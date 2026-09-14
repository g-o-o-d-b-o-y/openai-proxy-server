// Runtime settings: stored in SQLite and editable from the admin dashboard.
//
// Environment variables seed the settings table on first start. Afterwards the
// database is authoritative and `applyTo(config)` keeps the live config object
// in sync, so changes take effect without a restart.

import crypto from 'node:crypto';
import { hashToken } from './auth.js';
import { parsePrices } from './billing.js';

export const DEFAULT_KEY_LIMITS = {
  spend: { max_usd: 5, window_hours: 720 },
  requests: { max: 2000, window_hours: 24 },
  rpm: 60,
  max_children: 2,
  allowed_models: []
};

const integer = (value, fallback = 0) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

const float = (value, fallback = 0) => {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

const boolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const text = (value) => (value == null ? '' : String(value));

const url = (value) => text(value).replace(/\/+$/, '');

const pathSegment = (value, fallback) => {
  const clean = text(value).replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]/g, '');
  return `/${clean || fallback}`;
};

const asObject = (value, fallback) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
);

// The live server configuration. Every field is either set by bootstrap
// (host/port/dbFile) or applied from the settings registry below.
export function createConfig(bootstrap) {
  return {
    host: bootstrap.host,
    port: bootstrap.port,
    dbFile: bootstrap.dbFile,
    keyPepper: '',
    dashboard: {
      enabled: true,
      path: '/dashboard',
      title: 'OpenAI Proxy',
      adminTokenHash: ''
    },
    upstreams: {
      llm: { baseUrl: '', apiKey: '', model: '', modelFallbacks: [] },
      tts: { baseUrl: '', apiKey: '', model: '', voice: '', modelFallbacks: [] },
      stt: { baseUrl: '', apiKey: '', model: '', modelFallbacks: [] },
      modelPolicy: 'default',
      voicePolicy: 'default'
    },
    billing: { markupPct: 0, freeCreditUsd: 0, freeCreditExpiryDays: 0, prices: {} },
    keys: {
      requireKey: true,
      acceptAnyToken: false,
      ipLimitPerMonth: 2,
      cooldownSeconds: 30,
      globalHourlyLimit: 100,
      maxPerAccount: 10,
      defaultLimits: { ...DEFAULT_KEY_LIMITS },
      ipOverrides: {},
      keyPrefix: 'sk-opx-',
      dashboardPrefix: 'dash_',
      redeemPrefix: 'OPX'
    },
    server: {
      corsOrigin: '',
      maxJsonBodyBytes: 50 * 1024 * 1024,
      maxStreamBodyBytes: 512 * 1024 * 1024,
      upstreamTimeoutMs: 0,
      logLevel: 'info',
      logRetentionDays: 30,
      maxLogEntries: 5000,
      trustProxy: false
    },
    openrouter: { referer: '', title: '' }
  };
}

