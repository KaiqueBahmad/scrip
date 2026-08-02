import { Inject, Injectable } from '@nestjs/common';

import { DB, LOGGER } from '../common/injection-tokens';
import { ConfigStore } from '../config';
import { nowIso, type Db } from '../db/index';
import { badRequest, notFound, payloadTooLarge } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { serializeMerchant } from './serialize';
import type { KycDocumentRow, KycStatus, MerchantRow, Scope } from './types';
import { WebhookDispatcher } from './webhooks';

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

/**
 * KYC (specs.md:149). Documents are stored as BLOBs in SQLite — no S3, no disk
 * (specs.md:25) — and approval is a manual action taken from the panel.
 */
@Injectable()
export class KycService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigStore,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  upload(input: UploadKycInput): KycDocumentRow {
    const maxBytes = this.config.get('kycMaxFileSizeMb') * 1024 * 1024;

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

    this.requireMerchant(input.merchantId);

    const at = nowIso();
    const id = newId('kycDocument');

    this.db
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

    this.log.info(
      { merchant_id: input.merchantId, document_id: id, size: input.content.length },
      'kyc document uploaded',
    );

    return this.getDocument(id);
  }

  /** Metadata only — the BLOB is fetched separately so listings stay cheap. */
  getDocument(documentId: string, scope: Scope = {}): KycDocumentRow {
    const row = this.db
      .prepare<[string], KycDocumentRow>(
        `SELECT id, merchant_id, type, filename, mime_type, size, status, created_at
           FROM kyc_documents WHERE id = ?`,
      )
      .get(documentId);

    if (!row || (scope.merchantId && row.merchant_id !== scope.merchantId)) {
      throw notFound('document_not_found', `No KYC document ${documentId}`);
    }

    return row;
  }

  getDocumentContent(documentId: string, scope: Scope = {}): { row: KycDocumentRow; content: Buffer } {
    const row = this.getDocument(documentId, scope);

    const blob = this.db
      .prepare<[string], { content: Buffer }>('SELECT content FROM kyc_documents WHERE id = ?')
      .get(documentId);

    if (!blob) throw notFound('document_not_found', `No KYC document ${documentId}`);

    return { row, content: blob.content };
  }

  listDocuments(merchantId?: string): KycDocumentRow[] {
    const columns = `id, merchant_id, type, filename, mime_type, size, status, created_at`;

    if (merchantId) {
      return this.db
        .prepare<[string], KycDocumentRow>(
          `SELECT ${columns} FROM kyc_documents WHERE merchant_id = ? ORDER BY created_at DESC`,
        )
        .all(merchantId);
    }

    return this.db
      .prepare<[], KycDocumentRow>(
        `SELECT ${columns} FROM kyc_documents ORDER BY created_at DESC`,
      )
      .all();
  }

  deleteDocument(documentId: string, scope: Scope = {}): void {
    this.getDocument(documentId, scope);
    this.db.prepare('DELETE FROM kyc_documents WHERE id = ?').run(documentId);
  }

  approve(input: ReviewKycInput): MerchantRow {
    return this.review(input, 'approved');
  }

  reject(input: ReviewKycInput): MerchantRow {
    return this.review(input, 'rejected');
  }

  private review(input: ReviewKycInput, status: Extract<KycStatus, 'approved' | 'rejected'>): MerchantRow {
    this.requireMerchant(input.merchantId);

    const at = nowIso();

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE merchants
              SET kyc_status = ?, kyc_reason = ?, kyc_reviewed_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(status, input.reason ?? null, at, at, input.merchantId);

      // Documents follow the merchant-level decision, so the queue empties as it is worked.
      this.db
        .prepare(`UPDATE kyc_documents SET status = ? WHERE merchant_id = ? AND status = 'pending'`)
        .run(status, input.merchantId);
    })();

    const merchant = this.requireMerchant(input.merchantId);

    this.webhooks.enqueue({
      merchantId: merchant.id,
      event: status === 'approved' ? 'kyc.approved' : 'kyc.rejected',
      data: {
        merchant: serializeMerchant(merchant),
        reason: input.reason ?? null,
      },
    });

    this.log.info({ merchant_id: merchant.id, kyc_status: status }, 'kyc reviewed');

    return merchant;
  }

  private requireMerchant(merchantId: string): MerchantRow {
    const merchant = this.db
      .prepare<[string], MerchantRow>('SELECT * FROM merchants WHERE id = ?')
      .get(merchantId);

    if (!merchant) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return merchant;
  }
}
