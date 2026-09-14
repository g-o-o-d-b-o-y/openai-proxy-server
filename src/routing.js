// Route classification and request shaping.

export function classifyRoute(pathname) {
  const path = pathname.replace(/^\/v1(?=\/|$)/, '') || '/';
  if (/^\/audio\/speech\/?$/.test(path)) return 'tts';
  if (/^\/audio\/(transcriptions|translations)\/?$/.test(path)) return 'stt';
  return 'llm';
}

export function upstreamFor(config, kind) {
  if (kind === 'tts') return config.upstreams.tts;
  if (kind === 'stt') return config.upstreams.stt;
  return config.upstreams.llm;
}

export function buildUpstreamUrl(baseUrl, incomingUrl) {
  const local = new URL(incomingUrl, 'http://localhost');
  let pathname = local.pathname.replace(/^\/v1(?=\/|$)/, '');
  if (!pathname) pathname = '/';
  return new URL(`${baseUrl.replace(/\/+$/, '')}${pathname}${local.search}`);
}

function applyPolicy(object, key, configured, policy) {
  if (!configured || policy === 'passthrough') return;
  if (policy === 'force' || object[key] == null || object[key] === '') object[key] = configured;
}

export function patchJsonBody(value, { kind, upstream, modelPolicy, voicePolicy }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  applyPolicy(value, 'model', upstream.model, modelPolicy);
  if (kind === 'tts') applyPolicy(value, 'voice', upstream.voice, voicePolicy);
  return value;
}
