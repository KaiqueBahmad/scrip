import type { FastifyRequest } from 'fastify';

import { unauthorized } from '../lib/errors.js';
import { verifyIntegrationToken } from '../lib/jwt.js';
import type { Services } from '../services.js';
import { extractBearer, type IntegrationAuth } from './context.js';

/**
 * Integration auth (specs.md:36): a Bearer JWT minted by a merchant session in the panel.
 *
 * Signature and expiry are checked in the JWT itself; revocation and the merchant's
 * continued existence are checked against the database on every request, so revoking a
 * token takes effect immediately instead of waiting for it to expire. A token that
 * survives those checks reaches every integration route — there is no narrower scope.
 */
export function requireIntegrationAuth(services: Services) {
  return async function integrationAuthHook(request: FastifyRequest): Promise<void> {
    const token = extractBearer(request.headers.authorization);

    if (!token) {
      throw unauthorized(
        'integration_auth_required',
        'Send your integration JWT as "Authorization: Bearer <token>"',
      );
    }

    const claims = verifyIntegrationToken(token, services.config.get('jwtSigningSecret'));
    const row = services.tokens.find(claims.sub);

    if (!row) {
      throw unauthorized('token_not_found', 'This token is no longer registered');
    }

    if (row.revoked_at) {
      throw unauthorized('token_revoked', `This token was revoked at ${row.revoked_at}`);
    }

    if (!services.merchants.find(row.merchant_id)) {
      throw unauthorized('merchant_not_found', 'The merchant this token belongs to no longer exists');
    }

    const auth: IntegrationAuth = {
      tokenId: row.id,
      merchantId: row.merchant_id,
    };

    request.integration = auth;
  };
}

/** Reads the credential resolved by `requireIntegrationAuth`. */
export function integrationAuth(request: FastifyRequest): IntegrationAuth {
  const auth = request.integration;
  if (!auth) throw unauthorized('integration_auth_required', 'No integration token on this request');
  return auth;
}
