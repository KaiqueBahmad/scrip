import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { MerchantService } from '../service/merchants.service';
import { unauthorized } from '../lib/errors';
import { PUBLIC_ROUTE } from './context';

/** Header carrying the panel identity. */
export const MERCHANT_HEADER = 'x-scrip-merchant';

/**
 * Panel auth: the merchant id, sent as-is in the X-Scrip-Merchant header.
 *
 * The merchant *is* the panel identity — there is no separate operator login, so a session
 * only ever sees its own charges, tokens, webhooks and KYC. There is no password check at
 * all: the panel is an account *selector*, not a login, which is why an instance should
 * never be exposed publicly.
 *
 * It deliberately stays out of the Authorization header, so a reverse proxy in front of
 * Scrip (e.g. Apache with htpasswd) can own that header without clobbering the selection.
 */
@Injectable()
export class MerchantGuard implements CanActivate {
  constructor(
    private readonly merchants: MerchantService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const raw = request.headers[MERCHANT_HEADER];
    const identifier = (Array.isArray(raw) ? raw[0] : raw)?.trim();

    if (!identifier) {
      throw unauthorized(
        'merchant_auth_required',
        'Send your merchant id in the "X-Scrip-Merchant" header',
      );
    }

    const merchant = this.merchants.find(identifier);

    if (!merchant) {
      throw unauthorized(
        'merchant_not_found',
        `No merchant matches "${identifier}". Pick one from GET /v1/panel/session/merchants`,
      );
    }

    request.merchant = merchant;

    return true;
  }
}
