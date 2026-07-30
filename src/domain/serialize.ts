import { parseJsonColumn } from '../db/index.js';
import { decodeExpiry } from '../lib/jwt.js';
import type {
  ChargeEventRow,
  ChargeRow,
  IntegrationTokenRow,
  KycDocumentRow,
  MerchantRow,
  RefundRow,
  UserRow,
  WebhookDeliveryRow,
} from '../types.js';

/**
 * Row -> JSON. The payer-facing and merchant-facing surfaces get different shapes on
 * purpose: /v1/app is reached with a token that lives in a browser, so it never sees
 * merchant metadata or the merchant id.
 */

export function serializeCharge(row: ChargeRow) {
  return {
    id: row.id,
    object: 'pix_charge' as const,
    merchant_id: row.merchant_id,
    status: row.status,
    amount: row.amount,
    amount_refunded: row.refunded_amount,
    payer_document: row.payer_document,
    payer_name: row.payer_name,
    description: row.description,
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata, {}),
    qr_code: row.qr_code,
    qr_code_txid: row.qr_code_txid,
    qr_code_expires_at: row.qr_code_expires_at,
    public_token: row.public_token,
    e2e_id: row.e2e_id,
    paid_at: row.paid_at,
    expired_at: row.expired_at,
    canceled_at: row.canceled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Reduced shape for /v1/app — no metadata, no merchant id, no public_token echo. */
export function serializePublicCharge(row: ChargeRow) {
  return {
    id: row.id,
    object: 'pix_charge' as const,
    status: row.status,
    amount: row.amount,
    description: row.description,
    qr_code: row.qr_code,
    qr_code_expires_at: row.qr_code_expires_at,
    e2e_id: row.e2e_id,
    paid_at: row.paid_at,
    expired_at: row.expired_at,
    created_at: row.created_at,
  };
}

export function serializeRefund(row: RefundRow) {
  return {
    id: row.id,
    object: 'pix_refund' as const,
    charge_id: row.charge_id,
    amount: row.amount,
    status: row.status,
    reason: row.reason,
    e2e_id: row.e2e_id,
    created_at: row.created_at,
  };
}

export function serializeChargeEvent(row: ChargeEventRow) {
  return {
    id: row.id,
    charge_id: row.charge_id,
    from_status: row.from_status,
    to_status: row.to_status,
    reason: row.reason,
    created_at: row.created_at,
  };
}

/** `includeSecret` is only ever true on the admin surface. */
export function serializeMerchant(row: MerchantRow, includeSecret = false) {
  return {
    id: row.id,
    object: 'merchant' as const,
    name: row.name,
    document: row.document,
    webhook_url: row.webhook_url,
    ...(includeSecret ? { webhook_secret: row.webhook_secret } : {}),
    kyc_status: row.kyc_status,
    kyc_reason: row.kyc_reason,
    kyc_reviewed_at: row.kyc_reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeUser(row: UserRow) {
  return {
    id: row.id,
    object: 'user' as const,
    name: row.name,
    email: row.email,
    permissions: parseJsonColumn<string[]>(row.permissions, []),
    merchant_id: row.merchant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * The JWT is always included: specs.md:62 requires it to stay visible in the panel
 * instead of being shown once and discarded.
 */
export function serializeToken(row: IntegrationTokenRow) {
  return {
    id: row.id,
    object: 'integration_token' as const,
    user_id: row.user_id,
    merchant_id: row.merchant_id,
    name: row.name,
    permissions: parseJsonColumn<string[]>(row.permissions, []),
    token: row.token,
    expires_at: row.expires_at ?? decodeExpiry(row.token),
    revoked_at: row.revoked_at,
    revoked: row.revoked_at !== null,
    created_at: row.created_at,
  };
}

export function serializeKycDocument(row: KycDocumentRow) {
  return {
    id: row.id,
    object: 'kyc_document' as const,
    merchant_id: row.merchant_id,
    type: row.type,
    filename: row.filename,
    mime_type: row.mime_type,
    size: row.size,
    status: row.status,
    created_at: row.created_at,
  };
}

export function serializeDelivery(row: WebhookDeliveryRow) {
  return {
    id: row.id,
    object: 'webhook_delivery' as const,
    merchant_id: row.merchant_id,
    charge_id: row.charge_id,
    event: row.event,
    url: row.url,
    payload: parseJsonColumn<Record<string, unknown>>(row.payload, {}),
    signature: row.signature,
    attempt: row.attempt,
    max_attempts: row.max_attempts,
    status: row.status,
    response_status: row.response_status,
    response_body: row.response_body,
    error: row.error,
    scheduled_at: row.scheduled_at,
    delivered_at: row.delivered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
