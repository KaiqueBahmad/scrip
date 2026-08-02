/**
 * The persistence layer: one model per table group, each holding every Drizzle query that
 * touches it, plus `types.ts` with the row shapes those queries return.
 *
 * A model knows how a row is stored and nothing else. It does not validate, does not throw
 * domain errors, does not decide what time it is and does not enqueue anything — a missing
 * row comes back as `undefined` and the caller decides what that means. Timestamps and ids
 * arrive already computed, because which clock is authoritative is a domain decision
 * (charges follow the injected Scheduler, merchants follow the wall clock).
 *
 * The direction is domain -> models and never the reverse: nothing in here imports a
 * service. Transactions live here too, since spanning tables atomically is a storage
 * concern; the domain hands over the complete set of rows a transition writes.
 */
export * from './charges.model';
export * from './idempotency.model';
export * from './kyc.model';
export * from './merchants.model';
export * from './refunds.model';
export * from './settings.model';
export * from './tokens.model';
export * from './types';
export * from './webhooks.model';
