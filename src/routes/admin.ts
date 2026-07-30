import type { FastifyPluginAsync } from 'fastify';

import { adminUser, requireAdminUser } from '../auth/basic.js';
import { PERMISSIONS, WILDCARD } from '../auth/permissions.js';
import { KYC_DOCUMENT_TYPES } from '../domain/kyc.js';
import {
  serializeCharge,
  serializeChargeEvent,
  serializeDelivery,
  serializeKycDocument,
  serializeMerchant,
  serializeRefund,
  serializeToken,
  serializeUser,
} from '../domain/serialize.js';
import { MUTABLE_CONFIG_KEYS } from '../config.js';
import { badRequest } from '../lib/errors.js';
import type { Services } from '../services.js';
import type { ChargeStatus } from '../types.js';
import { readUpload } from './upload.js';

interface IdParams {
  id: string;
}

/**
 * Panel API. Authenticated with Basic auth (specs.md:35) but deliberately not
 * authorized — any panel session can do anything, including creating a user with any
 * permissions (specs.md:112-118).
 */
export function adminRoutes(services: Services): FastifyPluginAsync {
  return async function register(app) {
    // ------------------------------------------------------- session (public)

    /**
     * Unauthenticated on purpose: this is the list the panel shows so you can pick who to
     * be, because there is no login screen (specs.md:54).
     */
    app.get('/session/users', async () => ({
      object: 'list',
      data: services.users.list().map(serializeUser),
    }));

    app.get('/session/permissions', async () => ({
      object: 'list',
      data: [WILDCARD, ...PERMISSIONS],
    }));

    // -------------------------------------------------------- users (public)

    /**
     * User CRUD is unauthenticated: specs.md:114 calls it "CRUD público", and it has to be,
     * because Basic auth resolves to an existing user — with an empty database there would
     * otherwise be no way to create the first one.
     */
    app.get('/users', async () => ({
      object: 'list',
      data: services.users.list().map(serializeUser),
    }));

    app.post('/users', async (request, reply) => {
      const body = (request.body ?? {}) as {
        name?: string;
        email?: string;
        permissions?: unknown;
        merchant_id?: string | null;
      };

      const user = services.users.create({
        name: body.name as string,
        email: body.email as string,
        permissions: body.permissions,
        merchantId: body.merchant_id ?? null,
      });

      return reply.status(201).send(serializeUser(user));
    });

    app.get<{ Params: IdParams }>('/users/:id', async (request) =>
      serializeUser(services.users.get(request.params.id)),
    );

    app.patch<{ Params: IdParams }>('/users/:id', async (request) => {
      const body = (request.body ?? {}) as {
        name?: string;
        email?: string;
        permissions?: unknown;
        merchant_id?: string | null;
      };

      return serializeUser(
        services.users.update(request.params.id, {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.email === undefined ? {} : { email: body.email }),
          ...(body.permissions === undefined ? {} : { permissions: body.permissions }),
          ...(body.merchant_id === undefined ? {} : { merchantId: body.merchant_id }),
        }),
      );
    });

    app.delete<{ Params: IdParams }>('/users/:id', async (request, reply) => {
      services.users.delete(request.params.id);
      return reply.status(204).send();
    });

    // ------------------------------------------------- everything below: auth

    await app.register(async (guarded) => {
      guarded.addHook('preHandler', requireAdminUser(services));

      guarded.get('/session/me', async (request) => {
        const user = adminUser(request);

        return {
          user: serializeUser(user),
          merchant: user.merchant_id
            ? serializeMerchant(services.merchants.get(user.merchant_id), true)
            : null,
        };
      });

      // -------------------------------------------------------- merchants

      guarded.get('/merchants', async () => ({
        object: 'list',
        data: services.merchants.list().map((m) => serializeMerchant(m, true)),
      }));

      guarded.post('/merchants', async (request, reply) => {
        const body = (request.body ?? {}) as {
          name?: string;
          document?: string | null;
          webhook_url?: string | null;
        };

        const merchant = services.merchants.create({
          name: body.name as string,
          document: body.document ?? null,
          webhookUrl: body.webhook_url ?? null,
        });

        return reply.status(201).send(serializeMerchant(merchant, true));
      });

      guarded.get<{ Params: IdParams }>('/merchants/:id', async (request) =>
        serializeMerchant(services.merchants.get(request.params.id), true),
      );

      guarded.patch<{ Params: IdParams }>('/merchants/:id', async (request) => {
        const body = (request.body ?? {}) as {
          name?: string;
          document?: string | null;
          webhook_url?: string | null;
          rotate_webhook_secret?: boolean;
        };

        return serializeMerchant(
          services.merchants.update(request.params.id, {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.document === undefined ? {} : { document: body.document }),
            ...(body.webhook_url === undefined ? {} : { webhookUrl: body.webhook_url }),
            ...(body.rotate_webhook_secret ? { rotateWebhookSecret: true } : {}),
          }),
          true,
        );
      });

      guarded.delete<{ Params: IdParams }>('/merchants/:id', async (request, reply) => {
        services.merchants.delete(request.params.id);
        return reply.status(204).send();
      });

      // ----------------------------------------------------------- tokens

      /** "Meus tokens" (specs.md:60-62) — scoped to the acting panel user. */
      guarded.get('/tokens', async (request) => ({
        object: 'list',
        data: services.tokens.listForUser(adminUser(request).id).map(serializeToken),
      }));

      guarded.post('/tokens', async (request, reply) => {
        const body = (request.body ?? {}) as {
          merchant_id?: string | null;
          name?: string | null;
          permissions?: unknown;
          expires_in?: string | null;
        };

        const token = services.tokens.issue({
          user: adminUser(request),
          merchantId: body.merchant_id ?? null,
          name: body.name ?? null,
          permissions: body.permissions,
          ...(body.expires_in === undefined ? {} : { expiresIn: body.expires_in }),
        });

        return reply.status(201).send(serializeToken(token));
      });

      guarded.post<{ Params: IdParams }>('/tokens/:id/revoke', async (request) =>
        serializeToken(services.tokens.revoke(request.params.id)),
      );

      guarded.delete<{ Params: IdParams }>('/tokens/:id', async (request, reply) => {
        services.tokens.delete(request.params.id);
        return reply.status(204).send();
      });

      // ---------------------------------------------------------- charges

      guarded.get('/charges', async (request) => {
        const query = request.query as {
          merchant_id?: string;
          status?: ChargeStatus;
          from?: string;
          to?: string;
          limit?: string;
          offset?: string;
        };

        const filters = {
          ...(query.merchant_id ? { merchantId: query.merchant_id } : {}),
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
        const charge = services.charges.get(request.params.id);

        return {
          charge: serializeCharge(charge),
          events: services.charges.listEvents(charge.id).map(serializeChargeEvent),
          refunds: services.refunds.list(charge.id).map(serializeRefund),
          deliveries: services.webhooks
            .listForMerchant(charge.merchant_id, { chargeId: charge.id })
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

        return serializeCharge(services.charges.simulate(request.params.id, result));
      });

      guarded.post<{ Params: IdParams }>('/charges/:id/cancel', async (request) =>
        serializeCharge(services.charges.cancel(request.params.id)),
      );

      guarded.post<{ Params: IdParams }>('/charges/:id/refunds', async (request, reply) => {
        const body = (request.body ?? {}) as { amount?: number | null; reason?: string | null };

        const refund = services.refunds.create({
          chargeId: request.params.id,
          amount: body.amount ?? null,
          reason: body.reason ?? null,
        });

        return reply.status(201).send(serializeRefund(refund));
      });

      // -------------------------------------------------------------- kyc

      guarded.get('/kyc/documents', async (request) => {
        const query = request.query as { merchant_id?: string };

        return {
          object: 'list',
          document_types: KYC_DOCUMENT_TYPES,
          data: services.kyc.listDocuments(query.merchant_id).map(serializeKycDocument),
        };
      });

      guarded.get('/kyc/pending', async () => ({
        object: 'list',
        data: services.kyc.pendingMerchants().map((m) => serializeMerchant(m, true)),
      }));

      guarded.post<{ Params: IdParams }>('/merchants/:id/kyc/documents', async (request, reply) => {
        const upload = await readUpload(request);

        const document = services.kyc.upload({
          merchantId: request.params.id,
          type: upload.type,
          filename: upload.filename,
          mimeType: upload.mimeType,
          content: upload.content,
        });

        return reply.status(201).send(serializeKycDocument(document));
      });

      /** Streams the stored BLOB back so the panel can preview or download it. */
      guarded.get<{ Params: IdParams }>('/kyc/documents/:id/content', async (request, reply) => {
        const { row, content } = services.kyc.getDocumentContent(request.params.id);

        return reply
          .header('content-type', row.mime_type)
          .header('content-length', String(content.length))
          .header('content-disposition', `inline; filename="${encodeURIComponent(row.filename)}"`)
          .send(content);
      });

      guarded.delete<{ Params: IdParams }>('/kyc/documents/:id', async (request, reply) => {
        services.kyc.deleteDocument(request.params.id);
        return reply.status(204).send();
      });

      guarded.post<{ Params: IdParams }>('/merchants/:id/kyc/approve', async (request) => {
        const body = (request.body ?? {}) as { reason?: string | null };

        return serializeMerchant(
          services.kyc.approve({ merchantId: request.params.id, reason: body.reason ?? null }),
          true,
        );
      });

      guarded.post<{ Params: IdParams }>('/merchants/:id/kyc/reject', async (request) => {
        const body = (request.body ?? {}) as { reason?: string | null };

        return serializeMerchant(
          services.kyc.reject({ merchantId: request.params.id, reason: body.reason ?? null }),
          true,
        );
      });

      // --------------------------------------------------------- webhooks

      guarded.get('/webhooks/deliveries', async (request) => {
        const query = request.query as {
          merchant_id?: string;
          charge_id?: string;
          event?: string;
          status?: string;
          limit?: string;
        };

        const filters = {
          ...(query.event ? { event: query.event } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.limit ? { limit: Number(query.limit) } : {}),
        };

        const deliveries = query.merchant_id
          ? services.webhooks.listForMerchant(query.merchant_id, {
              ...filters,
              ...(query.charge_id ? { chargeId: query.charge_id } : {}),
            })
          : services.webhooks.listAll(filters);

        return { object: 'list', data: deliveries.map(serializeDelivery) };
      });

      guarded.get<{ Params: IdParams }>('/webhooks/deliveries/:id', async (request) =>
        serializeDelivery(services.webhooks.get(request.params.id)),
      );

      guarded.post<{ Params: IdParams }>('/webhooks/deliveries/:id/retry', async (request) =>
        serializeDelivery(services.webhooks.retry(request.params.id)),
      );

      // --------------------------------------------------------- settings

      /**
       * The signing secret is redacted even here. This project is deliberately lax about
       * access control (specs.md:112-118), but handing out the key that mints integration
       * tokens is a different order of leak from showing the tokens themselves.
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
