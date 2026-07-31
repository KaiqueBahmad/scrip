import type { ChargeRow, MerchantRow } from '../types.js';

/** Resolved credential for a /v1/integration request. */
export interface IntegrationAuth {
  tokenId: string;
  merchantId: string;
  /** Null for tokens minted by a merchant session, which is now the normal case. */
  userId: string | null;
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the Basic auth hook on /admin/api routes — the panel identity. */
    merchant?: MerchantRow;
    /** Set by the Bearer hook on /v1/integration routes. */
    integration?: IntegrationAuth;
    /** Set by the public-token hook on /v1/app routes. */
    publicCharge?: ChargeRow;
  }
}

/** Reads the Bearer credential from an Authorization header. */
export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}
