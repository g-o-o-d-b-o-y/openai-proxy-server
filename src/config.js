import path from 'node:path';
import { parseLimits } from './quota.js';

const asBool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const asInt = (value, fallback) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

const cleanBase = (value) => String(value || '').replace(/\/+$/, '');

export function loadConfig(env = process.env) {
  const openai = {
    baseUrl: cleanBase(env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || ''
  };

  const tts = {
    baseUrl: cleanBase(env.TTS_BASE_URL || openai.baseUrl),
    apiKey: env.TTS_API_KEY || openai.apiKey,
    model: env.TTS_MODEL || '',
    voice: env.TTS_VOICE || ''
  };

  const stt = {
    baseUrl: cleanBase(env.STT_BASE_URL || openai.baseUrl),
    apiKey: env.STT_API_KEY || openai.apiKey,
    model: env.STT_MODEL || ''
  };

  return {
    // Default binds all interfaces (0.0.0.0) so other devices on the network can
    // reach this proxy. Override with HOST=127.0.0.1 to restrict to loopback.
    host: env.HOST || '0.0.0.0',
    port: asInt(env.PORT, 56787),
    dashboard: asBool(env.DASHBOARD, true),
    dashboardPath: ('/' + String(env.DASHBOARD_PATH || '_proxy').replace(/^\/+|\/+$/g, '')),
    dashboardToken: env.DASHBOARD_TOKEN || '',
    proxyApiKey: env.PROXY_API_KEY || '',
    modelPolicy: ['default', 'force', 'passthrough'].includes(env.MODEL_POLICY) ? env.MODEL_POLICY : 'default',
    voicePolicy: ['default', 'force', 'passthrough'].includes(env.VOICE_POLICY) ? env.VOICE_POLICY : 'default',
    maxJsonBodyBytes: asInt(env.MAX_JSON_BODY_MB, 50) * 1024 * 1024,
    maxStreamBodyBytes: asInt(env.MAX_STREAM_BODY_MB, 512) * 1024 * 1024,
    upstreamTimeoutMs: asInt(env.UPSTREAM_TIMEOUT_MS, 0),
    maxLogEntries: asInt(env.MAX_LOG_ENTRIES, 1000),
    limits: parseLimits(env.LIMITS),
    statsFile: path.resolve(process.cwd(), env.STATS_FILE || '.openai-proxy-server/stats.json'),
    logLevel: env.LOG_LEVEL || 'info',
    corsOrigin: env.CORS_ORIGIN ?? '*',
    openrouterReferer: env.OPENROUTER_HTTP_REFERER || '',
    openrouterTitle: env.OPENROUTER_X_TITLE || '',
    openai,
    tts,
    stt
  };
}
