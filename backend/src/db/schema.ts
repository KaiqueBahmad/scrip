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

import type { ChargeStatus, DeliveryStatus, KycStatus } from '../repositories/types';

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
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (table) => [
    check('merchants_kyc_status', sql`${table.kyc_status} IN ('pending', 'approved', 'rejected')`),
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

export const pixCharges = sqliteTable(
  'pix_charges',
  {
    id: text().primaryKey(),
    merchant_id: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    amount: integer().notNull(),
    status: text().$type<ChargeStatus>().notNull().default('pending'),
    payer_document: text(),
    payer_name: text(),
    description: text(),
    metadata: text().notNull().default('{}'),
    qr_code: text().notNull(),
    qr_code_txid: text().notNull(),
    qr_code_expires_at: text().notNull(),
    e2e_id: text(),
    refunded_amount: integer().notNull().default(0),
    paid_at: text(),
    expired_at: text(),
    canceled_at: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (table) => [
    index('idx_charges_merchant_created').on(table.merchant_id, sql`${table.created_at} DESC`),
    index('idx_charges_status').on(table.status),
    check('pix_charges_amount', sql`${table.amount} > 0`),
    check('pix_charges_refunded_amount', sql`${table.refunded_amount} >= 0`),
    check(
      'pix_charges_status',
      sql`${table.status} IN ('pending', 'paid', 'expired', 'canceled', 'partially_refunded', 'refunded')`,
    ),
  ],
);

export const pixRefunds = sqliteTable(
  'pix_refunds',
  {
    id: text().primaryKey(),
    charge_id: text()
      .notNull()
      .references(() => pixCharges.id, { onDelete: 'cascade' }),
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
      .references(() => pixCharges.id, { onDelete: 'cascade' }),
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
    charge_id: text().references(() => pixCharges.id, { onDelete: 'set null' }),
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
  pixCharges,
  kycDocuments,
  apiTokens,
  merchants,
] as const;
