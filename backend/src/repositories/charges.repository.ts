import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, getTableColumns, gte, lte, type SQL } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { chargeEvents, charges, pixChargeDetails } from '../db/schema';
import type { ChargeEventRow, ChargeRow, ChargeStatus } from './types';

export interface ChargeQuery {
  merchantId?: string;
  status?: ChargeStatus;
  /** ISO date-time lower bound on created_at, inclusive. */
  from?: string;
  /** ISO date-time upper bound on created_at, inclusive. */
  to?: string;
  limit?: number;
  offset?: number;
}

/** The subset of generic columns a status transition writes. */
export type ChargePatch = Partial<typeof charges.$inferInsert>;

/** The subset of PIX-only columns a status transition writes (currently just e2e_id). */
export type PixDetailsPatch = Partial<typeof pixChargeDetails.$inferInsert>;

const chargeWithPixColumns = {
  ...getTableColumns(charges),
  qr_code: pixChargeDetails.qr_code,
  qr_code_txid: pixChargeDetails.qr_code_txid,
  qr_code_expires_at: pixChargeDetails.qr_code_expires_at,
  e2e_id: pixChargeDetails.e2e_id,
};

/**
 * The WHERE shared by `list` and `count`. `and` drops the undefined branches, so an absent
 * filter simply contributes nothing.
 */
function chargeFilters(query: ChargeQuery, options: { dateRange: boolean }): SQL | undefined {
  return and(
    query.merchantId ? eq(charges.merchant_id, query.merchantId) : undefined,
    query.status ? eq(charges.status, query.status) : undefined,
    options.dateRange && query.from ? gte(charges.created_at, query.from) : undefined,
    options.dateRange && query.to ? lte(charges.created_at, query.to) : undefined,
  );
}

@Injectable()
export class ChargeRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** A charge, its PIX details and the event that opened it are written together or not at all. */
  insert(row: ChargeRow, event: ChargeEventRow): void {
    const { qr_code, qr_code_txid, qr_code_expires_at, e2e_id, ...chargeFields } = row;

    this.db.transaction((tx) => {
      tx.insert(charges).values(chargeFields).run();
      tx.insert(pixChargeDetails)
        .values({ charge_id: row.id, qr_code, qr_code_txid, qr_code_expires_at, e2e_id })
        .run();
      tx.insert(chargeEvents).values(event).run();
    });
  }

  /** Same deal for every later transition: the row(s) move and the log grows atomically. */
  updateWithEvent(
    chargeId: string,
    patch: ChargePatch,
    event: ChargeEventRow,
    pixPatch?: PixDetailsPatch,
  ): void {
    this.db.transaction((tx) => {
      if (Object.keys(patch).length > 0) {
        tx.update(charges).set(patch).where(eq(charges.id, chargeId)).run();
      }
      if (pixPatch && Object.keys(pixPatch).length > 0) {
        tx.update(pixChargeDetails)
          .set(pixPatch)
          .where(eq(pixChargeDetails.charge_id, chargeId))
          .run();
      }
      tx.insert(chargeEvents).values(event).run();
    });
  }

  findById(chargeId: string): ChargeRow | undefined {
    return this.db
      .select(chargeWithPixColumns)
      .from(charges)
      .innerJoin(pixChargeDetails, eq(pixChargeDetails.charge_id, charges.id))
      .where(eq(charges.id, chargeId))
      .get();
  }

  list(query: ChargeQuery = {}): ChargeRow[] {
    return this.db
      .select(chargeWithPixColumns)
      .from(charges)
      .innerJoin(pixChargeDetails, eq(pixChargeDetails.charge_id, charges.id))
      .where(chargeFilters(query, { dateRange: true }))
      .orderBy(desc(charges.created_at), desc(charges.id))
      .limit(Math.min(query.limit ?? 50, 200))
      .offset(query.offset ?? 0)
      .all();
  }

  // Note: the date range is not applied here, matching the SQL this replaced. A `total`
  // taken with from/to set therefore counts more rows than `list` returns.
  count(query: ChargeQuery = {}): number {
    const row = this.db
      .select({ total: count() })
      .from(charges)
      .where(chargeFilters(query, { dateRange: false }))
      .get();

    return row?.total ?? 0;
  }

  listByStatus(status: ChargeStatus): ChargeRow[] {
    return this.db
      .select(chargeWithPixColumns)
      .from(charges)
      .innerJoin(pixChargeDetails, eq(pixChargeDetails.charge_id, charges.id))
      .where(eq(charges.status, status))
      .all();
  }

  listEvents(chargeId: string): ChargeEventRow[] {
    return this.db
      .select()
      .from(chargeEvents)
      .where(eq(chargeEvents.charge_id, chargeId))
      .orderBy(asc(chargeEvents.created_at), asc(chargeEvents.id))
      .all();
  }

  findPayerDocument(chargeId: string): string | null | undefined {
    return this.db
      .select({ payer_document: charges.payer_document })
      .from(charges)
      .where(eq(charges.id, chargeId))
      .get()?.payer_document;
  }
}
