import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { MerchantService } from '../service/merchants.service';
import { unauthorized } from '../lib/errors';
import { PUBLIC_ROUTE } from './context';

/**
 * Panel auth: HTTP Basic where the username is a merchant id and the password is always
 * empty.
 *
 * The merchant *is* the panel identity — there is no separate operator login, so a session
 * only ever sees its own charges, tokens, webhooks and KYC. There is no password check at
 * all: the panel is an account *selector*, not a login, which is why an instance should
 * never be exposed publicly.
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

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const match = header ? /^Basic\s+(.+)$/i.exec(header.trim()) : null;

    if (!match?.[1]) {
      http
        .getResponse<FastifyReply>()
        .header('WWW-Authenticate', 'Basic realm="PseudoPay", charset="UTF-8"');

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
