import type { FastifyReply, FastifyRequest } from 'fastify';

import { unauthorized } from '../lib/errors.js';
import type { Services } from '../services.js';
import type { MerchantRow } from '../types.js';

/**
 * Panel auth: HTTP Basic where the username is a merchant id and the password is always
 * empty (specs.md:35).
 *
 * The merchant *is* the panel identity — there is no separate operator login, so a session
 * only ever sees its own charges, tokens, webhooks and KYC. There is no password check at
 * all: the panel is an account *selector*, not a login (specs.md:54), which is why
 * specs.md:110-118 says never to expose an instance publicly.
 */
export function requireMerchantSession(services: Services) {
  return async function merchantAuthHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    const match = header ? /^Basic\s+(.+)$/i.exec(header.trim()) : null;

    if (!match?.[1]) {
      reply.header('WWW-Authenticate', 'Basic realm="PseudoPay", charset="UTF-8"');
      throw unauthorized(
        'merchant_auth_required',
        'Send HTTP Basic credentials: username is your merchant id, password is empty',
      );
    }

    let decoded: string;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      throw unauthorized('invalid_credentials', 'Basic credentials are not valid base64');
    }

    // The password half is intentionally ignored rather than required to be empty.
    const identifier = (decoded.split(':', 1)[0] ?? '').trim();

    if (!identifier) {
      throw unauthorized('invalid_credentials', 'Basic username (merchant id) is required');
    }

    const merchant = services.merchants.find(identifier);

    if (!merchant) {
      throw unauthorized(
        'merchant_not_found',
        `No merchant matches "${identifier}". Pick one from GET /v1/panel/session/merchants`,
      );
    }

    request.merchant = merchant;
  };
}

/** Reads the merchant resolved by `requireMerchantSession`. */
export function sessionMerchant(request: FastifyRequest): MerchantRow {
  const merchant = request.merchant;
  if (!merchant) throw unauthorized('merchant_auth_required', 'No merchant on this request');
  return merchant;
}
