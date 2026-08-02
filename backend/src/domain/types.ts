/**
 * Row shapes as they come out of SQLite, plus the enums shared across domain and routes.
 *
 * The rows are inferred from the Drizzle tables, so a column added there shows up here
 * without being restated. The enums stay hand-written: the tables narrow their text columns
 * to these unions, which is why the import below has to be type-only — it keeps the schema
 * and this module free of a runtime cycle.
 */
import type {
  chargeEvents,
  integrationTokens,
  kycDocuments,
  merchants,
  pixCharges,
  pixRefunds,
  webhookDeliveries,
} from '../db/schema';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export type ChargeStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'canceled'
  | 'partially_refunded'
  | 'refunded';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export type MerchantRow = typeof merchants.$inferSelect;

export type IntegrationTokenRow = typeof integrationTokens.$inferSelect;

export type ChargeRow = typeof pixCharges.$inferSelect;

export type RefundRow = typeof pixRefunds.$inferSelect;

export type ChargeEventRow = typeof chargeEvents.$inferSelect;

/** Metadata only: the BLOB is never carried around with the row. */
export type KycDocumentRow = Omit<typeof kycDocuments.$inferSelect, 'content'>;

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

/** Webhook event names, exactly as listed in specs.md:106. */
export const WEBHOOK_EVENTS = [
  'pix.charge.created',
  'pix.charge.paid',
  'pix.charge.expired',
  'pix.charge.refunded',
  'kyc.approved',
  'kyc.rejected',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Restricts a lookup to one merchant. A row belonging to another one is reported as
 * missing rather than forbidden, so ids cannot be probed across merchants.
 */
export interface Scope {
  merchantId?: string;
}
