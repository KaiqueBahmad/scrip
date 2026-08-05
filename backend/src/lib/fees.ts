/**
 * The "fixed + %" shape real gateways charge (e.g. Stripe's 2.9% + $0.30). `bps` is basis
 * points (1/100 of a percent) and `fixed` is flat centavos; both apply to the same amount.
 */
export function computeFee(amount: number, bps: number, fixed: number): number {
  return fixed + Math.round((amount * bps) / 10000);
}
