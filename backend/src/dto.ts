import type { UpdateMerchantInput } from './domain/merchants';

/**
 * Request bodies and query strings as they arrive on the wire. Field names stay snake_case
 * because that is the published API contract; the mapping to the domain layer's camelCase
 * inputs happens here, once, instead of in every controller.
 *
 * Values are not validated on the way in: the domain services already reject a bad amount
 * or a malformed webhook_url with a specific error code, and duplicating those rules here
 * would only give the same input two different answers.
 */

export interface CreateChargeBody {
  amount?: number;
  payer_document?: string | null;
  payer_name?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateRefundBody {
  amount?: number | null;
  reason?: string | null;
}

export interface CreateMerchantBody {
  name?: string;
}

export interface UpdateMerchantBody {
  name?: string;
  webhook_url?: string | null;
  rotate_webhook_secret?: boolean;
}

export interface IssueTokenBody {
  name?: string | null;
  expires_in?: string | null;
}

export interface SimulateChargeBody {
  result?: string;
}

export interface SimulateKycBody {
  decision?: string;
  reason?: string | null;
}

/**
 * A merchant update, as the domain layer wants it. Absent keys are dropped rather than
 * passed as undefined, so "not sent" stays distinct from "set to null".
 */
export function toMerchantUpdate(body: UpdateMerchantBody): UpdateMerchantInput {
  return {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.webhook_url === undefined ? {} : { webhookUrl: body.webhook_url }),
    ...(body.rotate_webhook_secret ? { rotateWebhookSecret: true } : {}),
  };
}
