import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { chargeEvents, pixCharges } from '../db/schema';
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

/** The subset of columns a status transition writes. */
export type ChargePatch = Partial<typeof pixCharges.$inferInsert>;

/**
 * The WHERE shared by `list` and `count`. `and` drops the undefined branches, so an absent
 * filter simply contributes nothing.
 */
function chargeFilters(query: ChargeQuery, options: { dateRange: boolean }): SQL | undefined {
  return and(
    query.merchantId ? eq(pixCharges.merchant_id, query.merchantId) : undefined,
    query.status ? eq(pixCharges.status, query.status) : undefined,
    options.dateRange && query.from ? gte(pixCharges.created_at, query.from) : undefined,
    options.dateRange && query.to ? lte(pixCharges.created_at, query.to) : undefined,
  );
}

@Injectable()
export class ChargeModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** A charge and the event that opened it are written together or not at all. */
  insert(row: ChargeRow, event: ChargeEventRow): void {
    this.db.transaction((tx) => {
      tx.insert(pixCharges).values(row).run();
      tx.insert(chargeEvents).values(event).run();
    });
  }

  /** Same deal for every later transition: the row moves and the log grows atomically. */
  updateWithEvent(chargeId: string, patch: ChargePatch, event: ChargeEventRow): void {
    this.db.transaction((tx) => {
      tx.update(pixCharges).set(patch).where(eq(pixCharges.id, chargeId)).run();
      tx.insert(chargeEvents).values(event).run();
    });
  }

  findById(chargeId: string): ChargeRow | undefined {
    return this.db.select().from(pixCharges).where(eq(pixCharges.id, chargeId)).get();
  }

  list(query: ChargeQuery = {}): ChargeRow[] {
    return this.db
      .select()
      .from(pixCharges)
      .where(chargeFilters(query, { dateRange: true }))
      .orderBy(desc(pixCharges.created_at), desc(pixCharges.id))
      .limit(Math.min(query.limit ?? 50, 200))
      .offset(query.offset ?? 0)
      .all();
  }

  // Note: the date range is not applied here, matching the SQL this replaced. A `total`
  // taken with from/to set therefore counts more rows than `list` returns.
  count(query: ChargeQuery = {}): number {
    const row = this.db
      .select({ total: count() })
      .from(pixCharges)
      .where(chargeFilters(query, { dateRange: false }))
      .get();

    return row?.total ?? 0;
  }

  listByStatus(status: ChargeStatus): ChargeRow[] {
    return this.db.select().from(pixCharges).where(eq(pixCharges.status, status)).all();
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
      .select({ payer_document: pixCharges.payer_document })
      .from(pixCharges)
      .where(eq(pixCharges.id, chargeId))
      .get()?.payer_document;
  }
}
