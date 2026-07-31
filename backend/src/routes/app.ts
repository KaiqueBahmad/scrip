import type { FastifyPluginAsync } from 'fastify';

import { publicCharge, requirePublicToken } from '../auth/publicToken.js';
import { serializePublicCharge } from '../domain/serialize.js';
import type { Services } from '../services.js';

interface ChargeParams {
  id: string;
}

/**
 * Payer-facing API (specs.md:22), consumed by the checkout frontend with the charge's
 * `public_token`. Read-only by design: everything that changes money lives on the
 * integration surface. Separate file from integration.ts per specs.md:21.
 */
export function appRoutes(services: Services): FastifyPluginAsync {
  return async function register(app) {
    app.addHook('preHandler', requirePublicToken(services));

    /** Polled by the checkout to watch for confirmation (specs.md:80-82). */
    app.get<{ Params: ChargeParams }>('/pix/charges/:id', async (request) => {
      const charge = publicCharge(request, request.params.id);

      // Re-read: the hook resolved the row when the request arrived, and a charge can
      // settle between two polls.
      return serializePublicCharge(services.charges.get(charge.id));
    });

    /** Just the payment payload, for rendering the QR without the surrounding charge state. */
    app.get<{ Params: ChargeParams }>('/pix/charges/:id/qrcode', async (request) => {
      const charge = publicCharge(request, request.params.id);
      const current = services.charges.get(charge.id);

      return {
        object: 'pix_qr_code',
        charge_id: current.id,
        qr_code: current.qr_code,
        txid: current.qr_code_txid,
        expires_at: current.qr_code_expires_at,
        amount: current.amount,
        status: current.status,
      };
    });
  };
}
