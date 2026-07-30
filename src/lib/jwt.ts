import jwt from 'jsonwebtoken';

import { unauthorized } from './errors.js';

/**
 * Integration tokens (specs.md:36) — HS256 JWTs the user mints for themselves in the
 * panel, scoped to one merchant and a set of permissions.
 */
export interface IntegrationTokenClaims {
  /** Subject is the integration_tokens row id, so revocation can be checked on every call. */
  sub: string;
  merchant_id: string;
  user_id: string;
  permissions: string[];
  iat?: number;
  exp?: number;
}

export interface SignTokenInput {
  secret: string;
  tokenId: string;
  merchantId: string;
  userId: string;
  permissions: string[];
  /** e.g. "24h". Empty or undefined issues a token with no `exp` (specs.md:116). */
  expiresIn?: string;
}

export function signIntegrationToken(input: SignTokenInput): string {
  const payload = {
    sub: input.tokenId,
    merchant_id: input.merchantId,
    user_id: input.userId,
    permissions: input.permissions,
  };

  const options: jwt.SignOptions = { algorithm: 'HS256', issuer: 'pseudopay' };
  if (input.expiresIn) {
    options.expiresIn = input.expiresIn as jwt.SignOptions['expiresIn'];
  }

  return jwt.sign(payload, input.secret, options);
}

/** Verifies signature, algorithm and expiry. Revocation is checked separately, in the DB. */
export function verifyIntegrationToken(token: string, secret: string): IntegrationTokenClaims {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'pseudopay' });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('token_expired', 'Integration token has expired');
    }
    throw unauthorized('invalid_token', 'Integration token is not valid');
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw unauthorized('invalid_token', 'Integration token payload is malformed');
  }

  const claims = decoded as Partial<IntegrationTokenClaims>;

  if (
    typeof claims.sub !== 'string' ||
    typeof claims.merchant_id !== 'string' ||
    typeof claims.user_id !== 'string' ||
    !Array.isArray(claims.permissions)
  ) {
    throw unauthorized('invalid_token', 'Integration token is missing required claims');
  }

  return {
    sub: claims.sub,
    merchant_id: claims.merchant_id,
    user_id: claims.user_id,
    permissions: claims.permissions.filter((p): p is string => typeof p === 'string'),
    iat: claims.iat,
    exp: claims.exp,
  };
}

/** Decodes without verifying — used only to display a token's expiry in the panel. */
export function decodeExpiry(token: string): string | null {
  const decoded = jwt.decode(token);
  if (typeof decoded !== 'object' || decoded === null) return null;
  const exp = (decoded as { exp?: number }).exp;
  return typeof exp === 'number' ? new Date(exp * 1000).toISOString() : null;
}
