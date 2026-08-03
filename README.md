# Scrip

A self-hosted, simulated **PIX** payment gateway for development and integration testing — in the spirit of MinIO (S3) or LocalStack (AWS), but for a payment gateway's lifecycle.

---

## What it is

Scrip reproduces the behavior of a real PIX gateway — QR code generation, async confirmation, expiration, refunds, withdrawals, signed webhooks, merchant KYC — with no external provider. Useful for:

- Testing checkout integrations without a third-party sandbox
- Deterministic CI scenarios (force a payment, force an expiration)
- Testing idempotency, retry, and webhook signature verification
- Building/demoing KYC and merchant approval flows locally

## Scope

- **PIX only** for now. Card, boleto and other methods are out of scope (the architecture already supports adding them).
- **Two API surfaces**, physically separate even where the logic overlaps:
  - `/v1/api/*` — called by the merchant's own backend, JWT auth
  - `/v1/panel/*` — called by the panel, HTTP Basic auth
- **No real queue** — async work (payment confirmation, QR expiration, webhook retry) is simulated with in-process `setTimeout`.
- **No external storage** — KYC documents are stored as BLOBs directly in SQLite.

## Stack

| Layer | Tech |
|---|---|
| Backend / API | Node.js + TypeScript + Fastify (NestJS) |
| Database | SQLite (better-sqlite3) + Drizzle ORM |
| Panel | Vite + React + TypeScript + react-router-dom |
| Styling | Tailwind |
| Panel auth | HTTP Basic (merchant id + empty password) |
| API auth | JWT, issued by the merchant itself from the panel |
| Async | in-process `setTimeout` (no Redis/BullMQ) |
| KYC uploads | BLOB in SQLite |

## Setup

Two independent npm projects: `backend/` (Fastify API) and `frontend/` (Vite + React panel).

```bash
npm --prefix backend install
npm --prefix frontend install

cd backend
npm run build       # compile
npm start           # run
npm run dev          # run with reload
npm run reset        # wipe the database, keep the schema
npm run db:generate  # regenerate migrations after changing src/db/schema.ts
npm test
```

The database is created automatically on first run — `openDb` applies Drizzle migrations on every boot, so there's no separate `init` step. The server listens on `http://localhost:8081` by default. Settings live in `backend/scrip.config.json` (or `SCRIP_*` env vars, e.g. `SCRIP_PORT=5000`), read once at boot.

Start the panel in another terminal:

```bash
npm --prefix frontend run dev
```

Available at `http://localhost:8080`.

## Quickstart

1. **Open the panel** (`http://localhost:8080`). There's no login screen — **the merchant is the panel's identity**. Pick an existing store or create one; store creation is intentionally unauthenticated, since Basic auth needs an existing merchant to resolve against — this is a dev tool, don't expose it publicly.
2. **Check the store page** for its balance, `merchant_id` (the Basic auth username), `webhook_url`, `webhook_secret`, and KYC status. Approving/rejecting KYC there is a simulation control — the same idea as forcing a payment — and fires real `kyc.approved`/`kyc.rejected` webhooks.
3. **Generate a token** on the Tokens screen. Only the store itself can mint one, always scoped to it. A valid token reaches every `/v1/api` route.
4. **Create a charge**:
   ```bash
   curl -X POST http://localhost:8081/v1/api/payments/pix/charges \
     -H "Authorization: Bearer {your_jwt}" \
     -H "Content-Type: application/json" \
     -d '{"amount": 15000, "payer_document": "11111111111", "metadata": {"order_id": "abc-123"}}'
   ```
   The response includes `pix.qr_code` and `pix.qr_code_expires_at`.
5. **Simulate the payment** (useful in tests/CI):
   ```bash
   curl -X POST http://localhost:8081/v1/api/payments/pix/charges/ch_a1b2c3/simulate \
     -H "Authorization: Bearer {your_jwt}" -H "Content-Type: application/json" \
     -d '{"result": "paid"}'
   ```
   This fires `pix.charge.paid` to the configured `webhook_url` and credits the store's balance.

## Balance & withdrawals

`available`, `gross_received`, `refunded` and `settled_charges` are all **derived from charges**, never stored — so they can't drift from what actually happened. A store can request a withdrawal of its `available` balance (`/v1/withdrawals`, both surfaces); the amount is reserved the moment it's requested. Since there's no real bank behind it, confirming or denying a withdrawal is a **panel-only** simulation control, same as KYC and payment confirmation. Denying releases the reservation.

## Test CPFs (deterministic behavior)

| `payer_document` | Behavior |
|---|---|
| `11111111111` | Always confirms, at the configured minimum delay |
| `22222222222` | Never confirms (forces expiration) |
| `33333333333` | Confirms, but the webhook deliberately fails (tests retry) |
| Anything else | Follows the configured `approvalRate` |

## Webhooks

Events: `pix.charge.created`, `pix.charge.paid`, `pix.charge.expired`, `pix.charge.refunded`, `kyc.approved`, `kyc.rejected`, `withdrawal.confirmed`, `withdrawal.denied`.

Signed with HMAC-SHA256 in the `X-Scrip-Signature` header, using the merchant's `webhook_secret`. Retries automatically (up to 3 attempts) on a non-`2xx` response.

Body shape:

```json
{
  "id": "whd_...",
  "event": "pix.charge.paid",
  "created_at": "2026-07-29T23:59:00.000Z",
  "data": { "charge": { "...": "..." } }
}
```

