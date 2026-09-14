import os from 'node:os';
import { loadBootstrap } from './bootstrap.js';
import { openDatabase } from './db.js';
import { AccountsStore } from './accounts.js';
import { KeyStore } from './keys.js';
import { UsageStore } from './usage.js';
import { SettingsStore, createConfig } from './settings.js';
import { createProxyServer } from './server.js';
import { formatUsd } from './money.js';
import { paint, PREFIX } from './term.js';

export { loadBootstrap } from './bootstrap.js';
export { loadDotEnv } from './env.js';
export { openDatabase } from './db.js';
export { createConfig, SettingsStore } from './settings.js';
export { AccountsStore } from './accounts.js';
export { KeyStore, normalizeKeyLimits } from './keys.js';
export { UsageStore } from './usage.js';
export { createProxyServer } from './server.js';
export { classifyRoute, buildUpstreamUrl, patchJsonBody } from './routing.js';

function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item && item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

// Builds the full application without binding a port. Exported for tests and
// embedding; `startServer` adds the banner and process signal handling.
export function createApp(env = process.env) {
  const bootstrap = loadBootstrap(env);
  const config = createConfig(bootstrap);
  const db = openDatabase(bootstrap.dbFile);
  const settings = new SettingsStore(db, bootstrap);
  settings.applyTo(config);
  const accounts = new AccountsStore({ db, config });
  const keys = new KeyStore({ db, config, accounts });
  const usage = new UsageStore({ db, config, accounts });
  const server = createProxyServer(config, usage, { keys, accounts, settings });
  return { bootstrap, config, db, settings, accounts, keys, usage, server };
}

export async function startServer(env = process.env) {
  const app = createApp(env);
  const { config, server, accounts, settings, db } = app;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const local = `http://127.0.0.1:${port}`;
  const pad = (label) => label.padEnd(15);
  const dim = (text) => paint(text, 'dim');

  console.log(`${paint(PREFIX, 'cyan')} ${paint(`${config.dashboard.title} ready`, 'bold')}`);
  console.log(`${PREFIX} ${dim(pad('API:'))} ${local}/v1`);
  console.log(`${PREFIX} ${dim(pad('Landing:'))} ${local}/`);
  console.log(`${PREFIX} ${dim(pad('Key dashboard:'))} ${local}/key/`);
  if (config.dashboard.enabled) console.log(`${PREFIX} ${dim(pad('Admin:'))} ${local}${config.dashboard.path}/`);
  if (config.host === '0.0.0.0') {
    const lan = lanAddresses();
    if (lan.length) {
      console.log(`${PREFIX} ${dim(pad('LAN API:'))} ${lan.map((ip) => `http://${ip}:${port}/v1`).join('   ')}`);
      if (config.dashboard.enabled) {
        console.log(`${PREFIX} ${dim(pad('LAN Admin:'))} ${lan.map((ip) => `http://${ip}:${port}${config.dashboard.path}/`).join('   ')}`);
      }
    }
  } else if (!['127.0.0.1', 'localhost'].includes(config.host)) {
    console.log(`${PREFIX} ${dim(pad('Listening:'))} ${config.host}:${port}`);
  }

  console.log(`${PREFIX} Billing: +${config.billing.markupPct}% markup`
    + ` · free credit ${formatUsd(config.billing.freeCreditUsd)}`
    + ` · key limit ${config.keys.ipLimitPerMonth}/IP/month`
    + ` · keys ${config.keys.requireKey ? 'required' : 'optional'}`);
  if (!config.keys.requireKey) {
    console.log(paint(`${PREFIX} NOTE: requests without an API key are allowed (keys.require_key=false)`
      + `${config.keys.acceptAnyToken ? '; unknown tokens are treated as anonymous' : ''}.`, 'yellow'));
  }
  if (config.dashboard.enabled && !settings.get('dashboard.admin_token_hash')) {
    console.log(paint(`${PREFIX} WARNING: the admin dashboard is open — set an admin token in Settings or ADMIN_TOKEN.`, 'yellow'));
  }
  console.log(`${PREFIX} Accounts: ${accounts.counts().accounts} · database: ${config.dbFile}`);

  const shutdown = () => {
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { ...app };
}
