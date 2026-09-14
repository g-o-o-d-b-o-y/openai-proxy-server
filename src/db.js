// SQLite storage layer (node:sqlite, Node >= 22.13).
//
// One database file holds everything durable. Tables are STRICT and use CHECK
// constraints so invalid state cannot be written even by mistake. Schema
// changes are applied through ordered migrations tracked in schema_migrations.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // ---------------------------------------------------------------- v1
  `
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE accounts (
    id                 TEXT PRIMARY KEY,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_ip         TEXT,
    contact            TEXT NOT NULL DEFAULT '',
    note               TEXT NOT NULL DEFAULT '',
    markup_pct         REAL CHECK (markup_pct IS NULL OR markup_pct >= 0),
    can_create_keys    INTEGER NOT NULL DEFAULT 0 CHECK (can_create_keys IN (0, 1)),
    total_requests     INTEGER NOT NULL DEFAULT 0 CHECK (total_requests >= 0),
    total_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    total_cost_micro   INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_micro >= 0),
    total_billed_micro INTEGER NOT NULL DEFAULT 0 CHECK (total_billed_micro >= 0)
  ) STRICT;
  CREATE INDEX idx_accounts_created_ip ON accounts (created_ip);

  CREATE TABLE plans (
    code          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    price_micro   INTEGER NOT NULL CHECK (price_micro >= 0),
    credit_micro  INTEGER NOT NULL CHECK (credit_micro > 0),
    duration_days INTEGER NOT NULL CHECK (duration_days >= 1),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    sort          INTEGER NOT NULL DEFAULT 0,
    description   TEXT NOT NULL DEFAULT ''
  ) STRICT;

  CREATE TABLE credits (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    source          TEXT NOT NULL CHECK (source IN ('free', 'subscription', 'purchase', 'admin', 'refund')),
    amount_micro    INTEGER NOT NULL CHECK (amount_micro > 0),
    remaining_micro INTEGER NOT NULL CHECK (remaining_micro >= 0),
    created_at      TEXT NOT NULL,
    expires_at      TEXT,
    plan_code       TEXT,
    note            TEXT NOT NULL DEFAULT '',
    CHECK (remaining_micro <= amount_micro)
  ) STRICT;
  CREATE INDEX idx_credits_account ON credits (account_id, remaining_micro);

  CREATE TABLE subscriptions (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    plan_code    TEXT NOT NULL,
    price_micro  INTEGER NOT NULL DEFAULT 0 CHECK (price_micro >= 0),
    credit_micro INTEGER NOT NULL DEFAULT 0 CHECK (credit_micro >= 0),
    started_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at   TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_subscriptions_account ON subscriptions (account_id, expires_at);

  CREATE TABLE api_keys (
    id               TEXT PRIMARY KEY,
    key_hash         TEXT NOT NULL UNIQUE,
    key_prefix       TEXT NOT NULL,
    name             TEXT NOT NULL DEFAULT '',
    account_id       TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    parent_key_id    TEXT REFERENCES api_keys (id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL,
    created_ip       TEXT,
    last_used_at     TEXT,
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'revoked')),
    bypass_ip_limit  INTEGER NOT NULL DEFAULT 0 CHECK (bypass_ip_limit IN (0, 1)),
    expires_at       TEXT,
    markup_pct       REAL CHECK (markup_pct IS NULL OR markup_pct >= 0),
    limits           TEXT NOT NULL DEFAULT '{}',
    total_requests   INTEGER NOT NULL DEFAULT 0 CHECK (total_requests >= 0),
    total_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    total_cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_micro >= 0),
    total_billed_micro INTEGER NOT NULL DEFAULT 0 CHECK (total_billed_micro >= 0)
  ) STRICT;
  CREATE INDEX idx_api_keys_account ON api_keys (account_id);
  CREATE INDEX idx_api_keys_created_ip ON api_keys (created_ip, created_at);
  CREATE INDEX idx_api_keys_parent ON api_keys (parent_key_id);

  CREATE TABLE dash_tokens (
    id           TEXT PRIMARY KEY,
    key_id       TEXT NOT NULL REFERENCES api_keys (id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
  ) STRICT;
  CREATE INDEX idx_dash_tokens_key ON dash_tokens (key_id);

  CREATE TABLE usage_buckets (
    key_id            TEXT NOT NULL REFERENCES api_keys (id) ON DELETE CASCADE,
    account_id        TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    hour_ts           INTEGER NOT NULL,
    kind              TEXT NOT NULL DEFAULT 'llm',
    model             TEXT NOT NULL DEFAULT '',
    requests          INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
    errors            INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
    input_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    upstream_cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (upstream_cost_micro >= 0),
    billed_cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (billed_cost_micro >= 0),
    audio_ms          INTEGER NOT NULL DEFAULT 0 CHECK (audio_ms >= 0),
    bytes_in          INTEGER NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
    bytes_out         INTEGER NOT NULL DEFAULT 0 CHECK (bytes_out >= 0),
    PRIMARY KEY (key_id, hour_ts, kind, model)
  ) STRICT;
  CREATE INDEX idx_usage_account ON usage_buckets (account_id, hour_ts);
  CREATE INDEX idx_usage_hour ON usage_buckets (hour_ts);

  CREATE TABLE request_logs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id         TEXT NOT NULL,
    time               TEXT NOT NULL,
    hour_ts            INTEGER NOT NULL,
    key_id             TEXT,
    account_id         TEXT,
    key_prefix         TEXT,
    method             TEXT,
    path               TEXT,
    kind               TEXT,
    client_ip          TEXT,
    status             INTEGER NOT NULL DEFAULT 0,
    duration_ms        INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    model              TEXT,
    fallback           TEXT,
    input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    audio_ms           INTEGER NOT NULL DEFAULT 0 CHECK (audio_ms >= 0),
    upstream_cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (upstream_cost_micro >= 0),
    billed_cost_micro  INTEGER NOT NULL DEFAULT 0 CHECK (billed_cost_micro >= 0),
    bytes_in           INTEGER NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
    bytes_out          INTEGER NOT NULL DEFAULT 0 CHECK (bytes_out >= 0),
    error              TEXT
  ) STRICT;
  CREATE INDEX idx_logs_time ON request_logs (time DESC);
  CREATE INDEX idx_logs_key ON request_logs (key_id, id DESC);
  CREATE INDEX idx_logs_account ON request_logs (account_id, id DESC);
  CREATE INDEX idx_logs_hour ON request_logs (hour_ts);

  CREATE TABLE redeem_codes (
    code        TEXT PRIMARY KEY,
    plan_code   TEXT,
    credit_micro INTEGER CHECK (credit_micro IS NULL OR credit_micro > 0),
    created_at  TEXT NOT NULL,
    expires_at  TEXT,
    redeemed_at TEXT,
    redeemed_by TEXT,
    note        TEXT NOT NULL DEFAULT ''
  ) STRICT;

  CREATE TABLE totals (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    requests           INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
    errors             INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
    bytes_in           INTEGER NOT NULL DEFAULT 0 CHECK (bytes_in >= 0),
    bytes_out          INTEGER NOT NULL DEFAULT 0 CHECK (bytes_out >= 0),
    input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    audio_ms           INTEGER NOT NULL DEFAULT 0 CHECK (audio_ms >= 0),
    upstream_cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (upstream_cost_micro >= 0),
    billed_cost_micro  INTEGER NOT NULL DEFAULT 0 CHECK (billed_cost_micro >= 0)
  ) STRICT;
  `
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(file = ':memory:') {
  if (file && file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (file !== ':memory:') {
    try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* e.g. network filesystem */ }
  }
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw new Error(`Incompatible database at ${file}: ${error.message}. `
      + 'This version requires a fresh database; move the old file aside or set DB_FILE to a new path.');
  }
  return db;
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)));
  for (let version = 1; version <= MIGRATIONS.length; version += 1) {
    if (applied.has(version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version - 1]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
  }
}

// Small helper for multi-statement writes.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  }
}
