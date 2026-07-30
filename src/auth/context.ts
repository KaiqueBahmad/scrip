import type { ChargeRow, UserRow } from '../types.js';

/** Resolved credential for a /v1/integration request. */
export interface IntegrationAuth {
  tokenId: string;
  merchantId: string;
  userId: string;
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the Basic auth hook on /admin/api routes. */
    adminUser?: UserRow;
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
