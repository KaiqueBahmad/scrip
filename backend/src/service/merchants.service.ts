import { Injectable } from '@nestjs/common';

import { nowIso } from '../db/index';
import { badRequest, notFound } from '../lib/errors';
import { newId, newWebhookSecret } from '../lib/ids';
import { MerchantRepository } from '../repositories';
import type { ChargeStatus, MerchantRow } from '../repositories/types';
import { serializeMerchant } from './serialize.service';

/**
 * A store is created with just its identity. The webhook is set afterwards through
 * `update`, so signing up and wiring up stay separate steps.
 */
export interface CreateMerchantInput {
  name: string;
  /** Supply to pin a known secret in tests; otherwise one is generated. */
  webhookSecret?: string;
}

export interface UpdateMerchantInput {
  name?: string;
  webhookUrl?: string | null;
  /** Rotates the HMAC secret used to sign this merchant's webhooks. */
  rotateWebhookSecret?: boolean;
}

function assertValidWebhookUrl(url: string | null | undefined): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('invalid_webhook_url', `webhook_url is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('invalid_webhook_url', 'webhook_url must be http or https');
  }
}

export interface MerchantBalance {
  /** Liquid balance in centavos: everything settled, minus what was given back. */
  available: number;
  /** Sum of every charge that ever settled, before refunds. */
  gross_received: number;
  /** Sum of every refund issued. */
  refunded: number;
  /** How many charges contributed to `gross_received`. */
  settled_charges: number;
}

/** Only these statuses ever moved money; a fully refunded charge contributes zero. */
const SETTLED_STATUSES: readonly ChargeStatus[] = ['paid', 'partially_refunded', 'refunded'];

@Injectable()
export class MerchantService {
  constructor(private readonly merchants: MerchantRepository) {}

  /**
   * A store as its own session sees it: the full record — secret included, because you are
   * looking at yourself — plus the derived balance.
   */
  present(merchant: MerchantRow) {
    return serializeMerchant(merchant, true, this.balanceFor(merchant.id));
  }

  /**
   * Balance is derived from the charges rather than stored, so it can never drift out of
   * sync with the ledger it describes — every refund and every settlement is already
   * recorded on pix_charges.
   */
  balanceFor(merchantId: string): MerchantBalance {
    const totals = this.merchants.sumCharges(merchantId, SETTLED_STATUSES);

    return {
      available: totals.amount - totals.refunded_amount,
      gross_received: totals.amount,
      refunded: totals.refunded_amount,
      settled_charges: totals.count,
    };
  }

  create(input: CreateMerchantInput): MerchantRow {
    const name = input.name?.trim();
    if (!name) throw badRequest('invalid_name', 'name is required');

    const at = nowIso();
    const row: MerchantRow = {
      id: newId('merchant'),
      name,
      // Always null on creation — configured later via update.
      webhook_url: null,
      webhook_secret: input.webhookSecret ?? newWebhookSecret(),
      // New merchants start unverified; whether that blocks charges is a config decision
      // (requireApprovedKycForCharges), off by default.
      kyc_status: 'pending',
      kyc_reason: null,
      kyc_reviewed_at: null,
      created_at: at,
      updated_at: at,
    };

    this.merchants.insert(row);

    return row;
  }

  get(merchantId: string): MerchantRow {
    const row = this.find(merchantId);

    if (!row) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return row;
  }

  find(merchantId: string): MerchantRow | undefined {
    return this.merchants.findById(merchantId);
  }

  list(): MerchantRow[] {
    return this.merchants.list();
  }

  update(merchantId: string, input: UpdateMerchantInput): MerchantRow {
    const current = this.get(merchantId);

    if (input.name !== undefined && !input.name.trim()) {
      throw badRequest('invalid_name', 'name cannot be empty');
    }
    if (input.webhookUrl !== undefined) assertValidWebhookUrl(input.webhookUrl);

    this.merchants.update(merchantId, {
      name: input.name?.trim() ?? current.name,
      webhook_url: input.webhookUrl === undefined ? current.webhook_url : input.webhookUrl,
      webhook_secret: input.rotateWebhookSecret ? newWebhookSecret() : current.webhook_secret,
      updated_at: nowIso(),
    });

    return this.get(merchantId);
  }

  delete(merchantId: string): void {
    this.get(merchantId);
    this.merchants.delete(merchantId);
  }
}
