import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { idempotencyKeys } from '../db/schema';

export type IdempotencyRow = typeof idempotencyKeys.$inferInsert;

/** The columns a replay needs: the fingerprint to compare and the response to hand back. */
export interface StoredEntry {
  request_hash: string;
  response_status: number;
  response_body: string;
}

export interface IdempotencyKey {
  key: string;
  merchantId: string;
  endpoint: string;
}

@Injectable()
export class IdempotencyModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  find(lookup: IdempotencyKey): StoredEntry | undefined {
    return this.db
      .select({
        request_hash: idempotencyKeys.request_hash,
        response_status: idempotencyKeys.response_status,
        response_body: idempotencyKeys.response_body,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.merchant_id, lookup.merchantId),
          eq(idempotencyKeys.endpoint, lookup.endpoint),
          eq(idempotencyKeys.key, lookup.key),
        ),
      )
      .get();
  }

  upsert(row: IdempotencyRow): void {
    this.db
      .insert(idempotencyKeys)
      .values(row)
      .onConflictDoUpdate({
        target: [idempotencyKeys.merchant_id, idempotencyKeys.endpoint, idempotencyKeys.key],
        set: {
          request_hash: sql`excluded.request_hash`,
          response_status: sql`excluded.response_status`,
          response_body: sql`excluded.response_body`,
          created_at: sql`excluded.created_at`,
        },
      })
      .run();
  }
}
