import { loadConfig } from './config.js';
import { StatsStore } from './stats.js';
import { createProxyServer } from './server.js';
import { paint, PREFIX } from './term.js';
import os from 'node:os';

export { loadConfig } from './config.js';
export { createProxyServer } from './server.js';
export { StatsStore } from './stats.js';
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

export async function startServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const stats = new StatsStore({ file: config.statsFile, maxLogs: config.maxLogEntries });
  const server = createProxyServer(config, stats);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const pad = (label) => label.padEnd(15);
  const dim = (text) => paint(text, 'dim');
  const loc = `${PREFIX} ${dim(pad('Local:'))}`;

  console.log(`${paint(PREFIX, 'cyan')} ${paint('AI gateway ready', 'bold')}`);
  console.log(`${loc} http://127.0.0.1:${port}/v1`);
  console.log(`${loc} http://127.0.0.1:${port}${config.dashboardPath}/ (dashboard)`);
  if (config.host === '0.0.0.0') {
    const lan = lanAddresses();
    if (lan.length) {
      console.log(`${PREFIX} ${dim(pad('LAN API:'))} ${lan.map((ip) => `http://${ip}:${port}/v1`).join('   ')}`);
      console.log(`${PREFIX} ${dim(pad('LAN Dashboard:'))} ${lan.map((ip) => `http://${ip}:${port}${config.dashboardPath}/`).join('   ')}`);
    }
  } else if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    console.log(`${PREFIX} ${dim(pad('Listening:'))} ${config.host}:${port}`);
  }
  if (config.limits && config.limits.length) {
    console.log(`${PREFIX} Quotas: ${config.limits.length} rule(s) enabled`);
  }
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.proxyApiKey) {
    console.log(paint(`${PREFIX} WARNING: the proxy is reachable from other devices on your network (HOST=${config.host}) but PROXY_API_KEY is empty.`, 'yellow'));
    console.log(paint(`${PREFIX}   Anyone on the network can call your upstream API through this proxy.`, 'yellow'));
    console.log(paint(`${PREFIX}   Fix: set PROXY_API_KEY (and DASHBOARD_TOKEN) in .env.`, 'yellow'));
  }

  const shutdown = () => {
    stats.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { server, config, stats };
}
