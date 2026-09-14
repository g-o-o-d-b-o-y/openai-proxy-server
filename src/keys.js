// API keys: creation, authentication, per-key limits and rotation.
//
// The abuse guards (per-IP monthly allowance, cooldown, global hourly cap and
// per-account key count) are evaluated inside the same transaction as the
// insert, so parallel requests cannot overshoot them.

import { displayPrefix, generateApiKey, generateDashToken, generateId, hashKey } from './auth.js';
import { transaction } from './db.js';
import { formatUsd, microToUsd, usdToMicro } from './money.js';
import { keyUsageWindows, sumKeyUsage } from './usage.js';

const NOW = () => new Date().toISOString();
const monthStart = (now = Date.now()) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

const integer = (value, fallback = 0) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

// Canonical shape stored in api_keys.limits:
//   spend: { max_usd, window_hours }, tokens: { max, window_hours },
//   requests: { max, window_hours }, rpm, max_children, allowed_models.
export function normalizeKeyLimits(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const limits = {};
  if (input.spend && Number(input.spend.max_usd) > 0) {
    limits.spend = { max_usd: Number(input.spend.max_usd), window_hours: Math.max(1, integer(input.spend.window_hours, 720)) };
  }
  if (input.tokens && Number(input.tokens.max) > 0) {
    limits.tokens = { max: Math.max(1, integer(input.tokens.max, 1)), window_hours: Math.max(1, integer(input.tokens.window_hours, 720)) };
  }
  if (input.requests && Number(input.requests.max) > 0) {
    limits.requests = { max: Math.max(1, integer(input.requests.max, 1)), window_hours: Math.max(1, integer(input.requests.window_hours, 24)) };
  }
  if (Number(input.rpm) > 0) limits.rpm = Math.max(1, integer(input.rpm));
  if (Number(input.max_children) > 0) limits.max_children = Math.max(1, integer(input.max_children));
  const models = [];
  for (const model of Array.isArray(input.allowed_models) ? input.allowed_models : []) {
    const value = String(model).trim().toLowerCase();
    if (value && !models.includes(value)) models.push(value);
  }
  if (models.length) limits.allowed_models = models;
  if (input.expires_at) limits.expires_at = String(input.expires_at);
  return limits;
}

function parseLimits(raw) {
  try { return normalizeKeyLimits(JSON.parse(raw || '{}')); }
  catch { return {}; }
}

const keyFromRow = (row) => row && {
  id: row.id,
  keyPrefix: row.key_prefix,
  name: row.name,
  accountId: row.account_id,
  parentKeyId: row.parent_key_id,
  createdAt: row.created_at,
  createdIp: row.created_ip,
  lastUsedAt: row.last_used_at,
  status: row.status,
  bypassIpLimit: Boolean(row.bypass_ip_limit),
  expiresAt: row.expires_at,
  markupPct: row.markup_pct == null ? null : Number(row.markup_pct),
  limits: parseLimits(row.limits),
  totalRequests: Number(row.total_requests),
  totalTokens: Number(row.total_tokens),
  totalCostUsd: microToUsd(row.total_cost_micro),
  totalBilledUsd: microToUsd(row.total_billed_micro)
};

// Sliding one-minute limiter for per-key rpm caps (bounded, no persistence).
class MinuteRateLimiter {
  #minute = new Map();

  check(keyId, limit, now = Date.now()) {
    if (!limit || limit <= 0) return { ok: true };
    const minute = Math.floor(now / 60000);
    const used = this.#minute.get(keyId);
    const count = used && used.minute === minute ? used.count : 0;
    if (count >= limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil(((minute + 1) * 60000 - now) / 1000)) };
    }
    this.#minute.set(keyId, { minute, count: count + 1 });
    if (this.#minute.size > 20000) this.#prune(minute);
    return { ok: true };
  }

  #prune(minute) {
    for (const [id, used] of this.#minute) if (used.minute < minute) this.#minute.delete(id);
  }
}

export class KeyStore {
  constructor({ db, config, accounts }) {
    this.db = db;
    this.config = config;
    this.accounts = accounts;
    this.limiter = new MinuteRateLimiter();
  }

  // ------------------------------------------------------------ creation

