import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { merchants, pixCharges } from '../db/schema';
import type { ChargeStatus, MerchantRow } from './types';

/** The columns `update` is allowed to move; identity and KYC are written elsewhere. */
export interface MerchantPatch {
  name: string;
  webhook_url: string | null;
  webhook_secret: string;
  updated_at: string;
}

/** Raw sums over the charges of one merchant; the money meaning is given by MerchantService. */
export interface ChargeTotals {
  amount: number;
  refunded_amount: number;
  count: number;
}

/** What signing and addressing a webhook needs, without carrying the whole row around. */
export interface MerchantWebhookConfig {
  webhook_url: string | null;
  webhook_secret: string;
}

@Injectable()
export class MerchantModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(row: MerchantRow): void {
    this.db.insert(merchants).values(row).run();
  }

  findById(merchantId: string): MerchantRow | undefined {
    return this.db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
  }

  list(): MerchantRow[] {
    return this.db.select().from(merchants).orderBy(desc(merchants.created_at)).all();
  }

  update(merchantId: string, patch: MerchantPatch): void {
    this.db.update(merchants).set(patch).where(eq(merchants.id, merchantId)).run();
  }

  delete(merchantId: string): void {
    // Charges, tokens, KYC docs and deliveries cascade (see db/schema.ts).
    this.db.delete(merchants).where(eq(merchants.id, merchantId)).run();
  }

  findWebhookConfig(merchantId: string): MerchantWebhookConfig | undefined {
    return this.db
      .select({ webhook_url: merchants.webhook_url, webhook_secret: merchants.webhook_secret })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .get();
  }

  /** Raw charge aggregates. The domain supplies the status scope and assigns their meaning. */
  sumCharges(merchantId: string, statuses: readonly ChargeStatus[]): ChargeTotals {
    const row = this.db
      .select({
        amount: sql<number>`COALESCE(SUM(${pixCharges.amount}), 0)`,
        refunded_amount: sql<number>`COALESCE(SUM(${pixCharges.refunded_amount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(pixCharges)
      .where(
        and(eq(pixCharges.merchant_id, merchantId), inArray(pixCharges.status, [...statuses])),
      )
      .get();

    return {
      amount: row?.amount ?? 0,
      refunded_amount: row?.refunded_amount ?? 0,
      count: row?.count ?? 0,
    };
  }
}
