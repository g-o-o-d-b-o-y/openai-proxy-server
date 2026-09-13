import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { once } from 'node:events';
import { createProxyServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { StatsStore } from '../src/stats.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

test('proxies JSON, injects defaults, preserves streaming, and records usage', async (t) => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    seen.push({ url: req.url, auth: req.headers.authorization, body: bodyText });

    if (req.url === '/api/v1/chat/completions') {
      const parsed = JSON.parse(bodyText);
      assert.equal(parsed.model, 'server-llm');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n');
        res.end('data: [DONE]\n\n');
      }, 10);
      return;
    }

    if (req.url === '/api/v1/audio/speech') {
      const parsed = JSON.parse(bodyText);
      assert.equal(parsed.model, 'server-tts');
      assert.equal(parsed.voice, 'voice-z');
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(Buffer.from([1, 2, 3, 4]));
      return;
    }

    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-proxy-test-'));
  const config = loadConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/api/v1`,
    OPENAI_API_KEY: 'upstream-llm-key',
    OPENAI_MODEL: 'server-llm',
    TTS_BASE_URL: `http://127.0.0.1:${upstreamPort}/api/v1`,
    TTS_API_KEY: 'upstream-tts-key',
    TTS_MODEL: 'server-tts',
    TTS_VOICE: 'voice-z',
    STT_BASE_URL: `http://127.0.0.1:${upstreamPort}/api/v1`,
    STT_API_KEY: 'upstream-stt-key',
    STT_MODEL: 'server-stt',
    LOG_LEVEL: 'silent',
    STATS_FILE: path.join(dir, 'stats.json')
  });
  const stats = new StatsStore({ file: config.statsFile, maxLogs: 100 });
  const proxy = createProxyServer(config, stats);
  const proxyPort = await listen(proxy);
  t.after(() => close(proxy));

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer client-key' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], stream: true })
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /hello/);
  assert.equal(seen[0].auth, 'Bearer upstream-llm-key');

  const speech = await fetch(`http://127.0.0.1:${proxyPort}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'say hi' })
  });
  assert.deepEqual([...new Uint8Array(await speech.arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(seen[1].auth, 'Bearer upstream-tts-key');

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stats.totals.requests, 2);
  assert.equal(stats.totals.totalTokens, 5);
  assert.equal(stats.byRoute.openai.requests, 1);
  assert.equal(stats.byRoute.tts.requests, 1);

  // Client IP is captured and normalized (loopback IPv6 -> IPv4 style).
  assert.equal(stats.logs[0].clientIp, '127.0.0.1');

  // /api/logs supports pagination and kind filtering.
  const page1 = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?limit=1&offset=0`)).json();
  assert.equal(page1.total, 2);
  assert.equal(page1.logs.length, 1);
  assert.equal(page1.logs[0].kind, 'tts');
  const ttsOnly = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?kind=tts`)).json();
  assert.equal(ttsOnly.total, 1);
  assert.equal(ttsOnly.logs[0].kind, 'tts');
  const legacy = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs`)).json();
  assert.ok(Array.isArray(legacy), 'legacy plain-array shape preserved');
  assert.equal(legacy.length, 2);

  // Targeted filters: by IP, model, method, status.
  assert.equal((await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?ip=127.0.0.1`)).json()).total, 2);
  const llmOnly = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?model=server-llm`)).json();
  assert.equal(llmOnly.total, 1);
  assert.equal(llmOnly.logs[0].kind, 'openai');
  assert.equal((await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?method=POST`)).json()).total, 2);
  assert.equal((await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?status=200`)).json()).total, 2);
  assert.equal((await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?ip=203.0.113.9`)).json()).total, 0);

  // Path and hour filters actually apply.
  const byPath = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?path=/v1/audio/speech`)).json();
  assert.equal(byPath.total, 1);
  assert.ok(byPath.logs.every((l) => l.path === '/v1/audio/speech'));
  const hourParam = stats.logs[0].time.slice(0, 13);
  const byHour = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/logs?hour=${hourParam}`)).json();
  assert.ok(byHour.total >= 1, 'hour filter returns matches');
  assert.ok(byHour.logs.every((l) => l.time.startsWith(hourParam)), 'hour filter matches exact hour');

  // /api/groups aggregates by field and respects filters.
  const byIp = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/groups?field=ip`)).json();
  assert.equal(byIp.field, 'ip');
  assert.equal(byIp.total, 2);
  assert.deepEqual(byIp.groups.map((g) => [g.key, g.count]), [['127.0.0.1', 2]]);
  const byModel = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/groups?field=model`)).json();
  assert.equal(byModel.groups.length, 2);
  assert.ok(byModel.groups.some((g) => g.key === 'server-llm' && g.count === 1));
  assert.ok(byModel.groups.some((g) => g.key === 'server-tts' && g.count === 1));
  const byKind = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/groups?field=kind&method=POST`)).json();
  assert.deepEqual(byKind.groups.map((g) => [g.key, g.count]).sort(), [['openai', 1], ['tts', 1]]);
  const byStatus = await (await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/groups?field=status&ip=127.0.0.1&model=server-llm`)).json();
  assert.deepEqual(byStatus.groups.map((g) => [g.key, g.count]), [['200', 1]]);
  const badGroup = await fetch(`http://127.0.0.1:${proxyPort}/_proxy/api/groups?field=nope`);
  assert.equal(badGroup.status, 400);
});

