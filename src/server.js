// HTTP server: dashboard pages, customer API, admin API and the proxied
// OpenAI-compatible traffic.
//
// Requests fall through in this order:
//   1. favicon and public pages (landing, key dashboard, admin shell)
//   2. dashboard admin API and events
//   3. customer API under /v1 (keys, account, usage)
//   4. proxied /v1 traffic
//
// Only existing DB keys are accepted; `keys.require_key` controls whether a
// request without any token is allowed (anonymous traffic is logged but not
// billed).

import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { buildUpstreamUrl, classifyRoute, patchJsonBody, upstreamFor } from './routing.js';
import { createDashboard, serveFavicon, serveKeyDashboard, serveLanding } from './dashboard.js';
import { createCustomerApi } from './api/customer.js';
import { createAdminApi } from './api/admin.js';
import { estimateAudioMs } from './audio.js';
import { jsonError, remoteIp, sendJson } from './http.js';
import { formatUsd } from './money.js';
import { paint, statusStyle, routeLabel, formatDuration, humanBytes, formatCount, ellipsize, PREFIX } from './term.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const CAPTURE_LIMIT = 4 * 1024 * 1024;

function copyRequestHeaders(headers, upstream, config) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || ['host', 'authorization', 'x-api-key', 'content-length', 'accept-encoding'].includes(lower)) continue;
    if (value != null) out[key] = value;
  }
  if (upstream.apiKey) out.authorization = `Bearer ${upstream.apiKey}`;
  out['accept-encoding'] = 'identity';
  if (config.openrouter.referer) out['HTTP-Referer'] = config.openrouter.referer;
  if (config.openrouter.title) out['X-Title'] = config.openrouter.title;
  return out;
}

function copyResponseHeaders(headers, config) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase()) || value == null) continue;
    out[key] = value;
  }
  if (config.server.corsOrigin) out['access-control-allow-origin'] = config.server.corsOrigin;
  return out;
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
      try {
        const usage = findUsage(JSON.parse(raw));
        if (usage) found = usage;
      } catch { /* not a JSON event */ }
    }
    return found;
  }
  if (contentType.includes('json')) {
    try { return findUsage(JSON.parse(text)); } catch { /* invalid JSON */ }
  }
  return null;
}

// Browser/service probes and assets are never API traffic; answering them
// locally avoids noisy logs and upstream 404 HTML pages.
function isBrowserNoise(pathname) {
  const path = String(pathname || '').toLowerCase();
  return path === '/robots.txt' || path === '/manifest.json' || path === '/manifest.webmanifest'
    || path === '/sitemap.xml' || path === '/asset-manifest.json'
    || path === '/.env' || path === '/.git/config'
    || path === '/.well-known' || path.startsWith('/.well-known/')
    || path.startsWith('/apple-touch-icon')
    || path === '/favicon.ico' || path === '/favicon.svg' || path.startsWith('/favicon/')
    || path === '/sw.js' || path === '/service-worker.js'
    || path.startsWith('/_next/') || path.startsWith('/_nuxt/')
    || path.startsWith('/cdn-cgi/');
}

function logLine(config, request) {
  if (config.server.logLevel === 'silent') return;
  const time = new Date(request.time).toTimeString().slice(0, 8);
  const status = request.status || 'ERR';
  const parts = [
    paint(time, 'gray'),
    paint(request.method, 'cyan'),
    ellipsize(request.path),
    paint(routeLabel(request.kind), 'magenta'),
    paint(String(status), statusStyle(status)),
    paint(formatDuration(request.durationMs), 'gray')
  ];
  if (request.keyPrefix) parts.push(paint(request.keyPrefix, 'blue'));
  if (request.usage?.totalTokens) parts.push(paint(`${formatCount(request.usage.totalTokens)} tok`, 'yellow'));
  if (request.billedCostUsd) parts.push(paint(`billed ${formatUsd(request.billedCostUsd)}`, 'cyan'));
  if (request.fallback) parts.push(paint(`fallback=${request.fallback}`, 'magenta'));
  if (request.bytesOut >= 1024) parts.push(paint(humanBytes(request.bytesOut), 'gray'));
  if (request.clientIp) parts.push(paint(request.clientIp, 'gray'));
  if (request.error) parts.push(paint(`error=${request.error}`, 'red'));
  console.log(`${paint(`${PREFIX} `, 'dim')}${parts.join(' ')}`);
}

