import type { ConfigStore } from '../config.js';
import { nowIso, type Db } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { SIGNATURE_HEADER, signPayload } from '../lib/hmac.js';
import { newId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { Scheduler } from '../lib/scheduler.js';
import type { ChargeRow, WebhookDeliveryRow, WebhookEvent } from '../types.js';
import { isWebhookFailingDocument } from './testDocuments.js';

const MAX_STORED_RESPONSE_CHARS = 2000;

export interface WebhookDispatcherDeps {
  db: Db;
  config: ConfigStore;
  scheduler: Scheduler;
  log: Logger;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

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
export class WebhookDispatcher {
  #db: Db;
  #config: ConfigStore;
  #scheduler: Scheduler;
  #log: Logger;
  #fetch: typeof fetch;

  constructor(deps: WebhookDispatcherDeps) {
    this.#db = deps.db;
    this.#config = deps.config;
    this.#scheduler = deps.scheduler;
    this.#log = deps.log;
    this.#fetch = deps.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Records a delivery and schedules the first attempt after `webhookDelayMs`.
   * Returns null when the merchant has no webhook_url configured.
   */
  enqueue(input: EnqueueInput): WebhookDeliveryRow | null {
    const merchant = this.#db
      .prepare<[string], { webhook_url: string | null }>(
        'SELECT webhook_url FROM merchants WHERE id = ?',
      )
      .get(input.merchantId);

    if (!merchant?.webhook_url) {
      this.#log.debug(
        { merchant_id: input.merchantId, event: input.event },
        'webhook skipped: merchant has no webhook_url',
      );
      return null;
    }

    const config = this.#config.current();
    const id = newId('webhookDelivery');
    const createdAt = nowIso(this.#scheduler.now());
    const scheduledAt = nowIso(this.#scheduler.now() + config.webhookDelayMs);

    // The body is stored verbatim because it is what gets signed — the signature must be
    // reproducible on a manual retry days later.
    const body = JSON.stringify({
      id,
      event: input.event,
      created_at: createdAt,
      data: input.data,
    });

    this.#db
      .prepare(
        `INSERT INTO webhook_deliveries
           (id, merchant_id, charge_id, event, url, payload, attempt, max_attempts,
            status, scheduled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        id,
        input.merchantId,
        input.chargeId ?? null,
        input.event,
        merchant.webhook_url,
        body,
        config.webhookMaxRetries,
        scheduledAt,
        createdAt,
        createdAt,
      );

    this.#scheduler.schedule(config.webhookDelayMs, () => this.attempt(id));

    return this.#get(id)!;
  }

  /** Re-arms a delivery from the panel or the integration API, ignoring prior outcome. */
  retry(deliveryId: string): WebhookDeliveryRow {
    const delivery = this.#get(deliveryId);
    if (!delivery) throw notFound('delivery_not_found', `No webhook delivery ${deliveryId}`);

    const at = nowIso(this.#scheduler.now());

    this.#db
      .prepare(
        `UPDATE webhook_deliveries
            SET status = 'pending', attempt = 0, error = NULL, response_status = NULL,
                response_body = NULL, delivered_at = NULL, scheduled_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(at, at, deliveryId);

    this.#scheduler.schedule(0, () => this.attempt(deliveryId));

    return this.#get(deliveryId)!;
  }

  /** One delivery attempt. Reschedules itself while attempts remain. */
  async attempt(deliveryId: string): Promise<void> {
    const delivery = this.#get(deliveryId);
    if (!delivery || delivery.status !== 'pending') return;

    const config = this.#config.current();
    const attempt = delivery.attempt + 1;
    const { header, signature } = signPayload(
      this.#merchantSecret(delivery.merchant_id),
      delivery.payload,
      this.#scheduler.now(),
    );

    if (this.#shouldForceFailure(delivery)) {
      // specs.md:101 — this CPF exists so retry handling can be exercised. No request is
      // sent; the attempt is recorded as a failure.
      this.#recordFailure(delivery, attempt, signature, {
        error: 'forced_failure_test_document',
      });
      return;
    }

    try {
      const response = await this.#fetch(delivery.url, {
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
        const at = nowIso(this.#scheduler.now());
        this.#db
          .prepare(
            `UPDATE webhook_deliveries
                SET status = 'delivered', attempt = ?, signature = ?, response_status = ?,
                    response_body = ?, error = NULL, delivered_at = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(attempt, signature, response.status, responseBody, at, at, delivery.id);

        this.#log.info(
          { delivery_id: delivery.id, event: delivery.event, attempt },
          'webhook delivered',
        );
        return;
      }

      this.#recordFailure(delivery, attempt, signature, {
        responseStatus: response.status,
        responseBody,
        error: `endpoint responded ${response.status}`,
      });
    } catch (err) {
      this.#recordFailure(delivery, attempt, signature, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  listForMerchant(
    merchantId: string,
    filters: { chargeId?: string; event?: string; status?: string; limit?: number } = {},
  ): WebhookDeliveryRow[] {
    const clauses = ['merchant_id = ?'];
    const params: unknown[] = [merchantId];

    if (filters.chargeId) {
      clauses.push('charge_id = ?');
      params.push(filters.chargeId);
    }
    if (filters.event) {
      clauses.push('event = ?');
      params.push(filters.event);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    params.push(Math.min(filters.limit ?? 50, 200));

    return this.#db
      .prepare<unknown[], WebhookDeliveryRow>(
        `SELECT * FROM webhook_deliveries
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params);
  }

  /** Panel surface: every merchant. */
  listAll(filters: { event?: string; status?: string; limit?: number } = {}): WebhookDeliveryRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.event) {
      clauses.push('event = ?');
      params.push(filters.event);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    params.push(Math.min(filters.limit ?? 100, 500));

    return this.#db
      .prepare<unknown[], WebhookDeliveryRow>(
        `SELECT * FROM webhook_deliveries
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params);
  }

  get(deliveryId: string): WebhookDeliveryRow {
    const delivery = this.#get(deliveryId);
    if (!delivery) throw notFound('delivery_not_found', `No webhook delivery ${deliveryId}`);
    return delivery;
  }

  #get(deliveryId: string): WebhookDeliveryRow | undefined {
    return this.#db
      .prepare<[string], WebhookDeliveryRow>('SELECT * FROM webhook_deliveries WHERE id = ?')
      .get(deliveryId);
  }

  #merchantSecret(merchantId: string): string {
    const row = this.#db
      .prepare<[string], { webhook_secret: string }>(
        'SELECT webhook_secret FROM merchants WHERE id = ?',
      )
      .get(merchantId);
    return row?.webhook_secret ?? '';
  }

  /**
   * Resolved per attempt rather than stored on the row, so a manual retry of a
   * `33333333333` charge still fails the way the docs promise.
   */
  #shouldForceFailure(delivery: WebhookDeliveryRow): boolean {
    if (!delivery.charge_id) return false;

    const charge = this.#db
      .prepare<[string], Pick<ChargeRow, 'payer_document'>>(
        'SELECT payer_document FROM pix_charges WHERE id = ?',
      )
      .get(delivery.charge_id);

    return isWebhookFailingDocument(charge?.payer_document);
  }

  #recordFailure(
    delivery: WebhookDeliveryRow,
    attempt: number,
    signature: string,
    outcome: { responseStatus?: number; responseBody?: string; error: string },
  ): void {
    const config = this.#config.current();
    const exhausted = attempt >= delivery.max_attempts;
    const at = nowIso(this.#scheduler.now());

    // Backoff grows with the attempt number: 1x, 2x, 3x the configured base.
    const backoffMs = config.webhookRetryBackoffMs * attempt;
    const nextAttemptAt = exhausted ? null : nowIso(this.#scheduler.now() + backoffMs);

    this.#db
      .prepare(
        `UPDATE webhook_deliveries
            SET status = ?, attempt = ?, signature = ?, response_status = ?, response_body = ?,
                error = ?, scheduled_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        exhausted ? 'failed' : 'pending',
        attempt,
        signature,
        outcome.responseStatus ?? null,
        outcome.responseBody ?? null,
        outcome.error,
        nextAttemptAt,
        at,
        delivery.id,
      );

    this.#log.warn(
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
      this.#scheduler.schedule(backoffMs, () => this.attempt(delivery.id));
    }
  }
}
