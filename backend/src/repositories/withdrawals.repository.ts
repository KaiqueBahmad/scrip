import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { withdrawals } from '../db/schema';
import type { WithdrawalRow, WithdrawalStatus } from './types';

export interface WithdrawalQuery {
  merchantId?: string;
  status?: WithdrawalStatus;
  limit?: number;
  offset?: number;
}

/** The subset of columns a status transition writes. */
export type WithdrawalPatch = Partial<typeof withdrawals.$inferInsert>;

function withdrawalFilters(query: WithdrawalQuery): SQL | undefined {
  return and(
    query.merchantId ? eq(withdrawals.merchant_id, query.merchantId) : undefined,
    query.status ? eq(withdrawals.status, query.status) : undefined,
  );
}

@Injectable()
export class WithdrawalRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(row: WithdrawalRow): void {
    this.db.insert(withdrawals).values(row).run();
  }

  findById(id: string): WithdrawalRow | undefined {
    return this.db.select().from(withdrawals).where(eq(withdrawals.id, id)).get();
  }

  update(id: string, patch: WithdrawalPatch): void {
    this.db.update(withdrawals).set(patch).where(eq(withdrawals.id, id)).run();
  }

  list(query: WithdrawalQuery = {}): WithdrawalRow[] {
    return this.db
      .select()
      .from(withdrawals)
      .where(withdrawalFilters(query))
      .orderBy(desc(withdrawals.created_at), desc(withdrawals.id))
      .limit(Math.min(query.limit ?? 50, 200))
      .offset(query.offset ?? 0)
      .all();
  }

  count(query: WithdrawalQuery = {}): number {
    const row = this.db
      .select({ total: count() })
      .from(withdrawals)
      .where(withdrawalFilters(query))
      .get();

    return row?.total ?? 0;
  }

  /**
   * Pending + confirmed: what's currently held against the merchant's available balance —
   * the payout itself plus the exit fee it was requested with.
   */
  sumHeld(merchantId: string): number {
    const row = this.db
      .select({
        total: sql<number>`COALESCE(SUM(${withdrawals.amount} + ${withdrawals.fee_amount}), 0)`,
      })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.merchant_id, merchantId),
          inArray(withdrawals.status, ['pending', 'confirmed']),
        ),
      )
      .get();

    return row?.total ?? 0;
  }

  /** Confirmed only — the informational "already withdrawn" total (gross of the exit fee). */
  sumConfirmed(merchantId: string): number {
    const row = this.db
      .select({ total: sql<number>`COALESCE(SUM(${withdrawals.amount}), 0)` })
      .from(withdrawals)
      .where(and(eq(withdrawals.merchant_id, merchantId), eq(withdrawals.status, 'confirmed')))
      .get();

    return row?.total ?? 0;
  }

  /** Confirmed only — the exit fee portion of `sumConfirmed`, broken out for transparency. */
  sumConfirmedFees(merchantId: string): number {
    const row = this.db
      .select({ total: sql<number>`COALESCE(SUM(${withdrawals.fee_amount}), 0)` })
      .from(withdrawals)
      .where(and(eq(withdrawals.merchant_id, merchantId), eq(withdrawals.status, 'confirmed')))
      .get();

    return row?.total ?? 0;
  }
}