  checkKeyCreationAllowed({ ip = '', account = null, now = Date.now() } = {}) {
    const { keys } = this.config;
    if (keys.globalHourlyLimit > 0) {
      const created = this.db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE created_at >= ?')
        .get(new Date(now - 3600000).toISOString()).n;
      if (created >= keys.globalHourlyLimit) {
        return { allowed: false, status: 429, code: 'creation_rate_limited', message: 'Key creation is temporarily rate limited', retryAfter: 3600 };
      }
    }

    if (account) {
      if (account.status !== 'active') {
        return { allowed: false, status: 403, code: 'account_suspended', message: 'This account is suspended' };
      }
      const activeKeys = this.db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ? AND status = 'active'").get(account.id).n;
      if (activeKeys >= keys.maxPerAccount) {
        return { allowed: false, status: 429, code: 'account_key_limit', message: `This account already has ${keys.maxPerAccount} active keys` };
      }
      if (this.accounts.hasActiveSubscription(account.id, now) || account.canCreateKeys) {
        return { allowed: true, bypass: true };
      }
    }

    const override = keys.ipOverrides[ip];
    if (override === -1 || override === '-1') return { allowed: true, bypass: false };
    const monthlyLimit = Number.isFinite(Number(override)) ? Number(override) : keys.ipLimitPerMonth;
    if (monthlyLimit <= 0) return { allowed: true, bypass: false };

    const createdThisMonth = this.db.prepare(`SELECT COUNT(*) AS n FROM api_keys
      WHERE created_ip = ? AND created_at >= ? AND bypass_ip_limit = 0`)
      .get(ip, monthStart(now)).n;
    if (createdThisMonth >= monthlyLimit) {
      return {
        allowed: false, status: 429, code: 'ip_key_limit',
        message: `This IP address has already created ${monthlyLimit} key${monthlyLimit === 1 ? '' : 's'} this month. `
          + 'Disable any VPN/proxy and try again next month, or subscribe for additional keys.'
      };
    }

    if (keys.cooldownSeconds > 0) {
      const last = this.db.prepare('SELECT created_at FROM api_keys WHERE created_ip = ? ORDER BY created_at DESC LIMIT 1').get(ip);
      if (last) {
        const elapsed = (now - Date.parse(last.created_at)) / 1000;
        if (elapsed < keys.cooldownSeconds) {
          const wait = Math.ceil(keys.cooldownSeconds - elapsed);
          return { allowed: false, status: 429, code: 'creation_cooldown', message: `Please wait ${wait}s before creating another key`, retryAfter: wait };
        }
      }
    }
    return { allowed: true, bypass: false };
  }

  createKey({
    account = null, ip = '', name = '', contact = '', parentKeyId = null,
    bypassIpLimit = false, limits = null, markupPct = null, expiresAt = null
  } = {}) {
    return transaction(this.db, () => this.createKeyInTransaction({
      account, ip, name, contact, parentKeyId, bypassIpLimit, limits, markupPct, expiresAt
    }));
  }

