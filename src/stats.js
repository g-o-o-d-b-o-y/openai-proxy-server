import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function initialTotals() {
  return {
    requests: 0,
    errors: 0,
    bytesIn: 0,
    bytesOut: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    audioSeconds: 0,
    cost: 0
  };
}

function pickNumber(...values) {
  for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
  return 0;
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokens: pickNumber(usage.prompt_tokens, usage.input_tokens),
    completionTokens: pickNumber(usage.completion_tokens, usage.output_tokens),
    totalTokens: pickNumber(usage.total_tokens),
    audioSeconds: pickNumber(usage.audio_seconds, usage.seconds),
    cost: pickNumber(usage.cost, usage.total_cost)
  };
}

export class StatsStore {
  constructor({ file, maxLogs = 1000 } = {}) {
    this.file = file;
    this.maxLogs = maxLogs;
    this.startedAt = new Date().toISOString();
    this.active = 0;
    this.totals = initialTotals();
    this.byRoute = {};
    this.logs = [];
    this.listeners = new Set();
    this.flushTimer = null;
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.totals) this.totals = { ...initialTotals(), ...saved.totals };
      if (saved?.byRoute && typeof saved.byRoute === 'object') this.byRoute = saved.byRoute;
      if (Array.isArray(saved?.logs)) this.logs = saved.logs.slice(-this.maxLogs);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[openai-proxy-server] could not load stats:', error.message);
    }
  }

  begin(meta) {
    this.active += 1;
    const req = {
      id: crypto.randomUUID().slice(0, 8),
      startedAt: Date.now(),
      time: new Date().toISOString(),
      ...meta
    };
    this.emit('active');
    return req;
  }

  finish(req, result = {}) {
    this.active = Math.max(0, this.active - 1);
    const usage = normalizeUsage(result.usage);
    const durationMs = Math.max(0, Date.now() - req.startedAt);
    const status = Number(result.status || 0);
    const bytesIn = Number(result.bytesIn || 0);
    const bytesOut = Number(result.bytesOut || 0);
    const isError = Boolean(result.error) || status >= 400 || status === 0;

    this.totals.requests += 1;
    this.totals.errors += isError ? 1 : 0;
    this.totals.bytesIn += bytesIn;
    this.totals.bytesOut += bytesOut;
    if (usage) {
      this.totals.promptTokens += usage.promptTokens;
      this.totals.completionTokens += usage.completionTokens;
      this.totals.totalTokens += usage.totalTokens || usage.promptTokens + usage.completionTokens;
      this.totals.audioSeconds += usage.audioSeconds;
      this.totals.cost += usage.cost;
    }

    const routeKey = req.kind || 'openai';
    const route = this.byRoute[routeKey] ||= { requests: 0, errors: 0, totalTokens: 0, bytesOut: 0 };
    route.requests += 1;
    route.errors += isError ? 1 : 0;
    route.totalTokens += usage?.totalTokens || 0;
    route.bytesOut += bytesOut;

    const log = {
      id: req.id,
      time: req.time,
      method: req.method,
      path: req.path,
      kind: req.kind,
      clientIp: String(req.clientIp || '').replace(/^::ffff:/, '') || null,
      model: result.model || req.model || null,
      status,
      durationMs,
      bytesIn,
      bytesOut,
      usage,
      quota: result.quota || null,
      error: result.error ? String(result.error) : null
    };
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
    this.scheduleFlush();
    this.emit('request', log);
    return log;
  }

  snapshot() {
    return {
      startedAt: this.startedAt,
      uptimeSeconds: Math.floor((Date.now() - Date.parse(this.startedAt)) / 1000),
      active: this.active,
      totals: this.totals,
      byRoute: this.byRoute,
      recent: this.logs.slice(-100).reverse()
    };
  }

  emit(type, data = null) {
    const payload = JSON.stringify({ type, data, snapshot: this.snapshot() });
    for (const listener of this.listeners) {
      try { listener(`data: ${payload}\n\n`); } catch { /* closed */ }
    }
  }

  subscribe(write) {
    this.listeners.add(write);
    write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: this.snapshot() })}\n\n`);
    return () => this.listeners.delete(write);
  }

  scheduleFlush() {
    if (!this.file || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 250);
    this.flushTimer.unref?.();
  }

  flush() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, totals: this.totals, byRoute: this.byRoute, logs: this.logs }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.warn('[openai-proxy-server] could not persist stats:', error.message);
    }
  }
}
