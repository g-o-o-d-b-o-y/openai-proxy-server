# openai-proxy-server

An OpenAI-compatible reverse proxy for **LLM + TTS + STT** that works as a small **API reseller platform**: visitors generate their own keys, every request is metered against an account balance with a configurable markup, and the administrator manages keys, limits, credits and subscriptions from a black, responsive dashboard.

```text
API:        http://localhost:56787/v1
Landing:    http://localhost:56787/           self-service keys and plans
Key board:  http://localhost:56787/key/       per-key usage dashboard
Admin:      http://localhost:56787/dashboard/    keys, accounts, billing, settings
```

## Highlights

- **Self-service keys** — one click or `POST /v1/keys`; keys are shown once and stored as HMAC hashes.
- **Reseller billing** — customers pay `upstream_cost × (1 + markup%)`. Provider-reported costs win; otherwise a configurable price table estimates tokens and audio seconds. Money is stored as integer micro-USD, so balances never drift.
- **Accounts with shared balances** — every key belongs to an account. Credit lots (free, subscription, purchase, admin) are consumed soonest-expiring-first.
- **Subscriptions** — seed plans (`$20/30d`, `$100/180d` or your own) grant expiring credit and remove the per-IP key limit; all keys on the account share the balance.
- **Block & rotate** — block a key and mint a replacement with the same account and limits; dashboard access survives blocking.
- **Per-key limits** — spend, tokens, requests, requests/minute, model allowlist and expiry.
- **Abuse protection** — self-service keys default to **2 per IP per month** plus a cooldown and a global hourly cap; the check and insert are one transaction, so parallel requests cannot overshoot.
- **SQLite everything** — settings, keys, accounts, credits, usage and logs live in one strict-schema database. Environments variable only seed the first start.
- **Zero runtime dependencies** — Node's built-in `node:sqlite`.

## Quick start

```bash
npm install
cp .env.example .env    # add your upstream keys
npm start
```

Minimal `.env`:

```dotenv
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-...
OPENAI_MODEL=google/gemma-4-26b-a4b-it
ADMIN_TOKEN=change-me
```

Or with npx:

```bash
npx openai-proxy-server
```

The server binds `0.0.0.0` by default and prints the local/LAN URLs. Set `HOST=127.0.0.1` to restrict it to this machine.

## How it works

### Accounts and credit

Each `POST /v1/keys` creates an **account** with an evaluation credit (`FREE_CREDIT_USD`, default `$0.25`) and one API key. Credits are a ledger of lots:

| Source | Created by | Expiry |
|---|---|---|
| `free` | first key of a new account | `FREE_CREDIT_EXPIRY_DAYS` (0 = never) |
| `subscription` | granting/redeeming a plan | plan period end |
| `purchase` | credit code or admin top-up | optional |
| `admin` / `refund` | administrator | optional |

Spendable balance = unexpired lots with a positive remainder. Requests consume the soonest-expiring lot first. Balance checks are soft: an in-flight request may overshoot a near-empty balance; the next request gets `402 insufficient_balance`.

### Markup

```text
upstream_cost = provider usage.cost  OR  price-table estimate
billed        = upstream_cost × (1 + markup_pct / 100)
```

Markup resolution: **key → account → global**. Price table format (USD per 1M tokens, USD per audio second):

```json
{
  "google/gemma-4-26b-a4b-it": { "input": 0.06, "output": 0.12 },
  "qwen/qwen-audio-3.0-tts-flash": { "audio_second": 0.001 },
  "default": { "input": 0.5, "output": 1.5 }
}
```

TTS providers that stream audio without a usage object get their duration estimated from the stream (`audio/pcm`, `audio/wav`), so audio can be priced too.

### Subscriptions and keys

Plans are rows in the database and editable in the admin UI. A plan grants a credit lot expiring at the end of its period and marks the account as subscribed:

- subscribed accounts **bypass the per-IP key limit**;
- additional keys are created through `POST /v1/keys` with an existing key/dashboard token;
- blocking a key and rotating it keeps the account, balance and limits.

Payments are intentionally not built in. Issue **redeem codes** (plan or credit) in the admin UI and let users redeem them at `/key/` or `POST /v1/account/redeem`. A payment provider only needs to call the same grant path.

### Abuse limits

Self-service keys default to **2 per IP per calendar month**, a 30-second cooldown and a global 100/hour cap. This is deliberately conservative: it stops one script from mining unlimited evaluation credit while leaving room for a normal user with two devices. Shared NAT and VPN addresses can collide — raise `keys.ip_limit_per_month`, add per-IP overrides (`{"203.0.113.7": 10}`), or grant a subscription, which exempts the account. Behind Cloudflare/nginx enable `server.trust_proxy` so limits see real client IPs.

## Proxy usage

Any OpenAI-compatible client works:

