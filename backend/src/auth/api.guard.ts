import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ConfigStore } from '../config';
import { MerchantService } from '../service/merchants.service';
import { TokenService } from '../service/tokens.service';
import { unauthorized } from '../lib/errors';
import { verifyApiToken } from '../lib/jwt';
import { extractBearer } from './context';

/**
 * API auth: a Bearer JWT minted by a merchant session in the panel.
 *
 * Signature and expiry are checked in the JWT itself; revocation and the merchant's
 * continued existence are checked against the database on every request, so revoking a
 * token takes effect immediately instead of waiting for it to expire. A token that
 * survives those checks reaches every API route — there is no narrower scope.
 */
@Injectable()
export class ApiGuard implements CanActivate {
  constructor(
    private readonly config: ConfigStore,
    private readonly tokens: TokenService,
    private readonly merchants: MerchantService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = extractBearer(request.headers.authorization);

    if (!token) {
      throw unauthorized(
        'api_auth_required',
        'Send your API JWT as "Authorization: Bearer <token>"',
      );
    }

    const claims = verifyApiToken(token, this.config.get('jwtSigningSecret'));
    const row = this.tokens.find(claims.sub);

    if (!row) {
      throw unauthorized('token_not_found', 'This token is no longer registered');
    }

    if (row.revoked_at) {
      throw unauthorized('token_revoked', `This token was revoked at ${row.revoked_at}`);
    }

    if (!this.merchants.find(row.merchant_id)) {
      throw unauthorized(
        'merchant_not_found',
        'The merchant this token belongs to no longer exists',
      );
    }

    request.api = { tokenId: row.id, merchantId: row.merchant_id };

    return true;
  }
}
