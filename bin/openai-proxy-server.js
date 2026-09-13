#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../src/env.js';
import { startServer } from '../src/index.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`openai-proxy-server\n\nUsage:\n  npx openai-proxy-server\n\nConfiguration is read from process environment and .env in the current directory.\nBy default it listens on 0.0.0.0 so any device on your network can connect:\n  API:       http://<your-lan-ip>:56787/v1\n  Dashboard: http://<your-lan-ip>:56787/_proxy/\nLocal only: set HOST=127.0.0.1 in .env\n\nOptions:\n  -h, --help       Show help\n  -v, --version    Show package version`);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

loadDotEnv();

startServer().catch((error) => {
  console.error('[openai-proxy-server] fatal:', error?.stack || error);
  process.exitCode = 1;
});
