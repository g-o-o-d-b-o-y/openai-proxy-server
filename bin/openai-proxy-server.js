#!/usr/bin/env node
import fs from 'node:fs';
import { loadDotEnv } from '../src/env.js';
import { startServer } from '../src/index.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`openai-proxy-server

Usage:
  npx openai-proxy-server

Environment variables are bootstrap defaults: they seed the SQLite settings
table on first start. Afterwards everything is managed from the admin
dashboard and the database is authoritative.

  API:        http://<host>:56787/v1
  Landing:    http://<host>:56787/            self-service API keys
  Key board:  http://<host>:56787/key/        per-key usage dashboard
  Admin:      http://<host>:56787/_proxy/     keys, accounts, billing, settings

Key variables:
  ADMIN_TOKEN=...          protect the admin dashboard
  SITE_NAME=...            brand shown in the dashboard and landing page
  MARKUP_PCT=30            reseller markup over upstream cost
  FREE_CREDIT_USD=0.25     evaluation credit per new account
  REQUIRE_KEY=true         reject proxied requests without a key
  DB_FILE=.openai-proxy-server/proxy.db
  HOST=0.0.0.0             bind address (default: all interfaces)
  PORT=56787

Options:
  -h, --help       Show help
  -v, --version    Show package version`);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

loadDotEnv();

startServer().catch((error) => {
  if (error?.code === 'EADDRINUSE') {
    const port = error.port || process.env.PORT || 56787;
    console.error(`[openai-proxy-server] Fatal: address already in use (${error.address || '0.0.0.0'}:${port}).`);
    console.error(`[openai-proxy-server] Stop the other instance:  lsof -tiTCP:${port} | xargs kill`);
    console.error(`[openai-proxy-server] Or use another port:        PORT=56788 npm start`);
    process.exitCode = 1;
    return;
  }
  console.error('[openai-proxy-server] fatal:', error?.stack || error);
  process.exitCode = 1;
});
