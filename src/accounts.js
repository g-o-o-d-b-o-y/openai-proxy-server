// Accounts, credit lots, subscriptions, plans and redeem codes.
//
//   account 1─* api_keys      (a key's usage is billed to its account)
//   account 1─* credits       (free / subscription / purchase / admin lots)
//   account 1─* subscriptions (a plan activation grants an expiring credit lot)
//
// Spendable balance is the sum of unexpired lots with a positive remainder.
// Requests consume lots soonest-expiring-first so nothing expires unused.
// Monetary values are integer micro-USD in SQLite and USD numbers in memory.

import { generateId, generateRedeemCode } from './auth.js';
import { transaction } from './db.js';
import { microToUsd, usdToMicro } from './money.js';

const NOW = () => new Date().toISOString();
const addDays = (days, from = Date.now()) => new Date(from + days * 86400000).toISOString();

export const DEFAULT_PLANS = [
  {
    code: 'monthly', name: 'Monthly', priceUsd: 20, creditUsd: 20, durationDays: 30,
    active: true, sort: 10, description: '30 days of usage credit'
  },
  {
    code: 'semiannual', name: '6 months', priceUsd: 100, creditUsd: 100, durationDays: 180,
    active: true, sort: 20, description: '180 days of usage credit'
  }
];

const accountFromRow = (row) => row && {
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  status: row.status,
  createdIp: row.created_ip,
  contact: row.contact,
  note: row.note,
  markupPct: row.markup_pct == null ? null : Number(row.markup_pct),
  canCreateKeys: Boolean(row.can_create_keys),
  totalRequests: Number(row.total_requests),
  totalTokens: Number(row.total_tokens),
  totalCostUsd: microToUsd(row.total_cost_micro),
  totalBilledUsd: microToUsd(row.total_billed_micro)
};

const creditFromRow = (row) => row && {
  id: row.id,
  accountId: row.account_id,
  source: row.source,
  amountUsd: microToUsd(row.amount_micro),
  remainingUsd: microToUsd(row.remaining_micro),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  planCode: row.plan_code,
  note: row.note
};

const subscriptionFromRow = (row) => row && {
  id: row.id,
  accountId: row.account_id,
  planCode: row.plan_code,
  priceUsd: microToUsd(row.price_micro),
  creditUsd: microToUsd(row.credit_micro),
  startedAt: row.started_at,
  expiresAt: row.expires_at,
  status: row.status,
  createdAt: row.created_at
};

const planFromRow = (row) => row && {
  code: row.code,
  name: row.name,
  priceUsd: microToUsd(row.price_micro),
  creditUsd: microToUsd(row.credit_micro),
  durationDays: Number(row.duration_days),
  active: Boolean(row.active),
  sort: Number(row.sort),
  description: row.description
};

const codeFromRow = (row) => row && {
  code: row.code,
  planCode: row.plan_code,
  creditUsd: row.credit_micro == null ? null : microToUsd(row.credit_micro),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  redeemedAt: row.redeemed_at,
  redeemedBy: row.redeemed_by,
  note: row.note
};

