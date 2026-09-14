import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startTestApp, listen, close, createKey, jsonRequest } from './helpers.js';

function usageUpstream({ cost = null, sse = false } = {}) {
  return http.createServer(async (req, res) => {
    for await (const chunk of req) { /* drain */ }
    const usage = { prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000 };
    if (cost != null) usage.cost = cost;
    if (sse) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
      res.write(`data: {"choices":[],"usage":${JSON.stringify(usage)}}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage }));
  });
}

async function chat(app, key, body = {}) {
  const response = await fetch(`${app.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...body })
  });
  return response;
}

test('proxies JSON, injects the configured model, streams usage and bills with markup', async (t) => {
  const upstream = usageUpstream({ sse: true });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
    OPENAI_API_KEY: 'upstream-key',
    OPENAI_MODEL: 'server-model',
    PRICES: JSON.stringify({ 'server-model': { input: 1, output: 0 } }),
    MARKUP_PCT: '50',
    FREE_CREDIT_USD: '1'
  });
  t.after(() => app.close());

  const { data } = await createKey(app);
  const response = await chat(app, data.key, { stream: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-key-prefix'), data.key_prefix);
  assert.equal(response.headers.get('x-account-balance-usd'), '1');
  assert.ok(response.headers.get('x-request-id'));
  assert.match(await response.text(), /ok/);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const request = app.usage.recent(1)[0];
  assert.equal(request.model, 'server-model');
  assert.equal(request.status, 200);
  assert.equal(request.usage.totalTokens, 1000);
  assert.equal(request.upstreamCostUsd, 0.001);
  assert.equal(request.billedCostUsd, 0.0015);
  assert.equal(request.keyPrefix, data.key_prefix);

  const account = await (await fetch(`${app.url}/v1/account`, { headers: { authorization: `Bearer ${data.dashboard_token}` } })).json();
  assert.ok(Math.abs(account.account.balance_usd - 0.9985) < 1e-9);
});

test('reported upstream cost beats the price estimate', async (t) => {
  const upstream = usageUpstream({ cost: 0.5 });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    PRICES: JSON.stringify({ m: { input: 1, output: 1 } }), MARKUP_PCT: '30', FREE_CREDIT_USD: '2'
  });
  t.after(() => app.close());

  const { data } = await createKey(app);
  assert.equal((await chat(app, data.key)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const request = app.usage.recent(1)[0];
  assert.equal(request.upstreamCostUsd, 0.5);
  assert.equal(request.billedCostUsd, 0.65);
});

