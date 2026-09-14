import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { testEnv } from './helpers.js';

function setup(t, overrides = {}) {
  const app = createApp(testEnv({ FREE_CREDIT_USD: '1', MARKUP_PCT: '50', ...overrides }));
  t.after(() => app.db.close());
  return app;
}

const micro = (usd) => Math.round(usd * 1_000_000);

test('accounts start with the configured evaluation credit', (t) => {
  const app = setup(t);
  const account = app.accounts.createAccount({ ip: '203.0.113.5' });
  assert.equal(account.createdIp, '203.0.113.5');
  assert.equal(account.status, 'active');
  const balance = app.accounts.accountBalance(account.id);
  assert.equal(balance.availableUsd, 1);
  assert.equal(balance.freeUsd, 1);
  assert.equal(app.accounts.listCredits(account.id).length, 1);

  const none = app.accounts.createAccount({ withFreeCredit: false });
  assert.equal(app.accounts.accountBalance(none.id).availableUsd, 0);
});

test('credit lots are consumed soonest-expiring-first', (t) => {
  const app = setup(t, { FREE_CREDIT_USD: '0' });
  const account = app.accounts.createAccount({});
  app.accounts.addCredit(account.id, { amountUsd: 10, source: 'purchase' });
  app.accounts.addCredit(account.id, { amountUsd: 2, source: 'admin', expiresAt: new Date(Date.now() + 86400000).toISOString() });
  app.accounts.addCredit(account.id, { amountUsd: 5, source: 'subscription', expiresAt: new Date(Date.now() - 1000).toISOString() });

  assert.equal(app.accounts.accountBalance(account.id).availableUsd, 12, 'expired lot excluded');

  const consumed = app.accounts.consumeCreditsInTx(account.id, micro(3));
  assert.equal(consumed, micro(3));
  const lots = app.accounts.listCredits(account.id).sort((a, b) => a.amountUsd - b.amountUsd);
  assert.equal(lots.find((lot) => lot.amountUsd === 2).remainingUsd, 0, 'expiring lot consumed first');
  assert.equal(lots.find((lot) => lot.amountUsd === 10).remainingUsd, 9);

  assert.equal(app.accounts.consumeCreditsInTx(account.id, micro(100)), micro(9), 'consumption stops at available credit');
  assert.equal(app.accounts.accountBalance(account.id).availableUsd, 0);
  assert.equal(app.accounts.pruneExpiredCredits(), 3, 'zero and expired lots pruned');
});

test('subscriptions grant an expiring lot and renew by extending', (t) => {
  const app = setup(t, { FREE_CREDIT_USD: '0' });
  const account = app.accounts.createAccount({});

  const subscription = app.accounts.grantSubscription(account.id, 'monthly');
  assert.equal(subscription.planCode, 'monthly');
  assert.equal(subscription.priceUsd, 20);
  assert.equal(subscription.creditUsd, 20);
  assert.equal(app.accounts.hasActiveSubscription(account.id), true);
  const balance = app.accounts.accountBalance(account.id);
  assert.equal(balance.subscriptionUsd, 20);

  const renewed = app.accounts.grantSubscription(account.id, 'monthly');
  assert.ok(Date.parse(renewed.expiresAt) > Date.parse(subscription.expiresAt), 'renewal extends the period');
  assert.equal(app.accounts.accountBalance(account.id).subscriptionUsd, 40);
  assert.throws(() => app.accounts.grantSubscription(account.id, 'nope'), /Unknown plan/);
});

test('redeem codes are single use and grant credit or a plan', (t) => {
  const app = setup(t, { FREE_CREDIT_USD: '0' });
  const account = app.accounts.createAccount({});

  const creditCode = app.accounts.createRedeemCode({ creditUsd: 5 });
  assert.match(creditCode.code, /^OPX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.deepEqual(app.accounts.redeemCode(creditCode.code.toLowerCase(), account.id), {
    kind: 'credit',
    credit: app.accounts.listCredits(account.id)[0]
  });
  assert.equal(app.accounts.accountBalance(account.id).availableUsd, 5);
  assert.throws(() => app.accounts.redeemCode(creditCode.code, account.id), /already redeemed/);
  assert.throws(() => app.accounts.redeemCode('OPX-AAAA-BBBB-CCCC', account.id), /Invalid code/);

  const planCode = app.accounts.createRedeemCode({ planCode: 'semiannual' });
  const redeemed = app.accounts.redeemCode(planCode.code, account.id);
  assert.equal(redeemed.kind, 'subscription');
  assert.equal(redeemed.subscription.planCode, 'semiannual');
  assert.equal(app.accounts.hasActiveSubscription(account.id), true);
  assert.ok(app.accounts.accountBalance(account.id).availableUsd > 100);

  const expired = app.accounts.createRedeemCode({ creditUsd: 1, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.throws(() => app.accounts.redeemCode(expired.code, account.id), /expired/);
});

test('plans validate their shape and can be updated', (t) => {
  const app = setup(t);
  const plans = app.accounts.listPlans();
  assert.deepEqual(plans.map((plan) => plan.code), ['monthly', 'semiannual']);
  assert.throws(() => app.accounts.upsertPlan({ code: 'x', name: 'X', price_usd: 1, credit_usd: 1, duration_days: 1 }), /2-32 chars/);
  assert.throws(() => app.accounts.upsertPlan({ code: 'weekly', name: 'W', price_usd: 5, credit_usd: 0, duration_days: 7 }), /credit_usd/);
  const plan = app.accounts.upsertPlan({ code: 'weekly', name: 'Weekly', price_usd: 5, credit_usd: 6, duration_days: 7 });
  assert.equal(plan.creditUsd, 6);
  assert.equal(app.accounts.listPlans({ activeOnly: true }).length, 3);
  app.accounts.upsertPlan({ code: 'weekly', name: 'Weekly', price_usd: 5, credit_usd: 6, duration_days: 7, active: false });
  assert.equal(app.accounts.listPlans({ activeOnly: true }).length, 2);
});

test('account summaries expose totals, counts and outstanding credit', (t) => {
  const app = setup(t, { FREE_CREDIT_USD: '2' });
  const account = app.accounts.createAccount({});
  app.accounts.updateAccount(account.id, { status: 'suspended', contact: 'ops@example.com', canCreateKeys: true });
  const summary = app.accounts.accountSummary(account.id);
  assert.equal(summary.status, 'suspended');
  assert.equal(summary.canCreateKeys, true);
  assert.equal(summary.contact, 'ops@example.com');
  assert.equal(app.accounts.outstandingCreditUsd(), 2);
  const counts = app.accounts.counts();
  assert.equal(counts.accounts, 1);
  assert.equal(counts.keys, 0);
  assert.equal(app.accounts.listAccounts({ q: 'ops@' }).total, 1);
  assert.equal(app.accounts.listAccounts({ status: 'active' }).total, 0);
});
