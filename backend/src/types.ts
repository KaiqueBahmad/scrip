/** Row shapes as they come out of SQLite, plus the enums shared across domain and routes. */

export type KycStatus = 'pending' | 'approved' | 'rejected';

export type ChargeStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'canceled'
  | 'partially_refunded'
  | 'refunded';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface MerchantRow {
  id: string;
  name: string;
  webhook_url: string | null;
  webhook_secret: string;
  kyc_status: KycStatus;
  kyc_reason: string | null;
  kyc_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationTokenRow {
  id: string;
  merchant_id: string;
  name: string | null;
  token: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ChargeRow {
  id: string;
  merchant_id: string;
  amount: number;
  status: ChargeStatus;
  payer_document: string | null;
  payer_name: string | null;
  description: string | null;
  metadata: string;
  qr_code: string;
  qr_code_txid: string;
  qr_code_expires_at: string;
  e2e_id: string | null;
  refunded_amount: number;
  paid_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefundRow {
  id: string;
  charge_id: string;
  merchant_id: string;
  amount: number;
  status: 'succeeded' | 'failed';
  reason: string | null;
  e2e_id: string | null;
  created_at: string;
}

export interface ChargeEventRow {
  id: string;
  charge_id: string;
  from_status: ChargeStatus | null;
  to_status: ChargeStatus;
  reason: string | null;
  created_at: string;
}

export interface KycDocumentRow {
  id: string;
  merchant_id: string;
  type: string;
  filename: string;
  mime_type: string;
  size: number;
  status: KycStatus;
  created_at: string;
}

export interface WebhookDeliveryRow {
  id: string;
  merchant_id: string;
  charge_id: string | null;
  event: string;
  url: string;
  payload: string;
  signature: string | null;
  attempt: number;
  max_attempts: number;
  status: DeliveryStatus;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  scheduled_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

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
