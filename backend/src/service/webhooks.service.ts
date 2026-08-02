import { Inject, Injectable } from '@nestjs/common';

import { FETCH, LOGGER, SCHEDULER } from '../common/injection-tokens';
import { ConfigStore } from '../config';
import { nowIso } from '../db/index';
import { notFound } from '../lib/errors';
import { SIGNATURE_HEADER, signPayload } from '../lib/hmac';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import type { Scheduler } from '../lib/scheduler';
import { ChargeRepository, MerchantRepository, WebhookDeliveryRepository, type DeliveryQuery } from '../repositories';
import type { Scope, WebhookDeliveryRow, WebhookEvent } from '../repositories/types';
import { isWebhookFailingDocument } from './testDocuments.service';

const MAX_STORED_RESPONSE_CHARS = 2000;

export interface EnqueueInput {
  merchantId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
  chargeId?: string | null;
}

/**
 * Webhook delivery. Deliveries are persisted before being attempted, so
 * the panel can show the full history, but the retry timers themselves are in-process
 * setTimeouts and are lost on restart
 */
@Injectable()
export class WebhookDispatcher {
  constructor(
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly merchants: MerchantRepository,
    private readonly charges: ChargeRepository,
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
    const merchant = this.merchants.findWebhookConfig(input.merchantId);

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

    this.deliveries.insert({
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
    });

    this.scheduler.schedule(config.webhookDelayMs, () => this.attempt(id));

    return this.deliveries.findById(id)!;
  }

  /** Re-arms a delivery from the panel or the integration API, ignoring prior outcome. */
  retry(deliveryId: string, scope: Scope = {}): WebhookDeliveryRow {
    this.get(deliveryId, scope);

    const at = nowIso(this.scheduler.now());

    this.deliveries.update(deliveryId, {
      status: 'pending',
      attempt: 0,
      error: null,
      response_status: null,
      response_body: null,
      delivered_at: null,
      scheduled_at: at,
      updated_at: at,
    });

    this.scheduler.schedule(0, () => this.attempt(deliveryId));

    return this.deliveries.findById(deliveryId)!;
  }

  /** One delivery attempt. Reschedules itself while attempts remain. */
  async attempt(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.findById(deliveryId);
    if (!delivery || delivery.status !== 'pending') return;

    const config = this.config.current();
    const attempt = delivery.attempt + 1;
    const { header, signature } = signPayload(
      this.merchants.findWebhookConfig(delivery.merchant_id)?.webhook_secret ?? '',
      delivery.payload,
      this.scheduler.now(),
    );

    if (this.shouldForceFailure(delivery)) {
      // This CPF exists so retry handling can be exercised. No request is sent; the
      // attempt is recorded as a failure.
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
        this.deliveries.update(delivery.id, {
          status: 'delivered',
          attempt,
          signature,
          response_status: response.status,
          response_body: responseBody,
          error: null,
          delivered_at: at,
          updated_at: at,
        });

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

  listForMerchant(merchantId: string, filters: DeliveryQuery = {}): WebhookDeliveryRow[] {
    return this.deliveries.listForMerchant(merchantId, filters);
  }

  get(deliveryId: string, scope: Scope = {}): WebhookDeliveryRow {
    const delivery = this.deliveries.findById(deliveryId);

    if (!delivery || (scope.merchantId && delivery.merchant_id !== scope.merchantId)) {
      throw notFound('delivery_not_found', `No webhook delivery ${deliveryId}`);
    }

    return delivery;
  }

  /**
   * Resolved per attempt rather than stored on the row, so a manual retry of a
   * `33333333333` charge still fails
   */
  private shouldForceFailure(delivery: WebhookDeliveryRow): boolean {
    if (!delivery.charge_id) return false;

    return isWebhookFailingDocument(this.charges.findPayerDocument(delivery.charge_id));
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

    this.deliveries.update(delivery.id, {
      status: exhausted ? 'failed' : 'pending',
      attempt,
      signature,
      response_status: outcome.responseStatus ?? null,
      response_body: outcome.responseBody ?? null,
      error: outcome.error,
      scheduled_at: nextAttemptAt,
      updated_at: at,
    });

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
