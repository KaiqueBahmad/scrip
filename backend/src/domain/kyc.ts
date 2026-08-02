import { Inject, Injectable } from '@nestjs/common';

import { LOGGER } from '../common/injection-tokens';
import { ConfigStore } from '../config';
import { nowIso } from '../db/index';
import { badRequest, notFound, payloadTooLarge } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { KycRepository, MerchantRepository } from '../repositories';
import type { KycDocumentRow, KycStatus, MerchantRow, Scope } from '../repositories/types';
import { serializeMerchant } from './serialize';
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
    private readonly documents: KycRepository,
    private readonly merchants: MerchantRepository,
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

    this.documents.insertDocument({
      id,
      merchant_id: input.merchantId,
      type,
      filename,
      mime_type: input.mimeType || 'application/octet-stream',
      size: input.content.length,
      content: input.content,
      status: 'pending',
      created_at: at,
    });

    this.log.info(
      { merchant_id: input.merchantId, document_id: id, size: input.content.length },
      'kyc document uploaded',
    );

    return this.getDocument(id);
  }

  /** Metadata only — the BLOB is fetched separately so listings stay cheap. */
  getDocument(documentId: string, scope: Scope = {}): KycDocumentRow {
    const row = this.documents.findDocument(documentId);

    if (!row || (scope.merchantId && row.merchant_id !== scope.merchantId)) {
      throw notFound('document_not_found', `No KYC document ${documentId}`);
    }

    return row;
  }

  getDocumentContent(documentId: string, scope: Scope = {}): { row: KycDocumentRow; content: Buffer } {
    const row = this.getDocument(documentId, scope);
    const content = this.documents.findDocumentContent(documentId);

    if (!content) throw notFound('document_not_found', `No KYC document ${documentId}`);

    return { row, content };
  }

  listDocuments(merchantId?: string): KycDocumentRow[] {
    return this.documents.listDocuments(merchantId);
  }

  deleteDocument(documentId: string, scope: Scope = {}): void {
    this.getDocument(documentId, scope);
    this.documents.deleteDocument(documentId);
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
    this.documents.applyReview(
      input.merchantId,
      {
        kyc_status: status,
        kyc_reason: input.reason ?? null,
        kyc_reviewed_at: at,
        updated_at: at,
      },
      { from: 'pending', to: status },
    );

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
    const merchant = this.merchants.findById(merchantId);

    if (!merchant) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return merchant;
  }
}
