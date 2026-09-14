// Environment bootstrap.
//
// Environment variables are read once at startup and used as defaults when the
// settings table is first populated. The database is the source of truth after
// that; only HOST, PORT and DB_FILE remain environment-only because they are
// needed before a database connection exists.

import path from 'node:path';

const asBool = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const asInt = (value, fallback) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

const asFloat = (value, fallback) => {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

const asList = (value) => {
  const seen = new Set();
  for (const item of String(value || '').split(',')) {
    const trimmed = item.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
};

const asObject = (value) => {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const trimUrl = (value) => String(value || '').replace(/\/+$/, '');

export function loadBootstrap(env = process.env) {
  const llm = {
    baseUrl: trimUrl(env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || '',
    modelFallbacks: asList(env.OPENAI_MODEL_FALLBACKS)
  };
  const tts = {
    baseUrl: trimUrl(env.TTS_BASE_URL || llm.baseUrl),
    apiKey: env.TTS_API_KEY || llm.apiKey,
    model: env.TTS_MODEL || '',
    voice: env.TTS_VOICE || '',
    modelFallbacks: asList(env.TTS_MODEL_FALLBACKS)
  };
  const stt = {
    baseUrl: trimUrl(env.STT_BASE_URL || llm.baseUrl),
    apiKey: env.STT_API_KEY || llm.apiKey,
    model: env.STT_MODEL || '',
    modelFallbacks: asList(env.STT_MODEL_FALLBACKS)
  };

  return {
    host: env.HOST || '0.0.0.0',
    port: asInt(env.PORT, 56787),
    dbFile: env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(process.cwd(), env.DB_FILE || '.openai-proxy-server/proxy.db'),
    seed: {
      dashboard: {
        enabled: asBool(env.DASHBOARD, true),
        path: env.DASHBOARD_PATH || 'dashboard',
        title: env.SITE_NAME || 'OpenAI Proxy',
        adminToken: env.ADMIN_TOKEN || ''
      },
      upstreams: {
        llm,
        tts,
        stt,
        modelPolicy: ['default', 'force', 'passthrough'].includes(env.MODEL_POLICY) ? env.MODEL_POLICY : 'default',
        voicePolicy: ['default', 'force', 'passthrough'].includes(env.VOICE_POLICY) ? env.VOICE_POLICY : 'default'
      },
      billing: {
        markupPct: asFloat(env.MARKUP_PCT, 30),
        freeCreditUsd: asFloat(env.FREE_CREDIT_USD, 0.25),
        freeCreditExpiryDays: asInt(env.FREE_CREDIT_EXPIRY_DAYS, 30),
        prices: asObject(env.PRICES)
      },
      keys: {
        requireKey: asBool(env.REQUIRE_KEY, true),
        acceptAnyToken: asBool(env.ACCEPT_ANY_TOKEN, false),
        ipLimitPerMonth: asInt(env.KEY_IP_LIMIT_PER_MONTH, 2),
        cooldownSeconds: asInt(env.KEY_COOLDOWN_SECONDS, 30),
        globalHourlyLimit: asInt(env.KEY_GLOBAL_HOURLY_LIMIT, 100),
        maxPerAccount: asInt(env.KEY_MAX_PER_ACCOUNT, 10),
        defaultLimits: asObject(env.KEY_DEFAULT_LIMITS),
        ipOverrides: asObject(env.KEY_IP_OVERRIDES) || {},
        keyPrefix: env.KEY_PREFIX || 'sk-opx-',
        dashboardPrefix: env.DASHBOARD_TOKEN_PREFIX || 'dash_',
        redeemPrefix: env.REDEEM_CODE_PREFIX || 'OPX'
      },
      server: {
        corsOrigin: env.CORS_ORIGIN ?? '',
        maxJsonBodyMb: asInt(env.MAX_JSON_BODY_MB, 50),
        maxStreamBodyMb: asInt(env.MAX_STREAM_BODY_MB, 512),
        upstreamTimeoutMs: asInt(env.UPSTREAM_TIMEOUT_MS, 0),
        logLevel: env.LOG_LEVEL || 'info',
        logRetentionDays: asInt(env.LOG_RETENTION_DAYS, 30),
        maxLogEntries: asInt(env.MAX_LOG_ENTRIES, 5000),
        trustProxy: asBool(env.TRUST_PROXY, false)
      },
      openrouter: {
        referer: env.OPENROUTER_HTTP_REFERER || '',
        title: env.OPENROUTER_X_TITLE || ''
      },
      keyPepper: env.KEY_PEPPER || ''
    }
  };
}
