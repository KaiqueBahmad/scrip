# Scrip

A self-hosted, simulated **PIX** payment gateway for development and integration testing — in the spirit of MinIO (S3) or LocalStack (AWS), but for a payment gateway's lifecycle.

Reproduces a real PIX gateway — QR generation, async confirmation, expiration, refunds, withdrawals, signed webhooks, merchant KYC — with no external provider. Useful for testing checkout integrations, deterministic CI scenarios, idempotency/retry/webhook-signature testing, and demoing KYC flows locally.

## Scope

- **PIX only** for now (architecture supports adding other methods later).
- Two physically separate API surfaces: `/v1/api/*` (merchant backend, JWT auth) and `/v1/panel/*` (panel, HTTP Basic auth).
- **No real queue** — async work simulated with in-process `setTimeout`.
- **No external storage** — KYC documents stored as BLOBs in SQLite.

## Stack

Node.js + TypeScript + Fastify (NestJS) · SQLite (better-sqlite3) + Drizzle ORM · Vite + React panel + Tailwind · JWT (API) / HTTP Basic (panel) · in-process `setTimeout` for async work.

## Setup

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

The database is created automatically on first run. API listens on `http://localhost:8081` by default (`backend/scrip.config.json` or `SCRIP_*` env vars). Start the panel separately:

```bash
npm --prefix frontend run dev  # http://localhost:8080
```

## Docker

Prebuilt image: [`kaiquebt/scrip`](https://hub.docker.com/r/kaiquebt/scrip) — nginx + API in one container via `supervisord`. All variables below at their default (see [`examples/docker-compose.prod.yml`](examples/docker-compose.prod.yml)); `SCRIP_HOST`, `SCRIP_PORT` and `SCRIP_DATABASE_PATH` are fixed by the image and omitted:

```yaml
services:
  app:
    image: kaiquebt/scrip:latest
    ports:
      - "8080:8080"
      - "8081:8081"
    environment:
      SCRIP_APPROVAL_RATE: 0.85
      SCRIP_PIX_CONFIRMATION_DELAY_MS: 4000
      SCRIP_PIX_MIN_CONFIRMATION_DELAY_MS: 500
      SCRIP_PIX_QR_CODE_EXPIRATION_MS: 900000
      SCRIP_WEBHOOK_DELAY_MS: 3000
      SCRIP_WEBHOOK_MAX_RETRIES: 3
      SCRIP_WEBHOOK_RETRY_BACKOFF_MS: 2000
      SCRIP_WEBHOOK_TIMEOUT_MS: 5000
      SCRIP_JWT_SIGNING_SECRET: change-me
      SCRIP_JWT_DEFAULT_EXPIRATION: 24h
      SCRIP_KYC_MAX_FILE_SIZE_MB: 5
      SCRIP_REQUIRE_APPROVED_KYC_FOR_CHARGES: false
      SCRIP_PIX_KEY: scrip@localhost
      SCRIP_PIX_RECEIVER_NAME: SCRIP
      SCRIP_PIX_RECEIVER_CITY: SAO PAULO
      API_BASE_URL: http://localhost:8081  # public URL as reached from the browser
    volumes:
      - scrip-data:/app/backend/data
    restart: unless-stopped

volumes:
  scrip-data:
```

`docker compose up -d`. `API_BASE_URL` is injected at container start (no rebuild needed). To build from source: `docker compose up -d --build` using the repo's `docker-compose.yml`.

## Quickstart

1. Open the panel (`http://localhost:8080`) — no login, the merchant *is* the panel's identity. Create/pick a store (store creation is unauthenticated by design; don't expose this publicly).
2. The store page shows balance, `merchant_id`, `webhook_url`, `webhook_secret`, and KYC status. Approving/rejecting KYC there is a simulation control that fires real webhooks.
3. Generate a token (Tokens screen) — scoped to that store, reaches every `/v1/api` route.
4. Create a charge:
   ```bash
   curl -X POST http://localhost:8081/v1/api/payments/pix/charges \
     -H "Authorization: Bearer {your_jwt}" -H "Content-Type: application/json" \
     -d '{"amount": 15000, "payer_document": "11111111111", "metadata": {"order_id": "abc-123"}}'
   ```