  // Caller must already hold a transaction (used by createKeyWithChecks).
  createKeyInTransaction({
    account = null, ip = '', name = '', contact = '', parentKeyId = null,
    bypassIpLimit = false, limits = null, markupPct = null, expiresAt = null
  } = {}) {
    const target = account || this.accounts.createAccount({ ip, contact });
    const token = generateApiKey(this.config.keys.keyPrefix);
    const dashToken = generateDashToken(this.config.keys.dashboardPrefix);
    const id = generateId('key');
    const at = NOW();
    const normalized = normalizeKeyLimits(limits ?? this.config.keys.defaultLimits);
    if (expiresAt) normalized.expires_at = expiresAt;

    this.db.prepare(`INSERT INTO api_keys (id, key_hash, key_prefix, name, account_id, parent_key_id, created_at, created_ip, status, bypass_ip_limit, expires_at, markup_pct, limits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run(id, this.hashToken(token), displayPrefix(token, this.config.keys.keyPrefix.length), String(name || '').slice(0, 80),
        target.id, parentKeyId, at, ip || null, bypassIpLimit ? 1 : 0, normalized.expires_at || null, markupPct, JSON.stringify(normalized));
    this.db.prepare(`INSERT INTO dash_tokens (id, token_hash, key_id, created_at, status) VALUES (?, ?, ?, ?, 'active')`)
      .run(generateId('dt'), this.hashToken(dashToken), id, at);

    return { secret: token, dashboardSecret: dashToken, key: this.getKey(id), account: target };
  }

  createKeyWithChecks({ account = null, ip = '', parentKeyId = null, maxChildren = null, ...options } = {}) {
    return transaction(this.db, () => {
      if (maxChildren != null && parentKeyId) {
        const active = this.db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE parent_key_id = ? AND status = 'active'").get(parentKeyId).n;
        if (active >= maxChildren) {
          return {
            allowed: { allowed: false, status: 429, code: 'child_key_limit', message: `This key can create at most ${maxChildren} additional active keys` },
            created: null
          };
        }
      }
      const allowed = this.checkKeyCreationAllowed({ ip, account });
      if (!allowed.allowed) return { allowed, created: null };
      return {
        allowed,
        created: this.createKeyInTransaction({
          account, ip, parentKeyId, ...options, bypassIpLimit: Boolean(allowed.bypass)
        })
      };
    });
  }

  rotateKey({ target, account, ip, bypass = false } = {}) {
    return transaction(this.db, () => {
      const allowed = bypass ? { allowed: true, bypass: true } : this.checkKeyCreationAllowed({ ip, account });
      if (!allowed.allowed) return { allowed, created: null };
      this.updateKey(target.id, { status: 'blocked' });
      return {
        allowed,
        created: this.createKeyInTransaction({
          account, ip,
          name: target.name,
          parentKeyId: target.parentKeyId || target.id,
          bypassIpLimit: bypass || Boolean(allowed.bypass),
          limits: target.limits,
          markupPct: target.markupPct,
          expiresAt: target.expiresAt
        })
      };
    });
  }

  // ------------------------------------------------------------ lookups

  hashToken(token) {
    return hashKey(this.config.keyPepper, token);
  }

  getKey(id) {
    return keyFromRow(this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id));
  }

  getAccountKeys(accountId) {
    return this.db.prepare('SELECT * FROM api_keys WHERE account_id = ? ORDER BY created_at DESC').all(accountId).map(keyFromRow);
  }

  updateKey(id, patch = {}) {
    const fields = [];
    const values = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(String(patch.name).slice(0, 80)); }
    if (patch.status !== undefined) {
      if (!['active', 'blocked', 'revoked'].includes(patch.status)) throw Object.assign(new Error('Invalid key status'), { statusCode: 400 });
      fields.push('status = ?'); values.push(patch.status);
    }
    if (patch.limits !== undefined) { fields.push('limits = ?'); values.push(JSON.stringify(normalizeKeyLimits(patch.limits))); }
    if (patch.markupPct !== undefined) { fields.push('markup_pct = ?'); values.push(patch.markupPct == null ? null : Number(patch.markupPct)); }
    if (patch.expiresAt !== undefined) { fields.push('expires_at = ?'); values.push(patch.expiresAt || null); }
    if (!fields.length) return this.getKey(id);
    values.push(id);
    this.db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getKey(id);
  }

  revokeKey(id) {
    return transaction(this.db, () => {
      this.db.prepare("UPDATE api_keys SET status = 'revoked' WHERE id = ?").run(id);
      this.db.prepare("UPDATE dash_tokens SET status = 'revoked' WHERE key_id = ?").run(id);
      return this.getKey(id);
    });
  }

  touchKey(id, now = Date.now()) {
    this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), id);
  }

  // Resolves an API key or dashboard token to { kind, key, account }.
  authenticate(token) {
    if (!token) return null;
    const hash = this.hashToken(token);
    const keyRow = this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash);
    if (keyRow) {
      const key = keyFromRow(keyRow);
      return { kind: 'api_key', key, account: this.accounts.getAccount(key.accountId) };
    }
    const dashRow = this.db.prepare("SELECT * FROM dash_tokens WHERE token_hash = ? AND status = 'active'").get(hash);
    if (!dashRow) return null;
    const key = this.getKey(dashRow.key_id);
    if (!key) return null;
    this.db.prepare('UPDATE dash_tokens SET last_used_at = ? WHERE id = ?').run(NOW(), dashRow.id);
    return { kind: 'dashboard', key, account: this.accounts.getAccount(key.accountId) };
  }

  resolveMarkup({ key = null, account = null } = {}) {
    for (const value of [key?.markupPct, account?.markupPct, this.config.billing.markupPct]) {
      if (value != null && Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }

  // ------------------------------------------------------------ limit checks

  keyWindow(keyId, windowHours, now = Date.now()) {
    const since = Math.floor(now / 1000) - Math.max(1, Math.round(windowHours * 3600));
    return sumKeyUsage(this.db, keyId, since);
  }

  // Pre-flight checks for a proxied request. `ignoreModel` skips the model
  // allowlist (used for WebSocket upgrades where no body is parsed).
  checkRequest(key, { model = null, now = Date.now(), ignoreModel = false } = {}) {
    if (!key) return { ok: false, status: 401, code: 'invalid_api_key', message: 'Invalid API key' };
    if (key.status === 'blocked') return { ok: false, status: 401, code: 'key_blocked', message: 'This API key is blocked' };
    if (key.status === 'revoked') return { ok: false, status: 401, code: 'key_revoked', message: 'This API key has been revoked' };
    if (key.expiresAt && Date.parse(key.expiresAt) <= now) {
      return { ok: false, status: 401, code: 'key_expired', message: 'This API key has expired' };
    }
    const account = this.accounts.getAccount(key.accountId);
    if (!account || account.status !== 'active') {
      return { ok: false, status: 403, code: 'account_suspended', message: 'This account is suspended' };
    }

    const limits = key.limits;
    if (!ignoreModel && limits.allowed_models?.length) {
      if (!model || !limits.allowed_models.includes(String(model).toLowerCase())) {
        return {
          ok: false, status: 403, code: 'model_not_allowed',
          message: model ? `Model ${model} is not available on this key` : 'A model is required on this key'
        };
      }
    }

    if (limits.rpm) {
      const rate = this.limiter.check(key.id, limits.rpm, now);
      if (!rate.ok) {
        return { ok: false, status: 429, code: 'rate_limit_exceeded', message: `Rate limit exceeded (${limits.rpm}/min)`, retryAfter: rate.retryAfter };
      }
    }

    if (limits.spend?.max_usd > 0) {
      const usedMicro = this.keyWindow(key.id, limits.spend.window_hours, now).billedMicro;
      if (usedMicro >= usdToMicro(limits.spend.max_usd)) {
        return {
          ok: false, status: 429, code: 'spend_limit_exceeded',
          message: `Spend limit reached: ${formatUsd(microToUsd(usedMicro))}/${formatUsd(limits.spend.max_usd)} per ${limits.spend.window_hours}h`
        };
      }
    }
    if (limits.tokens?.max > 0) {
      const used = this.keyWindow(key.id, limits.tokens.window_hours, now).tokens;
      if (used >= limits.tokens.max) {
        return { ok: false, status: 429, code: 'token_limit_exceeded', message: `Token limit reached: ${used}/${limits.tokens.max} per ${limits.tokens.window_hours}h` };
      }
    }
    if (limits.requests?.max > 0) {
      const used = this.keyWindow(key.id, limits.requests.window_hours, now).requests;
      if (used >= limits.requests.max) {
        return { ok: false, status: 429, code: 'request_limit_exceeded', message: `Request limit reached: ${used}/${limits.requests.max} per ${limits.requests.window_hours}h` };
      }
    }

    const balance = this.accounts.accountBalance(account.id, now);
    if (balance.availableUsd <= 0) {
      return { ok: false, status: 402, code: 'insufficient_balance', message: 'No remaining credit. Add credit or subscribe to continue.', balance };
    }
    return { ok: true, account, balance };
  }

  // ------------------------------------------------------------ admin views

  listKeys({ q = '', status = '', accountId = '', limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (q) {
      where.push('(k.key_prefix LIKE ? OR k.name LIKE ? OR k.id LIKE ? OR k.account_id LIKE ? OR a.contact LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    if (status) { where.push('k.status = ?'); params.push(status); }
    if (accountId) { where.push('k.account_id = ?'); params.push(accountId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM api_keys k JOIN accounts a ON a.id = k.account_id ${clause}`).get(...params).n;
    const keys = this.db.prepare(`SELECT k.*, a.contact AS account_contact, a.status AS account_status
      FROM api_keys k JOIN accounts a ON a.id = k.account_id ${clause}
      ORDER BY k.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.max(1, limit), Math.max(0, offset))
      .map((row) => ({ ...keyFromRow(row), accountContact: row.account_contact, accountStatus: row.account_status }));
    if (keys.length) {
      const since = Math.floor(Date.now() / 1000) - 720 * 3600;
      const windows = keyUsageWindows(this.db, keys.map((key) => key.id), since);
      for (const key of keys) {
        const usage = windows.get(key.id);
        key.usage30d = usage ? {
          requests: usage.requests,
          tokens: usage.tokens,
          upstreamUsd: microToUsd(usage.upstreamMicro),
          billedUsd: microToUsd(usage.billedMicro)
        } : { requests: 0, tokens: 0, upstreamUsd: 0, billedUsd: 0 };
      }
    }
    return { total: Number(total), keys };
  }
}
