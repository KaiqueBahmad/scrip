import { nowIso, type Db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import { generateE2eId } from '../lib/pix.js';
import type { Scheduler } from '../lib/scheduler.js';
import type { RefundRow } from '../types.js';
import type { ChargeService } from './charges.js';
import { serializeCharge, serializeRefund } from './serialize.js';
import type { WebhookDispatcher } from './webhooks.js';

export interface CreateRefundInput {
  chargeId: string;
  /** Integer centavos. Omit to refund everything still outstanding. */
  amount?: number | null;
  reason?: string | null;
  /** Restricts the charge lookup to one merchant on the integration surface. */
  merchantId?: string;
}

export interface RefundServiceDeps {
  db: Db;
  scheduler: Scheduler;
  log: Logger;
  charges: ChargeService;
  webhooks: WebhookDispatcher;
}

/**
 * Refunds own the pix_refunds ledger; the charge's own status and refunded_amount are moved
 * by ChargeService.applyRefund so all status writes stay in the state machine.
 */
export class RefundService {
  #db: Db;
  #scheduler: Scheduler;
  #log: Logger;
  #charges: ChargeService;
  #webhooks: WebhookDispatcher;

  constructor(deps: RefundServiceDeps) {
    this.#db = deps.db;
    this.#scheduler = deps.scheduler;
    this.#log = deps.log;
    this.#charges = deps.charges;
    this.#webhooks = deps.webhooks;
  }

  create(input: CreateRefundInput): RefundRow {
    const charge = this.#charges.get(input.chargeId, { merchantId: input.merchantId });

    if (charge.status !== 'paid' && charge.status !== 'partially_refunded') {
      throw conflict(
        'charge_not_refundable',
        `Charge ${charge.id} is ${charge.status}; only paid charges can be refunded`,
        { charge_id: charge.id, status: charge.status },
      );
    }

    const outstanding = charge.amount - charge.refunded_amount;
    const amount = input.amount ?? outstanding;

    if (!Number.isInteger(amount) || amount <= 0) {
      throw badRequest('invalid_amount', 'amount must be a positive integer number of centavos', {
        amount,
      });
    }

    if (amount > outstanding) {
      throw badRequest(
        'refund_exceeds_charge',
        `Refund of ${amount} exceeds the ${outstanding} still refundable on this charge`,
        { amount, outstanding, charge_amount: charge.amount, already_refunded: charge.refunded_amount },
      );
    }

    const refund: RefundRow = {
      id: newId('refund'),
      charge_id: charge.id,
      merchant_id: charge.merchant_id,
      amount,
      status: 'succeeded',
      reason: input.reason ?? null,
      e2e_id: generateE2eId(new Date(this.#scheduler.now())),
      created_at: nowIso(this.#scheduler.now()),
    };

    this.#db
      .prepare(
        `INSERT INTO pix_refunds (id, charge_id, merchant_id, amount, status, reason, e2e_id, created_at)
         VALUES (@id, @charge_id, @merchant_id, @amount, @status, @reason, @e2e_id, @created_at)`,
      )
      .run(refund);

    const updatedCharge = this.#charges.applyRefund(charge.id, amount);

    this.#webhooks.enqueue({
      merchantId: charge.merchant_id,
      event: 'pix.charge.refunded',
      chargeId: charge.id,
      data: { charge: serializeCharge(updatedCharge), refund: serializeRefund(refund) },
    });

    this.#log.info(
      { charge_id: charge.id, refund_id: refund.id, amount, status: updatedCharge.status },
      'pix charge refunded',
    );

    return refund;
  }

  list(chargeId: string, scope: { merchantId?: string } = {}): RefundRow[] {
    // Runs the scoped charge lookup first so a foreign charge id 404s consistently.
    this.#charges.get(chargeId, scope);

    return this.#db
      .prepare<[string], RefundRow>(
        'SELECT * FROM pix_refunds WHERE charge_id = ? ORDER BY created_at ASC',
      )
      .all(chargeId);
  }

  get(refundId: string): RefundRow {
    const row = this.#db
      .prepare<[string], RefundRow>('SELECT * FROM pix_refunds WHERE id = ?')
      .get(refundId);

    if (!row) throw notFound('refund_not_found', `No refund ${refundId}`);
    return row;
  }
}
