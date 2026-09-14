// Shared HTTP helpers.

export function sendJson(res, status, payload, config = {}, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(config.server?.corsOrigin ? { 'access-control-allow-origin': config.server.corsOrigin } : {}),
    ...extraHeaders
  });
  res.end(body);
}

export function errorBody(code, message, extra = {}) {
  return JSON.stringify({ error: { code, message, ...extra } });
}

export function jsonError(res, status, code, message, config = {}, extraHeaders = {}) {
  const body = errorBody(code, message);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(config.server?.corsOrigin ? { 'access-control-allow-origin': config.server.corsOrigin } : {}),
    ...extraHeaders
  });
  res.end(body);
}

export async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`Request body exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

export function remoteIp(req, config) {
  if (config.server.trustProxy) {
    const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '');
    const first = forwarded.split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/, '');
  }
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// Absolute base URL derived from the request (behind a proxy the forwarded
// proto/host are honored only when trust_proxy is enabled).
export function baseUrl(req, config) {
  const host = String(req.headers.host || `127.0.0.1:${config.port}`);
  const forwardedProto = config.server.trustProxy ? req.headers['x-forwarded-proto'] : '';
  const proto = String(forwardedProto || 'http').split(',')[0].trim() || 'http';
  return `${proto}://${host}`;
}
