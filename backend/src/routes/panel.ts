import type { FastifyPluginAsync } from 'fastify';

import { requireMerchantSession, sessionMerchant } from '../auth/basic.js';
import { PERMISSIONS, WILDCARD } from '../auth/permissions.js';
import { MUTABLE_CONFIG_KEYS } from '../config.js';
import { KYC_DOCUMENT_TYPES } from '../domain/kyc.js';
import {
  serializeCharge,
  serializeChargeEvent,
  serializeDelivery,
  serializeKycDocument,
  serializeMerchant,
  serializeRefund,
  serializeToken,
} from '../domain/serialize.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { Services } from '../services.js';
import type { ChargeStatus } from '../types.js';
import { readUpload } from './upload.js';

interface IdParams {
  id: string;
}

/**
 * Panel API. The merchant is the panel identity (specs.md:35 for the Basic scheme), so every
 * route below the auth hook is scoped to the merchant in the session — there is no operator
 * role that can see across merchants.
 */
export function panelRoutes(services: Services): FastifyPluginAsync {
  return async function register(app) {
    // ------------------------------------------------------ session (public)

    /**
     * Unauthenticated on purpose: this is the list the panel shows so you can pick which
     * store to be, because there is no login screen (specs.md:54). The balance comes along
     * so the picker can show it.
     */
    app.get('/session/merchants', async () => ({
      object: 'list',
      data: services.merchants
        .list()
        .map((merchant) => serializeMerchant(merchant, false, services.merchants.balanceFor(merchant.id))),
    }));

    app.get('/session/permissions', async () => ({
      object: 'list',
      data: [WILDCARD, ...PERMISSIONS],
    }));

    /**
     * Creating a store is unauthenticated on purpose (specs.md:114): Basic auth resolves an
     * existing merchant, so with an empty database there would be no way to create the first
     * one.
     */
    app.post('/merchants', async (request, reply) => {
      const body = (request.body ?? {}) as { name?: string };

      // No webhook_url here: a new store has no session yet, and wiring the webhook is a
      // separate step through PATCH /merchants/me once you are signed in.
      const merchant = services.merchants.create({ name: body.name as string });

      return reply
        .status(201)
        .send(serializeMerchant(merchant, true, services.merchants.balanceFor(merchant.id)));
    });

    // ------------------------------------------- everything below: own store

    await app.register(async (guarded) => {
      guarded.addHook('preHandler', requireMerchantSession(services));

      /** Everything the panel needs to render a session: the store plus its balance. */
      guarded.get('/session/me', async (request) => {
        const merchant = sessionMerchant(request);

        return {
          merchant: serializeMerchant(merchant, true, services.merchants.balanceFor(merchant.id)),
        };
      });

      // ---------------------------------------------------------- my store

      guarded.get('/merchants/me', async (request) => {
        const merchant = services.merchants.get(sessionMerchant(request).id);
        return serializeMerchant(merchant, true, services.merchants.balanceFor(merchant.id));
      });

      guarded.patch('/merchants/me', async (request) => {
        const body = (request.body ?? {}) as {
          name?: string;
          webhook_url?: string | null;
          rotate_webhook_secret?: boolean;
        };

        const merchant = services.merchants.update(sessionMerchant(request).id, {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.webhook_url === undefined ? {} : { webhookUrl: body.webhook_url }),
          ...(body.rotate_webhook_secret ? { rotateWebhookSecret: true } : {}),
        });

        return serializeMerchant(merchant, true, services.merchants.balanceFor(merchant.id));
      });

      guarded.get('/balance', async (request) => ({
        object: 'balance',
        ...services.merchants.balanceFor(sessionMerchant(request).id),
      }));

      guarded.delete('/merchants/me', async (request, reply) => {
        services.merchants.delete(sessionMerchant(request).id);
        return reply.status(204).send();
      });

      // ----------------------------------------------------------- tokens

      /** Only a merchant session can mint an integration JWT, always scoped to itself. */
      guarded.get('/tokens', async (request) => ({
        object: 'list',
        data: services.tokens.listForMerchant(sessionMerchant(request).id).map(serializeToken),
      }));

      guarded.post('/tokens', async (request, reply) => {
        const body = (request.body ?? {}) as {
          name?: string | null;
          permissions?: unknown;
          expires_in?: string | null;
        };

        const token = services.tokens.issue({
          // Taken from the session, never from the body: a store cannot mint for another.
          merchantId: sessionMerchant(request).id,
          name: body.name ?? null,
          permissions: body.permissions,
          ...(body.expires_in === undefined ? {} : { expiresIn: body.expires_in }),
        });

        return reply.status(201).send(serializeToken(token));
      });

      guarded.post<{ Params: IdParams }>('/tokens/:id/revoke', async (request) => {
        const token = ownToken(services, request.params.id, sessionMerchant(request).id);
        return serializeToken(services.tokens.revoke(token.id));
      });

      guarded.delete<{ Params: IdParams }>('/tokens/:id', async (request, reply) => {
        const token = ownToken(services, request.params.id, sessionMerchant(request).id);
        services.tokens.delete(token.id);
        return reply.status(204).send();
      });

      // ---------------------------------------------------------- charges

      guarded.get('/charges', async (request) => {
        const query = request.query as {
          status?: ChargeStatus;
          from?: string;
          to?: string;
          limit?: string;
          offset?: string;
        };

        const filters = {
          merchantId: sessionMerchant(request).id,
          ...(query.status ? { status: query.status } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          ...(query.limit ? { limit: Number(query.limit) } : {}),
          ...(query.offset ? { offset: Number(query.offset) } : {}),
        };

        return {
          object: 'list',
          data: services.charges.list(filters).map(serializeCharge),
          total: services.charges.count(filters),
        };
      });

      guarded.get<{ Params: IdParams }>('/charges/:id', async (request) => {
        const merchantId = sessionMerchant(request).id;
        const charge = services.charges.get(request.params.id, { merchantId });

        return {
          charge: serializeCharge(charge),
          events: services.charges.listEvents(charge.id).map(serializeChargeEvent),
          refunds: services.refunds.list(charge.id, { merchantId }).map(serializeRefund),
          deliveries: services.webhooks
            .listForMerchant(merchantId, { chargeId: charge.id })
            .map(serializeDelivery),
        };
      });

      guarded.post<{ Params: IdParams }>('/charges/:id/simulate', async (request) => {
        const { result } = (request.body ?? {}) as { result?: string };

        if (result !== 'paid' && result !== 'expired') {
          throw badRequest('invalid_result', 'result must be "paid" or "expired"', {
            received: result ?? null,
          });
        }

        return serializeCharge(
          services.charges.simulate(request.params.id, result, {
            merchantId: sessionMerchant(request).id,
          }),
        );
      });

      guarded.post<{ Params: IdParams }>('/charges/:id/cancel', async (request) =>
        serializeCharge(
          services.charges.cancel(request.params.id, { merchantId: sessionMerchant(request).id }),
        ),
      );

      guarded.post<{ Params: IdParams }>('/charges/:id/refunds', async (request, reply) => {
        const body = (request.body ?? {}) as { amount?: number | null; reason?: string | null };

        const refund = services.refunds.create({
          chargeId: request.params.id,
          merchantId: sessionMerchant(request).id,
          amount: body.amount ?? null,
          reason: body.reason ?? null,
        });

        return reply.status(201).send(serializeRefund(refund));
      });

      // -------------------------------------------------------------- kyc

      guarded.get('/kyc/documents', async (request) => {
        const merchant = services.merchants.get(sessionMerchant(request).id);

        return {
          object: 'list',
          kyc_status: merchant.kyc_status,
          kyc_reason: merchant.kyc_reason,
          document_types: KYC_DOCUMENT_TYPES,
          data: services.kyc.listDocuments(merchant.id).map(serializeKycDocument),
        };
      });

      guarded.post('/kyc/documents', async (request, reply) => {
        const upload = await readUpload(request);

        const document = services.kyc.upload({
          merchantId: sessionMerchant(request).id,
          type: upload.type,
          filename: upload.filename,
          mimeType: upload.mimeType,
          content: upload.content,
        });

        return reply.status(201).send(serializeKycDocument(document));
      });

      guarded.get<{ Params: IdParams }>('/kyc/documents/:id/content', async (request, reply) => {
        const { row, content } = ownDocument(services, request.params.id, sessionMerchant(request).id);

        return reply
          .header('content-type', row.mime_type)
          .header('content-length', String(content.length))
          .header('content-disposition', `inline; filename="${encodeURIComponent(row.filename)}"`)
          .send(content);
      });

      guarded.delete<{ Params: IdParams }>('/kyc/documents/:id', async (request, reply) => {
        ownDocument(services, request.params.id, sessionMerchant(request).id);
        services.kyc.deleteDocument(request.params.id);
        return reply.status(204).send();
      });

      /**
       * With the merchant as the only identity there is no reviewer above it, so approving
       * and rejecting are simulation controls over your own KYC — the same idea as forcing a
       * payment. They still emit the real kyc.approved / kyc.rejected webhooks.
       */
      guarded.post('/kyc/simulate', async (request) => {
        const body = (request.body ?? {}) as { decision?: string; reason?: string | null };
        const merchantId = sessionMerchant(request).id;

        if (body.decision !== 'approved' && body.decision !== 'rejected') {
          throw badRequest('invalid_decision', 'decision must be "approved" or "rejected"', {
            received: body.decision ?? null,
          });
        }

        const merchant =
          body.decision === 'approved'
            ? services.kyc.approve({ merchantId, reason: body.reason ?? null })
            : services.kyc.reject({ merchantId, reason: body.reason ?? null });

        return serializeMerchant(merchant, true, services.merchants.balanceFor(merchant.id));
      });

      // --------------------------------------------------------- webhooks

      guarded.get('/webhooks/deliveries', async (request) => {
        const query = request.query as {
          charge_id?: string;
          event?: string;
          status?: string;
          limit?: string;
        };

        return {
          object: 'list',
          data: services.webhooks
            .listForMerchant(sessionMerchant(request).id, {
              ...(query.charge_id ? { chargeId: query.charge_id } : {}),
              ...(query.event ? { event: query.event } : {}),
              ...(query.status ? { status: query.status } : {}),
              ...(query.limit ? { limit: Number(query.limit) } : {}),
            })
            .map(serializeDelivery),
        };
      });

      guarded.get<{ Params: IdParams }>('/webhooks/deliveries/:id', async (request) =>
        serializeDelivery(ownDelivery(services, request.params.id, sessionMerchant(request).id)),
      );

      guarded.post<{ Params: IdParams }>('/webhooks/deliveries/:id/retry', async (request) => {
        const delivery = ownDelivery(services, request.params.id, sessionMerchant(request).id);
        return serializeDelivery(services.webhooks.retry(delivery.id));
      });

      // --------------------------------------------------------- settings

      /**
       * Settings are instance-wide, not per store: they control how the simulation behaves.
       * The signing secret is redacted — this project is lax about access control
       * (specs.md:112-118), but handing out the key that mints tokens is a different order
       * of leak from showing the tokens themselves.
       */
      const readSettings = () => {
        const { jwtSigningSecret, ...rest } = services.config.current();
        return {
          object: 'settings' as const,
          editable: MUTABLE_CONFIG_KEYS,
          values: { ...rest, jwtSigningSecret: jwtSigningSecret ? '[redacted]' : '' },
        };
      };

      guarded.get('/settings', async () => readSettings());

      guarded.patch('/settings', async (request) => {
        const body = (request.body ?? {}) as Record<string, unknown>;

        try {
          services.saveSettings(body);
          return readSettings();
        } catch (err) {
          throw badRequest(
            'invalid_setting',
            err instanceof Error ? err.message : 'Could not apply settings',
          );
        }
      });
    });
  };
}

/**
 * Ownership guards. Each reports a foreign resource as missing rather than forbidden, so ids
 * cannot be probed across merchants — the same rule ChargeService.get already follows.
 */
function ownToken(services: Services, tokenId: string, merchantId: string) {
  const token = services.tokens.find(tokenId);
  if (!token || token.merchant_id !== merchantId) {
    throw notFound('token_not_found', `No integration token ${tokenId}`);
  }
  return token;
}

function ownDelivery(services: Services, deliveryId: string, merchantId: string) {
  const delivery = services.webhooks.get(deliveryId);
  if (delivery.merchant_id !== merchantId) {
    throw notFound('delivery_not_found', `No webhook delivery ${deliveryId}`);
  }
  return delivery;
}

function ownDocument(services: Services, documentId: string, merchantId: string) {
  const result = services.kyc.getDocumentContent(documentId);
  if (result.row.merchant_id !== merchantId) {
    throw notFound('document_not_found', `No KYC document ${documentId}`);
  }
  return result;
}