export class AccountsStore {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
    this.#ensurePlans();
  }

  #ensurePlans() {
    if (this.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n > 0) return;
    const insert = this.db.prepare(`INSERT INTO plans (code, name, price_micro, credit_micro, duration_days, active, sort, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    transaction(this.db, () => {
      for (const plan of DEFAULT_PLANS) {
        insert.run(plan.code, plan.name, usdToMicro(plan.priceUsd), usdToMicro(plan.creditUsd), plan.durationDays,
          plan.active ? 1 : 0, plan.sort, plan.description);
      }
    });
  }

  // ---------------------------------------------------------------- accounts

  createAccount({ ip = '', contact = '', note = '', markupPct = null, canCreateKeys = false, withFreeCredit = true } = {}) {
    const id = generateId('acc');
    const at = NOW();
    this.db.prepare(`INSERT INTO accounts (id, created_at, updated_at, created_ip, contact, note, markup_pct, can_create_keys)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, at, at, ip || null, contact, note, markupPct, canCreateKeys ? 1 : 0);
    if (withFreeCredit) this.grantFreeCredit(id);
    return this.getAccount(id);
  }

  grantFreeCredit(accountId) {
    const amountUsd = Number(this.config.billing.freeCreditUsd) || 0;
    if (amountUsd <= 0) return null;
    const days = Number(this.config.billing.freeCreditExpiryDays) || 0;
    return this.addCredit(accountId, {
      amountUsd,
      source: 'free',
      expiresAt: days > 0 ? addDays(days) : null,
      note: 'Evaluation credit'
    });
  }

  getAccount(id) {
    return accountFromRow(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
  }

  updateAccount(id, patch = {}) {
    const columns = { status: 'status', contact: 'contact', note: 'note', createdIp: 'created_ip', markupPct: 'markup_pct', canCreateKeys: 'can_create_keys' };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] === undefined) continue;
      fields.push(`${column} = ?`);
      if (key === 'canCreateKeys') values.push(patch[key] ? 1 : 0);
      else values.push(patch[key] ?? null);
    }
    if (!fields.length) return this.getAccount(id);
    fields.push('updated_at = ?');
    values.push(NOW(), id);
    this.db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getAccount(id);
  }

  accountBalance(accountId, now = Date.now()) {
    const row = this.db.prepare(`SELECT
        COALESCE(SUM(remaining_micro), 0) AS available,
        COALESCE(SUM(CASE WHEN source = 'free' THEN remaining_micro ELSE 0 END), 0) AS free,
        COALESCE(SUM(CASE WHEN source = 'subscription' THEN remaining_micro ELSE 0 END), 0) AS subscription,
        COALESCE(SUM(CASE WHEN source NOT IN ('free', 'subscription') THEN remaining_micro ELSE 0 END), 0) AS purchased
      FROM credits
      WHERE account_id = ? AND remaining_micro > 0 AND (expires_at IS NULL OR expires_at > ?)`)
      .get(accountId, new Date(now).toISOString());
    return {
      availableUsd: microToUsd(row.available),
      freeUsd: microToUsd(row.free),
      subscriptionUsd: microToUsd(row.subscription),
      purchasedUsd: microToUsd(row.purchased)
    };
  }

  hasActiveSubscription(accountId, now = Date.now()) {
    const row = this.db.prepare(`SELECT 1 AS ok FROM subscriptions
      WHERE account_id = ? AND status = 'active' AND expires_at > ? LIMIT 1`)
      .get(accountId, new Date(now).toISOString());
    return Boolean(row);
  }

  listAccounts({ q = '', status = '', limit = 50, offset = 0, now = Date.now() } = {}) {
    const where = [];
    const params = [];
    if (q) {
      where.push('(a.id LIKE ? OR a.contact LIKE ? OR a.note LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (status) { where.push('a.status = ?'); params.push(status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM accounts a ${clause}`).get(...params).n;
    const rows = this.db.prepare(`SELECT a.*,
        (SELECT COALESCE(SUM(c.remaining_micro), 0) FROM credits c
          WHERE c.account_id = a.id AND c.remaining_micro > 0 AND (c.expires_at IS NULL OR c.expires_at > ?)) AS balance_micro,
        (SELECT COUNT(*) FROM api_keys k WHERE k.account_id = a.id AND k.status = 'active') AS active_keys
      FROM accounts a ${clause}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`)
      .all(new Date(now).toISOString(), ...params, Math.max(1, limit), Math.max(0, offset));
    return {
      total: Number(total),
      accounts: rows.map((row) => ({
        ...accountFromRow(row),
        balanceUsd: microToUsd(row.balance_micro),
        activeKeys: Number(row.active_keys)
      }))
    };
  }

  accountSummary(accountId, now = Date.now()) {
    const account = this.getAccount(accountId);
    if (!account) return null;
    return {
      ...account,
      balance: this.accountBalance(accountId, now),
      subscription: this.activeSubscription(accountId, now),
      subscriptions: this.listSubscriptions(accountId),
      credits: this.listCredits(accountId)
    };
  }

  outstandingCreditUsd(now = Date.now()) {
    const row = this.db.prepare(`SELECT COALESCE(SUM(remaining_micro), 0) AS micro FROM credits
      WHERE remaining_micro > 0 AND (expires_at IS NULL OR expires_at > ?)`).get(new Date(now).toISOString());
    return microToUsd(row.micro);
  }

  counts(now = Date.now()) {
    const keys = this.db.prepare('SELECT COUNT(*) AS n FROM api_keys').get().n;
    const activeKeys = this.db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE status = 'active'").get().n;
    const accounts = this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    const subscriptions = this.db.prepare(`SELECT COUNT(*) AS n FROM subscriptions
      WHERE status = 'active' AND expires_at > ?`).get(new Date(now).toISOString()).n;
    return {
      keys: Number(keys),
      activeKeys: Number(activeKeys),
      accounts: Number(accounts),
      subscriptions: Number(subscriptions)
    };
  }

  // ------------------------------------------------------------- credit lots

  addCredit(accountId, { amountUsd, source = 'admin', expiresAt = null, planCode = null, note = '' } = {}) {
    const amountMicro = usdToMicro(amountUsd);
    if (amountMicro <= 0) throw Object.assign(new Error('amount_usd must be greater than 0'), { statusCode: 400 });
    if (!['free', 'subscription', 'purchase', 'admin', 'refund'].includes(source)) {
      throw Object.assign(new Error(`Invalid credit source: ${source}`), { statusCode: 400 });
    }
    const id = generateId('cr');
    this.db.prepare(`INSERT INTO credits (id, account_id, source, amount_micro, remaining_micro, created_at, expires_at, plan_code, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, accountId, source, amountMicro, amountMicro, NOW(), expiresAt || null, planCode, note);
    return creditFromRow(this.db.prepare('SELECT * FROM credits WHERE id = ?').get(id));
  }

  listCredits(accountId) {
    return this.db.prepare('SELECT * FROM credits WHERE account_id = ? ORDER BY created_at DESC').all(accountId).map(creditFromRow);
  }

  // Consumes lots inside an existing transaction (called by the usage store).
  consumeCreditsInTx(accountId, amountMicro, now = Date.now()) {
    let remaining = Number(amountMicro) || 0;
    if (remaining <= 0) return 0;
    const lots = this.db.prepare(`SELECT id, remaining_micro FROM credits
      WHERE account_id = ? AND remaining_micro > 0 AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY (expires_at IS NULL) ASC, expires_at ASC, created_at ASC`)
      .all(accountId, new Date(now).toISOString());
    const update = this.db.prepare('UPDATE credits SET remaining_micro = ? WHERE id = ?');
    let consumed = 0;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(Number(lot.remaining_micro), remaining);
      update.run(Number(lot.remaining_micro) - take, lot.id);
      consumed += take;
      remaining -= take;
    }
    return consumed;
  }

  pruneExpiredCredits(now = Date.now()) {
    return this.db.prepare('DELETE FROM credits WHERE remaining_micro <= 0 OR (expires_at IS NOT NULL AND expires_at <= ?)')
      .run(new Date(now).toISOString()).changes;
  }

  // ------------------------------------------------------------ subscriptions

  activeSubscription(accountId, now = Date.now()) {
    const row = this.db.prepare(`SELECT * FROM subscriptions
      WHERE account_id = ? AND status = 'active' AND expires_at > ?
      ORDER BY expires_at DESC LIMIT 1`).get(accountId, new Date(now).toISOString());
    return subscriptionFromRow(row);
  }

  listSubscriptions(accountId) {
    return this.db.prepare('SELECT * FROM subscriptions WHERE account_id = ? ORDER BY created_at DESC')
      .all(accountId).map(subscriptionFromRow);
  }

  grantSubscription(accountId, planCode, options = {}) {
    return transaction(this.db, () => this.grantSubscriptionInTransaction(accountId, planCode, options));
  }

  // Caller must already hold a transaction (used when redeeming a plan code).
  grantSubscriptionInTransaction(accountId, planCode, { priceUsd = null, creditUsd = null, note = '' } = {}) {
    const plan = this.getPlan(planCode);
    if (!plan) throw Object.assign(new Error(`Unknown plan: ${planCode}`), { statusCode: 400 });
    const now = Date.now();
    const current = this.activeSubscription(accountId, now);
    // Renewing the same plan extends the current period instead of stacking.
    const startMs = current && current.planCode === plan.code ? Date.parse(current.expiresAt) : now;
    const expiresAt = addDays(plan.durationDays, startMs);
    const price = priceUsd == null ? plan.priceUsd : Number(priceUsd);
    const credit = creditUsd == null ? plan.creditUsd : Number(creditUsd);
    const id = generateId('sub');
    this.db.prepare(`INSERT INTO subscriptions (id, account_id, plan_code, price_micro, credit_micro, started_at, expires_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(id, accountId, plan.code, usdToMicro(price), usdToMicro(credit), new Date(now).toISOString(), expiresAt, new Date(now).toISOString());
    this.addCredit(accountId, {
      amountUsd: credit,
      source: 'subscription',
      expiresAt,
      planCode: plan.code,
      note: note || `${plan.name} subscription`
    });
    return subscriptionFromRow(this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id));
  }

  // ------------------------------------------------------------------- plans

  getPlan(code) {
    return planFromRow(this.db.prepare('SELECT * FROM plans WHERE code = ?').get(String(code || '').toLowerCase()));
  }

  listPlans({ activeOnly = false } = {}) {
    const sql = activeOnly
      ? 'SELECT * FROM plans WHERE active = 1 ORDER BY sort, price_micro'
      : 'SELECT * FROM plans ORDER BY sort, price_micro';
    return this.db.prepare(sql).all().map(planFromRow);
  }

  upsertPlan(input) {
    const code = String(input.code || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(code)) throw Object.assign(new Error('Plan code must be 2-32 chars: a-z, 0-9, _ or -'), { statusCode: 400 });
    const name = String(input.name || code).trim();
    const priceUsd = Number(input.price_usd);
    const creditUsd = Number(input.credit_usd);
    const durationDays = Number.parseInt(input.duration_days, 10);
    if (!Number.isFinite(priceUsd) || priceUsd < 0) throw Object.assign(new Error('price_usd must be >= 0'), { statusCode: 400 });
    if (!Number.isFinite(creditUsd) || creditUsd <= 0) throw Object.assign(new Error('credit_usd must be > 0'), { statusCode: 400 });
    if (!Number.isFinite(durationDays) || durationDays < 1) throw Object.assign(new Error('duration_days must be >= 1'), { statusCode: 400 });
    this.db.prepare(`INSERT INTO plans (code, name, price_micro, credit_micro, duration_days, active, sort, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (code) DO UPDATE SET name = excluded.name, price_micro = excluded.price_micro, credit_micro = excluded.credit_micro,
        duration_days = excluded.duration_days, active = excluded.active, sort = excluded.sort, description = excluded.description`)
      .run(code, name, usdToMicro(priceUsd), usdToMicro(creditUsd), durationDays,
        input.active === false ? 0 : 1, Number(input.sort) || 0, String(input.description || ''));
    return this.getPlan(code);
  }

  // ----------------------------------------------------------- redeem codes

  createRedeemCode({ planCode = null, creditUsd = null, expiresAt = null, note = '' } = {}) {
    if (planCode && !this.getPlan(planCode)) throw Object.assign(new Error(`Unknown plan: ${planCode}`), { statusCode: 400 });
    if (!planCode && !(Number(creditUsd) > 0)) throw Object.assign(new Error('Provide a plan or a positive credit amount'), { statusCode: 400 });
    const code = generateRedeemCode(this.config.keys.redeemPrefix);
    this.db.prepare('INSERT INTO redeem_codes (code, plan_code, credit_micro, created_at, expires_at, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(code, planCode || null, planCode ? null : usdToMicro(creditUsd), NOW(), expiresAt || null, note);
    return codeFromRow(this.db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code));
  }

  listRedeemCodes(limit = 100) {
    return this.db.prepare('SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, limit)).map(codeFromRow);
  }

  redeemCode(rawCode, accountId) {
    const normalized = String(rawCode || '').trim().toUpperCase();
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(normalized);
      if (!row) throw Object.assign(new Error('Invalid code'), { statusCode: 404, code: 'invalid_code' });
      if (row.redeemed_at) throw Object.assign(new Error('Code already redeemed'), { statusCode: 409, code: 'code_redeemed' });
      if (row.expires_at && row.expires_at <= NOW()) throw Object.assign(new Error('Code expired'), { statusCode: 410, code: 'code_expired' });
      this.db.prepare('UPDATE redeem_codes SET redeemed_at = ?, redeemed_by = ? WHERE code = ?').run(NOW(), accountId, row.code);
      if (row.plan_code) {
        const subscription = this.grantSubscriptionInTransaction(accountId, row.plan_code, { note: 'Redeemed code' });
        return { kind: 'subscription', subscription };
      }
      const credit = this.addCredit(accountId, {
        amountUsd: microToUsd(row.credit_micro),
        source: 'purchase',
        note: 'Redeemed code'
      });
      return { kind: 'credit', credit };
    });
  }
}
