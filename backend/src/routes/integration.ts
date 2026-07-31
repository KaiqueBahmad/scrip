import type { FastifyPluginAsync } from 'fastify';

import { requireIntegrationAuth } from '../auth/bearer.js';
import { integrationAuth } from '../auth/bearer.js';
import { assertPermission } from '../auth/permissions.js';
import { KYC_DOCUMENT_TYPES } from '../domain/kyc.js';
import {
  serializeCharge,
  serializeChargeEvent,
  serializeDelivery,
  serializeKycDocument,
  serializeMerchant,
  serializeRefund,
} from '../domain/serialize.js';
import { badRequest } from '../lib/errors.js';
import type { Services } from '../services.js';
import type { ChargeStatus } from '../types.js';
import { readUpload } from './upload.js';

interface ChargeParams {
  id: string;
}

/**
 * Integration API (specs.md:22), called by the merchant's own backend with a JWT. Kept in
 * its own file from the panel API, because specs.md:21 asks for the surfaces to be
 * physically separated by route.
 */
export function integrationRoutes(services: Services): FastifyPluginAsync {
  return async function register(app) {
    app.addHook('preHandler', requireIntegrationAuth(services));

    // ---------------------------------------------------------------- charges

    app.post('/pix/charges', async (request, reply) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'charges:write');

      const body = (request.body ?? {}) as {
        amount?: number;
        payer_document?: string | null;
        payer_name?: string | null;
        description?: string | null;
        metadata?: Record<string, unknown> | null;
      };

      const idempotencyKey = request.headers['idempotency-key'];
      const lookup =
        typeof idempotencyKey === 'string' && idempotencyKey.trim()
          ? {
              key: idempotencyKey.trim(),
              merchantId: auth.merchantId,
              endpoint: 'POST /v1/integration/pix/charges',
              requestBody: body,
            }
          : undefined;

      if (lookup) {
        const replayed = services.idempotency.find(lookup);
        if (replayed) {
          reply.header('idempotent-replay', 'true');
          return reply.status(replayed.status).send(replayed.body);
        }
      }

      const charge = services.charges.create({
        merchantId: auth.merchantId,
        amount: body.amount as number,
        payerDocument: body.payer_document ?? null,
        payerName: body.payer_name ?? null,
        description: body.description ?? null,
        metadata: body.metadata ?? null,
      });

      const payload = serializeCharge(charge);

      if (lookup) services.idempotency.store(lookup, { status: 201, body: payload });

      return reply.status(201).send(payload);
    });

    app.get('/pix/charges', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'charges:read');

      const query = request.query as {
        status?: ChargeStatus;
        from?: string;
        to?: string;
        limit?: string;
        offset?: string;
      };

      const filters = {
        merchantId: auth.merchantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit ? { limit: Number(query.limit) } : {}),
        ...(query.offset ? { offset: Number(query.offset) } : {}),
      };

      return {
        object: 'list',
        data: services.charges.list(filters).map(serializeCharge),
        total: services.charges.count({
          merchantId: auth.merchantId,
          ...(query.status ? { status: query.status } : {}),
        }),
      };
    });

    app.get<{ Params: ChargeParams }>('/pix/charges/:id', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'charges:read');

      return serializeCharge(
        services.charges.get(request.params.id, { merchantId: auth.merchantId }),
      );
    });

    app.get<{ Params: ChargeParams }>('/pix/charges/:id/events', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'charges:read');

      const charge = services.charges.get(request.params.id, { merchantId: auth.merchantId });

      return {
        object: 'list',
        data: services.charges.listEvents(charge.id).map(serializeChargeEvent),
      };
    });

    /** Forces an outcome instead of waiting on the simulation (specs.md:84-93). */
    app.post<{ Params: ChargeParams }>('/pix/charges/:id/simulate', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'simulate:write');

      const { result } = (request.body ?? {}) as { result?: string };

      if (result !== 'paid' && result !== 'expired') {
        throw badRequest('invalid_result', 'result must be "paid" or "expired"', {
          received: result ?? null,
        });
      }

      return serializeCharge(
        services.charges.simulate(request.params.id, result, { merchantId: auth.merchantId }),
      );
    });

    app.post<{ Params: ChargeParams }>('/pix/charges/:id/cancel', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'charges:write');

      return serializeCharge(
        services.charges.cancel(request.params.id, { merchantId: auth.merchantId }),
      );
    });

    // ---------------------------------------------------------------- refunds

    app.post<{ Params: ChargeParams }>('/pix/charges/:id/refunds', async (request, reply) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'refunds:write');

      const body = (request.body ?? {}) as { amount?: number | null; reason?: string | null };

      const refund = services.refunds.create({
        chargeId: request.params.id,
        merchantId: auth.merchantId,
        amount: body.amount ?? null,
        reason: body.reason ?? null,
      });

      return reply.status(201).send(serializeRefund(refund));
    });

    app.get<{ Params: ChargeParams }>('/pix/charges/:id/refunds', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'charges:read');

      return {
        object: 'list',
        data: services.refunds
          .list(request.params.id, { merchantId: auth.merchantId })
          .map(serializeRefund),
      };
    });

    // -------------------------------------------------------------- merchant

    app.get('/merchants/me', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'merchants:read');

      // The secret is included here because the caller is the merchant's own backend and
      // needs it to verify webhook signatures.
      return serializeMerchant(services.merchants.get(auth.merchantId), true);
    });

    app.patch('/merchants/me', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'merchants:write');

      const body = (request.body ?? {}) as {
        name?: string;
        document?: string | null;
        webhook_url?: string | null;
        rotate_webhook_secret?: boolean;
      };

      const merchant = services.merchants.update(auth.merchantId, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.document === undefined ? {} : { document: body.document }),
        ...(body.webhook_url === undefined ? {} : { webhookUrl: body.webhook_url }),
        ...(body.rotate_webhook_secret ? { rotateWebhookSecret: true } : {}),
      });

      return serializeMerchant(merchant, true);
    });

    // -------------------------------------------------------------- webhooks

    app.get('/webhooks/deliveries', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'webhooks:read');

      const query = request.query as {
        charge_id?: string;
        event?: string;
        status?: string;
        limit?: string;
      };

      return {
        object: 'list',
        data: services.webhooks
          .listForMerchant(auth.merchantId, {
            ...(query.charge_id ? { chargeId: query.charge_id } : {}),
            ...(query.event ? { event: query.event } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.limit ? { limit: Number(query.limit) } : {}),
          })
          .map(serializeDelivery),
      };
    });

    app.post<{ Params: { id: string } }>('/webhooks/deliveries/:id/retry', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'webhooks:write');

      // Fetched through the merchant-scoped getter so one merchant cannot retry another's.
      const delivery = services.webhooks.get(request.params.id);
      if (delivery.merchant_id !== auth.merchantId) {
        throw badRequest('delivery_not_found', `No webhook delivery ${request.params.id}`);
      }

      return serializeDelivery(services.webhooks.retry(delivery.id));
    });

    // ------------------------------------------------------------------- kyc

    app.post('/kyc/documents', async (request, reply) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'kyc:write');

      const upload = await readUpload(request);

      const document = services.kyc.upload({
        merchantId: auth.merchantId,
        type: upload.type,
        filename: upload.filename,
        mimeType: upload.mimeType,
        content: upload.content,
      });

      return reply.status(201).send(serializeKycDocument(document));
    });

    app.get('/kyc/documents', async (request) => {
      const auth = integrationAuth(request);
      assertPermission(auth.permissions, 'kyc:read');

      const merchant = services.merchants.get(auth.merchantId);

      return {
        object: 'list',
        kyc_status: merchant.kyc_status,
        kyc_reason: merchant.kyc_reason,
        document_types: KYC_DOCUMENT_TYPES,
        data: services.kyc.listDocuments(auth.merchantId).map(serializeKycDocument),
      };
    });
  };
}
