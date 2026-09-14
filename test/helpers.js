import { once } from 'node:events';
import { createApp } from '../src/index.js';

export function testEnv(overrides = {}) {
  return {
    DB_FILE: ':memory:',
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'silent',
    KEY_COOLDOWN_SECONDS: '0',
    ...overrides
  };
}

export async function startTestApp(overrides = {}) {
  const app = createApp(testEnv(overrides));
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  app.port = app.server.address().port;
  app.url = `http://127.0.0.1:${app.port}`;
  app.close = async () => {
    if (app.server.listening) {
      app.server.close();
      await once(app.server, 'close');
    }
    try { app.db.close(); } catch { /* already closed */ }
  };
  return app;
}

export async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

export async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

export function jsonRequest(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

export async function createKey(app, body = {}, headers = {}) {
  const response = await jsonRequest(`${app.url}/v1/keys`, body, headers);
  return { response, data: await response.json() };
}
