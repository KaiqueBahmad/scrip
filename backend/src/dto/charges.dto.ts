import type { ListChargesFilters } from '../domain/charges';
import type { ChargeStatus } from '../models/types';

export interface CreateChargeBody {
  amount?: number;
  payer_document?: string | null;
  payer_name?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SimulateChargeBody {
  result?: string;
}

/** The charge list query string, identical on both surfaces. */
export interface ChargeQuery {
  status?: ChargeStatus;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

/** Query string to filters, dropping the keys the caller left out. */
export function chargeFilters(merchantId: string, query: ChargeQuery): ListChargesFilters {
  return {
    merchantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.limit ? { limit: Number(query.limit) } : {}),
    ...(query.offset ? { offset: Number(query.offset) } : {}),
  };
}