The header is `t=<unix>,v1=<hmac>`, where the HMAC is computed over `<t>.<raw body>`. Verification:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=', 2)));
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Each attempt also carries `X-Scrip-Event`, `X-Scrip-Delivery` and `X-Scrip-Attempt`. Every attempt is recorded and can be retried from the panel or `POST /v1/api/webhooks/deliveries/{id}/retry`.

## Configuration

`backend/scrip.config.json` ships with every key at its default:

```json
{
  "port": 8081,
  "host": "127.0.0.1",
  "databasePath": "data/scrip.sqlite",

  "approvalRate": 0.85,
  "pixConfirmationDelayMs": 4000,
  "pixMinConfirmationDelayMs": 500,
  "pixQrCodeExpirationMs": 900000,

  "webhookDelayMs": 3000,
  "webhookMaxRetries": 3,
  "webhookRetryBackoffMs": 2000,
  "webhookTimeoutMs": 5000,

  "jwtSigningSecret": "change-me",
  "jwtDefaultExpiration": "24h",

  "kycMaxFileSizeMb": 5,
  "requireApprovedKycForCharges": false,

  "pixKey": "scrip@localhost",
  "pixReceiverName": "SCRIP",
  "pixReceiverCity": "SAO PAULO"
}
```

| Key | What it does |
|---|---|
| `port` / `host` | Where the listener binds. Dev tool — don't expose by default. |
| `databasePath` | SQLite file; `:memory:` works (tests use it). |
| `approvalRate` | Chance a non-test-CPF charge confirms. |
| `pixConfirmationDelayMs` / `pixMinConfirmationDelayMs` | Auto-confirm delay, and the floor used by the always-confirms test CPF. |
| `pixQrCodeExpirationMs` | QR code validity before a charge expires. |
| `webhookDelayMs` / `webhookMaxRetries` / `webhookRetryBackoffMs` / `webhookTimeoutMs` | Webhook delivery timing and retry policy. |
| `jwtSigningSecret` / `jwtDefaultExpiration` | Signs API tokens; their default validity. |
| `kycMaxFileSizeMb` | Max size of a KYC upload. |
| `requireApprovedKycForCharges` | If `true`, blocks charge creation until KYC is approved. |
| `pixKey` / `pixReceiverName` / `pixReceiverCity` | Receiver details embedded in the generated BR Code. |

KYC blocking defaults to **off** so the quickstart above works on a fresh install. The file (plus any `SCRIP_*` env var on top) is the only place configuration is edited — nothing is persisted to the database or changed at runtime. The panel's Settings screen is read-only.

## API reference

**Integration** (`Authorization: Bearer <jwt>`):

| Method & route |
|---|
| `POST /v1/api/payments/pix/charges` (accepts `Idempotency-Key`) |
| `GET /v1/api/payments/charges` (filters: `status`, `from`, `to`, `limit`, `offset`) |
| `GET /v1/api/payments/charges/{id}` · `/events` · `/refunds` |
| `POST /v1/api/payments/charges/{id}/cancel` |
| `POST /v1/api/payments/charges/{id}/refunds` — `amount` optional |
| `GET`/`PATCH /v1/api/merchants/me` |
| `POST`/`GET /v1/api/withdrawals`, `GET /v1/api/withdrawals/{id}` |

Any valid, unrevoked token reaches every route above — there are no per-route permissions, and everything is scoped to the token's own store. Requesting another store's resource responds `404`, not `403`, so ids can't be probed. Errors always come back in the same envelope:

```json
{ "error": { "code": "invalid_state_transition", "message": "...", "details": { "from": "paid", "to": "expired" } } }
```

## Known limitations

- Webhooks scheduled via `setTimeout` are lost on process restart (no queue persistence)
- SQLite isn't suited for high write concurrency
- The QR payload looks like a real PIX one but isn't decodable by an actual banking app
- The simulated `e2e_id` resembles the real Bacen format but doesn't implement the official algorithm

Card, boleto and other methods are a future extension.

## Structure

```
backend/
  src/
    main.ts        bootstrap: starts the app and listens
    app.ts          createApp(): Nest over Fastify + multipart
    app.module.ts   AppModule.forRoot(): providers, controllers, test seams
    http/           api/ and panel/ — surfaces split by controller
    auth/           Basic (store session) and Bearer (API) guards
    common/         exception filter, injection tokens, upload handling
    config/         scrip.config.json + SCRIP_*, resolved once at boot
    db/             schema.ts (single source of truth), migrations/, openDb, reset
    service/        charges (state machine), refunds, webhooks, kyc, tokens, merchants, withdrawals
    dto/            request bodies and query strings, one file per resource
    lib/            pix (BR Code + CRC16), jwt, hmac, scheduler, ids, errors
  tests/            node:test with a virtual clock, no real sleeping
  data/             SQLite database
frontend/           independent Vite + React panel
```

The backend is a NestJS app on the Fastify adapter. Business rules live in `service/` as injectable services with no knowledge of HTTP; controllers only translate requests and responses. Two guards handle auth; every error becomes a response through one `AppExceptionFilter`.

All async work goes through `backend/src/lib/scheduler.ts`, which wraps `setTimeout` — letting timers be canceled on shutdown, and tests advance time manually instead of actually waiting.

## State machine

```
pending ──► paid ──► partially_refunded ──► refunded
   │          └──────────────────────────► refunded
   ├──► expired
   └──► canceled
```

`expired`, `canceled` and `refunded` are terminal. Any transition outside this diagram responds `409 invalid_state_transition`, and every transition is recorded in `charge_events` — what the panel draws as the lifecycle view.
