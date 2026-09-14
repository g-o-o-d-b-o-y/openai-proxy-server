import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkupMicro, computeBilling, estimateUpstreamCostMicro, parsePrices, priceForModel } from '../src/billing.js';
import { usdToMicro } from '../src/money.js';

test('parsePrices accepts tokens and audio rates', () => {
  assert.deepEqual(parsePrices(null), {});
  assert.deepEqual(parsePrices('nope'), {});
  assert.deepEqual(parsePrices('[1]'), {});
  const prices = parsePrices(JSON.stringify({
    'GPT-X': { input: 1, output: '2', audio_second: 0.01 },
    default: { input: 0.5 },
    bad: { input: 'x', output: 'y' },
    negative: { input: -1, output: 2 }
  }));
  assert.deepEqual(prices['gpt-x'], { input: 1, output: 2, audioSecond: 0.01 });
  assert.deepEqual(prices.default, { input: 0.5, output: 0 });
  assert.equal(prices.bad, undefined);
  assert.deepEqual(prices.negative, { input: 0, output: 2 });
  assert.deepEqual(priceForModel(prices, 'GPT-X'), prices['gpt-x']);
  assert.deepEqual(priceForModel(prices, 'unknown'), prices.default);
  assert.equal(priceForModel(prices, ''), prices.default);
});

test('reported upstream cost wins over the price table', () => {
  const prices = parsePrices({ m: { input: 1, output: 1 } });
  const reported = { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, audioMs: 0, costMicro: usdToMicro(0.5) };
  assert.equal(estimateUpstreamCostMicro(reported, 'm', prices), usdToMicro(0.5));
});

test('estimates token and audio cost in micro-USD', () => {
  const prices = parsePrices({ m: { input: 1, output: 2, audio_second: 0.5 }, default: { input: 2 } });
  const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, audioMs: 2000, costMicro: 0 };
  // 1000/1M*$1 + 500/1M*$2 + 2s*$0.5 = 0.001 + 0.001 + 1 = 1.002
  assert.equal(estimateUpstreamCostMicro(usage, 'm', prices), usdToMicro(1.002));
  assert.equal(estimateUpstreamCostMicro(usage, 'other', prices), usdToMicro(0.002), 'default price has no audio rate');
  assert.equal(estimateUpstreamCostMicro(usage, 'm', {}), 0);
  assert.equal(estimateUpstreamCostMicro(null, 'm', prices), 0);
});

test('markup is applied exactly and clamped at zero', () => {
  assert.equal(applyMarkupMicro(1_000_000, 0), 1_000_000);
  assert.equal(applyMarkupMicro(1_000_000, 30), 1_300_000);
  assert.equal(applyMarkupMicro(1_000_001, 33.3), 1_333_001);
  assert.equal(applyMarkupMicro(1_000_000, -5), 1_000_000);
  assert.equal(applyMarkupMicro(0, 100), 0);
});

test('computeBilling combines estimate and markup', () => {
  const prices = parsePrices({ m: { input: 1, output: 0 } });
  const usage = { promptTokens: 1000, completionTokens: 0, totalTokens: 1000, audioMs: 0, costMicro: 0 };
  assert.deepEqual(computeBilling(usage, { model: 'm', prices, markupPct: 50 }), {
    upstreamMicro: usdToMicro(0.001),
    billedMicro: usdToMicro(0.0015)
  });
});
