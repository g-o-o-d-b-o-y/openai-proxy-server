// Telemetry: request logs, per-key usage buckets, billing settlement and the
// aggregate counters that back the live dashboards.
//
// Every finished request is settled in one transaction:
//   request_logs insert + usage_buckets upsert + key/account counters +
//   credit consumption + global totals.

import crypto from 'node:crypto';
import { computeBilling } from './billing.js';
import { transaction } from './db.js';
import { microToUsd } from './money.js';

const HOUR_MS = 3600000;

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...values) => {
    for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
    return 0;
  };
  const audioSeconds = pick(raw.audio_seconds, raw.seconds);
  return {
    promptTokens: pick(raw.prompt_tokens, raw.input_tokens),
    completionTokens: pick(raw.completion_tokens, raw.output_tokens),
    totalTokens: pick(raw.total_tokens),
    audioMs: Math.round(audioSeconds * 1000),
    costMicro: Math.round(pick(raw.cost, raw.total_cost) * 1_000_000)
  };
}

export function sumKeyUsage(db, keyId, sinceSec) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(requests), 0) AS requests,
      COALESCE(SUM(total_tokens), 0) AS tokens,
      COALESCE(SUM(billed_cost_micro), 0) AS billed,
      COALESCE(SUM(upstream_cost_micro), 0) AS upstream
    FROM usage_buckets WHERE key_id = ? AND hour_ts >= ?`).get(keyId, sinceSec);
  return {
    requests: Number(row.requests),
    tokens: Number(row.tokens),
    billedMicro: Number(row.billed),
    upstreamMicro: Number(row.upstream)
  };
}

export function keyUsageWindows(db, keyIds, sinceSec) {
  const usage = new Map();
  if (!keyIds.length) return usage;
  const placeholders = keyIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT key_id,
      COALESCE(SUM(requests), 0) AS requests,
      COALESCE(SUM(total_tokens), 0) AS tokens,
      COALESCE(SUM(billed_cost_micro), 0) AS billed,
      COALESCE(SUM(upstream_cost_micro), 0) AS upstream
    FROM usage_buckets WHERE key_id IN (${placeholders}) AND hour_ts >= ? GROUP BY key_id`)
    .all(...keyIds, sinceSec);
  for (const row of rows) {
    usage.set(row.key_id, {
      requests: Number(row.requests),
      tokens: Number(row.tokens),
      billedMicro: Number(row.billed),
      upstreamMicro: Number(row.upstream)
    });
  }
  return usage;
}

export function serializeRequest(row) {
  if (!row) return null;
  const hasUsage = row.input_tokens || row.output_tokens || row.total_tokens || row.audio_ms || row.upstream_cost_micro;
  return {
    id: row.request_id,
    time: row.time,
    method: row.method,
    path: row.path,
    kind: row.kind,
    keyId: row.key_id || null,
    keyPrefix: row.key_prefix || null,
    accountId: row.account_id || null,
    clientIp: row.client_ip || null,
    model: row.model || null,
    fallback: row.fallback || null,
    status: Number(row.status),
    durationMs: Number(row.duration_ms),
    bytesIn: Number(row.bytes_in),
    bytesOut: Number(row.bytes_out),
    usage: hasUsage ? {
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      audioMs: Number(row.audio_ms),
      costUsd: microToUsd(row.upstream_cost_micro)
    } : null,
    upstreamCostUsd: microToUsd(row.upstream_cost_micro),
    billedCostUsd: microToUsd(row.billed_cost_micro),
    error: row.error || null
  };
}

const REQUEST_FILTERS = {
  ip: 'client_ip = ?',
  model: 'lower(model) = ?',
  method: 'upper(method) = ?',
  status: 'status = ?',
  path: 'lower(path) = ?',
  hour: "strftime('%Y-%m-%dT%H', time) = ?",
  key: 'key_id = ?',
  account: 'account_id = ?',
  kind: "lower(COALESCE(kind, 'llm')) = ?"
};

