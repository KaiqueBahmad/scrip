import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Crockford-style base32: no i/l/o/u, so ids stay readable and unambiguous when
 * copy-pasted out of logs. 32 symbols means 5 unbiased bits per character.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function randomId(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! & 31];
  }
  return out;
}

/** Entity id prefixes, mirroring the `ch_a1b2c3` shape used in the README. */
export const ID_PREFIXES = {
  charge: 'ch',
  refund: 'rfd',
  merchant: 'mch',
  token: 'tok',
  kycDocument: 'kyc',
  webhookDelivery: 'whd',
  chargeEvent: 'evt',
} as const;

export type EntityKind = keyof typeof ID_PREFIXES;

export function newId(kind: EntityKind): string {
  return `${ID_PREFIXES[kind]}_${randomId(16)}`;
}

/** Per-merchant webhook signing secret (specs.md:108). */
export function newWebhookSecret(): string {
  return `whsec_${randomId(32)}`;
}

export function newIdempotencyFingerprint(): string {
  return randomUUID();
}
