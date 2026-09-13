import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLimits, parseWindow, formatWindow, QuotaStore, withRuleIds, matchRules, quotaSnapshots, strictest, denyReason, scopeValue } from '../src/quota.js';

const T0 = 1_000_000_000_000;

test('parseWindow handles suffixes and fallback', () => {
  assert.equal(parseWindow('7d'), 7 * 86400000);
  assert.equal(parseWindow('24h'), 24 * 3600000);
  assert.equal(parseWindow('1h'), 3600000);
  assert.equal(parseWindow('30m'), 1800000);
  assert.equal(parseWindow('15s'), 15000);
  assert.equal(parseWindow(5000), 5000);
  assert.equal(parseWindow('garbage'), 7 * 86400000);
  assert.equal(formatWindow(7 * 86400000), '7d');
  assert.equal(formatWindow(3600000), '1h');
});

test('parseLimits validates rules and matchers', () => {
  assert.deepEqual(parseLimits(null), []);
  assert.deepEqual(parseLimits('not json'), []);
  assert.deepEqual(parseLimits('{}'), []);
  const rules = parseLimits(JSON.stringify([
    { metric: 'tokens', scope: 'ip', window: '7d', max: 2000000, model: 'google/gemma-4-26b-a4b-it', name: 'demo' },
    { metric: 'requests', scope: 'all', window: '1h', max: 10 },
    { max: -5 }
  ]));
  assert.equal(rules.length, 2);
  assert.equal(rules[0].model, 'google/gemma-4-26b-a4b-it');
  assert.equal(rules[0].window, 7 * 86400000);
  assert.equal(rules[0].name, 'demo');
  assert.equal(rules[1].scope, 'all');
  assert.equal(rules[1].metric, 'requests');
});

test('matchRules filters by model and kind', () => {
  const rules = withRuleIds(parseLimits(JSON.stringify([
    { metric: 'requests', scope: 'ip', window: '1h', max: 5, model: 'gpt-4o', kind: 'tts' }
  ])));
  assert.equal(matchRules(rules, { model: 'gpt-4o', kind: 'tts' }).length, 1);
  assert.equal(matchRules(rules, { model: 'other', kind: 'tts' }).length, 0);
  assert.equal(matchRules(rules, { model: 'gpt-4o', kind: 'openai' }).length, 0);
});

test('QuotaStore accounts per IP over a sliding window', () => {
  const rules = withRuleIds(parseLimits(JSON.stringify([{ metric: 'tokens', scope: 'ip', window: '1h', max: 100 }])));
  const store = new QuotaStore();
  store.record(rules[0], rules[0].ruleId, scopeValue(rules[0], '127.0.0.1'), 30, T0);
  assert.equal(store.used(rules[0], rules[0].ruleId, '127.0.0.1', T0 + 1000), 30);
  assert.equal(store.used(rules[0], rules[0].ruleId, '10.0.0.2', T0 + 1000), 0, 'usage is split by IP');
  store.record(rules[0], rules[0].ruleId, scopeValue(rules[0], '127.0.0.1'), 20, T0 + 1000);
  assert.equal(store.used(rules[0], rules[0].ruleId, '127.0.0.1', T0 + 2000), 50);
  // after the 1h window both events roll off
  assert.equal(store.used(rules[0], rules[0].ruleId, '127.0.0.1', T0 + 3600000 + 1001), 0);
});

test('quotaSnapshots report remaining percentage and denyReason blocks exhausted quotas', () => {
  const rules = withRuleIds(parseLimits(JSON.stringify([{ metric: 'tokens', scope: 'ip', window: '7d', max: 100 }])));
  const store = new QuotaStore();

  let snaps = quotaSnapshots(store, rules, '127.0.0.1', T0);
  assert.equal(snaps[0].remaining, 100);
  assert.equal(snaps[0].pct, 100);
  assert.equal(denyReason(snaps), null);

  store.record(rules[0], rules[0].ruleId, scopeValue(rules[0], '127.0.0.1'), 40, T0);
  snaps = quotaSnapshots(store, rules, '127.0.0.1', T0 + 1000);
  assert.equal(snaps[0].used, 40);
  assert.equal(snaps[0].remaining, 60);
  assert.equal(snaps[0].pct, 60);
  assert.equal(strictest(snaps).pct, 60);

  store.record(rules[0], rules[0].ruleId, scopeValue(rules[0], '127.0.0.1'), 61, T0 + 1000);
  snaps = quotaSnapshots(store, rules, '127.0.0.1', T0 + 2000);
  assert.equal(
    denyReason(snaps),
    'Quota exceeded: 101/100 tokens in 7d for IP 127.0.0.1'
  );
});