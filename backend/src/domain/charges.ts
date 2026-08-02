import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { DB, LOGGER, RANDOM, SCHEDULER } from '../common/injection-tokens';
import { ConfigStore } from '../config';
import { nowIso, type Db } from '../db/index';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { buildBrCode, generateE2eId, generateTxid } from '../lib/pix';
import type { Scheduler } from '../lib/scheduler';
import { serializeCharge } from './serialize';
import { planConfirmation } from './testDocuments';
import type { ChargeEventRow, ChargeRow, ChargeStatus, MerchantRow, Scope } from './types';
import { WebhookDispatcher } from './webhooks';

/**
 * The PIX state machine. Everything a charge can become is enumerated here, and
 * `transition` is the only place a status is ever written.
 */
const ALLOWED_TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  pending: ['paid', 'expired', 'canceled'],
  paid: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  expired: [],
  canceled: [],
  refunded: [],
};

const TERMINAL_STATUSES: readonly ChargeStatus[] = ['expired', 'canceled', 'refunded'];

export function canTransition(from: ChargeStatus, to: ChargeStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface CreateChargeInput {
  merchantId: string;
  /** Integer centavos. */
  amount: number;
  payerDocument?: string | null;
  payerName?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListChargesFilters {
  merchantId?: string;
  status?: ChargeStatus;
  /** ISO date-time lower bound on created_at, inclusive. */
  from?: string;
  /** ISO date-time upper bound on created_at, inclusive. */
  to?: string;
  limit?: number;
  offset?: number;
}

interface ChargeTimers {
  confirm?: number;
  expire?: number;
}

@Injectable()
export class ChargeService implements OnApplicationBootstrap {
  private readonly timers = new Map<string, ChargeTimers>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigStore,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly webhooks: WebhookDispatcher,
    @Inject(RANDOM) private readonly random: () => number,
  ) {}

  /** Charges still pending when the process stopped get their expiry re-armed on boot. */
  onApplicationBootstrap(): void {
    this.restorePendingTimers();
  }

  create(input: CreateChargeInput): ChargeRow {
    const config = this.config.current();

    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw badRequest(
        'invalid_amount',
        'amount must be a positive integer number of centavos',
        { amount: input.amount },
      );
    }

    if (input.metadata !== undefined && input.metadata !== null) {
      if (typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
        throw badRequest('invalid_metadata', 'metadata must be a JSON object');
      }
    }

    const merchant = this.db
      .prepare<[string], MerchantRow>('SELECT * FROM merchants WHERE id = ?')
      .get(input.merchantId);

    if (!merchant) {
      throw notFound('merchant_not_found', `No merchant ${input.merchantId}`);
    }

    // KYC gate (specs.md:149). Off by default so a fresh install can charge immediately.
    if (config.requireApprovedKycForCharges && merchant.kyc_status !== 'approved') {
      throw forbidden(
        'kyc_required',
        'Merchant KYC must be approved before creating charges',
        { kyc_status: merchant.kyc_status },
      );
    }

    const id = newId('charge');
    const txid = generateTxid();
    const createdAtMs = this.scheduler.now();
    const createdAt = nowIso(createdAtMs);
    const expiresAt = nowIso(createdAtMs + config.pixQrCodeExpirationMs);

    const qrCode = buildBrCode({
      pixKey: config.pixKey,
      receiverName: config.pixReceiverName,
      receiverCity: config.pixReceiverCity,
      amount: input.amount,
      txid,
    });

    const row: ChargeRow = {
      id,
      merchant_id: merchant.id,
      amount: input.amount,
      status: 'pending',
      payer_document: input.payerDocument ?? null,
      payer_name: input.payerName ?? null,
      description: input.description ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
      qr_code: qrCode,
      qr_code_txid: txid,
      qr_code_expires_at: expiresAt,
      e2e_id: null,
      refunded_amount: 0,
      paid_at: null,
      expired_at: null,
      canceled_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    };

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO pix_charges
             (id, merchant_id, amount, status, payer_document, payer_name, description,
              metadata, qr_code, qr_code_txid, qr_code_expires_at, e2e_id,
              refunded_amount, paid_at, expired_at, canceled_at, created_at, updated_at)
           VALUES (@id, @merchant_id, @amount, @status, @payer_document, @payer_name,
                   @description, @metadata, @qr_code, @qr_code_txid, @qr_code_expires_at,
                   @e2e_id, @refunded_amount, @paid_at, @expired_at,
                   @canceled_at, @created_at, @updated_at)`,
        )
        .run(row);

      this.recordEvent(id, null, 'pending', 'charge_created', createdAt);
    })();

    this.webhooks.enqueue({
      merchantId: merchant.id,
      event: 'pix.charge.created',
      chargeId: id,
      data: { charge: serializeCharge(row) },
    });

    this.armTimers(row);

    this.log.info(
      { charge_id: id, merchant_id: merchant.id, amount: input.amount },
      'pix charge created',
    );

    return row;
  }

  get(chargeId: string, scope: Scope = {}): ChargeRow {
    const row = this.db
      .prepare<[string], ChargeRow>('SELECT * FROM pix_charges WHERE id = ?')
      .get(chargeId);

    // A charge belonging to another merchant is reported as missing rather than forbidden,
    // so ids can't be probed across merchants.
    if (!row || (scope.merchantId && row.merchant_id !== scope.merchantId)) {
      throw notFound('charge_not_found', `No charge ${chargeId}`);
    }

    return row;
  }

  list(filters: ListChargesFilters = {}): ChargeRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.merchantId) {
      clauses.push('merchant_id = ?');
      params.push(filters.merchantId);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.from) {
      clauses.push('created_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push('created_at <= ?');
      params.push(filters.to);
    }

    params.push(Math.min(filters.limit ?? 50, 200), filters.offset ?? 0);

    return this.db
      .prepare<unknown[], ChargeRow>(
        `SELECT * FROM pix_charges
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params);
  }

  count(filters: ListChargesFilters = {}): number {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.merchantId) {
      clauses.push('merchant_id = ?');
      params.push(filters.merchantId);
    }
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    const row = this.db
      .prepare<unknown[], { total: number }>(
        `SELECT COUNT(*) AS total FROM pix_charges
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`,
      )
      .get(...params);

    return row?.total ?? 0;
  }

  listEvents(chargeId: string): ChargeEventRow[] {
    return this.db
      .prepare<[string], ChargeEventRow>(
        'SELECT * FROM charge_events WHERE charge_id = ? ORDER BY created_at ASC, id ASC',
      )
      .all(chargeId);
  }

  /** Forces an outcome for tests and CI (specs.md:84-93). */
  simulate(chargeId: string, result: 'paid' | 'expired', scope: Scope = {}): ChargeRow {
    const charge = this.get(chargeId, scope);

    if (result === 'paid') return this.markPaid(charge.id, 'simulated');
    return this.markExpired(charge.id, 'simulated');
  }

  markPaid(chargeId: string, reason: string): ChargeRow {
    const charge = this.get(chargeId);
    this.assertTransition(charge, 'paid');

    const at = nowIso(this.scheduler.now());
    const e2eId = generateE2eId(new Date(this.scheduler.now()));

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE pix_charges SET status = 'paid', paid_at = ?, e2e_id = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(at, e2eId, at, chargeId);

      this.recordEvent(chargeId, charge.status, 'paid', reason, at);
    })();

    this.clearTimers(chargeId);

    const updated = this.get(chargeId);

    this.webhooks.enqueue({
      merchantId: updated.merchant_id,
      event: 'pix.charge.paid',
      chargeId,
      data: { charge: serializeCharge(updated) },
    });

    this.log.info({ charge_id: chargeId, reason, e2e_id: e2eId }, 'pix charge paid');

    return updated;
  }

  markExpired(chargeId: string, reason: string): ChargeRow {
    const charge = this.get(chargeId);
    this.assertTransition(charge, 'expired');

    const at = nowIso(this.scheduler.now());

    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE pix_charges SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ?`)
        .run(at, at, chargeId);

      this.recordEvent(chargeId, charge.status, 'expired', reason, at);
    })();

    this.clearTimers(chargeId);

    const updated = this.get(chargeId);

    this.webhooks.enqueue({
      merchantId: updated.merchant_id,
      event: 'pix.charge.expired',
      chargeId,
      data: { charge: serializeCharge(updated) },
    });

    this.log.info({ charge_id: chargeId, reason }, 'pix charge expired');

    return updated;
  }

  cancel(chargeId: string, scope: Scope = {}): ChargeRow {
    const charge = this.get(chargeId, scope);
    this.assertTransition(charge, 'canceled');

    const at = nowIso(this.scheduler.now());

    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE pix_charges SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?`)
        .run(at, at, chargeId);

      this.recordEvent(chargeId, charge.status, 'canceled', 'canceled_by_merchant', at);
    })();

    this.clearTimers(chargeId);
    this.log.info({ charge_id: chargeId }, 'pix charge canceled');

    // No webhook: specs.md:106 does not define a pix.charge.canceled event.
    return this.get(chargeId);
  }

  /**
   * Applies a refund to the charge itself. Called by RefundService, which owns the
   * pix_refunds rows and the webhook — this only moves the charge's money and status.
   */
  applyRefund(chargeId: string, amount: number): ChargeRow {
    const charge = this.get(chargeId);
    const refundedTotal = charge.refunded_amount + amount;
    const nextStatus: ChargeStatus = refundedTotal >= charge.amount ? 'refunded' : 'partially_refunded';

    this.assertTransition(charge, nextStatus);

    const at = nowIso(this.scheduler.now());

    this.db.transaction(() => {
      this.db
        .prepare('UPDATE pix_charges SET status = ?, refunded_amount = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, refundedTotal, at, chargeId);

      this.recordEvent(chargeId, charge.status, nextStatus, 'refund_applied', at);
    })();

    return this.get(chargeId);
  }

  /**
   * Re-arms expiration for charges still pending. Auto-confirmation is deliberately not
   * re-planned on boot: the original decision was made in memory and, per specs.md:138,
   * in-process timers do not survive a restart.
   */
  restorePendingTimers(): number {
    const pending = this.db
      .prepare<[], ChargeRow>(`SELECT * FROM pix_charges WHERE status = 'pending'`)
      .all();

    for (const charge of pending) {
      const remaining = new Date(charge.qr_code_expires_at).getTime() - this.scheduler.now();

      if (remaining <= 0) {
        this.markExpired(charge.id, 'expired_while_offline');
        continue;
      }

      this.setTimer(charge.id, 'expire', this.scheduler.schedule(remaining, () => {
        this.safeExpire(charge.id, 'qr_code_expired');
      }));
    }

    if (pending.length > 0) {
      this.log.info({ count: pending.length }, 'restored pending charge timers');
    }

    return pending.length;
  }

  /** Schedules auto-confirmation (if any) and QR expiration for a new charge. */
  private armTimers(charge: ChargeRow): void {
    const config = this.config.current();
    const plan = planConfirmation(charge.payer_document, config, this.random);

    if (plan.confirm) {
      this.setTimer(charge.id, 'confirm', this.scheduler.schedule(plan.delayMs, () => {
        this.safePay(charge.id, plan.reason);
      }));
    } else {
      this.log.debug(
        { charge_id: charge.id, reason: plan.reason },
        'charge will not auto-confirm',
      );
    }

    this.setTimer(charge.id, 'expire', this.scheduler.schedule(config.pixQrCodeExpirationMs, () => {
      this.safeExpire(charge.id, 'qr_code_expired');
    }));
  }

  /**
   * Timer callbacks race with API calls — a payer may simulate a result microseconds
   * before the auto-confirm fires. Losing that race is normal, not an error.
   */
  private safePay(chargeId: string, reason: string): void {
    try {
      const charge = this.get(chargeId);
      if (charge.status !== 'pending') return;
      this.markPaid(chargeId, reason);
    } catch (err) {
      this.log.debug({ charge_id: chargeId, err }, 'auto-confirmation skipped');
    }
  }

  private safeExpire(chargeId: string, reason: string): void {
    try {
      const charge = this.get(chargeId);
      if (charge.status !== 'pending') return;
      this.markExpired(chargeId, reason);
    } catch (err) {
      this.log.debug({ charge_id: chargeId, err }, 'expiration skipped');
    }
  }

  private assertTransition(charge: ChargeRow, to: ChargeStatus): void {
    if (canTransition(charge.status, to)) return;

    throw conflict(
      'invalid_state_transition',
      `Charge ${charge.id} cannot go from ${charge.status} to ${to}`,
      {
        charge_id: charge.id,
        from: charge.status,
        to,
        allowed: ALLOWED_TRANSITIONS[charge.status],
        terminal: TERMINAL_STATUSES.includes(charge.status),
      },
    );
  }

  private recordEvent(
    chargeId: string,
    from: ChargeStatus | null,
    to: ChargeStatus,
    reason: string,
    at: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO charge_events (id, charge_id, from_status, to_status, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('chargeEvent'), chargeId, from, to, reason, at);
  }

  private setTimer(chargeId: string, kind: keyof ChargeTimers, handle: number): void {
    const timers = this.timers.get(chargeId) ?? {};
    timers[kind] = handle;
    this.timers.set(chargeId, timers);
  }

  private clearTimers(chargeId: string): void {
    const timers = this.timers.get(chargeId);
    if (!timers) return;

    if (timers.confirm !== undefined) this.scheduler.cancel(timers.confirm);
    if (timers.expire !== undefined) this.scheduler.cancel(timers.expire);

    this.timers.delete(chargeId);
  }
}
