import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { pixRefunds } from '../db/schema';
import type { RefundRow } from './types';

@Injectable()
export class RefundModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(row: RefundRow): void {
    this.db.insert(pixRefunds).values(row).run();
  }

  findById(refundId: string): RefundRow | undefined {
    return this.db.select().from(pixRefunds).where(eq(pixRefunds.id, refundId)).get();
  }

  listByCharge(chargeId: string): RefundRow[] {
    return this.db
      .select()
      .from(pixRefunds)
      .where(eq(pixRefunds.charge_id, chargeId))
      .orderBy(asc(pixRefunds.created_at))
      .all();
  }
}
