import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { startTestApp, createKey, jsonRequest } from './helpers.js';

const bearer = (token) => ({ authorization: `Bearer ${token}` });

test('anonymous key creation grants free credit and enforces the IP limit atomically', async (t) => {
  const app = await startTestApp({ FREE_CREDIT_USD: '0.25', KEY_IP_LIMIT_PER_MONTH: '2', KEY_COOLDOWN_SECONDS: '0' });
  t.after(() => app.close());

  const first = await createKey(app, { name: 'one', contact: 'a@example.com' });
  assert.equal(first.response.status, 201);
  assert.match(first.data.key, /^sk-opx-[A-Za-z0-9]{24}$/);
  assert.match(first.data.dashboard_token, /^dash_/);
  assert.match(first.data.dashboard_url, /\/key\/#token=/);
  assert.equal(first.data.account.balance_usd, 0.25);
  assert.equal(first.data.notice, 'Store the key and dashboard token now; they are shown only once.');

  const second = await createKey(app, {});
  assert.equal(second.response.status, 201);

  const third = await createKey(app, {});
  assert.equal(third.response.status, 429);
  assert.equal(third.data.error.code, 'ip_key_limit');

  // Parallel requests cannot overshoot: a fresh app with 8 parallel calls.
  const parallel = await startTestApp({ KEY_IP_LIMIT_PER_MONTH: '2', KEY_COOLDOWN_SECONDS: '0' });
  t.after(() => parallel.close());
  const results = await Promise.all(Array.from({ length: 8 }, () => jsonRequest(`${parallel.url}/v1/keys`, {})));
  assert.equal(results.filter((response) => response.status === 201).length, 2);
});

test('account-scoped keys share the balance and bypass the IP limit on subscription', async (t) => {
  const app = await startTestApp({ KEY_IP_LIMIT_PER_MONTH: '2', KEY_COOLDOWN_SECONDS: '0', FREE_CREDIT_USD: '0' });
  t.after(() => app.close());

  const { data: primary } = await createKey(app, { name: 'primary' });
  const scoped = await jsonRequest(`${app.url}/v1/keys`, { name: 'child' }, bearer(primary.key));
  assert.equal(scoped.status, 201);

  // The third key from the same IP is denied until the account subscribes.
  const denied = await jsonRequest(`${app.url}/v1/keys`, { name: 'third' }, bearer(primary.key));
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).error.code, 'ip_key_limit');

  app.accounts.grantSubscription(primary.account.id, 'monthly');
  const subscribed = await jsonRequest(`${app.url}/v1/keys`, { name: 'sub-child' }, bearer(primary.key));
  assert.equal(subscribed.status, 201);
  const subscribedBody = await subscribed.json();
  assert.equal(subscribedBody.account.id, primary.account.id);
  assert.equal(subscribedBody.account.subscription.plan_code, 'monthly');

  // List keys with usage windows.
  const list = await (await fetch(`${app.url}/v1/keys`, { headers: bearer(primary.key) })).json();
  assert.equal(list.keys.length, 3);
  assert.equal(list.account.id, primary.account.id);

  // Account view for a dashboard token exposes limits and credits.
  const account = await (await fetch(`${app.url}/v1/account`, { headers: bearer(primary.dashboard_token) })).json();
  assert.equal(account.current_key.id, primary.id);
  assert.deepEqual(account.limits_usage, { spend_usd: 0, tokens: null, requests: 0 });
  assert.ok(account.credits.some((credit) => credit.source === 'subscription'));
});

