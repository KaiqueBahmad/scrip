import { nowIso, type Db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId, newWebhookSecret } from '../lib/ids.js';
import type { MerchantRow } from '../types.js';

export interface CreateMerchantInput {
  name: string;
  document?: string | null;
  webhookUrl?: string | null;
  /** Supply to pin a known secret in tests; otherwise one is generated. */
  webhookSecret?: string;
}

export interface UpdateMerchantInput {
  name?: string;
  document?: string | null;
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

export class MerchantService {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  create(input: CreateMerchantInput): MerchantRow {
    const name = input.name?.trim();
    if (!name) throw badRequest('invalid_name', 'name is required');

    assertValidWebhookUrl(input.webhookUrl);

    const at = nowIso();
    const row: MerchantRow = {
      id: newId('merchant'),
      name,
      document: input.document ?? null,
      webhook_url: input.webhookUrl ?? null,
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
           (id, name, document, webhook_url, webhook_secret, kyc_status, kyc_reason,
            kyc_reviewed_at, created_at, updated_at)
         VALUES (@id, @name, @document, @webhook_url, @webhook_secret, @kyc_status,
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
      document: input.document === undefined ? current.document : input.document,
      webhook_url: input.webhookUrl === undefined ? current.webhook_url : input.webhookUrl,
      webhook_secret: input.rotateWebhookSecret ? newWebhookSecret() : current.webhook_secret,
      updated_at: nowIso(),
    };

    this.#db
      .prepare(
        `UPDATE merchants
            SET name = @name, document = @document, webhook_url = @webhook_url,
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
