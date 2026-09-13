export function classifyRoute(pathname) {
  const normalized = pathname.replace(/^\/v1(?=\/|$)/, '') || '/';
  if (/^\/audio\/speech\/?$/.test(normalized)) return 'tts';
  if (/^\/audio\/(transcriptions|translations)\/?$/.test(normalized)) return 'stt';
  return 'openai';
}

export function buildUpstreamUrl(baseUrl, incomingUrl) {
  const local = new URL(incomingUrl, 'http://localhost');
  let pathname = local.pathname.replace(/^\/v1(?=\/|$)/, '');
  if (!pathname) pathname = '/';
  return new URL(baseUrl.replace(/\/+$/, '') + pathname + local.search);
}

export function routeConfig(config, kind) {
  return kind === 'tts' ? config.tts : kind === 'stt' ? config.stt : config.openai;
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
