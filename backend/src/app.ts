import fastifyMultipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { loadConfig, type PseudoPayConfig } from './config';
import type { Db } from './db/index';
import { NestLoggerAdapter } from './lib/logger';
import type { Scheduler } from './lib/scheduler';

export interface CreateAppOptions {
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
  /** Request logging. Off in tests. */
  logger?: boolean;
}

export type PseudoPayApp = NestFastifyApplication;

/**
 * Builds the application without listening, so tests can drive it through `app.inject`.
 * The adapter is created first because its Fastify instance owns the logger that the
 * domain services write to.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<PseudoPayApp> {
  const config = loadConfig(options.config ?? {});
  const logging = options.logger ?? true;
  const log = logging ? new NestLoggerAdapter() : undefined;

  const adapter = new FastifyAdapter({
    logger: false,
    // Keeps ids in logs aligned with the ones the API returns.
    genReqId: () => Math.random().toString(36).slice(2, 10),
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot({ ...options, config, log }),
    adapter,
    // Without this Nest aborts the process on a wiring error instead of throwing, which
    // hides the cause completely when logging is off.
    {
      logger: log ?? false,
      abortOnError: false,
    },
  );

  // The precise size limit is enforced in KycService against the live config; this is just
  // a hard ceiling so a huge upload can't be buffered before that check runs.
  await app.register(fastifyMultipart, {
    limits: { fileSize: Math.max(config.kycMaxFileSizeMb, 1) * 1024 * 1024 * 2, files: 1 },
  });

  await app.init();

  return app;
}
