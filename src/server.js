import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { classifyRoute, buildUpstreamUrl, patchJsonBody, routeConfig } from './routing.js';
import { serveDashboard, serveFavicon } from './dashboard.js';
import { StatsStore } from './stats.js';
import { paint, statusStyle, routeLabel, formatDuration, humanBytes, formatCount, ellipsize, PREFIX } from './term.js';
import { QuotaStore, withRuleIds, matchRules, quotaSnapshots, strictest, denyReason, scopeValue } from './quota.js';

const HOP_BY_HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);

function copyRequestHeaders(headers, upstream, config) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host' || lower === 'authorization' || lower === 'content-length' || lower === 'accept-encoding') continue;
    if (value != null) out[key] = value;
  }
  if (upstream.apiKey) out.authorization = `Bearer ${upstream.apiKey}`;
  out['accept-encoding'] = 'identity';
  if (config.openrouterReferer) out['HTTP-Referer'] = config.openrouterReferer;
  if (config.openrouterTitle) out['X-Title'] = config.openrouterTitle;
  return out;
}

function copyResponseHeaders(headers, corsOrigin) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase()) || value == null) continue;
    out[key] = value;
  }
  if (corsOrigin) out['access-control-allow-origin'] = corsOrigin;
  return out;
}

function jsonError(res, status, code, message, config) {
  const body = JSON.stringify({ error: { message, type: code, code } });
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...(config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin } : {})
  });
  res.end(body);
}

function quotaHeaders(snapshot) {
  if (!snapshot) return {};
  return {
    'x-quota-used': String(snapshot.used),
    'x-quota-max': String(snapshot.max),
    'x-quota-remaining': String(snapshot.remaining),
    'x-quota-remaining-pct': String(snapshot.pct),
    'x-quota-window': snapshot.windowLabel,
    'x-quota-metric': snapshot.metric,
    'x-quota-key': snapshot.scope === 'ip' ? snapshot.key : 'all'
  };
}

function quotaError(res, config, reason, snapshot) {
  const body = JSON.stringify({ error: { message: reason, type: 'quota_exceeded', code: 'quota_exceeded', quota: snapshot } });
  res.writeHead(429, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin } : {}),
    ...quotaHeaders(snapshot)
  });
  res.end(body);
}