5. Simulate payment (handy for tests/CI):
   ```bash
   curl -X POST http://localhost:8081/v1/api/payments/pix/charges/ch_a1b2c3/simulate \
     -H "Authorization: Bearer {your_jwt}" -H "Content-Type: application/json" \
     -d '{"result": "paid"}'
   ```

## Test CPFs

| `payer_document` | Behavior |
|---|---|
| `11111111111` | Always confirms (min delay) |
| `22222222222` | Never confirms (forces expiration) |
| `33333333333` | Confirms, but webhook delivery fails (tests retry) |
| Anything else | Follows configured `approvalRate` |

## Webhooks

Events: `pix.charge.created/paid/expired/refunded`, `kyc.approved/rejected`, `withdrawal.confirmed/denied`. Signed HMAC-SHA256 in `X-Scrip-Signature: t=<unix>,v1=<hmac>` (over `<t>.<raw body>`), retried up to 3x on non-2xx. Also see `X-Scrip-Event`, `X-Scrip-Delivery`, `X-Scrip-Attempt` headers, and `POST /v1/api/webhooks/deliveries/{id}/retry`.

## Configuration

All settings live in `backend/scrip.config.json` (overridable via `SCRIP_*` env vars), read once at boot — nothing is persisted or changed at runtime. Key options: `port`/`host`, `databasePath`, `approvalRate`, `pixConfirmationDelayMs`/`pixMinConfirmationDelayMs`, `pixQrCodeExpirationMs`, `webhookDelayMs`/`webhookMaxRetries`/`webhookRetryBackoffMs`/`webhookTimeoutMs`, `jwtSigningSecret`/`jwtDefaultExpiration`, `kycMaxFileSizeMb`, `requireApprovedKycForCharges` (default `false`), `pixKey`/`pixReceiverName`/`pixReceiverCity`.

## API reference

`Authorization: Bearer <jwt>` on all `/v1/api/*` routes:

- `POST /v1/api/payments/pix/charges` (`Idempotency-Key` supported)
- `GET /v1/api/payments/charges` (filters: `status`, `from`, `to`, `limit`, `offset`)
- `GET /v1/api/payments/charges/{id}` · `/events` · `/refunds`
- `POST /v1/api/payments/charges/{id}/cancel`
- `POST /v1/api/payments/charges/{id}/refunds` (`amount` optional)
- `GET`/`PATCH /v1/api/merchants/me`
- `POST`/`GET /v1/api/withdrawals`, `GET /v1/api/withdrawals/{id}`

No per-route permissions — every token reaches every route above, scoped to its own store (other stores' resources 404, not 403). Errors: `{ "error": { "code": "...", "message": "...", "details": {} } }`.

## Known limitations

- Webhook timers are lost on process restart (no queue persistence)
- SQLite isn't suited for high write concurrency
- QR payload isn't decodable by real banking apps; `e2e_id` isn't the official Bacen algorithm

## Structure

```
backend/src/
  main.ts, app.ts, app.module.ts   bootstrap
  http/            api/ and panel/ controllers
  auth/            Basic + Bearer guards
  config/          scrip.config.json + SCRIP_*
  db/              schema.ts, migrations/, openDb
  service/         charges (state machine), refunds, webhooks, kyc, tokens, merchants, withdrawals
  lib/             pix (BR Code + CRC16), jwt, hmac, scheduler, ids
frontend/          independent Vite + React panel
```

NestJS on the Fastify adapter; business rules live in `service/`, controllers only translate HTTP. All async work goes through `backend/src/lib/scheduler.ts` (wraps `setTimeout`, cancelable, and mockable in tests).

## State machine

```
pending ──► paid ──► partially_refunded ──► refunded
   │          └──────────────────────────► refunded
   ├──► expired
   └──► canceled
```

Terminal states: `expired`, `canceled`, `refunded`. Invalid transitions respond `409 invalid_state_transition`; every transition is recorded in `charge_events`.