// `upstreams` entries map one DB value to one config field. `apply` keeps the
// live config object current; `seed` provides the first-start default.
export const SETTINGS = [
  // ------------------------------------------------------------------ LLM
  {
    key: 'upstreams.llm.base_url', type: 'string', group: 'upstreams', label: 'LLM base URL',
    description: 'OpenAI-compatible base URL used for chat completions and generic routes.',
    seed: (b) => b.upstreams.llm.baseUrl, apply: (c, v) => { c.upstreams.llm.baseUrl = url(v); }
  },
  {
    key: 'upstreams.llm.api_key', type: 'secret', group: 'upstreams', label: 'LLM upstream key',
    seed: (b) => b.upstreams.llm.apiKey, apply: (c, v) => { c.upstreams.llm.apiKey = text(v); }
  },
  {
    key: 'upstreams.llm.model', type: 'string', group: 'upstreams', label: 'LLM model',
    seed: (b) => b.upstreams.llm.model, apply: (c, v) => { c.upstreams.llm.model = text(v); }
  },
  {
    key: 'upstreams.llm.model_fallbacks', type: 'list', group: 'upstreams', label: 'LLM fallback models',
    description: 'Tried in order when the configured model is unavailable.',
    seed: (b) => b.upstreams.llm.modelFallbacks, apply: (c, v) => { c.upstreams.llm.modelFallbacks = asList(v); }
  },
  // ------------------------------------------------------------------ TTS
  {
    key: 'upstreams.tts.base_url', type: 'string', group: 'upstreams', label: 'TTS base URL',
    seed: (b) => b.upstreams.tts.baseUrl, apply: (c, v) => { c.upstreams.tts.baseUrl = url(v); }
  },
  {
    key: 'upstreams.tts.api_key', type: 'secret', group: 'upstreams', label: 'TTS upstream key',
    seed: (b) => b.upstreams.tts.apiKey, apply: (c, v) => { c.upstreams.tts.apiKey = text(v); }
  },
  {
    key: 'upstreams.tts.model', type: 'string', group: 'upstreams', label: 'TTS model',
    seed: (b) => b.upstreams.tts.model, apply: (c, v) => { c.upstreams.tts.model = text(v); }
  },
  {
    key: 'upstreams.tts.voice', type: 'string', group: 'upstreams', label: 'TTS voice',
    seed: (b) => b.upstreams.tts.voice, apply: (c, v) => { c.upstreams.tts.voice = text(v); }
  },
  {
    key: 'upstreams.tts.model_fallbacks', type: 'list', group: 'upstreams', label: 'TTS fallback models',
    seed: (b) => b.upstreams.tts.modelFallbacks, apply: (c, v) => { c.upstreams.tts.modelFallbacks = asList(v); }
  },
  // ------------------------------------------------------------------ STT
  {
    key: 'upstreams.stt.base_url', type: 'string', group: 'upstreams', label: 'STT base URL',
    seed: (b) => b.upstreams.stt.baseUrl, apply: (c, v) => { c.upstreams.stt.baseUrl = url(v); }
  },
  {
    key: 'upstreams.stt.api_key', type: 'secret', group: 'upstreams', label: 'STT upstream key',
    seed: (b) => b.upstreams.stt.apiKey, apply: (c, v) => { c.upstreams.stt.apiKey = text(v); }
  },
  {
    key: 'upstreams.stt.model', type: 'string', group: 'upstreams', label: 'STT model',
    seed: (b) => b.upstreams.stt.model, apply: (c, v) => { c.upstreams.stt.model = text(v); }
  },
  {
    key: 'upstreams.stt.model_fallbacks', type: 'list', group: 'upstreams', label: 'STT fallback models',
    seed: (b) => b.upstreams.stt.modelFallbacks, apply: (c, v) => { c.upstreams.stt.modelFallbacks = asList(v); }
  },
  {
    key: 'upstreams.model_policy', type: 'enum', options: ['default', 'force', 'passthrough'], group: 'upstreams',
    label: 'Model policy', description: 'default: inject when absent; force: always override; passthrough: never touch.',
    seed: (b) => b.upstreams.modelPolicy, apply: (c, v) => { c.upstreams.modelPolicy = v; }
  },
  {
    key: 'upstreams.voice_policy', type: 'enum', options: ['default', 'force', 'passthrough'], group: 'upstreams',
    label: 'Voice policy',
    seed: (b) => b.upstreams.voicePolicy, apply: (c, v) => { c.upstreams.voicePolicy = v; }
  },
  {
    key: 'openrouter.referer', type: 'string', group: 'upstreams', label: 'OpenRouter HTTP-Referer',
    seed: (b) => b.openrouter.referer, apply: (c, v) => { c.openrouter.referer = text(v); }
  },
  {
    key: 'openrouter.title', type: 'string', group: 'upstreams', label: 'OpenRouter X-Title',
    seed: (b) => b.openrouter.title, apply: (c, v) => { c.openrouter.title = text(v); }
  },

  // --------------------------------------------------------------- billing
  {
    key: 'billing.markup_pct', type: 'float', group: 'billing', label: 'Markup %',
    description: 'Percentage added on top of upstream cost: billed = upstream × (1 + markup / 100).',
    min: 0, max: 1000, seed: (b) => b.billing.markupPct, apply: (c, v) => { c.billing.markupPct = Math.max(0, float(v)); }
  },
  {
    key: 'billing.free_credit_usd', type: 'float', group: 'billing', label: 'Free credit per account ($)',
    min: 0, seed: (b) => b.billing.freeCreditUsd, apply: (c, v) => { c.billing.freeCreditUsd = Math.max(0, float(v)); }
  },
  {
    key: 'billing.free_credit_expiry_days', type: 'int', group: 'billing', label: 'Free credit expiry (days)',
    description: '0 means the evaluation credit never expires.',
    min: 0, seed: (b) => b.billing.freeCreditExpiryDays, apply: (c, v) => { c.billing.freeCreditExpiryDays = Math.max(0, integer(v)); }
  },
  {
    key: 'billing.prices', type: 'json', group: 'billing', label: 'Price table',
    description: 'USD per 1M tokens and USD per audio second: {"model":{"input":0.5,"output":1.5,"audio_second":0.01},"default":{...}}',
    seed: (b) => b.billing.prices, apply: (c, v) => { c.billing.prices = parsePrices(v); }
  },

  // ------------------------------------------------------------------ keys
  {
    key: 'keys.require_key', type: 'bool', group: 'keys', label: 'Require an API key',
    description: 'Reject proxied requests that do not present a valid key.',
    seed: (b) => b.keys.requireKey, apply: (c, v) => { c.keys.requireKey = boolean(v, true); }
  },
  {
    key: 'keys.accept_any_token', type: 'bool', group: 'keys', label: 'Accept any token in open mode',
    description: 'Only when require_key is off: unknown tokens are treated as anonymous instead of rejected. '
      + 'Lets SDKs with a placeholder key work without issuing real keys.',
    seed: (b) => b.keys.acceptAnyToken, apply: (c, v) => { c.keys.acceptAnyToken = boolean(v); }
  },
  {
    key: 'keys.ip_limit_per_month', type: 'int', group: 'keys', label: 'Self-service keys per IP per month',
    description: '0 disables the limit. Accounts with an active subscription or explicit permission are exempt.',
    min: 0, seed: (b) => b.keys.ipLimitPerMonth, apply: (c, v) => { c.keys.ipLimitPerMonth = Math.max(0, integer(v)); }
  },
  {
    key: 'keys.cooldown_seconds', type: 'int', group: 'keys', label: 'Key creation cooldown (seconds)',
    min: 0, seed: (b) => b.keys.cooldownSeconds, apply: (c, v) => { c.keys.cooldownSeconds = Math.max(0, integer(v)); }
  },
  {
    key: 'keys.global_hourly_limit', type: 'int', group: 'keys', label: 'Key creations per hour (global)',
    min: 0, seed: (b) => b.keys.globalHourlyLimit, apply: (c, v) => { c.keys.globalHourlyLimit = Math.max(0, integer(v)); }
  },
  {
    key: 'keys.max_per_account', type: 'int', group: 'keys', label: 'Max active keys per account',
    min: 1, seed: (b) => b.keys.maxPerAccount, apply: (c, v) => { c.keys.maxPerAccount = Math.max(1, integer(v)); }
  },
  {
    key: 'keys.default_limits', type: 'json', group: 'keys', label: 'Default limits for new keys',
    description: '{"spend":{"max_usd":5,"window_hours":720},"requests":{"max":2000,"window_hours":24},"rpm":60,"max_children":2,"allowed_models":[]}',
    seed: (b) => b.keys.defaultLimits || { ...DEFAULT_KEY_LIMITS }, apply: (c, v) => { c.keys.defaultLimits = asObject(v, { ...DEFAULT_KEY_LIMITS }); }
  },
  {
    key: 'keys.ip_overrides', type: 'json', group: 'keys', label: 'IP allowance overrides',
    description: 'Per-IP monthly key limit: {"203.0.113.7":10,"198.51.100.9":-1}. -1 means unlimited.',
    seed: (b) => b.keys.ipOverrides, apply: (c, v) => { c.keys.ipOverrides = asObject(v, {}); }
  },
  {
    key: 'keys.key_prefix', type: 'string', group: 'keys', label: 'API key prefix',
    pattern: '^[A-Za-z0-9_-]{1,16}$', seed: (b) => b.keys.keyPrefix, apply: (c, v) => { c.keys.keyPrefix = text(v) || 'sk-opx-'; }
  },
  {
    key: 'keys.dashboard_prefix', type: 'string', group: 'keys', label: 'Dashboard token prefix',
    pattern: '^[A-Za-z0-9_-]{1,16}$', seed: (b) => b.keys.dashboardPrefix, apply: (c, v) => { c.keys.dashboardPrefix = text(v) || 'dash_'; }
  },
  {
    key: 'keys.redeem_prefix', type: 'string', group: 'keys', label: 'Redeem code prefix',
    pattern: '^[A-Z0-9]{2,8}$', seed: (b) => b.keys.redeemPrefix, apply: (c, v) => { c.keys.redeemPrefix = text(v).toUpperCase() || 'OPX'; }
  },

  // ---------------------------------------------------------------- server
  {
    key: 'server.cors_origin', type: 'string', group: 'server', label: 'CORS origin',
    description: 'Empty disables CORS headers. * allows any origin.',
    seed: (b) => b.server.corsOrigin, apply: (c, v) => { c.server.corsOrigin = text(v); }
  },
  {
    key: 'server.max_json_body_mb', type: 'int', group: 'server', label: 'Max JSON body (MB)',
    min: 1, seed: (b) => b.server.maxJsonBodyMb, apply: (c, v) => { c.server.maxJsonBodyBytes = Math.max(1, integer(v)) * 1024 * 1024; }
  },
  {
    key: 'server.max_stream_body_mb', type: 'int', group: 'server', label: 'Max streamed body (MB)',
    min: 1, seed: (b) => b.server.maxStreamBodyMb, apply: (c, v) => { c.server.maxStreamBodyBytes = Math.max(1, integer(v)) * 1024 * 1024; }
  },
  {
    key: 'server.upstream_timeout_ms', type: 'int', group: 'server', label: 'Upstream timeout (ms)',
    description: '0 disables the timeout.',
    min: 0, seed: (b) => b.server.upstreamTimeoutMs, apply: (c, v) => { c.server.upstreamTimeoutMs = Math.max(0, integer(v)); }
  },
  {
    key: 'server.log_level', type: 'enum', options: ['info', 'silent'], group: 'server', label: 'Console log level',
    seed: (b) => b.server.logLevel, apply: (c, v) => { c.server.logLevel = v; }
  },
  {
    key: 'server.log_retention_days', type: 'int', group: 'server', label: 'Request log retention (days)',
    description: '0 keeps logs forever (bounded by max entries).',
    min: 0, seed: (b) => b.server.logRetentionDays, apply: (c, v) => { c.server.logRetentionDays = Math.max(0, integer(v)); }
  },
  {
    key: 'server.max_log_entries', type: 'int', group: 'server', label: 'Max request log entries',
    min: 100, seed: (b) => b.server.maxLogEntries, apply: (c, v) => { c.server.maxLogEntries = Math.max(100, integer(v)); }
  },
  {
    key: 'server.trust_proxy', type: 'bool', group: 'server', label: 'Trust proxy headers',
    description: 'Use X-Forwarded-For / CF-Connecting-IP for client IPs. Enable only behind a trusted reverse proxy.',
    seed: (b) => b.server.trustProxy, apply: (c, v) => { c.server.trustProxy = boolean(v); }
  },

  // ------------------------------------------------------------- dashboard
  {
    key: 'dashboard.enabled', type: 'bool', group: 'dashboard', label: 'Enable admin dashboard',
    seed: (b) => b.dashboard.enabled, apply: (c, v) => { c.dashboard.enabled = boolean(v, true); }
  },
  {
    key: 'dashboard.path', type: 'string', group: 'dashboard', label: 'Dashboard path',
    description: 'URL path segment for the admin dashboard (without slashes).',
    pattern: '^[A-Za-z0-9._-]{1,32}$', seed: (b) => b.dashboard.path, apply: (c, v) => { c.dashboard.path = pathSegment(v, 'dashboard'); }
  },
  {
    key: 'dashboard.title', type: 'string', group: 'dashboard', label: 'Site title',
    description: 'Shown in the browser tab and the page header.',
    seed: (b) => b.dashboard.title, apply: (c, v) => { c.dashboard.title = text(v) || 'OpenAI Proxy'; }
  },
  {
    key: 'dashboard.admin_token_hash', type: 'secret', group: 'dashboard', label: 'Admin token',
    description: 'Leave empty to keep the current token. Setting one protects the dashboard and its API.',
    seed: (b) => (b.dashboard.adminToken ? hashToken(b.dashboard.adminToken) : ''),
    apply: (c, v) => { c.dashboard.adminTokenHash = text(v); }
  },

  // -------------------------------------------------------------- internal
  {
    key: 'security.key_pepper', type: 'secret', group: 'server', label: 'Key pepper',
    description: 'Random secret used to hash API keys. Rotating it invalidates every key.',
    system: true, seed: () => crypto.randomBytes(32).toString('hex'), apply: (c, v) => { c.keyPepper = text(v); }
  }
];

