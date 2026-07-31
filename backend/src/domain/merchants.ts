import { nowIso, type Db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId, newWebhookSecret } from '../lib/ids.js';
import type { MerchantRow } from '../types.js';

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

export class MerchantService {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Balance is derived from the charges rather than stored, so it can never drift out of
   * sync with the ledger it describes — every refund and every settlement is already
   * recorded on pix_charges.
   */
  balanceFor(merchantId: string): MerchantBalance {
    const placeholders = SETTLED_STATUSES.map(() => '?').join(', ');

    const row = this.#db
      .prepare<
        unknown[],
        { available: number; gross: number; refunded: number; settled: number }
      >(
        `SELECT COALESCE(SUM(amount - refunded_amount), 0) AS available,
                COALESCE(SUM(amount), 0)                   AS gross,
                COALESCE(SUM(refunded_amount), 0)          AS refunded,
                COUNT(*)                                   AS settled
           FROM pix_charges
          WHERE merchant_id = ? AND status IN (${placeholders})`,
      )
      .get(merchantId, ...SETTLED_STATUSES);

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

    this.#db
      .prepare(
        `INSERT INTO merchants
           (id, name, webhook_url, webhook_secret, kyc_status, kyc_reason,
            kyc_reviewed_at, created_at, updated_at)
         VALUES (@id, @name, @webhook_url, @webhook_secret, @kyc_status,
                 @kyc_reason, @kyc_reviewed_at, @created_at, @updated_at)`,
      )
      .run(row);

    return row;
  }

  get(merchantId: string): MerchantRow {
    const row = this.#db
      .prepare<[string], MerchantRow>('SELECT * FROM merchants WHERE id = ?')
      .get(merchantId);

    if (!row) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return row;
  }

  find(merchantId: string): MerchantRow | undefined {
    return this.#db
      .prepare<[string], MerchantRow>('SELECT * FROM merchants WHERE id = ?')
      .get(merchantId);
  }

  list(): MerchantRow[] {
    return this.#db
      .prepare<[], MerchantRow>('SELECT * FROM merchants ORDER BY created_at DESC')
      .all();
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

    this.#db
      .prepare(
        `UPDATE merchants
            SET name = @name, webhook_url = @webhook_url,
                webhook_secret = @webhook_secret, updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({ ...next, id: merchantId });

    return this.get(merchantId);
  }

  delete(merchantId: string): void {
    this.get(merchantId);
    // Charges, tokens, KYC docs and deliveries cascade (see schema.sql).
    this.#db.prepare('DELETE FROM merchants WHERE id = ?').run(merchantId);
  }
}
