import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate, SCHEMA_VERSION } from '../src/db.js';

test('schema migrates cleanly and is idempotent', () => {
  const db = openDatabase(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  for (const expected of ['accounts', 'api_keys', 'credits', 'dash_tokens', 'plans', 'redeem_codes', 'request_logs', 'schema_migrations', 'settings', 'subscriptions', 'totals', 'usage_buckets']) {
    assert.ok(tables.includes(expected), `table ${expected}`);
  }
  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version);
  assert.deepEqual(applied, Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, SCHEMA_VERSION);
  db.close();
});

test('STRICT tables and CHECK constraints reject invalid state', () => {
  const db = openDatabase(':memory:');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)').run('acc_1', now, now);

  assert.throws(() => db.prepare('INSERT INTO credits (id, account_id, source, amount_micro, remaining_micro, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cr_1', 'acc_1', 'nonsense', 100, 100, now), /CHECK/, 'invalid credit source rejected');
  assert.throws(() => db.prepare('INSERT INTO credits (id, account_id, source, amount_micro, remaining_micro, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cr_2', 'acc_1', 'admin', -1, -1, now), /CHECK/, 'negative amount rejected');
  assert.throws(() => db.prepare('INSERT INTO credits (id, account_id, source, amount_micro, remaining_micro, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cr_3', 'acc_1', 'admin', 100, 200, now), /CHECK/, 'remaining above amount rejected');
  assert.throws(() => db.prepare('INSERT INTO accounts (id, created_at, updated_at, status) VALUES (?, ?, ?, ?)')
    .run('acc_2', now, now, 'weird'), /CHECK/, 'invalid account status rejected');
  assert.throws(() => db.prepare('INSERT INTO credits (id, account_id, source, amount_micro, remaining_micro, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cr_4', 'missing', 'admin', 100, 100, now), /FOREIGN KEY/, 'foreign keys enforced');

  db.close();
});
