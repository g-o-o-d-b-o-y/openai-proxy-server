// Reseller billing math.
//
// Upstream cost is the provider-reported cost when present, otherwise it is
// estimated from the configured price table (USD per 1M tokens and USD per
// audio second). Billed cost adds the configured markup. All amounts are
// integer micro-USD.

import { usdToMicro } from './money.js';

const PER_MILLION = 1_000_000;

// Normalizes a price table from settings. Unknown shapes are ignored.
export function parsePrices(raw) {
  if (raw == null || raw === '') return {};
  let source;
  try {
    source = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const prices = {};
  for (const [model, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const input = Number(value.input);
    const output = Number(value.output);
    const audioSecond = Number(value.audio_second ?? value.audio);
    if (!Number.isFinite(input) && !Number.isFinite(output) && !Number.isFinite(audioSecond)) continue;
    const entry = { input: 0, output: 0 };
    if (Number.isFinite(input) && input > 0) entry.input = input;
    if (Number.isFinite(output) && output > 0) entry.output = output;
    if (Number.isFinite(audioSecond) && audioSecond > 0) entry.audioSecond = audioSecond;
    prices[String(model).trim().toLowerCase()] = entry;
  }
  return prices;
}

export function priceForModel(prices, model) {
  const key = String(model || '').trim().toLowerCase();
  return (key && prices[key]) || prices.default || null;
}

// `usage` is the normalized record from usage.js:
//   { promptTokens, completionTokens, totalTokens, audioMs, costMicro }
export function estimateUpstreamCostMicro(usage, model, prices) {
  if (!usage) return 0;
  if (Number(usage.costMicro) > 0) return Number(usage.costMicro);
  const price = priceForModel(prices, model);
  if (!price) return 0;
  const tokenCost = (Number(usage.promptTokens) || 0) * price.input / PER_MILLION
    + (Number(usage.completionTokens) || 0) * price.output / PER_MILLION;
  const audioCost = (Number(usage.audioMs) || 0) / 1000 * (price.audioSecond || 0);
  return usdToMicro(tokenCost + audioCost);
}

export function applyMarkupMicro(upstreamMicro, markupPct = 0) {
  const pct = Math.max(0, Number(markupPct) || 0);
  return Math.round((Number(upstreamMicro) || 0) * (1 + pct / 100));
}

export function computeBilling(usage, { model = '', prices = {}, markupPct = 0 } = {}) {
  const upstreamMicro = estimateUpstreamCostMicro(usage, model, prices);
  return { upstreamMicro, billedMicro: applyMarkupMicro(upstreamMicro, markupPct) };
}
