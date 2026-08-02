import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { MerchantRow } from '../domain/types';
import { unauthorized } from '../lib/errors';

/** Resolved credential for a /v1/integration request. */
export interface IntegrationAuth {
  tokenId: string;
  merchantId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by MerchantGuard on /v1/panel routes — the panel identity. */
    merchant?: MerchantRow;
    /** Set by IntegrationGuard on /v1/integration routes. */
    integration?: IntegrationAuth;
  }
}

/** Reads the Bearer credential from an Authorization header. */
export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/** Injects the credential IntegrationGuard resolved for this request. */
export const Auth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): IntegrationAuth => {
    const auth = context.switchToHttp().getRequest<FastifyRequest>().integration;
    if (!auth) {
      throw unauthorized('integration_auth_required', 'No integration token on this request');
    }
    return auth;
  },
);

function requireMerchant(context: ExecutionContext): MerchantRow {
  const merchant = context.switchToHttp().getRequest<FastifyRequest>().merchant;
  if (!merchant) throw unauthorized('merchant_auth_required', 'No merchant on this request');
  return merchant;
}

/** Injects the merchant MerchantGuard resolved for this request. */
export const Merchant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MerchantRow => requireMerchant(context),
);

/** Injects just its id — what almost every panel route actually scopes by. */
export const MerchantId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => requireMerchant(context).id,
);

export const PUBLIC_ROUTE = 'pseudopay:public';

/**
 * Opts a route out of the store session. MerchantGuard is applied per controller, so a
 * route added without thinking about auth is protected by default and only becomes public
 * by saying so here.
 */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
