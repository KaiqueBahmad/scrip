import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { webhookDeliveries } from '../db/schema';
import type { DeliveryStatus, WebhookDeliveryRow } from './types';

export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert;

/** What one attempt (or a manual retry) writes back onto the delivery. */
export type WebhookDeliveryPatch = Partial<WebhookDeliveryInsert>;

export interface DeliveryQuery {
  chargeId?: string;
  event?: string;
  status?: string;
  limit?: number;
}

@Injectable()
export class WebhookDeliveryModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(row: WebhookDeliveryInsert): void {
    this.db.insert(webhookDeliveries).values(row).run();
  }

  findById(deliveryId: string): WebhookDeliveryRow | undefined {
    return this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId))
      .get();
  }

  update(deliveryId: string, patch: WebhookDeliveryPatch): void {
    this.db
      .update(webhookDeliveries)
      .set(patch)
      .where(eq(webhookDeliveries.id, deliveryId))
      .run();
  }

  listForMerchant(merchantId: string, query: DeliveryQuery = {}): WebhookDeliveryRow[] {
    return this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.merchant_id, merchantId),
          query.chargeId ? eq(webhookDeliveries.charge_id, query.chargeId) : undefined,
          query.event ? eq(webhookDeliveries.event, query.event) : undefined,
          query.status
            ? eq(webhookDeliveries.status, query.status as DeliveryStatus)
            : undefined,
        ),
      )
      .orderBy(desc(webhookDeliveries.created_at))
      .limit(Math.min(query.limit ?? 50, 200))
      .all();
  }
}
