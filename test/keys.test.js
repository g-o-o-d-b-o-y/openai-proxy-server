import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { normalizeKeyLimits } from '../src/keys.js';
import { testEnv } from './helpers.js';

function setup(t, overrides = {}) {
  const app = createApp(testEnv({ FREE_CREDIT_USD: '1', ...overrides }));
  t.after(() => app.db.close());
  return app;
}

test('normalizeKeyLimits produces a canonical shape', () => {
  assert.deepEqual(normalizeKeyLimits(null), {});
  assert.deepEqual(normalizeKeyLimits({ spend: { max_usd: -1 }, requests: { max: 0 }, rpm: 0 }), {});
  const limits = normalizeKeyLimits({
    spend: { max_usd: 2.5, window_hours: 24 },
    tokens: { max: 1000, window_hours: 0 },
    requests: { max: 50, window_hours: '6' },
    rpm: '30',
    max_children: 3,
    allowed_models: ['GPT-4o', ' claude-3 ', 'gpt-4o'],
    expires_at: '2030-01-01T00:00:00.000Z'
  });
  assert.deepEqual(limits.spend, { max_usd: 2.5, window_hours: 24 });
  assert.deepEqual(limits.tokens, { max: 1000, window_hours: 1 });
  assert.deepEqual(limits.requests, { max: 50, window_hours: 6 });
  assert.equal(limits.rpm, 30);
  assert.equal(limits.max_children, 3);
  assert.deepEqual(limits.allowed_models, ['gpt-4o', 'claude-3']);
  assert.equal(limits.expires_at, '2030-01-01T00:00:00.000Z');
});

test('keys are created with configurable prefixes and default limits', (t) => {
  const app = setup(t, { KEY_PREFIX: 'sk-test-', DASHBOARD_TOKEN_PREFIX: 'dt_' });
  const created = app.keys.createKey({ name: 'one' });
  assert.match(created.secret, /^sk-test-[A-Za-z0-9]{24}$/);
  assert.match(created.dashboardSecret, /^dt_[A-Za-z0-9]{24}$/);
  assert.equal(created.key.name, 'one');
  assert.equal(created.key.limits.rpm, 60, 'default limits applied');
  assert.equal(app.accounts.accountBalance(created.account.id).availableUsd, 1);

  const authenticated = app.keys.authenticate(created.secret);
  assert.equal(authenticated.kind, 'api_key');
  assert.equal(authenticated.key.id, created.key.id);
  const dashboard = app.keys.authenticate(created.dashboardSecret);
  assert.equal(dashboard.kind, 'dashboard');
  assert.equal(dashboard.key.id, created.key.id);
  assert.equal(app.keys.authenticate('sk-nope'), null);
});

test('key creation enforces monthly IP limits, cooldown and overrides', (t) => {
  const app = setup(t, { KEY_IP_LIMIT_PER_MONTH: '2', KEY_COOLDOWN_SECONDS: '30' });
  const first = app.keys.createKeyWithChecks({ ip: '198.51.100.1' });
  assert.equal(first.allowed.allowed, true);
  assert.equal(first.created.key.bypassIpLimit, false);

  const cooldown = app.keys.createKeyWithChecks({ ip: '198.51.100.1' });
  assert.equal(cooldown.allowed.code, 'creation_cooldown');

  app.config.keys.cooldownSeconds = 0;
  assert.equal(app.keys.createKeyWithChecks({ ip: '198.51.100.1' }).allowed.allowed, true);
  assert.equal(app.keys.createKeyWithChecks({ ip: '198.51.100.1' }).allowed.code, 'ip_key_limit');
  assert.equal(app.keys.createKeyWithChecks({ ip: '198.51.100.2' }).allowed.allowed, true, 'different IP unaffected');

  app.config.keys.ipOverrides = { '198.51.100.9': -1 };
  for (let i = 0; i < 3; i += 1) {
    assert.equal(app.keys.createKeyWithChecks({ ip: '198.51.100.9' }).allowed.allowed, true, 'unlimited override');
  }
});

