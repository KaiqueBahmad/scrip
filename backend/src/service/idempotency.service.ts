import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { nowIso } from '../db/index';
import { conflict } from '../lib/errors';
import { IdempotencyRepository } from '../repositories';

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
 * Idempotency-Key replay cache: the semantics match what a real gateway does: the same key with
 * the same body replays the stored response; the same key with a different body is a
 * conflict rather than a silent second charge.
 */
@Injectable()
export class IdempotencyStore {
  constructor(private readonly keys: IdempotencyRepository) {}

  find(lookup: IdempotencyLookup): StoredResponse | undefined {
    const row = this.keys.find(lookup);

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
    this.keys.upsert({
      key: lookup.key,
      merchant_id: lookup.merchantId,
      endpoint: lookup.endpoint,
      request_hash: hashRequest(lookup.requestBody),
      response_status: response.status,
      response_body: JSON.stringify(response.body),
      created_at: nowIso(),
    });
  }
}