const BY_KEY = new Map(SETTINGS.map((entry) => [entry.key, entry]));

function asList(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  for (const item of source) {
    const trimmed = String(item).trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

function coerce(entry, raw) {
  switch (entry.type) {
    case 'bool': return boolean(raw, false);
    case 'int': return integer(raw, 0);
    case 'float': return float(raw, 0);
    case 'list': return asList(raw);
    case 'enum': return entry.options.includes(raw) ? raw : entry.options[0];
    case 'json': return raw ?? null;
    default: return text(raw);
  }
}

function validate(entry, value) {
  if (entry.type === 'int' || entry.type === 'float') {
    if (!Number.isFinite(Number(value))) throw badRequest(`${entry.key} must be a number`);
    if (entry.min != null && Number(value) < entry.min) throw badRequest(`${entry.key} must be >= ${entry.min}`);
    if (entry.max != null && Number(value) > entry.max) throw badRequest(`${entry.key} must be <= ${entry.max}`);
  }
  if (entry.pattern && value !== '' && !new RegExp(entry.pattern).test(String(value))) {
    throw badRequest(`${entry.key} must match ${entry.pattern}`);
  }
  return value;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export class SettingsStore {
  constructor(db, bootstrap) {
    this.db = db;
    this.bootstrap = bootstrap;
    this.cache = new Map();
    this.#seed();
    this.#load();
  }

  #seed() {
    const insert = this.db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    const at = new Date().toISOString();
    for (const entry of SETTINGS) {
      const value = entry.seed ? entry.seed(this.bootstrap.seed) : null;
      insert.run(entry.key, JSON.stringify(value ?? null), at);
    }
  }

  #load() {
    this.cache.clear();
    for (const row of this.db.prepare('SELECT key, value FROM settings').all()) {
      try { this.cache.set(row.key, JSON.parse(row.value)); }
      catch { this.cache.set(row.key, null); }
    }
  }

  get(key = null) {
    if (key == null) return Object.fromEntries(this.cache);
    return this.cache.get(key);
  }

  set(key, rawValue, { apply = true, config = null } = {}) {
    const entry = BY_KEY.get(key);
    if (!entry) throw badRequest(`Unknown setting: ${key}`);
    if (entry.system) throw badRequest(`${key} is managed internally`);
    const value = validate(entry, coerce(entry, rawValue));
    this.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, JSON.stringify(value ?? null), new Date().toISOString());
    this.cache.set(key, value);
    if (apply && config) entry.apply(config, value);
    return value;
  }

  setMany(updates, config = null) {
    for (const key of Object.keys(updates || {})) {
      const entry = BY_KEY.get(key);
      if (!entry) throw badRequest(`Unknown setting: ${key}`);
      if (entry.system) throw badRequest(`${key} is managed internally`);
    }
    const changed = [];
    for (const [key, value] of Object.entries(updates || {})) {
      changed.push([key, this.set(key, value, { apply: false, config })]);
    }
    if (config) for (const [key] of changed) BY_KEY.get(key).apply(config, this.cache.get(key));
    return changed.map(([key]) => key);
  }

  applyTo(config) {
    for (const entry of SETTINGS) entry.apply(config, this.cache.get(entry.key));
    return config;
  }

  adminView() {
    return SETTINGS.filter((entry) => !entry.system).map((entry) => {
      const value = this.cache.get(entry.key) ?? null;
      return {
        key: entry.key,
        group: entry.group,
        label: entry.label,
        description: entry.description || '',
        type: entry.type,
        options: entry.options || null,
        min: entry.min ?? null,
        max: entry.max ?? null,
        secret: entry.type === 'secret',
        hasValue: entry.type === 'secret' ? Boolean(value) : undefined,
        value: entry.type === 'secret' ? null : value
      };
    });
  }
}

export { hashToken };
