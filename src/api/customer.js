// Customer API (mounted under /v1).
//
//   GET    /v1/plans                 public plan list
//   POST   /v1/keys                  create a key (public or account-scoped)
//   GET    /v1/keys                  list the account's keys with 30-day usage
//   PATCH  /v1/keys/:id              rename or block a key
//   POST   /v1/keys/:id/rotate       block a key and create a replacement
//   GET    /v1/account               balance, credits, subscription
//   GET    /v1/account/usage         daily series + breakdown
//   GET    /v1/account/requests      recent requests
//   POST   /v1/account/redeem        redeem a prepaid code
//
// Identities are an API key (sk-...) or a dashboard token (dash_...); the
// create endpoint additionally accepts anonymous callers.

import { baseUrl, jsonError, readJsonBody, remoteIp, sendJson } from '../http.js';
import { microToUsd } from '../money.js';
import { keyUsageWindows } from '../usage.js';
import { requestToken } from '../auth.js';

const keyJson = (key, usage = null) => ({
  id: key.id,
  key_prefix: key.keyPrefix,
  name: key.name,
  status: key.status,
  created_at: key.createdAt,
  last_used_at: key.lastUsedAt,
  expires_at: key.expiresAt,
  markup_pct: key.markupPct,
  limits: key.limits,
  usage: usage && {
    window_hours: 720,
    requests: usage.requests,
    tokens: usage.tokens,
    upstream_cost_usd: microToUsd(usage.upstreamMicro),
    billed_cost_usd: microToUsd(usage.billedMicro)
  }
});

function accountJson(accounts, account) {
  const summary = accounts.accountSummary(account.id);
  return {
    id: summary.id,
    status: summary.status,
    created_at: summary.createdAt,
    balance_usd: summary.balance.availableUsd,
    free_credit_usd: summary.balance.freeUsd,
    subscription_credit_usd: summary.balance.subscriptionUsd,
    purchased_credit_usd: summary.balance.purchasedUsd,
    subscription: summary.subscription && {
      plan_code: summary.subscription.planCode,
      started_at: summary.subscription.startedAt,
      expires_at: summary.subscription.expiresAt
    },
    markup_pct: summary.markupPct
  };
}

const retryHeaders = (result) => ({
  ...(result.retryAfter ? { 'retry-after': String(Math.ceil(result.retryAfter)) } : {})
});

const MAX_BODY = 256 * 1024;

