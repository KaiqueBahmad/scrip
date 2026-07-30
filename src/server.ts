import fastifyMultipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { ConfigStore, loadConfig, type PseudoPayConfig } from './config.js';
import { openDb, type Db } from './db/index.js';
import { AppError } from './lib/errors.js';
import { TimeoutScheduler, type Scheduler } from './lib/scheduler.js';
import { adminRoutes } from './routes/admin.js';
import { appRoutes } from './routes/app.js';
import { integrationRoutes } from './routes/integration.js';
import { adminUiRoutes, readAdminShell } from './routes/static.js';
import { buildServices, type Services } from './services.js';

export interface BuildServerOptions {
  /** Overrides layered on top of pseudopay.config.json and PSEUDOPAY_* env vars. */
  config?: Partial<PseudoPayConfig>;
  /** Pass an already-open database (tests use `:memory:`). */
  db?: Db;
  /** Pass a ManualScheduler to drive simulated time by hand. */
  scheduler?: Scheduler;
  /** Stub the webhook transport. */
  fetchImpl?: typeof fetch;
  /** Control the approvalRate coin flip. */
  random?: () => number;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

export type PseudoPayServer = FastifyInstance;

export async function buildServer(options: BuildServerOptions = {}): Promise<PseudoPayServer> {
  const config = loadConfig(options.config ?? {});
  const configStore = new ConfigStore(config);

  const ownsDb = !options.db;
  const db = options.db ?? openDb({ databasePath: config.databasePath });
  const scheduler = options.scheduler ?? new TimeoutScheduler();

  const app = Fastify({
    logger: options.logger ?? true,
    // Keeps ids in logs aligned with the ones the API returns.
    genReqId: () => Math.random().toString(36).slice(2, 10),
  });

  const services = buildServices({
    db,
    config: configStore,
    scheduler,
    log: app.log,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.random ? { random: options.random } : {}),
  });

  app.decorate('services', services);

  // Every failure serializes the same way across all three surfaces.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.debug({ err: error, code: error.code }, 'request rejected');
      return reply.status(error.statusCode).send(error.toJSON());
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: error.message,
          details: error.validation,
        },
      });
    }

    const status = error.statusCode ?? 500;

    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.status(status).send({
        error: { code: 'internal_error', message: 'Something went wrong on the PseudoPay side' },
      });
    }

    return reply.status(status).send({
      error: { code: error.code ?? 'request_failed', message: error.message },
    });
  });

  // The precise size limit is enforced in KycService against the live config; this is just
  // a hard ceiling so a huge upload can't be buffered before that check runs.
  await app.register(fastifyMultipart, {
    limits: { fileSize: Math.max(config.kycMaxFileSizeMb, 1) * 1024 * 1024 * 2, files: 1 },
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'pseudopay',
    time: new Date().toISOString(),
  }));

  app.get('/', async (_request, reply) => reply.redirect('/admin'));

  await app.register(appRoutes(services), { prefix: '/v1/app' });
  await app.register(integrationRoutes(services), { prefix: '/v1/integration' });
  await app.register(adminRoutes(services), { prefix: '/admin/api' });
  await app.register(adminUiRoutes);

  // Client-side panel routes fall back to the SPA shell; everything else is a JSON 404.
  const adminShell = readAdminShell();
  app.setNotFoundHandler(async (request, reply) => {
    if (adminShell && request.method === 'GET' && request.url.startsWith('/admin')) {
      return reply.type('text/html').send(adminShell);
    }

    return reply.status(404).send({
      error: {
        code: 'not_found',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  app.addHook('onClose', async () => {
    scheduler.clearAll();
    if (ownsDb) db.close();
  });

  // Charges that were still pending when the process stopped get their expiry re-armed.
  services.charges.restorePendingTimers();

  return app;
}
