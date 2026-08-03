import jwt from 'jsonwebtoken';

import { unauthorized } from './errors';

/**
 * API tokens — HS256 JWTs a merchant session mints in the panel,
 * scoped to that merchant. A valid token reaches every API route.
 */
export interface ApiTokenClaims {
  /** Subject is the api_tokens row id, so revocation can be checked on every call. */
  sub: string;
  merchant_id: string;
  iat?: number;
  exp?: number;
}

export interface SignTokenInput {
  secret: string;
  tokenId: string;
  merchantId: string;
  /** e.g. "24h". Empty or undefined issues a token with no `exp`. */
  expiresIn?: string;
}

export function signApiToken(input: SignTokenInput): string {
  const payload = {
    sub: input.tokenId,
    merchant_id: input.merchantId,
  };

  const options: jwt.SignOptions = { algorithm: 'HS256', issuer: 'pseudopay' };
  if (input.expiresIn) {
    options.expiresIn = input.expiresIn as jwt.SignOptions['expiresIn'];
  }

  return jwt.sign(payload, input.secret, options);
}

/** Verifies signature, algorithm and expiry. Revocation is checked separately, in the DB. */
export function verifyApiToken(token: string, secret: string): ApiTokenClaims {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'pseudopay' });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('token_expired', 'API token has expired');
    }
    throw unauthorized('invalid_token', 'API token is not valid');
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw unauthorized('invalid_token', 'API token payload is malformed');
  }

  const claims = decoded as Partial<ApiTokenClaims>;

  if (typeof claims.sub !== 'string' || typeof claims.merchant_id !== 'string') {
    throw unauthorized('invalid_token', 'API token is missing required claims');
  }

  return {
    sub: claims.sub,
    merchant_id: claims.merchant_id,
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
