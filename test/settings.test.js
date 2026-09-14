import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/index.js';
import { hashToken } from '../src/auth.js';
import { testEnv } from './helpers.js';

const baseEnv = (overrides = {}) => testEnv({
  ADMIN_TOKEN: 'seed-token',
  MARKUP_PCT: '40',
  OPENAI_BASE_URL: 'https://example.com/v1',
  OPENAI_API_KEY: 'up-key',
  OPENAI_MODEL: 'model-x',
  DASHBOARD_PATH: 'control',
  ...overrides
});

test('settings seed from the environment and shape the live config', (t) => {
  const app = createApp(baseEnv());
  t.after(() => app.db.close());
  const { config, settings } = app;

  assert.equal(config.billing.markupPct, 40);
  assert.equal(config.upstreams.llm.baseUrl, 'https://example.com/v1');
  assert.equal(config.upstreams.llm.apiKey, 'up-key');
  assert.equal(config.upstreams.llm.model, 'model-x');
  assert.equal(config.dashboard.path, '/control');
  assert.equal(config.dashboard.adminTokenHash, hashToken('seed-token'));
  assert.equal(config.keys.requireKey, true, 'reseller mode requires a key by default');
  assert.ok(config.keyPepper.length >= 32);
  assert.deepEqual(config.billing.prices, {});

  settings.setMany({
    'billing.markup_pct': 12.5,
    'keys.ip_limit_per_month': 3,
    'dashboard.title': 'Acme AI',
    'upstreams.llm.model_fallbacks': ['a', 'b', 'a']
  }, config);
  assert.equal(config.billing.markupPct, 12.5);
  assert.equal(config.keys.ipLimitPerMonth, 3);
  assert.equal(config.dashboard.title, 'Acme AI');
  assert.deepEqual(config.upstreams.llm.modelFallbacks, ['a', 'b']);
});

test('settings validate types, ranges, patterns and system flags', (t) => {
  const app = createApp(baseEnv());
  t.after(() => app.db.close());
  const { settings } = app;

  assert.throws(() => settings.set('keys.ip_limit_per_month', -1), /must be >= 0/);
  assert.throws(() => settings.set('billing.markup_pct', 2000), /must be <= 1000/);
  assert.throws(() => settings.set('keys.key_prefix', 'bad prefix!'), /must match/);
  assert.throws(() => settings.set('nope.nope', 1), /Unknown setting/);
  assert.throws(() => settings.set('security.key_pepper', 'should-not-change'), /managed internally/);

  settings.set('keys.require_key', false);
  assert.equal(settings.get('keys.require_key'), false);
});

test('settings persist across restarts and mask secrets in the admin view', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opx-settings-'));
  const env = baseEnv({ DB_FILE: path.join(dir, 'proxy.db') });

  const app1 = createApp(env);
  app1.settings.set('upstreams.llm.model', 'new-model', { config: app1.config });
  app1.settings.set('dashboard.admin_token_hash', hashToken('rotated'));
  app1.db.close();

  const app2 = createApp({ ...env, OPENAI_MODEL: 'ignored-after-seed' });
  t.after(() => app2.db.close());
  assert.equal(app2.config.upstreams.llm.model, 'new-model', 'database wins over env');
  assert.equal(app2.config.dashboard.adminTokenHash, hashToken('rotated'));

  const view = app2.settings.adminView();
  const upstreamKey = view.find((entry) => entry.key === 'upstreams.llm.api_key');
  assert.equal(upstreamKey.secret, true);
  assert.equal(upstreamKey.value, null);
  assert.equal(upstreamKey.hasValue, true);
  assert.ok(!view.some((entry) => entry.key === 'security.key_pepper'), 'system settings stay hidden');
});
