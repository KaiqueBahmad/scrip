import { Injectable } from '@nestjs/common';

import { nowIso } from '../db/index';
import { badRequest, notFound } from '../lib/errors';
import { newId, newWebhookSecret } from '../lib/ids';
import { MerchantRepository, WithdrawalRepository } from '../repositories';
import type { ChargeStatus, MerchantRow } from '../repositories/types';
import { serializeMerchant } from './serialize.service';

/**
 * A store is created with just its identity. The webhook is set afterwards through
 * `update`, so signing up and wiring up stay separate steps.
 */
export interface CreateMerchantInput {
  name: string;
  /** Supply to pin a known secret in tests; otherwise one is generated. */
  webhookSecret?: string;
}

export interface UpdateMerchantInput {
  name?: string;
  webhookUrl?: string | null;
  rotateWebhookSecret?: boolean;
  /** Basis points (0-10000): the cut taken from a charge once it settles. */
  pixFeeInBps?: number;
  /** Basis points (0-10000): the cut taken from a withdrawal once it's requested. */
  pixFeeOutBps?: number;
  /** Flat centavos charged on top of pixFeeInBps for every settled charge. */
  pixFeeInFixed?: number;
  /** Flat centavos charged on top of pixFeeOutBps for every withdrawal. */
  pixFeeOutFixed?: number;
}

/** Basis points are 0-10000 (0%-100%) and must be whole — a fee finer than 0.01% has no meaning. */
function assertValidBps(field: string, value: number | undefined): void {
  if (value === undefined) return;

  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw badRequest(`invalid_${field}`, `${field} must be an integer between 0 and 10000`, {
      [field]: value,
    });
  }
}

/** A flat fee is centavos, so it can only ever be a non-negative integer. */
function assertValidFixedFee(field: string, value: number | undefined): void {
  if (value === undefined) return;

  if (!Number.isInteger(value) || value < 0) {
    throw badRequest(`invalid_${field}`, `${field} must be a non-negative integer`, {
      [field]: value,
    });
  }
}

function assertValidWebhookUrl(url: string | null | undefined): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('invalid_webhook_url', `webhook_url is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('invalid_webhook_url', 'webhook_url must be http or https');
  }
}

export interface MerchantBalance {
  /**
   * Liquid balance in centavos: settled, minus refunds, minus entry fees, minus
   * pending/confirmed withdrawals (payout + exit fee).
   */
  available: number;
  /** Sum of every charge that ever settled, before refunds and before the entry fee. */
  gross_received: number;
  /** Sum of every refund issued. */
  refunded: number;
  /** How many charges contributed to `gross_received`. */
  settled_charges: number;
  /** Sum of confirmed withdrawals — informational; already reflected in `available`. */
  withdrawn: number;
  /** Entry fee taken out of settled charges — informational; already reflected in `available`. */
  fees_in: number;
  /** Exit fee taken out of confirmed withdrawals — informational; already reflected in `available`. */
  fees_out: number;
}

/** Only these statuses ever moved money; a fully refunded charge contributes zero. */
const SETTLED_STATUSES: readonly ChargeStatus[] = ['paid', 'partially_refunded', 'refunded'];

@Injectable()
export class MerchantService {
  constructor(
    private readonly merchants: MerchantRepository,
    private readonly withdrawals: WithdrawalRepository,
  ) {}

  /**
   * A store as its own session sees it: the full record — secret included, because you are
   * looking at yourself — plus the derived balance.
   */
  present(merchant: MerchantRow) {
    return serializeMerchant(merchant, true, this.balanceFor(merchant.id));
  }

  /**
   * Balance is derived from the charges and withdrawals rather than stored, so it can never
   * drift out of sync with the ledger it describes — every refund, settlement and withdrawal
   * is already recorded on its own table. A withdrawal counts against `available` from the
   * moment it's requested (not just once confirmed), so the same balance can't be withdrawn
   * twice while a request is still pending.
   */
  balanceFor(merchantId: string): MerchantBalance {
    const totals = this.merchants.sumCharges(merchantId, SETTLED_STATUSES);
    const held = this.withdrawals.sumHeld(merchantId);

    return {
      available: totals.amount - totals.refunded_amount - totals.fee_amount - held,
      gross_received: totals.amount,
      refunded: totals.refunded_amount,
      settled_charges: totals.count,
      withdrawn: this.withdrawals.sumConfirmed(merchantId),
      fees_in: totals.fee_amount,
      fees_out: this.withdrawals.sumConfirmedFees(merchantId),
    };
  }

  create(input: CreateMerchantInput): MerchantRow {
    const name = input.name?.trim();
    if (!name) throw badRequest('invalid_name', 'name is required');

    const at = nowIso();
    const row: MerchantRow = {
      id: newId('merchant'),
      name,
      // Always null on creation — configured later via update.
      webhook_url: null,
      webhook_secret: input.webhookSecret ?? newWebhookSecret(),
      // New merchants start unverified; whether that blocks charges is a config decision
      // (requireApprovedKycForCharges), off by default.
      kyc_status: 'pending',
      kyc_reason: null,
      kyc_reviewed_at: null,
      // New merchants start fee-free; the store configures its own rates via update.
      pix_fee_in_bps: 0,
      pix_fee_out_bps: 0,
      pix_fee_in_fixed: 0,
      pix_fee_out_fixed: 0,
      created_at: at,
      updated_at: at,
    };

    this.merchants.insert(row);

    return row;
  }

  get(merchantId: string): MerchantRow {
    const row = this.find(merchantId);

    if (!row) throw notFound('merchant_not_found', `No merchant ${merchantId}`);
    return row;
  }

  find(merchantId: string): MerchantRow | undefined {
    return this.merchants.findById(merchantId);
  }

  list(): MerchantRow[] {
    return this.merchants.list();
  }

  update(merchantId: string, input: UpdateMerchantInput): MerchantRow {
    const current = this.get(merchantId);

    if (input.name !== undefined && !input.name.trim()) {
      throw badRequest('invalid_name', 'name cannot be empty');
    }
    if (input.webhookUrl !== undefined) assertValidWebhookUrl(input.webhookUrl);
    assertValidBps('pix_fee_in_bps', input.pixFeeInBps);
    assertValidBps('pix_fee_out_bps', input.pixFeeOutBps);
    assertValidFixedFee('pix_fee_in_fixed', input.pixFeeInFixed);
    assertValidFixedFee('pix_fee_out_fixed', input.pixFeeOutFixed);

    this.merchants.update(merchantId, {
      name: input.name?.trim() ?? current.name,
      webhook_url: input.webhookUrl === undefined ? current.webhook_url : input.webhookUrl,
      webhook_secret: input.rotateWebhookSecret ? newWebhookSecret() : current.webhook_secret,
      pix_fee_in_bps: input.pixFeeInBps ?? current.pix_fee_in_bps,
      pix_fee_out_bps: input.pixFeeOutBps ?? current.pix_fee_out_bps,
      pix_fee_in_fixed: input.pixFeeInFixed ?? current.pix_fee_in_fixed,
      pix_fee_out_fixed: input.pixFeeOutFixed ?? current.pix_fee_out_fixed,
      updated_at: nowIso(),
    });

    return this.get(merchantId);
  }

  delete(merchantId: string): void {
    this.get(merchantId);
    this.merchants.delete(merchantId);
  }
}
