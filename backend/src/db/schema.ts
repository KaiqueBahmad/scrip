/**
 * The Drizzle mirror of schema.sql.
 *
 * schema.sql stays the DDL that actually runs (see openDb): it is idempotent and executed on
 * every boot, which is what lets this project ship without a migration layer. This file
 * describes the same tables to Drizzle so every query is typed and composed instead of
 * hand-written — and so the row types below are derived from the schema rather than restated.
 *
 * Both files therefore have to be changed together; tests/schema.test.ts fails the build if
 * they drift apart.
 *
 * Property names are deliberately the snake_case column names: rows travel from here to the
 * JSON serializers untouched, and the API speaks snake_case.
 */
import { sql } from 'drizzle-orm';
import { blob, check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  ChargeStatus,
  DeliveryStatus,
  KycStatus,
  PaymentMethod,
  WithdrawalStatus,
} from '../repositories/types';

export const merchants = sqliteTable(
  'merchants',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    webhook_url: text(),
    webhook_secret: text().notNull(),
    kyc_status: text().$type<KycStatus>().notNull().default('pending'),
    kyc_reason: text(),
    kyc_reviewed_at: text(),
    // Basis points (1/100 of a percent): 250 = 2.50%. Snapshotted onto each charge/withdrawal
    // when it settles, so a later rate change never reaches back into old money.
    pix_fee_in_bps: integer().notNull().default(0),
    pix_fee_out_bps: integer().notNull().default(0),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (table) => [
    check('merchants_kyc_status', sql`${table.kyc_status} IN ('pending', 'approved', 'rejected')`),
    check('merchants_pix_fee_in_bps', sql`${table.pix_fee_in_bps} BETWEEN 0 AND 10000`),
    check('merchants_pix_fee_out_bps', sql`${table.pix_fee_out_bps} BETWEEN 0 AND 10000`),
  ],
);

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text().primaryKey(),
    // A token is always minted by, and scoped to, a merchant session. There is no
    // identity above the merchant.
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    name: text(),
    // Stored in plaintext on purpose: the panel must be able to show it again at any
    // time.
    token: text().notNull(),
    expires_at: text(),
    revoked_at: text(),
    created_at: text().notNull(),
  },
  (table) => [index('idx_tokens_merchant').on(table.merchant_id)],
);

/**
 * Fields common to a charge regardless of payment method. Anything that only makes sense
 * for one method (PIX's QR code, for instance) lives in that method's own details table —
 * see pixChargeDetails.
 */
