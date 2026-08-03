import type { ListWithdrawalsFilters } from '../service/withdrawals.service';
import type { WithdrawalStatus } from '../repositories/types';

export interface CreateWithdrawalBody {
  /** Integer centavos. */
  amount?: number;
}

export interface DenyWithdrawalBody {
  reason?: string | null;
}

/** The withdrawal list query string, identical on both surfaces. */
export interface WithdrawalQuery {
  status?: WithdrawalStatus;
  limit?: string;
  offset?: string;
}

/** Query string to filters, dropping the keys the caller left out. */
export function withdrawalFilters(
  merchantId: string,
  query: WithdrawalQuery,
): ListWithdrawalsFilters {
  return {
    merchantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.limit ? { limit: Number(query.limit) } : {}),
    ...(query.offset ? { offset: Number(query.offset) } : {}),
  };
}
