import { Inject, Injectable } from '@nestjs/common';

import { createHash } from 'node:crypto';

import { nowIso, type Db } from '../db/index';
import { conflict } from '../lib/errors';
import { DB } from '../tokens';

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
      .prepare<[string, string, string], { request_hash: string; response_status: number; response_body: string }>(
        `SELECT request_hash, response_status, response_body
           FROM idempotency_keys
          WHERE merchant_id = ? AND endpoint = ? AND key = ?`,
      )
      .get(lookup.merchantId, lookup.endpoint, lookup.key);

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
      .prepare(
        `INSERT OR REPLACE INTO idempotency_keys
           (key, merchant_id, endpoint, request_hash, response_status, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lookup.key,
        lookup.merchantId,
        lookup.endpoint,
        hashRequest(lookup.requestBody),
        response.status,
        JSON.stringify(response.body),
        nowIso(),
      );
  }
}
