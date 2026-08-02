import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { kycDocumentColumns, kycDocuments, merchants } from '../db/schema';
import type { KycDocumentRow, KycStatus } from './types';

/** The row as it is written: metadata plus the BLOB the reads leave behind. */
export type KycDocumentInsert = typeof kycDocuments.$inferInsert;

export interface MerchantKycPatch {
  kyc_status: KycStatus;
  kyc_reason: string | null;
  kyc_reviewed_at: string;
  updated_at: string;
}

@Injectable()
export class KycModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  insertDocument(row: KycDocumentInsert): void {
    this.db.insert(kycDocuments).values(row).run();
  }

  /** Metadata only — the BLOB is fetched separately so listings stay cheap. */
  findDocument(documentId: string): KycDocumentRow | undefined {
    return this.db
      .select(kycDocumentColumns)
      .from(kycDocuments)
      .where(eq(kycDocuments.id, documentId))
      .get();
  }

  findDocumentContent(documentId: string): Buffer | undefined {
    return this.db
      .select({ content: kycDocuments.content })
      .from(kycDocuments)
      .where(eq(kycDocuments.id, documentId))
      .get()?.content;
  }

  listDocuments(merchantId?: string): KycDocumentRow[] {
    return this.db
      .select(kycDocumentColumns)
      .from(kycDocuments)
      .where(merchantId ? eq(kycDocuments.merchant_id, merchantId) : undefined)
      .orderBy(desc(kycDocuments.created_at))
      .all();
  }

  deleteDocument(documentId: string): void {
    this.db.delete(kycDocuments).where(eq(kycDocuments.id, documentId)).run();
  }

  /** Persist two caller-defined updates atomically; the domain supplies their statuses. */
  applyReview(
    merchantId: string,
    merchant: MerchantKycPatch,
    documentStatuses: { from: KycStatus; to: KycStatus },
  ): void {
    this.db.transaction((tx) => {
      tx.update(merchants)
        .set(merchant)
        .where(eq(merchants.id, merchantId))
        .run();

      tx.update(kycDocuments)
        .set({ status: documentStatuses.to })
        .where(
          and(
            eq(kycDocuments.merchant_id, merchantId),
            eq(kycDocuments.status, documentStatuses.from),
          ),
        )
        .run();
    });
  }
}
