import { Inject, Injectable } from '@nestjs/common';

import { LOGGER } from '../common/injection-tokens';
import { nowIso } from '../db/index';
import { badRequest, conflict, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { MerchantRepository, WithdrawalRepository } from '../repositories';
import type { Scope, WithdrawalRow, WithdrawalStatus } from '../repositories/types';
import { MerchantService } from './merchants.service';
import { serializeWithdrawal } from './serialize.service';
import { WebhookDispatcher } from './webhooks.service';

export interface CreateWithdrawalInput {
  merchantId: string;
  /** Integer centavos. */
  amount: number;
}

export interface ListWithdrawalsFilters {
  merchantId?: string;
  status?: WithdrawalStatus;
  limit?: number;
  offset?: number;
}

export interface DenyWithdrawalInput {
  reason?: string | null;
}

/**
 * Withdrawals: a store pulling its own available balance out. There is no real bank on
 * the other end, so confirming and denying are simulation controls taken from the panel —
 * the same idea as forcing a charge to pay or KYC to approve.
 */
@Injectable()
export class WithdrawalService {
  constructor(
    private readonly withdrawals: WithdrawalRepository,
    private readonly merchants: MerchantRepository,
    private readonly merchantService: MerchantService,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  create(input: CreateWithdrawalInput): WithdrawalRow {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw badRequest(
        'invalid_amount',
        'amount must be a positive integer number of centavos',
        { amount: input.amount },
      );
    }

    const merchant = this.merchants.findById(input.merchantId);
    if (!merchant) {
      throw notFound('merchant_not_found', `No merchant ${input.merchantId}`);
    }

    // The exit fee is locked in at request time, same as the amount itself — both hold
    // against the balance together from the moment the withdrawal is created.
    const feeAmount = Math.round((input.amount * merchant.pix_fee_out_bps) / 10000);
    const totalHeld = input.amount + feeAmount;

    // Re-checked here rather than trusted from the caller: the balance can move between
    // the moment a client reads it and the moment it requests a withdrawal.
    const balance = this.merchantService.balanceFor(input.merchantId);
    if (totalHeld > balance.available) {
      throw badRequest(
        'insufficient_balance',
        `Withdrawal of ${input.amount} (+ ${feeAmount} fee) exceeds the available balance of ${balance.available}`,
        { amount: input.amount, fee_amount: feeAmount, available: balance.available },
      );
    }

    const at = nowIso();
    const row: WithdrawalRow = {
      id: newId('withdrawal'),
      merchant_id: input.merchantId,
      amount: input.amount,
      fee_amount: feeAmount,
      status: 'pending',
      reason: null,
      confirmed_at: null,
      denied_at: null,
      created_at: at,
      updated_at: at,
    };

    this.withdrawals.insert(row);

    this.log.info(
      { withdrawal_id: row.id, merchant_id: input.merchantId, amount: input.amount, fee_amount: feeAmount },
      'withdrawal requested',
    );

    return row;
  }

  get(id: string, scope: Scope = {}): WithdrawalRow {
    const row = this.withdrawals.findById(id);

    // A withdrawal belonging to another merchant is reported as missing rather than
    // forbidden, so ids can't be probed across merchants.
    if (!row || (scope.merchantId && row.merchant_id !== scope.merchantId)) {
      throw notFound('withdrawal_not_found', `No withdrawal ${id}`);
    }

    return row;
  }

  list(filters: ListWithdrawalsFilters = {}): WithdrawalRow[] {
    return this.withdrawals.list(filters);
  }

  count(filters: ListWithdrawalsFilters = {}): number {
    return this.withdrawals.count(filters);
  }

  confirm(id: string, scope: Scope = {}): WithdrawalRow {
    const row = this.assertPending(this.get(id, scope));
    const at = nowIso();

    this.withdrawals.update(id, { status: 'confirmed', confirmed_at: at, updated_at: at });
    const updated = this.get(id);

    this.webhooks.enqueue({
      merchantId: updated.merchant_id,
      event: 'withdrawal.confirmed',
      data: { withdrawal: serializeWithdrawal(updated) },
    });

    this.log.info({ withdrawal_id: row.id }, 'withdrawal confirmed');

    return updated;
  }

  deny(id: string, input: DenyWithdrawalInput = {}, scope: Scope = {}): WithdrawalRow {
    const row = this.assertPending(this.get(id, scope));
    const at = nowIso();

    this.withdrawals.update(id, {
      status: 'denied',
      denied_at: at,
      reason: input.reason ?? null,
      updated_at: at,
    });
    const updated = this.get(id);

    this.webhooks.enqueue({
      merchantId: updated.merchant_id,
      event: 'withdrawal.denied',
      data: { withdrawal: serializeWithdrawal(updated) },
    });

    this.log.info({ withdrawal_id: row.id, reason: input.reason ?? null }, 'withdrawal denied');

    return updated;
  }

  private assertPending(row: WithdrawalRow): WithdrawalRow {
    if (row.status !== 'pending') {
      throw conflict(
        'invalid_withdrawal_status',
        `Withdrawal ${row.id} is ${row.status}; only pending withdrawals can be confirmed or denied`,
        { withdrawal_id: row.id, status: row.status },
      );
    }
    return row;
  }
}