test('multipart bodies stream through unchanged', async (t) => {
  let received = '';
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) received += chunk.toString();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: 'ok' }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k',
    STT_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, STT_API_KEY: 'k', STT_MODEL: 'stt-model'
  });
  t.after(() => app.close());
  const { data } = await createKey(app);

  const body = '--x\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--x--\r\n';
  const response = await fetch(`${app.url}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x', authorization: `Bearer ${data.key}` },
    body
  });
  assert.equal(response.status, 200);
  assert.equal(received, body);
});

test('retries availability failures with fallbacks and reports the served model', async (t) => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const model = JSON.parse(Buffer.concat(chunks).toString('utf8')).model;
    seen.push(model);
    if (model === 'primary') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'unavailable' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: model } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k',
    OPENAI_MODEL: 'primary', OPENAI_MODEL_FALLBACKS: 'backup-a,backup-b'
  });
  t.after(() => app.close());
  const { data } = await createKey(app);

  const response = await chat(app, data.key);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-model-fallback'), 'backup-a');
  assert.deepEqual(seen, ['primary', 'backup-a']);
  await response.text();

  // Client-chosen models are never replaced.
  const chosen = await chat(app, data.key, { model: 'client-model' });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.headers.get('x-model-fallback'), null);
});

test('per-key spend limits deny before the upstream and do not consume allowance', async (t) => {
  let hits = 0;
  const upstream = usageUpstream();
  upstream.on('request', () => { hits += 1; });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    PRICES: JSON.stringify({ m: { input: 1, output: 0 } }), FREE_CREDIT_USD: '10', MARKUP_PCT: '0'
  });
  t.after(() => app.close());
  const { data } = await createKey(app);
  app.keys.updateKey(data.id, { limits: { spend: { max_usd: 0.0005, window_hours: 24 } } });

  const allowed = await chat(app, data.key);
  assert.equal(allowed.status, 200);
  await allowed.text();

  const denied = await chat(app, data.key);
  assert.equal(denied.status, 429);
  const body = await denied.json();
  assert.equal(body.error.code, 'spend_limit_exceeded');
  assert.match(body.error.message, /\$0\.001\/\$0\.0005/);
  assert.equal(hits, 1, 'denied request never reached the upstream');

  await new Promise((resolve) => setTimeout(resolve, 20));
  const deniedLog = app.usage.recent(1)[0];
  assert.equal(deniedLog.status, 429);
  assert.equal(deniedLog.billedCostUsd, 0);
  assert.equal(deniedLog.usage, null, 'denied requests add no usage to the window');
});

test('audio responses without usage are priced from their duration', async (t) => {
  const pcm = Buffer.alloc(24000); // 0.5s at 24kHz mono 16-bit
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* drain */ }
    res.writeHead(200, { 'content-type': 'audio/pcm;rate=24000;channels=1' });
    res.end(pcm);
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k',
    TTS_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, TTS_API_KEY: 'k', TTS_MODEL: 'tts-model',
    PRICES: JSON.stringify({ 'tts-model': { audio_second: 0.02 } }), MARKUP_PCT: '100', FREE_CREDIT_USD: '1'
  });
  t.after(() => app.close());
  const { data } = await createKey(app);

  const response = await fetch(`${app.url}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.key}` },
    body: JSON.stringify({ input: 'hi' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 24000);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const request = app.usage.recent(1)[0];
  assert.equal(request.kind, 'tts');
  assert.equal(request.usage.audioMs, 500);
  assert.equal(request.upstreamCostUsd, 0.01);
  assert.equal(request.billedCostUsd, 0.02);
});

test('identity rules: required keys, invalid keys and empty balances', async (t) => {
  const upstream = usageUpstream();
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    FREE_CREDIT_USD: '0', REQUIRE_KEY: 'true'
  });
  t.after(() => app.close());

  const anonymous = await chat(app, null);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'missing_api_key');

  const invalid = await chat(app, 'sk-opx-not-a-real-key');
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error.code, 'invalid_api_key');

  const { data } = await createKey(app);
  const broke = await chat(app, data.key);
  assert.equal(broke.status, 402);
  assert.equal((await broke.json()).error.code, 'insufficient_balance');
});

test('open mode allows anonymous traffic and never bills it', async (t) => {
  const upstream = usageUpstream({ cost: 0.01 });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    REQUIRE_KEY: 'false'
  });
  t.after(() => app.close());

  const response = await chat(app, null);
  assert.equal(response.status, 200);
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const request = app.usage.recent(1)[0];
  assert.equal(request.keyId, null);
  assert.equal(request.billedCostUsd, 0);
  assert.equal(request.upstreamCostUsd, 0.01);
});

test('open mode can accept placeholder tokens when enabled', async (t) => {
  const upstream = usageUpstream({ cost: 0.01 });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  // Default open mode still rejects an unknown token.
  const strict = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    REQUIRE_KEY: 'false'
  });
  t.after(() => strict.close());
  const rejected = await chat(strict, 'local-anything');
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error.code, 'invalid_api_key');

  // With ACCEPT_ANY_TOKEN the same request is anonymous and unbilled.
  const open = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    REQUIRE_KEY: 'false', ACCEPT_ANY_TOKEN: 'true'
  });
  t.after(() => open.close());
  const allowed = await chat(open, 'local-anything');
  assert.equal(allowed.status, 200);
  await allowed.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const request = open.usage.recent(1)[0];
  assert.equal(request.keyId, null);
  assert.equal(request.billedCostUsd, 0);
  assert.equal(request.upstreamCostUsd, 0.01);

  // Required mode ignores the flag entirely.
  const required = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    REQUIRE_KEY: 'true', ACCEPT_ANY_TOKEN: 'true'
  });
  t.after(() => required.close());
  assert.equal((await chat(required, 'local-anything')).status, 401);
});

test('model policies reshape JSON bodies as configured', async (t) => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [] }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const app = await startTestApp({
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k', OPENAI_MODEL: 'forced-model',
    MODEL_POLICY: 'force', FREE_CREDIT_USD: '10'
  });
  t.after(() => app.close());
  const { data } = await createKey(app);

  const response = await chat(app, data.key, { model: 'client-model' });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen[0].model, 'forced-model');
});

test('admin API is protected when an admin token is configured', async (t) => {
  const app = await startTestApp({ ADMIN_TOKEN: 'top-secret' });
  t.after(() => app.close());

  assert.equal((await fetch(`${app.url}/dashboard/api/overview`)).status, 401);
  assert.equal((await fetch(`${app.url}/dashboard/api/requests`)).status, 401);
  assert.equal((await fetch(`${app.url}/dashboard/api/overview`, { headers: { 'x-admin-token': 'top-secret' } })).status, 200);
  assert.equal((await fetch(`${app.url}/dashboard/api/overview?token=top-secret`)).status, 200);
  assert.equal((await fetch(`${app.url}/dashboard/api/overview`, { headers: { 'x-admin-token': 'wrong' } })).status, 401);

  // The admin shell and public pages stay readable without a token.
  assert.equal((await fetch(`${app.url}/dashboard/`)).status, 200);
  assert.equal((await fetch(`${app.url}/`)).status, 200);
  assert.equal((await fetch(`${app.url}/key/`)).status, 200);
});

test('dashboard path and title are configurable', async (t) => {
  const app = await startTestApp({ DASHBOARD_PATH: 'control-room', SITE_NAME: 'Acme Gateway' });
  t.after(() => app.close());

  assert.equal((await fetch(`${app.url}/control-room/`)).status, 200);
  assert.equal((await fetch(`${app.url}/control-room/api/overview`)).status, 200);
  assert.equal((await fetch(`${app.url}/dashboard/`)).status, 404);
  assert.match(await (await fetch(`${app.url}/`)).text(), /Acme Gateway/);
});
