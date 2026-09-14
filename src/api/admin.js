// Admin API, served under the configured dashboard path.
//
//   GET    /api/overview
//   GET    /api/keys                    list/search keys
//   GET    /api/keys/:id                key detail with usage
//   PATCH  /api/keys/:id                rename, re-limit, re-price, block
//   POST   /api/keys/:id/rotate         replace a key
//   POST   /api/keys/:id/revoke         permanently revoke a key
//   GET    /api/accounts                list/search accounts
//   GET    /api/accounts/:id            account detail
//   PATCH  /api/accounts/:id            contact, note, status, markup, permissions
//   POST   /api/accounts/:id/credits    add credit
//   POST   /api/accounts/:id/subscriptions  grant a plan
//   POST   /api/accounts/:id/keys       create a key for the account
//   GET    /api/plans                   list plans
//   POST   /api/plans                   create/update a plan
//   GET    /api/codes                   list redeem codes
//   POST   /api/codes                   create a redeem code
//   GET    /api/requests                request logs (filters + pagination)
//   GET    /api/requests/groups         grouped request stats
//   GET    /api/settings                settings registry with values
//   PATCH  /api/settings                update settings
//   GET    /api/events                  Server-Sent Events
//
// Requests carry the admin token in x-admin-token, Authorization: Bearer or
// ?token=. With no token configured the dashboard is open (development mode).

import { hashToken, requestToken, safeEqual } from '../auth.js';
import { baseUrl, jsonError, readJsonBody, remoteIp, sendJson } from '../http.js';
import { microToUsd } from '../money.js';
import { GROUP_FIELDS } from '../usage.js';

const MAX_BODY = 256 * 1024;

const keyJson = (key, usage = null) => ({
  id: key.id,
  key_prefix: key.keyPrefix,
  name: key.name,
  account_id: key.accountId,
  parent_key_id: key.parentKeyId,
  status: key.status,
  created_at: key.createdAt,
  created_ip: key.createdIp,
  last_used_at: key.lastUsedAt,
  expires_at: key.expiresAt,
  markup_pct: key.markupPct,
  limits: key.limits,
  total_requests: key.totalRequests,
  total_tokens: key.totalTokens,
  upstream_cost_usd: key.totalCostUsd,
  billed_cost_usd: key.totalBilledUsd,
  usage_30d: usage && {
    requests: usage.requests,
    tokens: usage.tokens,
    upstream_cost_usd: microToUsd(usage.upstreamMicro),
    billed_cost_usd: microToUsd(usage.billedMicro)
  }
});

const accountJson = (accounts, account) => {
  const summary = accounts.accountSummary(account.id);
  return {
    id: summary.id,
    status: summary.status,
    created_at: summary.createdAt,
    created_ip: summary.createdIp,
    contact: summary.contact,
    note: summary.note,
    can_create_keys: summary.canCreateKeys,
    markup_pct: summary.markupPct,
    balance_usd: summary.balance.availableUsd,
    free_credit_usd: summary.balance.freeUsd,
    subscription_credit_usd: summary.balance.subscriptionUsd,
    purchased_credit_usd: summary.balance.purchasedUsd,
    total_requests: summary.totalRequests,
    total_tokens: summary.totalTokens,
    upstream_cost_usd: summary.totalCostUsd,
    billed_cost_usd: summary.totalBilledUsd,
    subscription: summary.subscription && {
      plan_code: summary.subscription.planCode,
      started_at: summary.subscription.startedAt,
      expires_at: summary.subscription.expiresAt,
      price_usd: summary.subscription.priceUsd,
      credit_usd: summary.subscription.creditUsd
    }
  };
};

export function adminAuthorized(req, settings) {
  const expected = settings.get('dashboard.admin_token_hash');
  if (!expected) return true;
  const token = req.headers['x-admin-token'] || requestToken(req, { query: true });
  return Boolean(token) && safeEqual(hashToken(token), expected);
}