export const charges = sqliteTable(
  'charges',
  {
    id: text().primaryKey(),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    payment_method: text().$type<PaymentMethod>().notNull().default('pix'),
    amount: integer().notNull(),
    status: text().$type<ChargeStatus>().notNull().default('pending'),
    payer_document: text(),
    payer_name: text(),
    description: text(),
    metadata: text().notNull().default('{}'),
    // Per-charge override: when set, this charge's webhooks go here instead of the
    // merchant's own webhook_url. Null means "use the merchant's".
    callback_url: text(),
    refunded_amount: integer().notNull().default(0),
    // The merchant's pix_fee_in_bps applied to `amount`, snapshotted once the charge is
    // paid (zero until then). Kept even if the charge is later refunded — see markPaid.
    fee_amount: integer().notNull().default(0),
    paid_at: text(),
    expired_at: text(),
    canceled_at: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (table) => [
    index('idx_charges_merchant_created').on(table.merchant_id, sql`${table.created_at} DESC`),
    index('idx_charges_status').on(table.status),
    check('charges_amount', sql`${table.amount} > 0`),
    check('charges_refunded_amount', sql`${table.refunded_amount} >= 0`),
    check('charges_fee_amount', sql`${table.fee_amount} >= 0`),
    check(
      'charges_status',
      sql`${table.status} IN ('pending', 'paid', 'expired', 'canceled', 'partially_refunded', 'refunded')`,
    ),
    check('charges_payment_method', sql`${table.payment_method} IN ('pix')`),
  ],
);

/** PIX-only fields, one row per charge whose payment_method is 'pix'. */
export const pixChargeDetails = sqliteTable('pix_charge_details', {
  charge_id: text()
    .primaryKey()
    .references(() => charges.id, { onDelete: 'cascade' }),
  qr_code: text().notNull(),
  qr_code_txid: text().notNull(),
  qr_code_expires_at: text().notNull(),
  e2e_id: text(),
});

export const pixRefunds = sqliteTable(
  'pix_refunds',
  {
    id: text().primaryKey(),
    charge_id: text()
      .notNull()
      .references(() => charges.id, { onDelete: 'cascade' }),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    amount: integer().notNull(),
    status: text().$type<'succeeded' | 'failed'>().notNull().default('succeeded'),
    reason: text(),
    e2e_id: text(),
    created_at: text().notNull(),
  },
  (table) => [
    index('idx_refunds_charge').on(table.charge_id),
    check('pix_refunds_amount', sql`${table.amount} > 0`),
    check('pix_refunds_status', sql`${table.status} IN ('succeeded', 'failed')`),
  ],
);

/**
 * Append-only transition log. Drives the timeline in the panel and makes every
 * state change auditable.
 */
export const chargeEvents = sqliteTable(
  'charge_events',
  {
    id: text().primaryKey(),
    charge_id: text()
      .notNull()
      .references(() => charges.id, { onDelete: 'cascade' }),
    from_status: text().$type<ChargeStatus>(),
    to_status: text().$type<ChargeStatus>().notNull(),
    reason: text(),
    created_at: text().notNull(),
  },
  (table) => [index('idx_charge_events_charge').on(table.charge_id, table.created_at)],
);

export const kycDocuments = sqliteTable(
  'kyc_documents',
  {
    id: text().primaryKey(),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    filename: text().notNull(),
    mime_type: text().notNull(),
    size: integer().notNull(),
    // No external storage by design: the file lives here as a BLOB.
    content: blob({ mode: 'buffer' }).notNull(),
    status: text().$type<KycStatus>().notNull().default('pending'),
    created_at: text().notNull(),
  },
  (table) => [
    index('idx_kyc_merchant').on(table.merchant_id, sql`${table.created_at} DESC`),
    check('kyc_documents_status', sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  ],
);

/** Every column but the BLOB — what a listing or a metadata lookup selects. */
export const kycDocumentColumns = {
  id: kycDocuments.id,
  merchant_id: kycDocuments.merchant_id,
  type: kycDocuments.type,
  filename: kycDocuments.filename,
  mime_type: kycDocuments.mime_type,
  size: kycDocuments.size,
  status: kycDocuments.status,
  created_at: kycDocuments.created_at,
} as const;

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text().primaryKey(),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    charge_id: text().references(() => charges.id, { onDelete: 'set null' }),
    event: text().notNull(),
    url: text().notNull(),
    payload: text().notNull(),
    signature: text(),
    attempt: integer().notNull().default(0),
    max_attempts: integer().notNull(),
    status: text().$type<DeliveryStatus>().notNull().default('pending'),
    response_status: integer(),
    response_body: text(),
    error: text(),
    scheduled_at: text(),
    delivered_at: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (table) => [
    index('idx_deliveries_merchant').on(table.merchant_id, sql`${table.created_at} DESC`),
    index('idx_deliveries_charge').on(table.charge_id),
    index('idx_deliveries_status').on(table.status),
    check(
      'webhook_deliveries_status',
      sql`${table.status} IN ('pending', 'delivered', 'failed')`,
    ),
  ],
);

/**
 * A merchant pulling money out of its own available balance. Creating one reserves the
 * amount (it counts against `available` immediately); confirming keeps it reserved,
 * denying releases it back — see MerchantService.balanceFor.
 */
export const withdrawals = sqliteTable(
  'withdrawals',
  {
    id: text().primaryKey(),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    amount: integer().notNull(),
    // The merchant's pix_fee_out_bps applied to `amount`, snapshotted at request time —
    // it holds against the balance alongside `amount` from the moment it's requested.
    fee_amount: integer().notNull().default(0),
    status: text().$type<WithdrawalStatus>().notNull().default('pending'),
    reason: text(),
    confirmed_at: text(),
    denied_at: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (table) => [
    index('idx_withdrawals_merchant_created').on(table.merchant_id, sql`${table.created_at} DESC`),
    check('withdrawals_amount', sql`${table.amount} > 0`),
    check('withdrawals_fee_amount', sql`${table.fee_amount} >= 0`),
    check('withdrawals_status', sql`${table.status} IN ('pending', 'confirmed', 'denied')`),
  ],
);

/**
 * Replay cache for Idempotency-Key on charge creation. The real table is WITHOUT ROWID,
 * which Drizzle has no way to express — it changes storage, not semantics, so it only lives
 * in schema.sql.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text().notNull(),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    endpoint: text().notNull(),
    request_hash: text().notNull(),
    response_status: integer().notNull(),
    response_body: text().notNull(),
    created_at: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.merchant_id, table.endpoint, table.key] }),
  ],
);

/**
 * Delete order for `resetData`: children before parents, so the wipe works with foreign
 * keys enforced.
 */
export const TABLES_CHILD_FIRST = [
  idempotencyKeys,
  webhookDeliveries,
  chargeEvents,
  pixRefunds,
  pixChargeDetails,
  charges,
  kycDocuments,
  apiTokens,
  withdrawals,
  merchants,
] as const;