test('streams non-JSON request bodies without buffering or rewriting', async (t) => {
  let received = '';
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) received += chunk.toString();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: 'ok' }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const config = loadConfig({
    HOST: '127.0.0.1', PORT: '0',
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, OPENAI_API_KEY: 'k',
    STT_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`, STT_API_KEY: 'stt-k', STT_MODEL: 'stt-model',
    LOG_LEVEL: 'silent', STATS_FILE: ''
  });
  const proxy = createProxyServer(config, new StatsStore({ file: null }));
  const proxyPort = await listen(proxy);
  t.after(() => close(proxy));

  const body = '--x\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--x--\r\n';
  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body
  });
  assert.equal(response.status, 200);
  assert.equal(received, body);
});

test('serves favicon locally without recording stats/logs or hitting upstream', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-proxy-favicon-'));
  // Unreachable upstream: proves the favicon never gets proxied.
  const config = loadConfig({
    HOST: '127.0.0.1', PORT: '0',
    OPENAI_BASE_URL: 'http://127.0.0.1:1/v1', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm',
    TTS_BASE_URL: 'http://127.0.0.1:1/v1', TTS_API_KEY: 'k',
    STT_BASE_URL: 'http://127.0.0.1:1/v1', STT_API_KEY: 'k',
    LOG_LEVEL: 'silent', STATS_FILE: path.join(dir, 'stats.json')
  });
  const stats = new StatsStore({ file: config.statsFile, maxLogs: 100 });
  const proxy = createProxyServer(config, stats);
  const proxyPort = await listen(proxy);
  t.after(() => close(proxy));

  // Opening the bare host redirects to the dashboard.
  const root = await fetch(`http://127.0.0.1:${proxyPort}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/_proxy/');
  assert.equal(stats.totals.requests, 0, 'root redirect must not be proxied or logged');

  for (const faviconPath of ['/favicon.ico', '/favicon.svg']) {
    const res = await fetch(`http://127.0.0.1:${proxyPort}${faviconPath}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await res.text(), /<svg/);
  }

  // Dashboard HTML points browsers at the SVG icon.
  const dash = await fetch(`http://127.0.0.1:${proxyPort}/_proxy/`);
  assert.equal(dash.status, 200);
  assert.match(await dash.text(), /rel="icon" href="\/favicon\.svg"/);

  // Browser/service probes are answered locally (404), never proxied upstream
  // and never recorded in stats/logs.
  const noise = await fetch(`http://127.0.0.1:${proxyPort}/.well-known/appspecific/com.chrome.devtools.json`);
  assert.equal(noise.status, 404);
  const robots = await fetch(`http://127.0.0.1:${proxyPort}/robots.txt`);
  assert.equal(robots.status, 404);
  for (const noisePath of [
    '/_next/static/immutable/chunks/abc.js',
    '/manifest.webmanifest',
    '/favicon/glyph.png',
    '/cdn-cgi/challenge-platform/scripts/jsd/main.js',
    '/service-worker.js'
  ]) {
    const res = await fetch(`http://127.0.0.1:${proxyPort}${noisePath}`);
    assert.equal(res.status, 404, `${noisePath} must not be proxied`);
  }
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(stats.totals.requests, 0);
  assert.equal(stats.logs.length, 0);
  assert.equal(stats.active, 0);
});
