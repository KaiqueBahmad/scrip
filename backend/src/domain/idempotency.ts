import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { DB } from '../common/injection-tokens';
import { nowIso, type Db } from '../db/index';
import { idempotencyKeys } from '../db/schema';
import { conflict } from '../lib/errors';

export interface IdempotencyLookup {
  key: string;
  merchantId: string;
  endpoint: string;
  requestBody: unknown;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/**
 * Idempotency-Key replay cache. Testing idempotency is one of the stated reasons this tool
 * exists (specs.md:15), so the semantics match what a real gateway does: the same key with
 * the same body replays the stored response; the same key with a different body is a
 * conflict rather than a silent second charge.
 */
@Injectable()
export class IdempotencyStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  find(lookup: IdempotencyLookup): StoredResponse | undefined {
    const row = this.db
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

    if (!row) return undefined;

    if (row.request_hash !== hashRequest(lookup.requestBody)) {
      throw conflict(
        'idempotency_key_reused',
        `Idempotency-Key "${lookup.key}" was already used with a different request body`,
        { key: lookup.key },
      );
    }

    return { status: row.response_status, body: JSON.parse(row.response_body) as unknown };
  }

  store(lookup: IdempotencyLookup, response: StoredResponse): void {
    this.db
      .insert(idempotencyKeys)
      .values({
        key: lookup.key,
        merchant_id: lookup.merchantId,
        endpoint: lookup.endpoint,
        request_hash: hashRequest(lookup.requestBody),
        response_status: response.status,
        response_body: JSON.stringify(response.body),
        created_at: nowIso(),
      })
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
