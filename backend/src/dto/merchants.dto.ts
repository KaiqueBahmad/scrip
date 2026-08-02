import type { UpdateMerchantInput } from '../service/merchants.service';

export interface CreateMerchantBody {
  name?: string;
}

export interface UpdateMerchantBody {
  name?: string;
  webhook_url?: string | null;
  rotate_webhook_secret?: boolean;
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
