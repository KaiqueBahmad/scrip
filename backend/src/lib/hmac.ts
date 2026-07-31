import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook payload signing (specs.md:108).
 *
 * The spec mandates HMAC-SHA256 in `X-PseudoPay-Signature` but not the encoding, so we use
 * the Stripe-style scheme:
 *
 *   X-PseudoPay-Signature: t=1717171717,v1=<hex hmac-sha256 of "<t>.<rawBody>">
 *
 * Binding the timestamp into the signed string is what makes replay protection possible on
 * the receiving end — which is one of the things this tool exists to let you test.
 */
export const SIGNATURE_HEADER = 'x-pseudopay-signature';

/** Signs `<timestamp>.<rawBody>`; returns the hex digest only. */
export function computeSignature(secret: string, rawBody: string, timestampSeconds: number): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
}

export interface SignedPayload {
  header: string;
  timestamp: number;
  signature: string;
}

export function signPayload(secret: string, rawBody: string, at: number = Date.now()): SignedPayload {
  const timestamp = Math.floor(at / 1000);
  const signature = computeSignature(secret, rawBody, timestamp);
  return { header: `t=${timestamp},v1=${signature}`, timestamp, signature };
}

export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (value === undefined) continue;
    if (key === 't') timestamp = Number(value);
    if (key === 'v1') signatures.push(value);
  }

  return { timestamp, signatures };
}

/**
 * Reference verifier — mirrors what a merchant backend should do, and is what the test
 * suite asserts against. `toleranceSeconds` of 0 disables the freshness check.
 */
export function verifySignature(options: {
  secret: string;
  rawBody: string;
  header: string;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const { secret, rawBody, header, toleranceSeconds = 300, now = Date.now() } = options;
  const { timestamp, signatures } = parseSignatureHeader(header);

  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  if (toleranceSeconds > 0) {
    const ageSeconds = Math.abs(Math.floor(now / 1000) - timestamp);
    if (ageSeconds > toleranceSeconds) return false;
  }

  const expected = Buffer.from(computeSignature(secret, rawBody, timestamp), 'utf8');

  return signatures.some((candidate) => {
    const actual = Buffer.from(candidate, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
