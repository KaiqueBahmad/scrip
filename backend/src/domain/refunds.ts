import { Inject, Injectable } from '@nestjs/common';

import { LOGGER, SCHEDULER } from '../common/injection-tokens';
import { nowIso } from '../db/index';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { generateE2eId } from '../lib/pix';
import type { Scheduler } from '../lib/scheduler';
import { RefundRepository } from '../repositories';
import type { RefundRow, Scope } from '../repositories/types';
import { ChargeService } from './charges';
import { serializeCharge, serializeRefund } from './serialize';
import { WebhookDispatcher } from './webhooks';

export interface CreateRefundInput {
  chargeId: string;
  /** Integer centavos. Omit to refund everything still outstanding. */
  amount?: number | null;
  reason?: string | null;
  /** Restricts the charge lookup to one merchant on the integration surface. */
  merchantId?: string;
}

/**
 * Refunds own the pix_refunds ledger; the charge's own status and refunded_amount are moved
 * by ChargeService.applyRefund so all status writes stay in the state machine.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly refunds: RefundRepository,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly charges: ChargeService,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  create(input: CreateRefundInput): RefundRow {
    const charge = this.charges.get(input.chargeId, { merchantId: input.merchantId });

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
      e2e_id: generateE2eId(new Date(this.scheduler.now())),
      created_at: nowIso(this.scheduler.now()),
    };

    this.refunds.insert(refund);

    const updatedCharge = this.charges.applyRefund(charge.id, amount);

    this.webhooks.enqueue({
      merchantId: charge.merchant_id,
      event: 'pix.charge.refunded',
      chargeId: charge.id,
      data: { charge: serializeCharge(updatedCharge), refund: serializeRefund(refund) },
    });

    this.log.info(
      { charge_id: charge.id, refund_id: refund.id, amount, status: updatedCharge.status },
      'pix charge refunded',
    );

    return refund;
  }

  list(chargeId: string, scope: Scope = {}): RefundRow[] {
    // Runs the scoped charge lookup first so a foreign charge id 404s consistently.
    this.charges.get(chargeId, scope);

    return this.refunds.listByCharge(chargeId);
  }

  get(refundId: string): RefundRow {
    const row = this.refunds.findById(refundId);

    if (!row) throw notFound('refund_not_found', `No refund ${refundId}`);
    return row;
  }
}