test('subscriptions and permissions bypass the IP limit and cap active keys', (t) => {
  const app = setup(t, { KEY_IP_LIMIT_PER_MONTH: '1', KEY_MAX_PER_ACCOUNT: '2', KEY_COOLDOWN_SECONDS: '0' });
  const first = app.keys.createKeyWithChecks({ ip: '198.51.100.5' }).created;
  const account = first.account;

  assert.equal(app.keys.createKeyWithChecks({ ip: '198.51.100.5' }).allowed.code, 'ip_key_limit');
  app.accounts.grantSubscription(account.id, 'monthly');
  const child = app.keys.createKeyWithChecks({ ip: '198.51.100.5', account });
  assert.equal(child.allowed.allowed, true);
  assert.equal(child.allowed.bypass, true);
  assert.equal(child.created.key.bypassIpLimit, true, 'subscription keys are exempt');

  const limited = app.keys.createKeyWithChecks({ ip: '198.51.100.5', account });
  assert.equal(limited.allowed.code, 'account_key_limit', 'active key cap enforced');

  // Blocking a key frees an active slot; an explicit permission also bypasses
  // the IP limit for accounts without a subscription.
  app.keys.updateKey(first.key.id, { status: 'blocked' });
  const afterBlock = app.keys.createKeyWithChecks({ ip: '198.51.100.5', account });
  assert.equal(afterBlock.allowed.allowed, true, 'blocking frees an active slot');

  const fresh = app.accounts.createAccount({});
  app.accounts.updateAccount(fresh.id, { canCreateKeys: true });
  const permitted = app.keys.createKeyWithChecks({ ip: '198.51.100.5', account: app.accounts.getAccount(fresh.id) });
  assert.equal(permitted.allowed.bypass, true);
  assert.equal(permitted.created.key.bypassIpLimit, true);
});

test('rotation blocks the old key and creates a linked replacement', (t) => {
  const app = setup(t);
  const created = app.keys.createKey({ name: 'primary' });
  const { allowed, created: replacement } = app.keys.rotateKey({
    target: created.key,
    account: created.account,
    ip: '127.0.0.1'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(app.keys.getKey(created.key.id).status, 'blocked');
  assert.equal(app.keys.getKey(created.key.id).name, 'primary');
  assert.notEqual(replacement.key.id, created.key.id);
  assert.equal(replacement.key.accountId, created.account.id);
  assert.equal(app.keys.authenticate(created.secret).kind, 'api_key', 'old key still resolves to its blocked state');
});

test('checkRequest enforces status, expiry, model allowlists and windows', (t) => {
  const app = setup(t, { FREE_CREDIT_USD: '10' });
  const created = app.keys.createKey({});
  const keyId = created.key.id;

  assert.equal(app.keys.checkRequest(created.key, { model: 'm' }).ok, true);
  app.keys.updateKey(keyId, { status: 'blocked' });
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'm' }).code, 'key_blocked');
  app.keys.updateKey(keyId, { status: 'active' });
  app.keys.updateKey(keyId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'm' }).code, 'key_expired');
  app.keys.updateKey(keyId, { expiresAt: null });

  app.keys.updateKey(keyId, { limits: { allowed_models: ['allowed'] } });
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'other' }).code, 'model_not_allowed');
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: null }).code, 'model_not_allowed');
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'allowed' }).ok, true);
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { ignoreModel: true }).ok, true);

  // Windowed limits read usage_buckets in micro-USD.
  const now = Date.now();
  const hourTs = Math.floor(now / 1000 / 3600) * 3600;
  app.db.prepare(`INSERT INTO usage_buckets (key_id, account_id, hour_ts, kind, model, requests, total_tokens, billed_cost_micro)
    VALUES (?, ?, ?, 'llm', 'allowed', 5, 1000, 1000)`).run(keyId, created.account.id, hourTs);

  app.keys.updateKey(keyId, { limits: { spend: { max_usd: 0.0005, window_hours: 24 } } });
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'allowed' }).code, 'spend_limit_exceeded');
  app.keys.updateKey(keyId, { limits: { tokens: { max: 500, window_hours: 24 } } });
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'allowed' }).code, 'token_limit_exceeded');
  app.keys.updateKey(keyId, { limits: { requests: { max: 3, window_hours: 24 } } });
  assert.equal(app.keys.checkRequest(app.keys.getKey(keyId), { model: 'allowed' }).code, 'request_limit_exceeded');

  // The per-minute limiter is cumulative per key, so use a fresh key.
  const fresh = app.keys.createKey({}).key;
  app.keys.updateKey(fresh.id, { limits: { rpm: 1 } });
  assert.equal(app.keys.checkRequest(app.keys.getKey(fresh.id), {}).ok, true);
  assert.equal(app.keys.checkRequest(app.keys.getKey(fresh.id), {}).code, 'rate_limit_exceeded');
});

test('checkRequest rejects requests without balance', (t) => {
  const app = setup(t, { FREE_CREDIT_USD: '0' });
  const created = app.keys.createKey({});
  const check = app.keys.checkRequest(created.key, {});
  assert.equal(check.code, 'insufficient_balance');
  assert.equal(check.status, 402);
  assert.equal(check.balance.availableUsd, 0);
});