export function createProxyServer(config, usage, { keys, accounts, settings } = {}) {
  const handleCustomerApi = createCustomerApi({ config, db: keys.db, keys, accounts, usage });
  const handleAdminApi = createAdminApi({ config, keys, accounts, usage, settings });
  const handleDashboard = createDashboard({ config, keys, usage, adminApi: handleAdminApi, settings });

  const handleRequest = async (req, res) => {
    if (serveFavicon(req, res, config)) return;
    if (serveLanding(req, res, { config, accounts })) return;
    if (serveKeyDashboard(req, res, config)) return;
    if (await handleDashboard(req, res)) return;

    const url = new URL(req.url, 'http://localhost');
    if (await handleCustomerApi(req, res, url)) return;

    if (isBrowserNoise(url.pathname)) {
      jsonError(res, 404, 'not_found', 'Not found', config);
      return;
    }

    // Bare GET /v1 is an SDK base-URL probe; answer locally.
    if (['GET', 'HEAD'].includes(req.method || 'GET') && (url.pathname === '/v1' || url.pathname === '/v1/')) {
      const body = JSON.stringify({
        service: 'openai-proxy-server',
        endpoints: {
          chat: '/v1/chat/completions',
          keys: '/v1/keys',
          account: '/v1/account',
          dashboard: '/key/'
        }
      });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        ...(config.server.corsOrigin ? { 'access-control-allow-origin': config.server.corsOrigin } : {})
      });
      res.end(body);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(config.server.corsOrigin ? { 'access-control-allow-origin': config.server.corsOrigin } : {}),
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': req.headers['access-control-request-headers'] || 'authorization,content-type,x-api-key,x-admin-token',
        'access-control-max-age': '86400'
      });
      res.end();
      return;
    }

    if (!url.pathname.startsWith('/v1')) {
      jsonError(res, 404, 'not_found', 'Not found', config);
      return;
    }

    // ------------------------------------------------------------- identity
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
      || String(req.headers['x-api-key'] || '').trim();
    let identity = token ? keys.authenticate(token) : null;
    if (token && !identity) {
      // Open mode can treat placeholder tokens as anonymous (e.g. SDKs that
      // require an apiKey value); required mode always rejects unknown tokens.
      if (!config.keys.requireKey && config.keys.acceptAnyToken) identity = null;
      else {
        jsonError(res, 401, 'invalid_api_key', 'Invalid API key', config);
        return;
      }
    }
    if (!token && config.keys.requireKey) {
      jsonError(res, 401, 'missing_api_key', 'An API key is required. Create one at POST /v1/keys', config);
      return;
    }

    const kind = classifyRoute(url.pathname);
    const upstream = upstreamFor(config, kind);
    if (!upstream.baseUrl) {
      jsonError(res, 500, 'proxy_configuration_error', `Missing upstream base URL for ${kind}`, config);
      return;
    }
    if (!upstream.apiKey) {
      jsonError(res, 500, 'proxy_configuration_error', `Missing upstream API key for ${kind}`, config);
      return;
    }

    const requestMeta = usage.begin({
      method: req.method,
      path: url.pathname + url.search,
      kind,
      clientIp: remoteIp(req, config)
    });
    const keyInfo = identity ? { key: identity.key, account: identity.account } : null;
    const preBalance = identity ? accounts.accountBalance(identity.account.id) : null;
    const target = buildUpstreamUrl(upstream.baseUrl, req.url);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const hasBody = !['GET', 'HEAD'].includes(req.method || 'GET');
    const isJson = hasBody && /(^|;)\s*application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(contentType);

    let bytesIn = 0;
    let parsedModel = null;
    let jsonValue = null;
    let bodyBuffer = null;
    let activeUpstreamReq = null;
    let clientAborted = false;
    let finished = false;
    let servedModel = upstream.model;

    const meteringHeaders = () => ({
      'x-request-id': requestMeta.id,
      ...(identity ? { 'x-key-prefix': identity.key.keyPrefix } : {}),
      ...(preBalance ? { 'x-account-balance-usd': String(preBalance.availableUsd) } : {})
    });

    const finishOnce = (result) => {
      if (finished) return;
      finished = true;
      const request = usage.finish(requestMeta, { bytesIn, ...result, keyInfo });
      logLine(config, request);
    };

    const deny = (result) => {
      sendJson(res, result.status || 429, {
        error: { code: result.code, message: result.message, ...(result.balance ? { balance: result.balance } : {}) }
      }, config, {
        ...(result.retryAfter ? { 'retry-after': String(Math.ceil(result.retryAfter)) } : {}),
        ...meteringHeaders()
      });
      finishOnce({ status: result.status || 429, bytesOut: 0, error: result.message, countUsage: false, model: parsedModel || upstream.model });
    };

    const retryableStatus = (status) => status >= 500 || [400, 402, 404, 408, 429].includes(status);
    const isFallbackModel = (model) => model != null && model !== parsedModel;

    const runAttempt = ({ model, canRetry }) => new Promise((resolve) => {
      const headers = copyRequestHeaders(req.headers, upstream, config);
      if (bodyBuffer) headers['content-length'] = String(bodyBuffer.length);
      else if (!hasBody) delete headers['content-length'];

      const transport = target.protocol === 'https:' ? https : http;
      let settled = false;
      let timedOut = false;
      const settle = (retry) => {
        if (settled) return;
        settled = true;
        activeUpstreamReq = null;
        resolve({ retry });
      };

      const upstreamReq = transport.request(target, { method: req.method, headers }, (upstreamRes) => {
        if (settled) {
          upstreamRes.destroy();
          return;
        }
        if (canRetry && !clientAborted && retryableStatus(upstreamRes.statusCode || 502)) {
          upstreamRes.resume();
          upstreamRes.on('end', () => settle(true));
          upstreamRes.on('error', () => settle(true));
          upstreamRes.on('close', () => settle(true));
          return;
        }

        const responseType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
        const isSse = responseType.includes('text/event-stream');
        const isJsonResponse = responseType.includes('json');
        const isAudio = responseType.startsWith('audio/');
        const isWav = isAudio && /wav|wave/.test(responseType);
        const fallback = isFallbackModel(model) ? model : null;
        const capture = [];
        let captureBytes = 0;
        let bytesOut = 0;
        let streamedUsage = null;
        let audioBytes = 0;
        let audioHeader = null;
        let ssePending = '';
        const sseDecoder = new StringDecoder('utf8');

        const inspectSse = (text, flush = false) => {
          ssePending += text;
          const lines = ssePending.split(/\r?\n/);
          ssePending = flush ? '' : (lines.pop() || '');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const value = findUsage(JSON.parse(raw));
              if (value) streamedUsage = value;
            } catch { /* not a JSON event */ }
          }
        };

        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage || undefined, {
          ...copyResponseHeaders(upstreamRes.headers, config),
          ...meteringHeaders(),
          ...(fallback ? { 'x-model-fallback': fallback } : {})
        });

        const tap = new Transform({
          transform(chunk, _encoding, callback) {
            bytesOut += chunk.length;
            if (isSse) inspectSse(sseDecoder.write(chunk));
            else if (isJsonResponse && captureBytes < CAPTURE_LIMIT) {
              const remaining = CAPTURE_LIMIT - captureBytes;
              capture.push(chunk.length <= remaining ? Buffer.from(chunk) : Buffer.from(chunk.subarray(0, remaining)));
              captureBytes += Math.min(chunk.length, remaining);
            } else if (isAudio) {
              audioBytes += chunk.length;
              if (!audioHeader && isWav) audioHeader = Buffer.from(chunk.subarray(0, 64));
            }
            callback(null, chunk);
          }
        });

        upstreamRes.on('end', () => {
          if (isSse) inspectSse(sseDecoder.end(), true);
          let usagePayload = isSse
            ? streamedUsage
            : (isJsonResponse ? parseUsageFromBuffer(Buffer.concat(capture), responseType) : null);
          if (!usagePayload && isAudio && audioBytes > 0) {
            const audioMs = estimateAudioMs({ contentType: responseType, bytes: audioBytes, header: audioHeader });
            if (audioMs > 0) usagePayload = { audio_seconds: audioMs / 1000 };
          }
          finishOnce({ status: upstreamRes.statusCode || 0, bytesOut, usage: usagePayload, model, fallback });
          settle(false);
        });
        upstreamRes.on('error', (error) => {
          finishOnce({ status: upstreamRes.statusCode || 0, bytesOut, error: error.message, model });
          settle(false);
        });
        tap.on('error', (error) => {
          if (!res.destroyed) res.destroy(error);
        });
        upstreamRes.pipe(tap).pipe(res);
      });

      activeUpstreamReq = upstreamReq;
      if (config.server.upstreamTimeoutMs > 0) {
        upstreamReq.setTimeout(config.server.upstreamTimeoutMs, () => {
          timedOut = true;
          upstreamReq.destroy(new Error(`Upstream timeout after ${config.server.upstreamTimeoutMs} ms`));
        });
      }

      upstreamReq.on('error', (error) => {
        if (settled) return;
        const status = error.statusCode || (timedOut || error.code === 'ETIMEDOUT' ? 504 : 502);
        if (canRetry && !clientAborted && !res.headersSent && !error.statusCode) {
          settle(true);
          return;
        }
        if (!res.headersSent) jsonError(res, status, 'upstream_error', error.message, config, meteringHeaders());
        else if (!res.destroyed) res.destroy(error);
        finishOnce({ status, bytesOut: 0, error: error.message, model });
        settle(false);
      });

      if (bodyBuffer) {
        upstreamReq.end(bodyBuffer);
      } else if (hasBody) {
        let streamBytes = 0;
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            streamBytes += chunk.length;
            bytesIn = streamBytes;
            if (streamBytes > config.server.maxStreamBodyBytes) {
              callback(Object.assign(new Error('Streaming request body too large'), { statusCode: 413 }));
              return;
            }
            callback(null, chunk);
          }
        });
        counter.on('error', (error) => upstreamReq.destroy(error));
        req.pipe(counter).pipe(upstreamReq);
      } else {
        upstreamReq.end();
      }
    });

    const onClientGone = () => {
      if (finished) return;
      clientAborted = true;
      activeUpstreamReq?.destroy(new Error('Client aborted request'));
    };
    req.on('aborted', onClientGone);
    res.on('close', onClientGone);

    try {
      if (isJson) {
        const read = await readBody(req, config.server.maxJsonBodyBytes);
        bytesIn = read.size;
        if (read.buffer.length) {
          try { jsonValue = JSON.parse(read.buffer.toString('utf8')); }
          catch { throw Object.assign(new Error('Invalid JSON request body'), { statusCode: 400 }); }
          patchJsonBody(jsonValue, {
            kind,
            upstream,
            modelPolicy: config.upstreams.modelPolicy,
            voicePolicy: config.upstreams.voicePolicy
          });
          parsedModel = jsonValue?.model || null;
          bodyBuffer = Buffer.from(JSON.stringify(jsonValue));
        } else {
          bodyBuffer = Buffer.alloc(0);
        }
      }

      const configuredModel = String(upstream.model || '').toLowerCase();
      const usesConfiguredModel = Boolean(parsedModel && configuredModel && String(parsedModel).toLowerCase() === configuredModel);
      const fallbacks = isJson && usesConfiguredModel ? (upstream.modelFallbacks || []) : [];

      if (identity && !finished && !clientAborted) {
        const check = keys.checkRequest(identity.key, { model: parsedModel });
        if (!check.ok) {
          deny(check);
        } else {
          keys.touchKey(identity.key.id);
        }
      }

      for (let attempt = 0; !finished && !clientAborted && attempt <= fallbacks.length; attempt += 1) {
        const model = attempt === 0 ? parsedModel : fallbacks[attempt - 1];
        servedModel = model || parsedModel || upstream.model;

        if (attempt > 0 && jsonValue) {
          jsonValue.model = model;
          bodyBuffer = Buffer.from(JSON.stringify(jsonValue));
        }
        const { retry } = await runAttempt({ model, canRetry: attempt < fallbacks.length });
        if (!retry) break;
      }

      if (!finished) {
        finishOnce({ status: 502, bytesOut: 0, error: 'Client aborted request', model: servedModel });
      }
    } catch (error) {
      const status = error.statusCode || 500;
      if (!res.headersSent) jsonError(res, status, status === 413 ? 'request_too_large' : 'proxy_error', error.message, config, meteringHeaders());
      activeUpstreamReq?.destroy();
      finishOnce({ status, bytesOut: 0, error: error.message, model: servedModel });
    }
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) jsonError(res, 500, 'internal_error', 'Internal server error', config);
      else res.destroy();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
      || String(req.headers['x-api-key'] || '').trim();
    let identity = token ? keys.authenticate(token) : null;
    if (token && !identity) {
      if (!config.keys.requireKey && config.keys.acceptAnyToken) identity = null;
      else {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    if (!token && config.keys.requireKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (identity) {
      const check = keys.checkRequest(identity.key, { ignoreModel: true });
      if (!check.ok) {
        socket.write(`HTTP/1.1 ${check.status || 429} ${check.code}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
    }

    const url = new URL(req.url, 'http://localhost');
    const kind = classifyRoute(url.pathname);
    const upstream = upstreamFor(config, kind);
    if (!upstream?.baseUrl || !upstream?.apiKey) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const target = buildUpstreamUrl(upstream.baseUrl, req.url);
    const headers = copyRequestHeaders(req.headers, upstream, config);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade || 'websocket';
    delete headers['content-length'];

    const requestMeta = usage.begin({
      method: 'WS',
      path: url.pathname + url.search,
      kind,
      clientIp: remoteIp(req, config)
    });
    const keyInfo = identity ? { key: identity.key, account: identity.account } : null;
    let bytesIn = 0;
    let bytesOut = 0;
    let done = false;
    const finish = (status, error = null) => {
      if (done) return;
      done = true;
      logLine(config, usage.finish(requestMeta, { status, bytesIn, bytesOut, error, model: upstream.model, keyInfo }));
    };

    const transport = target.protocol === 'https:' ? https : http;
    const upstreamReq = transport.request(target, { method: req.method || 'GET', headers });
    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      const raw = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || 'Switching Protocols'}`];
      for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) raw.push(`${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}`);
      raw.push('', '');
      socket.write(raw.join('\r\n'));
      if (head?.length) upstreamSocket.write(head);
      if (upstreamHead?.length) socket.write(upstreamHead);
      socket.on('data', (chunk) => { bytesIn += chunk.length; });
      upstreamSocket.on('data', (chunk) => { bytesOut += chunk.length; });
      socket.pipe(upstreamSocket).pipe(socket);
      socket.on('close', () => finish(101));
      upstreamSocket.on('error', (error) => finish(101, error.message));
    });
    upstreamReq.on('response', (upstreamRes) => {
      socket.write(`HTTP/1.1 ${upstreamRes.statusCode || 502} ${upstreamRes.statusMessage || 'Upstream Error'}\r\nConnection: close\r\n\r\n`);
      upstreamRes.pipe(socket);
      upstreamRes.on('end', () => finish(upstreamRes.statusCode || 502));
    });
    upstreamReq.on('error', (error) => {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      socket.destroy();
      finish(0, error.message);
    });
    upstreamReq.end();
  });

  server.usage = usage;
  return server;
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw Object.assign(new Error(`Request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), size };
}