const GROUP_EXPRESSIONS = {
  ip: "COALESCE(client_ip, '(none)')",
  model: "COALESCE(NULLIF(model, ''), '(none)')",
  method: "COALESCE(NULLIF(method, ''), '(none)')",
  status: "CAST(status AS TEXT)",
  kind: "COALESCE(NULLIF(kind, ''), 'llm')",
  path: "COALESCE(NULLIF(path, ''), '/')",
  key: "COALESCE(key_prefix, '(none)')",
  hour: "strftime('%Y-%m-%dT%H', time)"
};

export const GROUP_FIELDS = Object.keys(GROUP_EXPRESSIONS);

function buildRequestWhere(filters = {}) {
  const where = [];
  const params = [];
  for (const [name, value] of Object.entries(filters)) {
    if (value == null || value === '' || value === 'all') continue;
    if (name === 'q') {
      where.push(`(lower(path) LIKE ? OR lower(model) LIKE ? OR lower(method) LIKE ? OR client_ip LIKE ?
        OR CAST(status AS TEXT) LIKE ? OR lower(COALESCE(error, '')) LIKE ? OR key_prefix LIKE ?)`);
      const like = `%${String(value).toLowerCase()}%`;
      params.push(like, like, like, like, like, like, like);
      continue;
    }
    const clause = REQUEST_FILTERS[name];
    if (!clause) continue;
    where.push(clause);
    params.push(name === 'hour' || name === 'key' || name === 'account' ? value : (name === 'status' ? Number(value) : String(value)));
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export class UsageStore {
  constructor({ db, config, accounts }) {
    this.db = db;
    this.config = config;
    this.accounts = accounts;
    this.active = 0;
    this.startedAt = new Date().toISOString();
    this.listeners = new Set();
    this.writesSincePrune = 0;
    this.db.prepare(`INSERT OR IGNORE INTO totals (id) VALUES (1)`).run();
    this.totals = this.#readTotals();
    this.prune();
  }

  #readTotals() {
    const row = this.db.prepare('SELECT * FROM totals WHERE id = 1').get();
    return {
      requests: Number(row.requests),
      errors: Number(row.errors),
      bytesIn: Number(row.bytes_in),
      bytesOut: Number(row.bytes_out),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      audioMs: Number(row.audio_ms),
      upstreamCostUsd: microToUsd(row.upstream_cost_micro),
      billedCostUsd: microToUsd(row.billed_cost_micro)
    };
  }

  begin(meta) {
    this.active += 1;
    this.emit('active');
    return {
      id: crypto.randomUUID().slice(0, 8),
      startedAt: Date.now(),
      time: new Date().toISOString(),
      ...meta
    };
  }

  // result: { status, bytesIn, bytesOut, usage, model, fallback, error,
  //           keyInfo: { key, account }, countUsage }
  finish(req, result = {}) {
    this.active = Math.max(0, this.active - 1);
    const usage = normalizeUsage(result.usage);
    const key = result.keyInfo?.key || null;
    const account = result.keyInfo?.account || null;
    const markupPct = result.keyInfo
      ? this.#markupFor(key, account)
      : 0;
    const billing = key
      ? computeBilling(usage, { model: result.model || req.model || '', prices: this.config.billing.prices, markupPct })
      : { upstreamMicro: 0, billedMicro: 0 };
    // Anonymous traffic still records upstream cost in totals but is not billed.
    const upstreamMicro = key ? billing.upstreamMicro : this.#upstreamOnly(usage, result, req);
    const billedMicro = key ? billing.billedMicro : 0;

    const promptTokens = usage?.promptTokens || 0;
    const completionTokens = usage?.completionTokens || 0;
    const totalTokens = usage?.totalTokens || promptTokens + completionTokens;
    const audioMs = usage?.audioMs || 0;
    const bytesIn = Number(result.bytesIn || 0);
    const bytesOut = Number(result.bytesOut || 0);
    const status = Number(result.status || 0);
    const durationMs = Math.max(0, Date.now() - req.startedAt);
    const isError = Boolean(result.error) || status >= 400 || status === 0;
    const hourTs = Math.floor(Date.now() / HOUR_MS) * (HOUR_MS / 1000);
    const countUsage = result.countUsage !== false;

    transaction(this.db, () => {
      if (key && countUsage) {
        this.db.prepare(`INSERT INTO usage_buckets (key_id, account_id, hour_ts, kind, model, requests, errors,
            input_tokens, output_tokens, total_tokens, upstream_cost_micro, billed_cost_micro, audio_ms, bytes_in, bytes_out)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (key_id, hour_ts, kind, model) DO UPDATE SET
            requests = requests + 1,
            errors = errors + excluded.errors,
            input_tokens = input_tokens + excluded.input_tokens,
            output_tokens = output_tokens + excluded.output_tokens,
            total_tokens = total_tokens + excluded.total_tokens,
            upstream_cost_micro = upstream_cost_micro + excluded.upstream_cost_micro,
            billed_cost_micro = billed_cost_micro + excluded.billed_cost_micro,
            audio_ms = audio_ms + excluded.audio_ms,
            bytes_in = bytes_in + excluded.bytes_in,
            bytes_out = bytes_out + excluded.bytes_out`)
          .run(key.id, account?.id || key.accountId, hourTs, req.kind || 'llm', result.model || req.model || '',
            isError ? 1 : 0, promptTokens, completionTokens, totalTokens, upstreamMicro, billedMicro, audioMs, bytesIn, bytesOut);
        this.db.prepare(`UPDATE api_keys SET total_requests = total_requests + 1, total_tokens = total_tokens + ?,
            total_cost_micro = total_cost_micro + ?, total_billed_micro = total_billed_micro + ?, last_used_at = ?
          WHERE id = ?`)
          .run(totalTokens, upstreamMicro, billedMicro, new Date().toISOString(), key.id);
        if (account) {
          this.db.prepare(`UPDATE accounts SET total_requests = total_requests + 1, total_tokens = total_tokens + ?,
              total_cost_micro = total_cost_micro + ?, total_billed_micro = total_billed_micro + ?, updated_at = ?
            WHERE id = ?`)
            .run(totalTokens, upstreamMicro, billedMicro, new Date().toISOString(), account.id);
        }
        if (billedMicro > 0) this.accounts.consumeCreditsInTx(account?.id || key.accountId, billedMicro);
      }

      this.db.prepare(`UPDATE totals SET requests = requests + 1, errors = errors + ?, bytes_in = bytes_in + ?,
          bytes_out = bytes_out + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
          total_tokens = total_tokens + ?, audio_ms = audio_ms + ?, upstream_cost_micro = upstream_cost_micro + ?,
          billed_cost_micro = billed_cost_micro + ?
        WHERE id = 1`)
        .run(isError ? 1 : 0, bytesIn, bytesOut, promptTokens, completionTokens, totalTokens, audioMs, upstreamMicro, billedMicro);

      this.db.prepare(`INSERT INTO request_logs (request_id, time, hour_ts, key_id, account_id, key_prefix, method, path, kind,
          client_ip, status, duration_ms, model, fallback, input_tokens, output_tokens, total_tokens, audio_ms,
          upstream_cost_micro, billed_cost_micro, bytes_in, bytes_out, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.id, req.time, hourTs, key?.id || null, account?.id || key?.accountId || null, key?.keyPrefix || null,
          req.method || null, req.path || null, req.kind || null, req.clientIp || null, status, durationMs,
          result.model || req.model || null, result.fallback || null, promptTokens, completionTokens, totalTokens, audioMs,
          upstreamMicro, billedMicro, bytesIn, bytesOut, result.error ? String(result.error) : null);
    });

    this.emit('request');
    this.#refreshTotals();
    this.writesSincePrune += 1;
    if (this.writesSincePrune >= 128) {
      this.writesSincePrune = 0;
      this.prune();
    }
    return this.recent(1)[0] || null;
  }

  #markupFor(key, account) {
    for (const value of [key?.markupPct, account?.markupPct, this.config.billing.markupPct]) {
      if (value != null && Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }

  #upstreamOnly(usage, result, req) {
    const { upstreamMicro } = computeBilling(usage, {
      model: result.model || req.model || '',
      prices: this.config.billing.prices,
      markupPct: 0
    });
    return upstreamMicro;
  }

  #refreshTotals() {
    this.totals = this.#readTotals();
  }

  recent(limit = 100) {
    return this.db.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, limit)).map(serializeRequest);
  }

  queryRequests({ limit = 50, offset = 0, filters = {} } = {}) {
    const { clause, params } = buildRequestWhere(filters);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM request_logs ${clause}`).get(...params).n;
    const requests = this.db.prepare(`SELECT * FROM request_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.max(1, limit), Math.max(0, offset)).map(serializeRequest);
    return { total: Number(total), requests };
  }

  groupRequests({ field = 'model', limit = 12, filters = {} } = {}) {
    const expression = GROUP_EXPRESSIONS[field];
    if (!expression) throw Object.assign(new Error(`Unknown group field: ${field}`), { statusCode: 400 });
    const scoped = { ...filters };
    delete scoped[field];
    const { clause, params } = buildRequestWhere(scoped);
    const rows = this.db.prepare(`SELECT ${expression} AS key, COUNT(*) AS count,
        COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(upstream_cost_micro), 0) AS upstream,
        COALESCE(SUM(billed_cost_micro), 0) AS billed, COALESCE(SUM(audio_ms), 0) AS audio_ms,
        COALESCE(SUM(bytes_out), 0) AS bytes_out
      FROM request_logs ${clause}
      GROUP BY key
      ORDER BY ${field === 'hour' ? 'key DESC' : 'count DESC, bytes_out DESC'}
      LIMIT ?`).all(...params, Math.max(1, limit));
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM request_logs ${clause}`).get(...params).n;
    return {
      field,
      total: Number(total),
      groups: rows.map((row) => ({
        key: row.key,
        label: field === 'hour' ? `${String(row.key).replace('T', ' ')}:00` : row.key,
        count: Number(row.count),
        tokens: Number(row.tokens),
        upstreamCostUsd: microToUsd(row.upstream),
        billedCostUsd: microToUsd(row.billed),
        audioMs: Number(row.audio_ms),
        bytesOut: Number(row.bytes_out)
      }))
    };
  }

  usageSeries({ keyId = null, accountId = null, days = 30 } = {}) {
    const scope = keyId ? 'key_id' : 'account_id';
    const id = keyId || accountId;
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = this.db.prepare(`SELECT CAST(hour_ts / 86400 AS INTEGER) AS day,
        COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(errors), 0) AS errors,
        COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(upstream_cost_micro), 0) AS upstream,
        COALESCE(SUM(billed_cost_micro), 0) AS billed, COALESCE(SUM(audio_ms), 0) AS audio_ms
      FROM usage_buckets WHERE ${scope} = ? AND hour_ts >= ? GROUP BY day ORDER BY day`).all(id, since);
    return rows.map((row) => ({
      day: new Date(Number(row.day) * 86400000).toISOString().slice(0, 10),
      requests: Number(row.requests),
      errors: Number(row.errors),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      upstreamCostUsd: microToUsd(row.upstream),
      billedCostUsd: microToUsd(row.billed),
      audioMs: Number(row.audio_ms)
    }));
  }

  usageBreakdown({ keyId = null, accountId = null, days = 30 } = {}) {
    const scope = keyId ? 'key_id' : 'account_id';
    const id = keyId || accountId;
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const totals = this.db.prepare(`SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(errors), 0) AS errors,
        COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(upstream_cost_micro), 0) AS upstream,
        COALESCE(SUM(billed_cost_micro), 0) AS billed, COALESCE(SUM(audio_ms), 0) AS audio_ms
      FROM usage_buckets WHERE ${scope} = ? AND hour_ts >= ?`).get(id, since);
    const models = this.db.prepare(`SELECT model, SUM(requests) AS requests, SUM(total_tokens) AS tokens,
        SUM(upstream_cost_micro) AS upstream, SUM(billed_cost_micro) AS billed
      FROM usage_buckets WHERE ${scope} = ? AND hour_ts >= ? GROUP BY model ORDER BY billed DESC LIMIT 20`).all(id, since);
    const kinds = this.db.prepare(`SELECT kind, SUM(requests) AS requests, SUM(total_tokens) AS tokens,
        SUM(billed_cost_micro) AS billed FROM usage_buckets WHERE ${scope} = ? AND hour_ts >= ? GROUP BY kind`).all(id, since);
    return {
      days,
      totals: {
        requests: Number(totals.requests),
        errors: Number(totals.errors),
        tokens: Number(totals.tokens),
        upstreamCostUsd: microToUsd(totals.upstream),
        billedCostUsd: microToUsd(totals.billed),
        audioMs: Number(totals.audio_ms)
      },
      models: models.map((row) => ({
        model: row.model, requests: Number(row.requests), tokens: Number(row.tokens),
        upstreamCostUsd: microToUsd(row.upstream), billedCostUsd: microToUsd(row.billed)
      })),
      kinds: kinds.map((row) => ({
        kind: row.kind, requests: Number(row.requests), tokens: Number(row.tokens), billedCostUsd: microToUsd(row.billed)
      }))
    };
  }

  // Keyed revenue (margin excludes anonymous traffic, which is never billed).
  revenue({ days = 30 } = {}) {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const row = this.db.prepare(`SELECT COALESCE(SUM(billed_cost_micro), 0) AS billed,
        COALESCE(SUM(upstream_cost_micro), 0) AS upstream
      FROM usage_buckets WHERE hour_ts >= ?`).get(since);
    const billed = microToUsd(row.billed);
    const upstream = microToUsd(row.upstream);
    return { billedUsd: billed, upstreamUsd: upstream, marginUsd: billed - upstream };
  }

  topKeys({ days = 30, limit = 5 } = {}) {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    return this.db.prepare(`SELECT b.key_id, COALESCE(k.key_prefix, 'unknown') AS key_prefix,
        SUM(b.billed_cost_micro) AS billed, SUM(b.requests) AS requests, SUM(b.total_tokens) AS tokens
      FROM usage_buckets b LEFT JOIN api_keys k ON k.id = b.key_id
      WHERE b.hour_ts >= ? GROUP BY b.key_id ORDER BY billed DESC LIMIT ?`).all(since, Math.max(1, limit))
      .map((row) => ({
        keyId: row.key_id, keyPrefix: row.key_prefix,
        billedUsd: microToUsd(row.billed), requests: Number(row.requests), tokens: Number(row.tokens)
      }));
  }

  prune(now = Date.now()) {
    try {
      const maxEntries = Number(this.config.server.maxLogEntries) || 0;
      if (maxEntries > 0) {
        this.db.prepare(`DELETE FROM request_logs WHERE id <= COALESCE(
          (SELECT id FROM request_logs ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`).run(maxEntries);
      }
      const retentionDays = Number(this.config.server.logRetentionDays) || 0;
      if (retentionDays > 0) {
        this.db.prepare('DELETE FROM request_logs WHERE time < ?')
          .run(new Date(now - retentionDays * 86400000).toISOString());
      }
    } catch { /* pruning is best effort */ }
  }

  snapshot() {
    return {
      startedAt: this.startedAt,
      uptimeSeconds: Math.floor((Date.now() - Date.parse(this.startedAt)) / 1000),
      active: this.active,
      totals: this.totals
    };
  }

  subscribe(write) {
    this.listeners.add(write);
    write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
    return () => this.listeners.delete(write);
  }

  emit(type) {
    const payload = `data: ${JSON.stringify({ type, snapshot: this.snapshot() })}\n\n`;
    for (const write of this.listeners) {
      try { write(payload); } catch { this.listeners.delete(write); }
    }
  }
}