function authorized(req, config) {
  if (!config.proxyApiKey) return true;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  return token === config.proxyApiKey;
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`JSON request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), size };
}


function findUsage(value) {
  if (!value || typeof value !== 'object') return null;
  return value.usage || value.response?.usage || value.data?.usage || null;
}

function parseUsageFromBuffer(buffer, contentType) {
  if (!buffer?.length) return null;
  const text = buffer.toString('utf8');
  if (contentType.includes('text/event-stream')) {
    let found = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try { const obj = JSON.parse(raw); const usage = findUsage(obj); if (usage) found = usage; } catch {}
    }
    return found;
  }
  if (contentType.includes('json')) {
    try { return findUsage(JSON.parse(text)); } catch {}
  }
  return null;
}

// Paths that are never OpenAI-compatible API traffic (browser/service probes and
// assets automatically fetched by browsers when an upstream HTML page is rendered).
// They are answered locally, never proxied upstream, and never logged or counted.
function isBrowserNoise(pathname) {
  const p = String(pathname || '').toLowerCase();
  return p === '/robots.txt' || p === '/manifest.json' || p === '/manifest.webmanifest'
    || p === '/sitemap.xml' || p === '/asset-manifest.json'
    || p === '/.env' || p === '/.git/config'
    || p === '/.well-known' || p.startsWith('/.well-known/')
    || p.startsWith('/apple-touch-icon')
    || p === '/favicon.ico' || p === '/favicon.svg' || p.startsWith('/favicon/')
    || p === '/sw.js' || p === '/service-worker.js'
    || p.startsWith('/_next/') || p.startsWith('/_nuxt/')
    || p.startsWith('/cdn-cgi/');
}

function logLine(config, log) {
  if (config.logLevel === 'silent') return;
  const time = new Date(log.time).toTimeString().slice(0, 8);
  const status = log.status || 'ERR';
  const parts = [
    paint(time, 'gray'),
    paint(log.method, 'cyan'),
    ellipsize(log.path),
    paint(routeLabel(log.kind), 'magenta'),
    paint(String(status), statusStyle(status)),
    paint(formatDuration(log.durationMs), 'gray')
  ];
  if (log.usage?.totalTokens) parts.push(paint(`${formatCount(log.usage.totalTokens)} tok`, 'yellow'));
  if (log.bytesOut >= 1024) parts.push(paint(humanBytes(log.bytesOut), 'gray'));
  if (log.clientIp) parts.push(paint(log.clientIp, 'gray'));
  if (log.error) parts.push(paint(`error=${log.error}`, 'red'));
  console.log(`${paint(`${PREFIX} `, 'dim')}${parts.join(' ')}`);
}

export function createProxyServer(config, stats = new StatsStore({ file: config.statsFile, maxLogs: config.maxLogEntries })) {
  const quotaStore = new QuotaStore();
  const quotaRules = Array.isArray(config.limits) ? withRuleIds(config.limits) : [];

  const server = http.createServer(async (req, res) => {
    if (serveFavicon(req, res, { config })) return;

    // Opening the bare host (http://host:port/) should reach the dashboard.
    if (config.dashboard && (req.method === 'GET' || req.method === 'HEAD')) {
      const probeUrl = new URL(req.url, 'http://localhost');
      if (probeUrl.pathname === '/' || probeUrl.pathname === '') {
        res.writeHead(302, { location: `${config.dashboardPath}/`, 'cache-control': 'no-store' });
        res.end();
        return;
      }
    }

    if (serveDashboard(req, res, { config, stats, quotaStore, quotaRules })) return;

    const localUrl = new URL(req.url, 'http://localhost');
    if (isBrowserNoise(localUrl.pathname)) {
      jsonError(res, 404, 'not_found', 'Not found', config);
      return;
    }

    // A bare GET /v1 (browser address bar or SDK base-URL probe) is answered
    // locally instead of forwarding the upstream's 404 HTML page.
    if ((req.method === 'GET' || req.method === 'HEAD') && (localUrl.pathname === '/v1' || localUrl.pathname === '/v1/')) {
      const body = JSON.stringify({
        service: 'openai-proxy-server',
        endpoints: { api: '/v1/chat/completions', dashboard: `${config.dashboardPath}/` }
      });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        ...(config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin } : {})
      });
      res.end(body);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(config.corsOrigin ? { 'access-control-allow-origin': config.corsOrigin } : {}),
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': req.headers['access-control-request-headers'] || 'authorization,content-type',
        'access-control-max-age': '86400'
      });
      res.end();
      return;
    }

    if (!authorized(req, config)) {
      jsonError(res, 401, 'invalid_api_key', 'Invalid proxy API key', config);
      return;
    }

    const kind = classifyRoute(localUrl.pathname);
    const upstream = routeConfig(config, kind);
    if (!upstream.baseUrl) {
      jsonError(res, 500, 'proxy_configuration_error', `Missing upstream base URL for ${kind}`, config);
      return;
    }
    if (!upstream.apiKey) {
      jsonError(res, 500, 'proxy_configuration_error', `Missing upstream API key for ${kind}`, config);
      return;
    }

    const target = buildUpstreamUrl(upstream.baseUrl, req.url);
    const clientIp = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const requestMeta = stats.begin({ method: req.method, path: localUrl.pathname + localUrl.search, kind, clientIp });
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let bytesIn = 0;
    let parsedModel = null;
    let bodyBuffer = null;
    let upstreamReq;
    let finished = false;
    let matchedQuotaRules = [];
    let quotaDenied = false;
    let quotaStrict = null;

    const finishOnce = (result) => {
      if (finished) return;
      finished = true;
      const log = stats.finish(requestMeta, { bytesIn, ...result, quota: result.quota || quotaStrict });
      if (matchedQuotaRules.length && !quotaDenied) {
        for (const rule of matchedQuotaRules) {
          const amount = rule.metric === 'requests' ? 1 : (log.usage?.totalTokens || 0);
          quotaStore.record(rule, rule.ruleId, scopeValue(rule, clientIp), amount);
        }
        // Show the remaining AFTER this request consumed usage, so the first
        // request is e.g. 98% (not 100%) once its tokens were counted.
        const after = strictest(quotaSnapshots(quotaStore, matchedQuotaRules, clientIp));
        if (after) log.quota = after;
      }
      logLine(config, log);
    };

    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method || 'GET');
      const isJson = hasBody && /(^|;)\s*application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(contentType);
      if (isJson) {
        const read = await readJsonBody(req, config.maxJsonBodyBytes);
        bytesIn = read.size;
        if (read.buffer.length) {
          let value;
          try { value = JSON.parse(read.buffer.toString('utf8')); }
          catch { throw Object.assign(new Error('Invalid JSON request body'), { statusCode: 400 }); }
          patchJsonBody(value, { kind, upstream, modelPolicy: config.modelPolicy, voicePolicy: config.voicePolicy });
          parsedModel = value?.model || null;
          bodyBuffer = Buffer.from(JSON.stringify(value));
        } else {
          bodyBuffer = Buffer.alloc(0);
        }
      }

      // Quota pre-check (soft): reject before spending tokens upstream once the
      // window allowance is exhausted. Model-based rules need a known model
      // (JSON bodies); rules without a model matcher also apply to multipart
      // uploads (matched by route kind).
      if (quotaRules.length && (parsedModel !== null || quotaRules.some((rule) => !rule.model))) {
        matchedQuotaRules = matchRules(quotaRules, { model: parsedModel, kind });
        if (matchedQuotaRules.length) {
          const snapshots = quotaSnapshots(quotaStore, matchedQuotaRules, clientIp);
          quotaStrict = strictest(snapshots);
          const denied = denyReason(snapshots);
          if (denied) {
            quotaDenied = true;
            quotaError(res, config, denied, quotaStrict);
            finishOnce({ status: 429, bytesOut: 0, error: denied, model: parsedModel || upstream.model, quota: quotaStrict });
            return;
          }
        }
      }

      const headers = copyRequestHeaders(req.headers, upstream, config);
      if (bodyBuffer) headers['content-length'] = String(bodyBuffer.length);
      else if (!hasBody) delete headers['content-length'];

      const transport = target.protocol === 'https:' ? https : http;
      upstreamReq = transport.request(target, { method: req.method, headers }, (upstreamRes) => {
        const responseType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
        const capture = [];
        let captureBytes = 0;
        let bytesOut = 0;
        let streamedUsage = null;
        let ssePending = '';
        const sseDecoder = new StringDecoder('utf8');
        const captureLimit = 4 * 1024 * 1024;
        const isSse = responseType.includes('text/event-stream');
        const isJsonResponse = responseType.includes('json');

        const inspectSseText = (text, flush = false) => {
          ssePending += text;
          const lines = ssePending.split(/\r?\n/);
          ssePending = flush ? '' : (lines.pop() || '');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            try { const obj = JSON.parse(raw); const usage = findUsage(obj); if (usage) streamedUsage = usage; } catch {}
          }
        };

        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage || undefined, { ...copyResponseHeaders(upstreamRes.headers, config.corsOrigin), ...quotaHeaders(quotaStrict) });

        const tap = new Transform({
          transform(chunk, _enc, cb) {
            bytesOut += chunk.length;
            if (isSse) inspectSseText(sseDecoder.write(chunk));
            else if (isJsonResponse && captureBytes < captureLimit) {
              const remain = captureLimit - captureBytes;
              capture.push(chunk.length <= remain ? Buffer.from(chunk) : Buffer.from(chunk.subarray(0, remain)));
              captureBytes += Math.min(chunk.length, remain);
            }
            cb(null, chunk);
          }
        });

        upstreamRes.on('end', () => {
          if (isSse) inspectSseText(sseDecoder.end(), true);
          const usage = isSse ? streamedUsage : (isJsonResponse ? parseUsageFromBuffer(Buffer.concat(capture), responseType) : null);
          finishOnce({ status: upstreamRes.statusCode || 0, bytesOut, usage, model: parsedModel || upstream.model });
        });
        upstreamRes.on('error', (error) => finishOnce({ status: upstreamRes.statusCode || 0, bytesOut, error: error.message, model: parsedModel || upstream.model }));
        tap.on('error', (error) => {
          if (!res.destroyed) res.destroy(error);
        });
        upstreamRes.pipe(tap).pipe(res);
      });

      if (config.upstreamTimeoutMs > 0) {
        upstreamReq.setTimeout(config.upstreamTimeoutMs, () => upstreamReq.destroy(new Error(`Upstream timeout after ${config.upstreamTimeoutMs} ms`)));
      }

      upstreamReq.on('error', (error) => {
        const status = error.statusCode || (error.code === 'ETIMEDOUT' ? 504 : 502);
        if (!res.headersSent) jsonError(res, status, status === 413 ? 'request_too_large' : 'upstream_error', error.message, config);
        else if (!res.destroyed) res.destroy(error);
        finishOnce({ status, bytesOut: 0, error: error.message, model: parsedModel || upstream.model });
      });

      req.on('aborted', () => upstreamReq.destroy(new Error('Client aborted request')));

      if (bodyBuffer) {
        upstreamReq.end(bodyBuffer);
      } else if (hasBody) {
        let streamBytes = 0;
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            streamBytes += chunk.length;
            bytesIn = streamBytes;
            if (streamBytes > config.maxStreamBodyBytes) return cb(Object.assign(new Error('Streaming request body too large'), { statusCode: 413 }));
            cb(null, chunk);
          }
        });
        counter.on('error', (error) => upstreamReq.destroy(error));
        req.pipe(counter).pipe(upstreamReq);
      } else {
        upstreamReq.end();
      }
    } catch (error) {
      const status = error.statusCode || 500;
      if (!res.headersSent) jsonError(res, status, status === 413 ? 'request_too_large' : 'proxy_error', error.message, config);
      upstreamReq?.destroy();
      finishOnce({ status, bytesOut: 0, error: error.message, model: parsedModel || upstream.model });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (!authorized(req, config)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const localUrl = new URL(req.url, 'http://localhost');
    const kind = classifyRoute(localUrl.pathname);
    const upstream = routeConfig(config, kind);
    if (!upstream?.baseUrl || !upstream?.apiKey) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const target = buildUpstreamUrl(upstream.baseUrl, req.url);
    const headers = { ...req.headers, ...copyRequestHeaders(req.headers, upstream, config) };
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade || 'websocket';
    delete headers.host;
    delete headers['content-length'];

    const requestMeta = stats.begin({ method: 'WS', path: localUrl.pathname + localUrl.search, kind, clientIp: String(req.socket.remoteAddress || '').replace(/^::ffff:/, '') });
    let bytesIn = 0, bytesOut = 0, done = false;
    const finish = (status, error = null) => {
      if (done) return;
      done = true;
      const log = stats.finish(requestMeta, { status, bytesIn, bytesOut, error, model: upstream.model });
      logLine(config, log);
    };

    const transport = target.protocol === 'https:' ? https : http;
    const up = transport.request(target, { method: req.method || 'GET', headers });
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const raw = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || 'Switching Protocols'}`];
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) raw.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
      raw.push('', '');
      socket.write(raw.join('\r\n'));
      if (head?.length) upSocket.write(head);
      if (upHead?.length) socket.write(upHead);
      socket.on('data', chunk => { bytesIn += chunk.length; });
      upSocket.on('data', chunk => { bytesOut += chunk.length; });
      socket.pipe(upSocket).pipe(socket);
      socket.on('close', () => finish(101));
      upSocket.on('error', error => finish(101, error.message));
    });
    up.on('response', (upRes) => {
      socket.write(`HTTP/1.1 ${upRes.statusCode || 502} ${upRes.statusMessage || 'Upstream Error'}\r\nConnection: close\r\n\r\n`);
      upRes.pipe(socket);
      upRes.on('end', () => finish(upRes.statusCode || 502));
    });
    up.on('error', error => {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      socket.destroy();
      finish(0, error.message);
    });
    up.end();
  });

  server.stats = stats;
  return server;
}
