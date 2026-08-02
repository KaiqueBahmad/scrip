import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DB, LOGGER } from '../common/injection-tokens';
import { ConfigStore } from '../config';
import { nowIso, type Db } from '../db/index';
import { kycDocumentColumns, kycDocuments, merchants } from '../db/schema';
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
      .insert(kycDocuments)
      .values({
        id,
        merchant_id: input.merchantId,
        type,
        filename,
        mime_type: input.mimeType || 'application/octet-stream',
        size: input.content.length,
        content: input.content,
        status: 'pending',
        created_at: at,
      })
      .run();

    this.log.info(
      { merchant_id: input.merchantId, document_id: id, size: input.content.length },
      'kyc document uploaded',
    );

    return this.getDocument(id);
  }

  /** Metadata only — the BLOB is fetched separately so listings stay cheap. */
  getDocument(documentId: string, scope: Scope = {}): KycDocumentRow {
    const row = this.db
      .select(kycDocumentColumns)
      .from(kycDocuments)
      .where(eq(kycDocuments.id, documentId))
      .get();

    if (!row || (scope.merchantId && row.merchant_id !== scope.merchantId)) {
      throw notFound('document_not_found', `No KYC document ${documentId}`);
    }

    return row;
  }

  getDocumentContent(documentId: string, scope: Scope = {}): { row: KycDocumentRow; content: Buffer } {
    const row = this.getDocument(documentId, scope);

    const blob = this.db
      .select({ content: kycDocuments.content })
      .from(kycDocuments)
      .where(eq(kycDocuments.id, documentId))
      .get();

    if (!blob) throw notFound('document_not_found', `No KYC document ${documentId}`);

    return { row, content: blob.content };
  }

  listDocuments(merchantId?: string): KycDocumentRow[] {
    return this.db
      .select(kycDocumentColumns)
      .from(kycDocuments)
      .where(merchantId ? eq(kycDocuments.merchant_id, merchantId) : undefined)
      .orderBy(desc(kycDocuments.created_at))
      .all();
  }

  deleteDocument(documentId: string, scope: Scope = {}): void {
    this.getDocument(documentId, scope);
    this.db.delete(kycDocuments).where(eq(kycDocuments.id, documentId)).run();
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

    this.db.transaction((tx) => {
      tx.update(merchants)
        .set({
          kyc_status: status,
          kyc_reason: input.reason ?? null,
          kyc_reviewed_at: at,
          updated_at: at,
        })
        .where(eq(merchants.id, input.merchantId))
        .run();

      // Documents follow the merchant-level decision, so the queue empties as it is worked.
      tx.update(kycDocuments)
        .set({ status })
        .where(
          and(
            eq(kycDocuments.merchant_id, input.merchantId),
            eq(kycDocuments.status, 'pending'),
          ),
        )
        .run();
    });

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
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .get();

    if (!merchant) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return merchant;
  }
}