test('keys can be blocked and rotated; redeem codes apply to the account', async (t) => {
  const app = await startTestApp({ FREE_CREDIT_USD: '0' });
  t.after(() => app.close());
  const { data: primary } = await createKey(app, { name: 'original' });

  const blocked = await fetch(`${app.url}/v1/keys/${primary.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...bearer(primary.key) },
    body: JSON.stringify({ status: 'blocked', name: 'renamed' })
  });
  assert.equal(blocked.status, 200);
  const blockedKey = await blocked.json();
  assert.equal(blockedKey.key.status, 'blocked');
  assert.equal(blockedKey.key.name, 'renamed');

  const rotate = await jsonRequest(`${app.url}/v1/keys/${primary.id}/rotate`, {}, bearer(primary.dashboard_token));
  assert.equal(rotate.status, 201);
  const replacement = await rotate.json();
  assert.equal(replacement.blocked_key_id, primary.id);
  assert.equal(replacement.account, undefined, 'rotate returns only the new key material');

  const code = app.accounts.createRedeemCode({ creditUsd: 3 }).code;
  const redeemed = await jsonRequest(`${app.url}/v1/account/redeem`, { code }, bearer(replacement.key));
  assert.equal(redeemed.status, 200);
  const redeemedBody = await redeemed.json();
  assert.equal(redeemedBody.result.kind, 'credit');
  assert.equal(redeemedBody.account.balance_usd, 3);
  assert.equal((await jsonRequest(`${app.url}/v1/account/redeem`, { code }, bearer(replacement.key))).status, 409);
});

test('usage and request history are scoped to the account', async (t) => {
  const app = await startTestApp({ FREE_CREDIT_USD: '5' });
  t.after(() => app.close());
  const { data: primary } = await createKey(app);

  const hourTs = Math.floor(Date.now() / 1000 / 3600) * 3600;
  app.db.prepare(`INSERT INTO usage_buckets (key_id, account_id, hour_ts, kind, model, requests, total_tokens, billed_cost_micro)
    VALUES (?, ?, ?, 'llm', 'm', 2, 300, 1234)`).run(primary.id, primary.account.id, hourTs);

  const usage = await (await fetch(`${app.url}/v1/account/usage?days=30`, { headers: bearer(primary.key) })).json();
  assert.equal(usage.scope, 'account');
  assert.equal(usage.breakdown.totals.requests, 2);
  assert.ok(Math.abs(usage.breakdown.totals.billedCostUsd - 0.001234) < 1e-9);
  assert.equal(usage.series.length, 1);

  const byKey = await (await fetch(`${app.url}/v1/account/usage?days=30&key=${primary.id}`, { headers: bearer(primary.key) })).json();
  assert.equal(byKey.scope, 'key');
  assert.equal(byKey.key_id, primary.id);

  const notFound = await fetch(`${app.url}/v1/account/usage?key=key_nope`, { headers: bearer(primary.key) });
  assert.equal(notFound.status, 404);

  // Requests endpoint accepts the account token and pagination.
  app.db.prepare(`INSERT INTO request_logs (request_id, time, hour_ts, key_id, account_id, status) VALUES ('r1', ?, ?, ?, ?, 200)`)
    .run(new Date().toISOString(), hourTs, primary.id, primary.account.id);
  const requests = await (await fetch(`${app.url}/v1/account/requests?limit=5`, { headers: bearer(primary.key) })).json();
  assert.equal(requests.total, 1);
  assert.equal(requests.requests[0].id, 'r1');
});

test('admin API manages keys, accounts, plans, codes, requests and settings', async (t) => {
  const app = await startTestApp({ MARKUP_PCT: '30' });
  t.after(() => app.close());
  const { data: primary } = await createKey(app, { name: 'customer' });

  const overview = await (await fetch(`${app.url}/dashboard/api/overview`)).json();
  assert.equal(overview.counts.keys, 1);
  assert.equal(overview.counts.accounts, 1);
  assert.equal(overview.outstanding_usd, 0.25);
  assert.equal(overview.revenue_30d.billedUsd, 0);

  const keys = await (await fetch(`${app.url}/dashboard/api/keys?q=customer`)).json();
  assert.equal(keys.total, 1);
  assert.equal(keys.keys[0].account_id, primary.account.id);

  // The list reports 30-day usage windows.
  const bucketTs = Math.floor(Date.now() / 1000 / 3600) * 3600;
  app.db.prepare(`INSERT INTO usage_buckets (key_id, account_id, hour_ts, kind, model, requests, total_tokens, upstream_cost_micro, billed_cost_micro)
    VALUES (?, ?, ?, 'llm', 'm', 4, 500, 1000, 2000)`).run(primary.id, primary.account.id, bucketTs);
  const keysWithUsage = await (await fetch(`${app.url}/dashboard/api/keys?q=customer`)).json();
  assert.equal(keysWithUsage.keys[0].usage_30d.requests, 4);
  assert.equal(keysWithUsage.keys[0].usage_30d.billed_cost_usd, 0.002);

  const patched = await (await fetch(`${app.url}/dashboard/api/keys/${primary.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'renamed', limits: { rpm: 5, spend: { max_usd: 2, window_hours: 24 } }, markup_pct: 10 })
  })).json();
  assert.equal(patched.key.name, 'renamed');
  assert.equal(patched.key.limits.rpm, 5);
  assert.equal(patched.key.markup_pct, 10);

  const accountDetail = await (await fetch(`${app.url}/dashboard/api/accounts/${primary.account.id}`)).json();
  assert.equal(accountDetail.account.id, primary.account.id);
  assert.equal(accountDetail.keys.length, 1);

  const credited = await jsonRequest(`${app.url}/dashboard/api/accounts/${primary.account.id}/credits`, { amount_usd: 3.5, note: 'test' });
  assert.equal(credited.status, 200);
  assert.equal((await credited.json()).account.balance_usd, 3.75);

  const adminKey = await jsonRequest(`${app.url}/dashboard/api/accounts/${primary.account.id}/keys`, { name: 'admin' });
  assert.equal(adminKey.status, 201);
  assert.match((await adminKey.json()).key, /^sk-opx-/);

  const plan = await jsonRequest(`${app.url}/dashboard/api/plans`, { code: 'weekly', name: 'Weekly', price_usd: 5, credit_usd: 5, duration_days: 7 });
  assert.equal(plan.status, 200);
  assert.ok((await (await fetch(`${app.url}/v1/plans`)).json()).plans.some((entry) => entry.code === 'weekly'));

  const code = await jsonRequest(`${app.url}/dashboard/api/codes`, { plan_code: 'weekly' });
  assert.equal(code.status, 200);
  assert.match((await code.json()).code.code, /^OPX-/);

  const groups = await (await fetch(`${app.url}/dashboard/api/requests/groups?field=kind`)).json();
  assert.equal(groups.field, 'kind');
  const badGroup = await fetch(`${app.url}/dashboard/api/requests/groups?field=nope`);
  assert.equal(badGroup.status, 400);

  const settingsView = await (await fetch(`${app.url}/dashboard/api/settings`)).json();
  assert.ok(settingsView.settings.length > 20);
  const settingsPatch = await fetch(`${app.url}/dashboard/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ 'billing.markup_pct': 55, 'keys.ip_limit_per_month': 7 })
  });
  assert.equal(settingsPatch.status, 200);
  assert.equal(app.config.billing.markupPct, 55);
  assert.equal(app.config.keys.ipLimitPerMonth, 7);
});

test('admin token setup through the settings API protects all admin routes', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());

  const patch = await fetch(`${app.url}/dashboard/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ 'dashboard.admin_token_hash': 'chosen-token' })
  });
  assert.equal(patch.status, 200);

  assert.equal((await fetch(`${app.url}/dashboard/api/overview`)).status, 401);
  assert.equal((await fetch(`${app.url}/dashboard/api/overview`, { headers: { authorization: 'Bearer chosen-token' } })).status, 200);

  const controller = new AbortController();
  const events = await fetch(`${app.url}/dashboard/api/events`, {
    headers: { 'x-admin-token': 'chosen-token' },
    signal: controller.signal
  });
  assert.equal(events.status, 200);
  controller.abort();
});

