export interface CreateRefundBody {
  /** Integer centavos. Omit to refund everything still outstanding. */
  amount?: number | null;
  reason?: string | null;
}
