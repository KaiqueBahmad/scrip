import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import { nowIso, type Db } from '../db/index';
import { merchants, pixCharges } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { newId, newWebhookSecret } from '../lib/ids';
import { serializeMerchant } from './serialize';
import type { MerchantRow } from './types';

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
const SETTLED_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

@Injectable()
export class MerchantService {
  constructor(@Inject(DB) private readonly db: Db) {}

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
    const row = this.db
      .select({
        available: sql<number>`
          COALESCE(SUM(${pixCharges.amount} - ${pixCharges.refunded_amount}), 0)`,
        gross: sql<number>`COALESCE(SUM(${pixCharges.amount}), 0)`,
        refunded: sql<number>`COALESCE(SUM(${pixCharges.refunded_amount}), 0)`,
        settled: sql<number>`COUNT(*)`,
      })
      .from(pixCharges)
      .where(
        and(
          eq(pixCharges.merchant_id, merchantId),
          inArray(pixCharges.status, [...SETTLED_STATUSES]),
        ),
      )
      .get();

    return {
      available: row?.available ?? 0,
      gross_received: row?.gross ?? 0,
      refunded: row?.refunded ?? 0,
      settled_charges: row?.settled ?? 0,
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

    this.db.insert(merchants).values(row).run();

    return row;
  }

  get(merchantId: string): MerchantRow {
    const row = this.find(merchantId);

    if (!row) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return row;
  }

  find(merchantId: string): MerchantRow | undefined {
    return this.db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
  }

  list(): MerchantRow[] {
    return this.db.select().from(merchants).orderBy(desc(merchants.created_at)).all();
  }

  update(merchantId: string, input: UpdateMerchantInput): MerchantRow {
    const current = this.get(merchantId);

    if (input.name !== undefined && !input.name.trim()) {
      throw badRequest('invalid_name', 'name cannot be empty');
    }
    if (input.webhookUrl !== undefined) assertValidWebhookUrl(input.webhookUrl);

    const next = {
      name: input.name?.trim() ?? current.name,
      webhook_url: input.webhookUrl === undefined ? current.webhook_url : input.webhookUrl,
      webhook_secret: input.rotateWebhookSecret ? newWebhookSecret() : current.webhook_secret,
      updated_at: nowIso(),
    };

    this.db.update(merchants).set(next).where(eq(merchants.id, merchantId)).run();

    return this.get(merchantId);
  }

  delete(merchantId: string): void {
    this.get(merchantId);
    // Charges, tokens, KYC docs and deliveries cascade (see schema.sql).
    this.db.delete(merchants).where(eq(merchants.id, merchantId)).run();
  }
}
