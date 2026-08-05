import { parseJsonColumn } from '../db/index';
import { decodeExpiry } from '../lib/jwt';
import type { MerchantBalance } from './merchants.service';
import type {
  ChargeEventRow,
  ChargeRow,
  ApiTokenRow,
  KycDocumentRow,
  MerchantRow,
  RefundRow,
  WebhookDeliveryRow,
  WithdrawalRow,
} from '../repositories/types';

/** Row -> JSON, shared by the panel and the API surface. */
export function serializeCharge(row: ChargeRow) {
  return {
    id: row.id,
    object: 'charge' as const,
    merchant_id: row.merchant_id,
    payment_method: row.payment_method,
    status: row.status,
    amount: row.amount,
    amount_refunded: row.refunded_amount,
    payer_document: row.payer_document,
    payer_name: row.payer_name,
    description: row.description,
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata, {}),
    callback_url: row.callback_url,
    fee_amount: row.fee_amount,
    // Only 'pix' exists today, so this is unconditional — a second method would key this
    // object by row.payment_method instead of hardcoding 'pix'.
    pix: {
      qr_code: row.qr_code,
      qr_code_txid: row.qr_code_txid,
      qr_code_expires_at: row.qr_code_expires_at,
      e2e_id: row.e2e_id,
    },
    paid_at: row.paid_at,
    expired_at: row.expired_at,
    canceled_at: row.canceled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

export function serializeWithdrawal(row: WithdrawalRow) {
  return {
    id: row.id,
    object: 'withdrawal' as const,
    merchant_id: row.merchant_id,
    amount: row.amount,
    fee_amount: row.fee_amount,
    status: row.status,
    reason: row.reason,
    confirmed_at: row.confirmed_at,
    denied_at: row.denied_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

/** `includeSecret` is only ever true for the merchant's own session or its own API calls. */
export function serializeMerchant(
  row: MerchantRow,
  includeSecret = false,
  balance?: MerchantBalance,
) {
  return {
    id: row.id,
    object: 'merchant' as const,
    name: row.name,
    webhook_url: row.webhook_url,
    ...(includeSecret ? { webhook_secret: row.webhook_secret } : {}),
    kyc_status: row.kyc_status,
    kyc_reason: row.kyc_reason,
    kyc_reviewed_at: row.kyc_reviewed_at,
    pix_fee_in_bps: row.pix_fee_in_bps,
    pix_fee_out_bps: row.pix_fee_out_bps,
    ...(balance ? { balance } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeToken(row: ApiTokenRow) {
  return {
    id: row.id,
    object: 'api_token' as const,
    merchant_id: row.merchant_id,
    name: row.name,
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
