import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DB, FETCH, LOGGER, SCHEDULER } from '../common/injection-tokens';
import { ConfigStore } from '../config';
import { nowIso, type Db } from '../db/index';
import { merchants, pixCharges, webhookDeliveries } from '../db/schema';
import { notFound } from '../lib/errors';
import { SIGNATURE_HEADER, signPayload } from '../lib/hmac';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import type { Scheduler } from '../lib/scheduler';
import { isWebhookFailingDocument } from './testDocuments';
import type { DeliveryStatus, Scope, WebhookDeliveryRow, WebhookEvent } from './types';

const MAX_STORED_RESPONSE_CHARS = 2000;

export interface EnqueueInput {
  merchantId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
  chargeId?: string | null;
}

/**
 * Webhook delivery (specs.md:104-108). Deliveries are persisted before being attempted, so
 * the panel can show the full history, but the retry timers themselves are in-process
 * setTimeouts and are lost on restart — the documented limitation at specs.md:138.
 */
@Injectable()
export class WebhookDispatcher {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigStore,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(FETCH) private readonly fetch: typeof globalThis.fetch,
  ) {}

  /**
   * Records a delivery and schedules the first attempt after `webhookDelayMs`.
   * Returns null when the merchant has no webhook_url configured.
   */
  enqueue(input: EnqueueInput): WebhookDeliveryRow | null {
    const merchant = this.db
      .select({ webhook_url: merchants.webhook_url })
      .from(merchants)
      .where(eq(merchants.id, input.merchantId))
      .get();

    if (!merchant?.webhook_url) {
      this.log.debug(
        { merchant_id: input.merchantId, event: input.event },
        'webhook skipped: merchant has no webhook_url',
      );
      return null;
    }

    const config = this.config.current();
    const id = newId('webhookDelivery');
    const createdAt = nowIso(this.scheduler.now());
    const scheduledAt = nowIso(this.scheduler.now() + config.webhookDelayMs);

    // The body is stored verbatim because it is what gets signed — the signature must be
    // reproducible on a manual retry days later.
    const body = JSON.stringify({
      id,
      event: input.event,
      created_at: createdAt,
      data: input.data,
    });

    this.db
      .insert(webhookDeliveries)
      .values({
        id,
        merchant_id: input.merchantId,
        charge_id: input.chargeId ?? null,
        event: input.event,
        url: merchant.webhook_url,
        payload: body,
        attempt: 0,
        max_attempts: config.webhookMaxRetries,
        status: 'pending',
        scheduled_at: scheduledAt,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .run();

    this.scheduler.schedule(config.webhookDelayMs, () => this.attempt(id));

    return this.findRow(id)!;
  }

  /** Re-arms a delivery from the panel or the integration API, ignoring prior outcome. */
  retry(deliveryId: string, scope: Scope = {}): WebhookDeliveryRow {
    this.get(deliveryId, scope);

    const at = nowIso(this.scheduler.now());

    this.db
      .update(webhookDeliveries)
      .set({
        status: 'pending',
        attempt: 0,
        error: null,
        response_status: null,
        response_body: null,
        delivered_at: null,
        scheduled_at: at,
        updated_at: at,
      })
      .where(eq(webhookDeliveries.id, deliveryId))
      .run();

    this.scheduler.schedule(0, () => this.attempt(deliveryId));

    return this.findRow(deliveryId)!;
  }

  /** One delivery attempt. Reschedules itself while attempts remain. */
  async attempt(deliveryId: string): Promise<void> {
    const delivery = this.findRow(deliveryId);
    if (!delivery || delivery.status !== 'pending') return;

    const config = this.config.current();
    const attempt = delivery.attempt + 1;
    const { header, signature } = signPayload(
      this.merchantSecret(delivery.merchant_id),
      delivery.payload,
      this.scheduler.now(),
    );

    if (this.shouldForceFailure(delivery)) {
      // specs.md:101 — this CPF exists so retry handling can be exercised. No request is
      // sent; the attempt is recorded as a failure.
      this.recordFailure(delivery, attempt, signature, {
        error: 'forced_failure_test_document',
      });
      return;
    }

    try {
      const response = await this.fetch(delivery.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: header,
          'x-pseudopay-event': delivery.event,
          'x-pseudopay-delivery': delivery.id,
          'x-pseudopay-attempt': String(attempt),
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(config.webhookTimeoutMs),
      });

      const responseBody = (await response.text().catch(() => '')).slice(
        0,
        MAX_STORED_RESPONSE_CHARS,
      );

      if (response.ok) {
        const at = nowIso(this.scheduler.now());
        this.db
          .update(webhookDeliveries)
          .set({
            status: 'delivered',
            attempt,
            signature,
            response_status: response.status,
            response_body: responseBody,
            error: null,
            delivered_at: at,
            updated_at: at,
          })
          .where(eq(webhookDeliveries.id, delivery.id))
          .run();

        this.log.info(
          { delivery_id: delivery.id, event: delivery.event, attempt },
          'webhook delivered',
        );
        return;
      }

      this.recordFailure(delivery, attempt, signature, {
        responseStatus: response.status,
        responseBody,
        error: `endpoint responded ${response.status}`,
      });
    } catch (err) {
      this.recordFailure(delivery, attempt, signature, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  listForMerchant(
    merchantId: string,
    filters: { chargeId?: string; event?: string; status?: string; limit?: number } = {},
  ): WebhookDeliveryRow[] {
    return this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.merchant_id, merchantId),
          filters.chargeId ? eq(webhookDeliveries.charge_id, filters.chargeId) : undefined,
          filters.event ? eq(webhookDeliveries.event, filters.event) : undefined,
          filters.status
            ? eq(webhookDeliveries.status, filters.status as DeliveryStatus)
            : undefined,
        ),
      )
      .orderBy(desc(webhookDeliveries.created_at))
      .limit(Math.min(filters.limit ?? 50, 200))
      .all();
  }

  get(deliveryId: string, scope: Scope = {}): WebhookDeliveryRow {
    const delivery = this.findRow(deliveryId);

    if (!delivery || (scope.merchantId && delivery.merchant_id !== scope.merchantId)) {
      throw notFound('delivery_not_found', `No webhook delivery ${deliveryId}`);
    }

    return delivery;
  }

  private findRow(deliveryId: string): WebhookDeliveryRow | undefined {
    return this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId))
      .get();
  }

  private merchantSecret(merchantId: string): string {
    const row = this.db
      .select({ webhook_secret: merchants.webhook_secret })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .get();

    return row?.webhook_secret ?? '';
  }

  /**
   * Resolved per attempt rather than stored on the row, so a manual retry of a
   * `33333333333` charge still fails the way the docs promise.
   */
  private shouldForceFailure(delivery: WebhookDeliveryRow): boolean {
    if (!delivery.charge_id) return false;

    const charge = this.db
      .select({ payer_document: pixCharges.payer_document })
      .from(pixCharges)
      .where(eq(pixCharges.id, delivery.charge_id))
      .get();

    return isWebhookFailingDocument(charge?.payer_document);
  }

  private recordFailure(
    delivery: WebhookDeliveryRow,
    attempt: number,
    signature: string,
    outcome: { responseStatus?: number; responseBody?: string; error: string },
  ): void {
    const config = this.config.current();
    const exhausted = attempt >= delivery.max_attempts;
    const at = nowIso(this.scheduler.now());

    // Backoff grows with the attempt number: 1x, 2x, 3x the configured base.
    const backoffMs = config.webhookRetryBackoffMs * attempt;
    const nextAttemptAt = exhausted ? null : nowIso(this.scheduler.now() + backoffMs);

    this.db
      .update(webhookDeliveries)
      .set({
        status: exhausted ? 'failed' : 'pending',
        attempt,
        signature,
        response_status: outcome.responseStatus ?? null,
        response_body: outcome.responseBody ?? null,
        error: outcome.error,
        scheduled_at: nextAttemptAt,
        updated_at: at,
      })
      .where(eq(webhookDeliveries.id, delivery.id))
      .run();

    this.log.warn(
      {
        delivery_id: delivery.id,
        event: delivery.event,
        attempt,
        max_attempts: delivery.max_attempts,
        error: outcome.error,
      },
      exhausted ? 'webhook failed, no attempts left' : 'webhook attempt failed, will retry',
    );

    if (!exhausted) {
      this.scheduler.schedule(backoffMs, () => this.attempt(delivery.id));
    }
  }
}