export function createAdminApi({ config, keys, accounts, usage, settings }) {
  const authorized = (req) => adminAuthorized(req, settings);
  const parseFilters = (url) => {
    const filters = {};
    for (const name of ['q', 'kind', 'ip', 'model', 'method', 'status', 'path', 'hour', 'key', 'account']) {
      const value = url.searchParams.get(name);
      if (value) filters[name] = value.trim();
    }
    return filters;
  };

  const pagination = (url, defaultLimit = 50) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '', 10) || defaultLimit));
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '', 10) || 0);
    return { limit, offset };
  };

  return async function handleAdminApi(req, res, url, route) {
    if (!authorized(req)) {
      jsonError(res, 401, 'dashboard_unauthorized', 'Admin token required or invalid', config);
      return true;
    }
    const method = req.method || 'GET';

    if (route === 'overview' && method === 'GET') {
      sendJson(res, 200, {
        snapshot: usage.snapshot(),
        counts: accounts.counts(),
        outstanding_usd: accounts.outstandingCreditUsd(),
        revenue_30d: usage.revenue({ days: 30 }),
        top_keys: usage.topKeys({ days: 30, limit: 5 })
      }, config);
      return true;
    }

    // -------------------------------------------------------------------- keys
    if (route === 'keys' && method === 'GET') {
      const { limit, offset } = pagination(url);
      const result = keys.listKeys({
        q: (url.searchParams.get('q') || '').trim(),
        status: (url.searchParams.get('status') || '').trim(),
        accountId: (url.searchParams.get('account') || '').trim(),
        limit,
        offset
      });
      sendJson(res, 200, {
        total: result.total,
        keys: result.keys.map((key) => ({
          ...keyJson(key, null),
          usage_30d: key.usage30d ? {
            requests: key.usage30d.requests,
            tokens: key.usage30d.tokens,
            upstream_cost_usd: key.usage30d.upstreamUsd,
            billed_cost_usd: key.usage30d.billedUsd
          } : { requests: 0, tokens: 0, upstream_cost_usd: 0, billed_cost_usd: 0 },
          account_contact: key.accountContact,
          account_status: key.accountStatus
        }))
      }, config);
      return true;
    }

    const keyRoute = route.match(/^keys\/([A-Za-z0-9_-]+)(?:\/(rotate|revoke))?$/);
    if (keyRoute) {
      const key = keys.getKey(keyRoute[1]);
      if (!key) { jsonError(res, 404, 'key_not_found', 'No such key', config); return true; }
      const action = keyRoute[2];

      if (action === 'rotate' && method === 'POST') {
        const { created } = keys.rotateKey({
          target: key,
          account: accounts.getAccount(key.accountId),
          ip: key.createdIp,
          bypass: true
        });
        const base = baseUrl(req, config);
        sendJson(res, 201, {
          id: created.key.id,
          key: created.secret,
          key_prefix: created.key.keyPrefix,
          dashboard_url: `${base}/key/#token=${encodeURIComponent(created.dashboardSecret)}`,
          blocked_key_id: key.id,
          limits: created.key.limits
        }, config);
        return true;
      }

      if (action === 'revoke' && method === 'POST') {
        sendJson(res, 200, { key: keyJson(keys.revokeKey(key.id)) }, config);
        return true;
      }

      if (method === 'GET') {
        sendJson(res, 200, {
          key: keyJson(key, keys.keyWindow(key.id, 720)),
          account: accountJson(accounts, accounts.getAccount(key.accountId)),
          breakdown: usage.usageBreakdown({ keyId: key.id, days: 30 }),
          requests: usage.queryRequests({ limit: 20, filters: { key: key.id } }).requests
        }, config);
        return true;
      }

      if (method === 'PATCH') {
        let body;
        try { body = await readJsonBody(req, MAX_BODY); }
        catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
        const patch = {};
        if (body.name !== undefined) patch.name = body.name;
        if (body.status !== undefined) patch.status = body.status;
        if (body.limits !== undefined) patch.limits = body.limits;
        if (body.markup_pct !== undefined) patch.markupPct = body.markup_pct;
        if (body.expires_at !== undefined) patch.expiresAt = body.expires_at;
        try {
          sendJson(res, 200, { key: keyJson(keys.updateKey(key.id, patch)) }, config);
        } catch (error) {
          jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config);
        }
        return true;
      }
    }

    // ---------------------------------------------------------------- accounts
    if (route === 'accounts' && method === 'GET') {
      const { limit, offset } = pagination(url);
      const result = accounts.listAccounts({
        q: (url.searchParams.get('q') || '').trim(),
        status: (url.searchParams.get('status') || '').trim(),
        limit,
        offset
      });
      sendJson(res, 200, {
        total: result.total,
        accounts: result.accounts.map((account) => ({
          ...accountJson(accounts, account),
          active_keys: account.activeKeys
        }))
      }, config);
      return true;
    }

    const accountRoute = route.match(/^accounts\/([A-Za-z0-9_-]+)(?:\/(credits|subscriptions|keys))?$/);
    if (accountRoute) {
      const account = accounts.getAccount(accountRoute[1]);
      if (!account) { jsonError(res, 404, 'account_not_found', 'No such account', config); return true; }
      const action = accountRoute[2];

      if (!action && method === 'GET') {
        sendJson(res, 200, {
          account: accountJson(accounts, account),
          keys: keys.getAccountKeys(account.id).map((key) => keyJson(key)),
          credits: accounts.listCredits(account.id),
          subscriptions: accounts.listSubscriptions(account.id),
          breakdown: usage.usageBreakdown({ accountId: account.id, days: 30 }),
          series: usage.usageSeries({ accountId: account.id, days: 30 })
        }, config);
        return true;
      }

      if (!action && method === 'PATCH') {
        let body;
        try { body = await readJsonBody(req, MAX_BODY); }
        catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
        const patch = {};
        if (body.status !== undefined) patch.status = body.status;
        if (body.contact !== undefined) patch.contact = body.contact;
        if (body.note !== undefined) patch.note = body.note;
        if (body.markup_pct !== undefined) patch.markupPct = body.markup_pct;
        if (body.can_create_keys !== undefined) patch.canCreateKeys = body.can_create_keys;
        sendJson(res, 200, { account: accountJson(accounts, accounts.updateAccount(account.id, patch)) }, config);
        return true;
      }

      if (action === 'credits' && method === 'POST') {
        let body;
        try { body = await readJsonBody(req, MAX_BODY); }
        catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
        try {
          accounts.addCredit(account.id, {
            amountUsd: body.amount_usd,
            source: body.source || 'admin',
            expiresAt: body.expires_at || null,
            note: body.note || ''
          });
          sendJson(res, 200, { account: accountJson(accounts, account) }, config);
        } catch (error) {
          jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config);
        }
        return true;
      }

      if (action === 'subscriptions' && method === 'POST') {
        let body;
        try { body = await readJsonBody(req, MAX_BODY); }
        catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
        try {
          const subscription = accounts.grantSubscription(account.id, String(body.plan_code || ''));
          sendJson(res, 200, { subscription, account: accountJson(accounts, account) }, config);
        } catch (error) {
          jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config);
        }
        return true;
      }

      if (action === 'keys' && method === 'POST') {
        let body = {};
        try { body = await readJsonBody(req, MAX_BODY); }
        catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
        const created = keys.createKey({
          account,
          ip: remoteIp(req, config),
          name: body.name || 'admin',
          bypassIpLimit: true,
          limits: body.limits || null,
          markupPct: body.markup_pct ?? null
        });
        const base = baseUrl(req, config);
        sendJson(res, 201, {
          id: created.key.id,
          key: created.secret,
          key_prefix: created.key.keyPrefix,
          dashboard_url: `${base}/key/#token=${encodeURIComponent(created.dashboardSecret)}`,
          limits: created.key.limits
        }, config);
        return true;
      }
    }

    // ------------------------------------------------------------------- plans
    if (route === 'plans' && method === 'GET') {
      sendJson(res, 200, { plans: accounts.listPlans() }, config);
      return true;
    }
    if (route === 'plans' && method === 'POST') {
      let body;
      try { body = await readJsonBody(req, MAX_BODY); }
      catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
      try { sendJson(res, 200, { plan: accounts.upsertPlan(body) }, config); }
      catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); }
      return true;
    }

    // ------------------------------------------------------------------- codes
    if (route === 'codes' && method === 'GET') {
      sendJson(res, 200, { codes: accounts.listRedeemCodes(200) }, config);
      return true;
    }
    if (route === 'codes' && method === 'POST') {
      let body;
      try { body = await readJsonBody(req, MAX_BODY); }
      catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
      try {
        sendJson(res, 200, {
          code: accounts.createRedeemCode({
            planCode: body.plan_code || null,
            creditUsd: body.plan_code ? null : Number(body.credit_usd),
            expiresAt: body.expires_at || null,
            note: body.note || ''
          })
        }, config);
      } catch (error) {
        jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config);
      }
      return true;
    }

    // ---------------------------------------------------------------- requests
    if (route === 'requests' && method === 'GET') {
      const { limit, offset } = pagination(url);
      sendJson(res, 200, usage.queryRequests({ limit, offset, filters: parseFilters(url) }), config);
      return true;
    }
    if (route === 'requests/groups' && method === 'GET') {
      const field = String(url.searchParams.get('field') || 'model').toLowerCase();
      if (!GROUP_FIELDS.includes(field)) {
        jsonError(res, 400, 'invalid_group_field', `field must be one of: ${GROUP_FIELDS.join(', ')}`, config);
        return true;
      }
      const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '', 10) || 12));
      sendJson(res, 200, usage.groupRequests({ field, limit, filters: parseFilters(url) }), config);
      return true;
    }

    // ---------------------------------------------------------------- settings
    if (route === 'settings' && method === 'GET') {
      sendJson(res, 200, { settings: settings.adminView() }, config);
      return true;
    }
    if (route === 'settings' && method === 'PATCH') {
      let body;
      try { body = await readJsonBody(req, MAX_BODY); }
      catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
      const updates = {};
      for (const [key, value] of Object.entries(body || {})) {
        if (key === 'dashboard.admin_token_hash') {
          if (!value) continue;
          updates[key] = hashToken(value);
          continue;
        }
        updates[key] = value;
      }
      try {
        const updated = settings.setMany(updates, config);
        sendJson(res, 200, { updated }, config);
      } catch (error) {
        jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config);
      }
      return true;
    }

    jsonError(res, 404, 'not_found', 'Unknown admin endpoint', config);
    return true;
  };
}