test('keys, balances and usage survive a restart on a file database', async (t) => {
  const upstream = (await import('node:http')).createServer(async (req, res) => {
    for await (const chunk of req) { /* drain */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000 } }));
  });
  const { listen, close } = await import('./helpers.js');
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opx-persist-'));
  const env = {
    DB_FILE: path.join(dir, 'proxy.db'),
    FREE_CREDIT_USD: '1',
    MARKUP_PCT: '20',
    OPENAI_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
    OPENAI_API_KEY: 'k',
    OPENAI_MODEL: 'm',
    PRICES: JSON.stringify({ m: { input: 1, output: 0 } })
  };

  const app1 = await startTestApp(env);
  const { data: created } = await createKey(app1, {});
  const call = await fetch(`${app1.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${created.key}` },
    body: '{}'
  });
  assert.equal(call.status, 200);
  await call.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await app1.close();

  const app2 = await startTestApp(env);
  t.after(() => app2.close());

  const account = await (await fetch(`${app2.url}/v1/account`, { headers: bearer(created.dashboard_token) })).json();
  assert.equal(account.account.balance_usd, 0.9988);
  assert.equal(account.current_key.usage.requests, 1);

  const usage = await (await fetch(`${app2.url}/v1/account/usage?days=30`, { headers: bearer(created.key) })).json();
  assert.equal(usage.breakdown.totals.requests, 1);
  assert.equal(app2.usage.recent(5)[0].billedCostUsd, 0.0012);
});
