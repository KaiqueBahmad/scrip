/**
 * The persistence layer: one repository per table group, each holding every Drizzle query that
 * touches it, plus `types.ts` with the row shapes those queries return.
 *
 * A repository knows how a row is stored and nothing else. It does not validate, does not throw
 * domain errors, does not decide what time it is and does not enqueue anything — a missing
 * row comes back as `undefined` and the caller decides what that means. Timestamps and ids
 * arrive already computed, because which clock is authoritative is a domain decision
 * (charges follow the injected Scheduler, merchants follow the wall clock).
 *
 * The direction is domain -> repositories and never the reverse: nothing in here imports a
 * service. Transactions live here too, since spanning tables atomically is a storage
 * concern; the domain hands over the complete set of rows a transition writes.
 */
export * from './charges.repository';
export * from './idempotency.repository';
export * from './kyc.repository';
export * from './merchants.repository';
export * from './refunds.repository';
export * from './settings.repository';
export * from './tokens.repository';
export * from './types';
export * from './webhooks.repository';
