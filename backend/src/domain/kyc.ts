import type { ConfigStore } from '../config.js';
import { nowIso, type Db } from '../db/index.js';
import { badRequest, notFound, payloadTooLarge } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { KycDocumentRow, KycStatus, MerchantRow } from '../types.js';
import { serializeMerchant } from './serialize.js';
import type { WebhookDispatcher } from './webhooks.js';

/** Document kinds the panel offers. Free-form strings are accepted too. */
export const KYC_DOCUMENT_TYPES = [
  'identity',
  'proof_of_address',
  'company_registration',
  'bank_statement',
  'other',
] as const;

export interface UploadKycInput {
  merchantId: string;
  type: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface ReviewKycInput {
  merchantId: string;
  reason?: string | null;
}

export interface KycServiceDeps {
  db: Db;
  config: ConfigStore;
  log: Logger;
  webhooks: WebhookDispatcher;
}

/**
 * KYC (specs.md:149). Documents are stored as BLOBs in SQLite — no S3, no disk
 * (specs.md:25) — and approval is a manual action taken from the panel.
 */
export class KycService {
  #db: Db;
  #config: ConfigStore;
  #log: Logger;
  #webhooks: WebhookDispatcher;

  constructor(deps: KycServiceDeps) {
    this.#db = deps.db;
    this.#config = deps.config;
    this.#log = deps.log;
    this.#webhooks = deps.webhooks;
  }

  upload(input: UploadKycInput): KycDocumentRow {
    const maxBytes = this.#config.get('kycMaxFileSizeMb') * 1024 * 1024;

    if (input.content.length === 0) {
      throw badRequest('empty_document', 'The uploaded document is empty');
    }

    if (input.content.length > maxBytes) {
      throw payloadTooLarge(
        'document_too_large',
        `Document is ${input.content.length} bytes; the limit is ${maxBytes}`,
        { size: input.content.length, max_size: maxBytes },
      );
    }

    const filename = input.filename?.trim();
    if (!filename) throw badRequest('invalid_filename', 'filename is required');

    const type = input.type?.trim() || 'other';

    this.#requireMerchant(input.merchantId);

    const at = nowIso();
    const id = newId('kycDocument');

    this.#db
      .prepare(
        `INSERT INTO kyc_documents
           (id, merchant_id, type, filename, mime_type, size, content, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        id,
        input.merchantId,
        type,
        filename,
        input.mimeType || 'application/octet-stream',
        input.content.length,
        input.content,
        at,
      );

    this.#log.info(
      { merchant_id: input.merchantId, document_id: id, size: input.content.length },
      'kyc document uploaded',
    );

    return this.getDocument(id);
  }

  /** Metadata only — the BLOB is fetched separately so listings stay cheap. */
  getDocument(documentId: string): KycDocumentRow {
    const row = this.#db
      .prepare<[string], KycDocumentRow>(
        `SELECT id, merchant_id, type, filename, mime_type, size, status, created_at
           FROM kyc_documents WHERE id = ?`,
      )
      .get(documentId);

    if (!row) throw notFound('document_not_found', `No KYC document ${documentId}`);
    return row;
  }

  getDocumentContent(documentId: string): { row: KycDocumentRow; content: Buffer } {
    const row = this.getDocument(documentId);

    const blob = this.#db
      .prepare<[string], { content: Buffer }>('SELECT content FROM kyc_documents WHERE id = ?')
      .get(documentId);

    if (!blob) throw notFound('document_not_found', `No KYC document ${documentId}`);

    return { row, content: blob.content };
  }

  listDocuments(merchantId?: string): KycDocumentRow[] {
    const columns = `id, merchant_id, type, filename, mime_type, size, status, created_at`;

    if (merchantId) {
      return this.#db
        .prepare<[string], KycDocumentRow>(
          `SELECT ${columns} FROM kyc_documents WHERE merchant_id = ? ORDER BY created_at DESC`,
        )
        .all(merchantId);
    }

    return this.#db
      .prepare<[], KycDocumentRow>(
        `SELECT ${columns} FROM kyc_documents ORDER BY created_at DESC`,
      )
      .all();
  }

  deleteDocument(documentId: string): void {
    this.getDocument(documentId);
    this.#db.prepare('DELETE FROM kyc_documents WHERE id = ?').run(documentId);
  }

  approve(input: ReviewKycInput): MerchantRow {
    return this.#review(input, 'approved');
  }

  reject(input: ReviewKycInput): MerchantRow {
    return this.#review(input, 'rejected');
  }

  /** Merchants whose KYC still needs a decision — the panel's review queue. */
  pendingMerchants(): MerchantRow[] {
    return this.#db
      .prepare<[], MerchantRow>(
        `SELECT * FROM merchants WHERE kyc_status = 'pending' ORDER BY created_at ASC`,
      )
      .all();
  }

  #review(input: ReviewKycInput, status: Extract<KycStatus, 'approved' | 'rejected'>): MerchantRow {
    this.#requireMerchant(input.merchantId);

    const at = nowIso();

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE merchants
              SET kyc_status = ?, kyc_reason = ?, kyc_reviewed_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(status, input.reason ?? null, at, at, input.merchantId);

      // Documents follow the merchant-level decision, so the queue empties as it is worked.
      this.#db
        .prepare(`UPDATE kyc_documents SET status = ? WHERE merchant_id = ? AND status = 'pending'`)
        .run(status, input.merchantId);
    })();

    const merchant = this.#requireMerchant(input.merchantId);

    this.#webhooks.enqueue({
      merchantId: merchant.id,
      event: status === 'approved' ? 'kyc.approved' : 'kyc.rejected',
      data: {
        merchant: serializeMerchant(merchant),
        reason: input.reason ?? null,
      },
    });

    this.#log.info({ merchant_id: merchant.id, kyc_status: status }, 'kyc reviewed');

    return merchant;
  }

  #requireMerchant(merchantId: string): MerchantRow {
    const merchant = this.#db
      .prepare<[string], MerchantRow>('SELECT * FROM merchants WHERE id = ?')
      .get(merchantId);

    if (!merchant) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return merchant;
  }
}
