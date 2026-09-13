// Quotas / rate limits: sliding-window usage accounting per rule.
//
// A rule is defined in the LIMITS config variable, e.g.:
//   LIMITS=[{"metric":"tokens","scope":"ip","window":"7d","max":2000000,"model":"google/gemma-4-26b-a4b-it"}]
//
// - metric: "tokens" (usage.totalTokens) or "requests" (1 per request)
// - scope:  "ip" (bucket per client IP) or "all" (one bucket for everyone)
// - window: rolling period, e.g. "1h", "24h", "7d", "30d", or milliseconds
// - max:    the allowance within the window
// - model / kind: optional matchers (exact, case-insensitive)
//
// Quotas are soft: a request is allowed while used < max; when a completed
// request pushes used >= max, subsequent matching requests are rejected with
// 429 until the window rolls.

const WINDOW_UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

export function parseWindow(value, fallbackMs = 7 * 86400000) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, value);
  const match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/);
  if (!match) return fallbackMs;
  const amount = parseFloat(match[1]);
  const unit = match[2] || 'ms';
  return Math.max(1, Math.round(amount * (WINDOW_UNIT_MS[unit] || 1)));
}

export function formatWindow(ms) {
  if (ms >= 86400000 && ms % 86400000 === 0) return `${ms / 86400000}d`;
  if (ms >= 3600000 && ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000}m`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export function parseLimits(raw) {
  if (!raw) return [];
  let arr;
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((rule) => ({
    metric: rule.metric === 'requests' ? 'requests' : 'tokens',
    scope: rule.scope === 'all' ? 'all' : 'ip',
    window: parseWindow(rule.window),
    max: Number(rule.max),
    model: rule.model ? String(rule.model).toLowerCase() : '',
    kind: rule.kind ? String(rule.kind).toLowerCase() : '',
    name: rule.name ? String(rule.name) : ''
  })).filter((rule) => Number.isFinite(rule.max) && rule.max > 0);
}

// Attach a stable ruleId (index) used as part of storage keys.
export function withRuleIds(limits, now = Date.now()) {
  return limits.map((rule, index) => ({ ...rule, ruleId: `${now}_${index}` }));
}

export function matchRules(limits, { model, kind } = {}) {
  const modelValue = String(model || '').toLowerCase();
  const kindValue = String(kind || 'openai').toLowerCase();
  return limits.filter((rule) =>
    (!rule.model || rule.model === modelValue) &&
    (!rule.kind || rule.kind === kindValue)
  );
}

export function scopeValue(rule, clientIp) {
  return rule.scope === 'all' ? '*' : String(clientIp || 'unknown');
}

export class QuotaStore {
  constructor() {
    this.events = []; // { t, rid, sv, a }
    this.maxWindow = 0;
  }

  record(rule, ruleId, scopeValueName, amount, now = Date.now()) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.events.push({ t: now, rid: ruleId, sv: scopeValueName, a: amount });
    if (rule.window > this.maxWindow) this.maxWindow = rule.window;
    if (this.events.length > 50000) this.prune(now);
    else if (this.events.length % 1000 === 0) this.prune(now);
  }

  used(rule, ruleId, scopeValueName, now = Date.now()) {
    const from = now - rule.window;
    let sum = 0;
    for (const event of this.events) {
      if (event.rid === ruleId && event.sv === scopeValueName && event.t >= from) sum += event.a;
    }
    return sum;
  }

  prune(now = Date.now()) {
    const cutoff = now - (this.maxWindow || 86400000);
    this.events = this.events.filter((event) => event.t >= cutoff);
  }
}

export function quotaSnapshots(store, matchedRules, clientIp, now = Date.now()) {
  return matchedRules.map((rule) => {
    const sv = scopeValue(rule, clientIp);
    const used = store.used(rule, rule.ruleId, sv, now);
    const remaining = Math.max(0, rule.max - used);
    const pct = rule.max > 0 ? Math.min(100, Math.max(0, Math.round((remaining / rule.max) * 100))) : 0;
    return {
      name: rule.name,
      metric: rule.metric,
      scope: rule.scope,
      window: rule.window,
      windowLabel: formatWindow(rule.window),
      model: rule.model,
      kind: rule.kind,
      key: sv,
      used,
      max: rule.max,
      remaining,
      pct
    };
  });
}

export function strictest(snapshots) {
  if (!snapshots || !snapshots.length) return null;
  return [...snapshots].sort((a, b) => a.pct - b.pct)[0];
}

export function denyReason(snapshots) {
  const hit = (snapshots || []).find((snapshot) => snapshot.remaining <= 0);
  if (!hit) return null;
  const where = hit.scope === 'ip' ? `IP ${hit.key}` : 'all requests';
  const label = hit.metric === 'tokens' ? 'tokens' : 'requests';
  const model = hit.model ? ` for model ${hit.model}` : '';
  return `Quota exceeded: ${hit.used}/${hit.max} ${label}${model} in ${hit.windowLabel} for ${where}`;
}