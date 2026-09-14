import test from 'node:test';
import assert from 'node:assert/strict';
import { MICRO_PER_USD, microToUsd, roundUsd, usdToMicro, formatUsd } from '../src/money.js';

test('USD and micro-USD convert exactly', () => {
  assert.equal(MICRO_PER_USD, 1_000_000);
  assert.equal(usdToMicro(1), 1_000_000);
  assert.equal(usdToMicro(0.25), 250_000);
  assert.equal(usdToMicro('0.000001'), 1);
  assert.equal(usdToMicro(0.0000004), 0);
  assert.equal(usdToMicro(0.0000006), 1);
  assert.equal(usdToMicro('nope'), 0);
  assert.equal(microToUsd(1_500_000), 1.5);
  assert.equal(microToUsd(null), 0);
});

test('sums of micro amounts never drift', () => {
  const total = Array.from({ length: 1000 }, () => usdToMicro(0.001)).reduce((a, b) => a + b, 0);
  assert.equal(microToUsd(total), 1);
});

test('roundUsd and formatUsd produce stable display values', () => {
  assert.equal(roundUsd(0.1234567), 0.123457);
  assert.equal(roundUsd(Number.NaN), 0);
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(1.5), '$1.50');
  assert.equal(formatUsd(0.000123), '$0.000123');
});
