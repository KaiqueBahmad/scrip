import type { FastifyRequest } from 'fastify';

import { notFound, unauthorized } from '../lib/errors.js';
import type { Services } from '../services.js';
import type { ChargeRow } from '../types.js';
import { extractBearer } from './context.js';

/**
 * App-surface auth (specs.md:77-82): the `public_token` returned when a charge is created
 * is handed to the payer's frontend, and it grants access to exactly one charge. It is not
 * a session — there is nothing else it can reach.
 */
export function requirePublicToken(services: Services) {
  return async function publicTokenHook(request: FastifyRequest): Promise<void> {
    const token = extractBearer(request.headers.authorization);

    if (!token) {
      throw unauthorized(
        'public_token_required',
        'Send the charge public_token as "Authorization: Bearer <token>"',
      );
    }

    const charge = services.charges.getByPublicToken(token);

    if (!charge) {
      throw unauthorized('invalid_public_token', 'This public token does not match any charge');
    }

    request.publicCharge = charge;
  };
}

/**
 * Returns the charge the token unlocked, asserting it is the one the path asks for.
 * A mismatch is a 404 rather than a 403 so the token cannot be used to probe which
 * charge ids exist.
 */
export function publicCharge(request: FastifyRequest, chargeId: string): ChargeRow {
  const charge = request.publicCharge;

  if (!charge) throw unauthorized('public_token_required', 'No public token on this request');
  if (charge.id !== chargeId) throw notFound('charge_not_found', `No charge ${chargeId}`);

  return charge;
}