export function createCustomerApi({ config, db, keys, accounts, usage }) {
  const resolveIdentity = (req) => {
    const token = requestToken(req);
    if (!token) return { kind: 'anonymous' };
    const found = keys.authenticate(token);
    return found ? { ...found } : { kind: 'invalid' };
  };

  const requestUsageWindows = (accountKeys) => {
    const since = Math.floor(Date.now() / 1000) - 720 * 3600;
    return keyUsageWindows(db, accountKeys.map((key) => key.id), since);
  };

  return async function handleCustomerApi(req, res, url) {
    if (!url.pathname.startsWith('/v1/')) return false;
    const route = (url.pathname.replace(/\/+$/, '') || '/v1').slice(4).replace(/^\//, '');
    const method = req.method || 'GET';

    const isRoute = route === 'plans' || route === 'keys' || route.startsWith('keys/')
      || route === 'account' || route.startsWith('account/');
    if (!isRoute) return false;

    if (route === 'plans' && method === 'GET') {
      sendJson(res, 200, {
        plans: accounts.listPlans({ activeOnly: true }).map((plan) => ({
          code: plan.code,
          name: plan.name,
          price_usd: plan.priceUsd,
          credit_usd: plan.creditUsd,
          duration_days: plan.durationDays,
          description: plan.description
        }))
      }, config);
      return true;
    }

    const identity = resolveIdentity(req);

    if (route === 'keys' && method === 'POST') {
      if (identity.kind === 'invalid') {
        jsonError(res, 401, 'invalid_api_key', 'Invalid API key', config);
        return true;
      }
      let body;
      try { body = await readJsonBody(req, Math.min(config.server.maxJsonBodyBytes, MAX_BODY)); }
      catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }

      const account = identity.account || null;
      const parentKeyId = account ? identity.key.id : null;
      const maxChildren = account && identity.kind === 'api_key' ? identity.key.limits.max_children ?? null : null;
      const { allowed, created } = keys.createKeyWithChecks({
        account,
        ip: remoteIp(req, config),
        parentKeyId,
        maxChildren,
        name: body.name,
        contact: body.contact
      });
      if (!allowed.allowed) {
        jsonError(res, allowed.status || 429, allowed.code, allowed.message, config, retryHeaders(allowed));
        return true;
      }
      const base = baseUrl(req, config);
      sendJson(res, 201, {
        id: created.key.id,
        key: created.secret,
        key_prefix: created.key.keyPrefix,
        dashboard_token: created.dashboardSecret,
        dashboard_url: `${base}/key/#token=${encodeURIComponent(created.dashboardSecret)}`,
        api_base: `${base}/v1`,
        created_at: created.key.createdAt,
        limits: created.key.limits,
        account: accountJson(accounts, created.account),
        notice: 'Store the key and dashboard token now; they are shown only once.'
      }, config);
      return true;
    }

    if (route === 'account/redeem' && method === 'POST') {
      if (!identity.account) {
        jsonError(res, 401, 'missing_api_key', 'A valid API key or dashboard token is required', config);
        return true;
      }
      let body;
      try { body = await readJsonBody(req, 64 * 1024); }
      catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
      try {
        const result = accounts.redeemCode(body.code, identity.account.id);
        sendJson(res, 200, { result, account: accountJson(accounts, identity.account) }, config);
      } catch (error) {
        jsonError(res, error.statusCode || 400, error.code || 'redeem_failed', error.message, config);
      }
      return true;
    }

    if (!identity.account) {
      jsonError(res, 401, identity.kind === 'invalid' ? 'invalid_api_key' : 'missing_api_key',
        identity.kind === 'invalid' ? 'Invalid API key' : 'Send Authorization: Bearer <api key> or use your dashboard token', config);
      return true;
    }

    const account = identity.account;
    const accountKeys = keys.getAccountKeys(account.id);
    const usageWindows = requestUsageWindows(accountKeys);
    const current = accountKeys.find((key) => key.id === identity.key?.id) || null;

    if (route === 'account' && method === 'GET') {
      const usageValues = current ? usageWindows.get(current.id) : null;
      const limitsUsage = current ? {
        spend_usd: current.limits.spend ? microToUsd(keys.keyWindow(current.id, current.limits.spend.window_hours).billedMicro) : null,
        tokens: current.limits.tokens ? keys.keyWindow(current.id, current.limits.tokens.window_hours).tokens : null,
        requests: current.limits.requests ? keys.keyWindow(current.id, current.limits.requests.window_hours).requests : null
      } : null;
      sendJson(res, 200, {
        account: accountJson(accounts, account),
        credits: accounts.listCredits(account.id)
          .filter((credit) => credit.remainingUsd > 0)
          .map((credit) => ({
            source: credit.source,
            amount_usd: credit.amountUsd,
            remaining_usd: credit.remainingUsd,
            expires_at: credit.expiresAt
          })),
        current_key: current && keyJson(current, usageValues),
        limits_usage: limitsUsage,
        key_count: accountKeys.filter((key) => key.status !== 'revoked').length
      }, config);
      return true;
    }

    if (route === 'keys' && method === 'GET') {
      sendJson(res, 200, {
        account: accountJson(accounts, account),
        keys: accountKeys.map((key) => keyJson(key, usageWindows.get(key.id)))
      }, config);
      return true;
    }

    const keyRoute = route.match(/^keys\/([A-Za-z0-9_-]+)(?:\/(rotate))?$/);
    if (keyRoute) {
      const target = accountKeys.find((key) => key.id === keyRoute[1]);
      if (!target) {
        jsonError(res, 404, 'key_not_found', 'No such key on this account', config);
        return true;
      }

      if (keyRoute[2] === 'rotate' && method === 'POST') {
        const { allowed, created } = keys.rotateKey({ target, account, ip: remoteIp(req, config) });
        if (!allowed.allowed) {
          jsonError(res, allowed.status || 429, allowed.code, allowed.message, config, retryHeaders(allowed));
          return true;
        }
        const base = baseUrl(req, config);
        sendJson(res, 201, {
          id: created.key.id,
          key: created.secret,
          key_prefix: created.key.keyPrefix,
          dashboard_token: created.dashboardSecret,
          dashboard_url: `${base}/key/#token=${encodeURIComponent(created.dashboardSecret)}`,
          api_base: `${base}/v1`,
          blocked_key_id: target.id,
          created_at: created.key.createdAt,
          limits: created.key.limits,
          notice: 'Store the key and dashboard token now; they are shown only once.'
        }, config);
        return true;
      }

      if (method === 'PATCH') {
        let body;
        try { body = await readJsonBody(req, 64 * 1024); }
        catch (error) { jsonError(res, error.statusCode || 400, 'invalid_request', error.message, config); return true; }
        const patch = {};
        if (body.name !== undefined) patch.name = String(body.name);
        if (body.status !== undefined) {
          if (body.status !== 'blocked') {
            jsonError(res, 400, 'invalid_status', 'Keys can only be blocked from the customer API', config);
            return true;
          }
          patch.status = 'blocked';
        }
        sendJson(res, 200, { key: keyJson(keys.updateKey(target.id, patch)) }, config);
        return true;
      }
    }

    if (route === 'account/usage' && method === 'GET') {
      const requestedKey = url.searchParams.get('key');
      if (requestedKey && !accountKeys.some((key) => key.id === requestedKey)) {
        jsonError(res, 404, 'key_not_found', 'No such key on this account', config);
        return true;
      }
      const days = Math.min(365, Math.max(1, Number.parseInt(url.searchParams.get('days') || '30', 10) || 30));
      const scope = requestedKey ? { keyId: requestedKey } : { accountId: account.id };
      sendJson(res, 200, {
        scope: requestedKey ? 'key' : 'account',
        key_id: requestedKey || null,
        days,
        account: accountJson(accounts, account),
        series: usage.usageSeries({ ...scope, days }),
        breakdown: usage.usageBreakdown({ ...scope, days })
      }, config);
      return true;
    }

    if (route === 'account/requests' && method === 'GET') {
      const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const requestedKey = url.searchParams.get('key');
      if (requestedKey && !accountKeys.some((key) => key.id === requestedKey)) {
        jsonError(res, 404, 'key_not_found', 'No such key on this account', config);
        return true;
      }
      sendJson(res, 200, usage.queryRequests({
        limit,
        offset,
        filters: requestedKey ? { key: requestedKey } : { account: account.id }
      }), config);
      return true;
    }

    jsonError(res, method === 'GET' ? 404 : 405, method === 'GET' ? 'not_found' : 'method_not_allowed',
      method === 'GET' ? 'Unknown API endpoint' : `${method} is not allowed here`, config);
    return true;
  };
}
