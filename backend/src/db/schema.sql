-- PseudoPay schema. Idempotent: safe to run on every boot.
--
-- There is no migration layer: every statement is CREATE ... IF NOT EXISTS, so changing an
-- existing column means recreating the database (`npm run reset`, or delete data/).
--
-- Conventions:
--   * ids are prefixed strings ("ch_...", "mch_...") generated in src/lib/ids.ts
--   * timestamps are ISO-8601 UTC strings, so the SQLite file stays human-readable
--   * money is always an integer number of centavos
--   * JSON-shaped columns hold TEXT and are parsed at the domain boundary

CREATE TABLE IF NOT EXISTS merchants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  webhook_url     TEXT,
  webhook_secret  TEXT NOT NULL,
  kyc_status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (kyc_status IN ('pending', 'approved', 'rejected')),
  kyc_reason      TEXT,
  kyc_reviewed_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_tokens (
  id          TEXT PRIMARY KEY,
  -- A token is always minted by, and scoped to, a merchant session. There is no
  -- identity above the merchant.
  merchant_id TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  name        TEXT,
  -- Stored in plaintext on purpose: the panel must be able to show it again at any
  -- time (specs.md:62, specs.md:116).
  token       TEXT NOT NULL,
  expires_at  TEXT,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_merchant ON integration_tokens (merchant_id);

CREATE TABLE IF NOT EXISTS pix_charges (
  id                 TEXT PRIMARY KEY,
  merchant_id        TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  amount             INTEGER NOT NULL CHECK (amount > 0),
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'paid', 'expired', 'canceled',
                                         'partially_refunded', 'refunded')),
  payer_document     TEXT,
  payer_name         TEXT,
  description        TEXT,
  metadata           TEXT NOT NULL DEFAULT '{}',
  qr_code            TEXT NOT NULL,
  qr_code_txid       TEXT NOT NULL,
  qr_code_expires_at TEXT NOT NULL,
  e2e_id             TEXT,
  refunded_amount    INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  paid_at            TEXT,
  expired_at         TEXT,
  canceled_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_charges_merchant_created
  ON pix_charges (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_charges_status ON pix_charges (status);

CREATE TABLE IF NOT EXISTS pix_refunds (
  id          TEXT PRIMARY KEY,
  charge_id   TEXT NOT NULL REFERENCES pix_charges (id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  status      TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'failed')),
  reason      TEXT,
  e2e_id      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refunds_charge ON pix_refunds (charge_id);

-- Append-only transition log. Drives the timeline in the panel and makes every
-- state change auditable.
CREATE TABLE IF NOT EXISTS charge_events (
  id          TEXT PRIMARY KEY,
  charge_id   TEXT NOT NULL REFERENCES pix_charges (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_charge_events_charge ON charge_events (charge_id, created_at);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id          TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  -- No external storage by design (specs.md:25): the file lives here as a BLOB.
  content     BLOB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kyc_merchant ON kyc_documents (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  charge_id       TEXT REFERENCES pix_charges (id) ON DELETE SET NULL,
  event           TEXT NOT NULL,
  url             TEXT NOT NULL,
  payload         TEXT NOT NULL,
  signature       TEXT,
  attempt         INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'failed')),
  response_status INTEGER,
  response_body   TEXT,
  error           TEXT,
  scheduled_at    TEXT,
  delivered_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_merchant ON webhook_deliveries (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_charge ON webhook_deliveries (charge_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries (status);

-- Runtime-editable subset of pseudopay.config.json, driven by the Settings screen.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Replay cache for Idempotency-Key on charge creation.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT NOT NULL,
  merchant_id     TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (merchant_id, endpoint, key)
) WITHOUT ROWID;
