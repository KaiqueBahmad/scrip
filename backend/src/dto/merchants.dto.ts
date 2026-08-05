import type { UpdateMerchantInput } from '../service/merchants.service';

export interface CreateMerchantBody {
  name?: string;
}

export interface UpdateMerchantBody {
  name?: string;
  webhook_url?: string | null;
  rotate_webhook_secret?: boolean;
  /** Basis points (0-10000): the store's PIX entry fee, taken when a charge settles. */
  pix_fee_in_bps?: number;
  /** Basis points (0-10000): the store's PIX exit fee, taken when a withdrawal is requested. */
  pix_fee_out_bps?: number;
  /** Flat centavos charged on top of pix_fee_in_bps for every settled charge. */
  pix_fee_in_fixed?: number;
  /** Flat centavos charged on top of pix_fee_out_bps for every withdrawal. */
  pix_fee_out_fixed?: number;
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
    ...(body.pix_fee_in_bps === undefined ? {} : { pixFeeInBps: body.pix_fee_in_bps }),
    ...(body.pix_fee_out_bps === undefined ? {} : { pixFeeOutBps: body.pix_fee_out_bps }),
    ...(body.pix_fee_in_fixed === undefined ? {} : { pixFeeInFixed: body.pix_fee_in_fixed }),
    ...(body.pix_fee_out_fixed === undefined ? {} : { pixFeeOutFixed: body.pix_fee_out_fixed }),
  };
}