```bash
curl http://localhost:56787/v1/chat/completions \
  -H "Authorization: Bearer sk-opx-..." \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

Routing: `/v1/audio/speech` → TTS upstream, `/v1/audio/transcriptions|translations` → STT upstream, everything else under `/v1/*` → LLM upstream. The local `/v1` prefix is replaced by the path in the configured base URL; query strings are preserved. WebSocket upgrades are tunneled (not metered).

Responses carry:

```text
X-Request-Id: 5e04d57e
X-Key-Prefix: sk-opx-EHVSXRI
X-Account-Balance-USD: 0.249907
X-Model-Fallback: backup-model        (when a fallback served the request)
```

Failure codes: `401 invalid_api_key|key_blocked|key_revoked|key_expired|missing_api_key`, `402 insufficient_balance`, `403 account_suspended|model_not_allowed`, `429 spend_limit_exceeded|token_limit_exceeded|request_limit_exceeded|rate_limit_exceeded|ip_key_limit|creation_cooldown|creation_rate_limited`, `413 request_too_large`.

Model policy (`default`/`force`/`passthrough`) and fallback chains apply only to JSON requests using the configured model; multipart bodies stream through untouched.

## Customer API

Send an API key or dashboard token as `Authorization: Bearer`. `POST /v1/keys` and `GET /v1/plans` are public.

```text
GET    /v1/plans                 active plans
POST   /v1/keys                  create a key (account-scoped when authenticated)
GET    /v1/keys                  list keys with 30-day usage
PATCH  /v1/keys/:id              rename or block a key
POST   /v1/keys/:id/rotate       block and replace a key
GET    /v1/account               balance, credits, subscription, limits usage
GET    /v1/account/usage?days=30&key=…       daily series + breakdown
GET    /v1/account/requests?limit=20&key=…   request history
POST   /v1/account/redeem        { "code": "OPX-…" }
```

Example:

```bash
curl -X POST http://localhost:56787/v1/keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-laptop","contact":"me@example.com"}'
```

## Admin API

Served under the dashboard path (`/dashboard/api`) with the admin token in `x-admin-token`, `Authorization: Bearer` or `?token=`. With no token configured the dashboard is open (development mode, a startup warning is printed).

```text
GET    /api/overview
GET    /api/keys?q=&status=&limit=&offset=
GET    /api/keys/:id
PATCH  /api/keys/:id             name, status, limits, markup_pct, expires_at
POST   /api/keys/:id/rotate
POST   /api/keys/:id/revoke
GET    /api/accounts?q=&status=&limit=&offset=
GET    /api/accounts/:id
PATCH  /api/accounts/:id         status, contact, note, markup_pct, can_create_keys
POST   /api/accounts/:id/credits        { amount_usd, source, expires_at?, note? }
POST   /api/accounts/:id/subscriptions  { plan_code }
POST   /api/accounts/:id/keys
GET    /api/plans ;  POST /api/plans
GET    /api/codes ;  POST /api/codes
GET    /api/requests?q=&kind=&model=&status=&hour=&key=&account=&limit=&offset=
GET    /api/requests/groups?field=model|ip|status|kind|path|key|hour
GET    /api/settings ; PATCH /api/settings
GET    /api/events              server-sent events (snapshot on change)
```

## Configuration

Environment variables seed the settings table on first start. After that the database is authoritative and every setting is editable in **Admin → Settings**:

- **upstreams** — LLM/TTS/STT base URL, key, model, voice, fallback chains, policies, OpenRouter attribution;
- **billing** — markup, free credit and expiry, price table;
- **keys** — require-key mode, IP limit, cooldown, global cap, max keys per account, default limits, IP overrides, token prefixes;
- **server** — CORS, body limits, upstream timeout, log level/retention/entries, trust proxy;
- **dashboard** — enabled, path, site title, admin token.

Secrets are never returned by the API; leave a secret field blank to keep its current value.

### Running without API keys

Set `keys.require_key` to `false` (env `REQUIRE_KEY=false`) to let clients call the proxy without a key. Anonymous requests are logged, count toward upstream totals and can still be rate limited by your infrastructure, but they are never billed (there is no account to charge). If your clients always send a placeholder bearer token (many SDKs require an `apiKey` value), also enable `keys.accept_any_token` (env `ACCEPT_ANY_TOKEN=true`); unknown tokens are then treated as anonymous. In required mode unknown tokens are always rejected with `401 invalid_api_key`.

## Storage

One SQLite file (`DB_FILE`, default `.openai-proxy-server/proxy.db`, WAL mode) with a strict, checked schema:

- `settings` — runtime configuration;
- `accounts`, `api_keys`, `dash_tokens` — identity (only HMAC/SHA-256 hashes stored);
- `credits`, `subscriptions`, `plans`, `redeem_codes` — billing;
- `usage_buckets` — hourly per-key/model aggregates in micro-USD (charts + windowed limits);
- `request_logs` — request metadata (never prompts or audio), pruned by entries/retention;
- `totals` — global counters for the live dashboard.

Schema changes ship as ordered migrations in `src/db.js` and are tracked in `schema_migrations`. Version 0.5 uses a fresh schema and does not migrate older databases: point `DB_FILE` at a new path (or move the old file aside) when upgrading from 0.4 or earlier.

## Security

- Set `ADMIN_TOKEN` (or an admin token in Settings) before exposing the server.
- Keys and dashboard tokens are irreversible HMAC hashes; rotating `security.key_pepper` invalidates every key.
- `REQUIRE_KEY=true` by default: only existing keys are accepted, and unknown tokens are rejected even in open mode.
- Enable `trust_proxy` only behind a proxy you control, otherwise clients can spoof `X-Forwarded-For`.
- Logs never include bodies, prompts, transcripts, audio or Authorization headers.

## Development

```bash
npm test        # 50+ unit/integration tests (in-memory SQLite, fake upstreams)
npm run check   # syntax-check every entry point
```

Requires **Node.js ≥ 22.13** (`node:sqlite`). No runtime dependencies.

## Docker

```bash
docker run -d -p 56787:56787 \
  -e OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
  -e OPENAI_API_KEY=sk-or-v1-... \
  -e OPENAI_MODEL=google/gemma-4-26b-a4b-it \
  -e ADMIN_TOKEN=change-me \
  -v opx-data:/app/.openai-proxy-server \
  ghcr.io/g-o-o-d-b-o-y/openai-proxy-server
```

The image runs as the non-root `node` user with a healthcheck; mount the data volume to keep the database.

## License

MIT
