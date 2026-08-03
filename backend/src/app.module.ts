import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HealthController } from './http/health.controller';
import { ApiController } from './http/api/api.controller';
import { PanelChargesController } from './http/panel/charges.controller';
import { PanelKycController } from './http/panel/kyc.controller';
import { SessionController } from './http/panel/session.controller';
import { PanelSettingsController } from './http/panel/settings.controller';
import { PanelTokensController } from './http/panel/tokens.controller';
import { PanelWebhooksController } from './http/panel/webhooks.controller';
import { ApiGuard } from './auth/api.guard';
import { MerchantGuard } from './auth/merchant.guard';
import { AppExceptionFilter } from './common/app-exception.filter';
import { DB, FETCH, LOGGER, RANDOM, SCHEDULER } from './common/injection-tokens';
import { ConfigStore, SettingsService, type PseudoPayConfig } from './config';
import { openDb, type Db } from './db/index';
import { ChargeService } from './service/charges.service';
import { IdempotencyStore } from './service/idempotency.service';
import { KycService } from './service/kyc.service';
import { MerchantService } from './service/merchants.service';
import { RefundService } from './service/refunds.service';
import { TokenService } from './service/tokens.service';
import { WebhookDispatcher } from './service/webhooks.service';
import { silentLogger, type Logger } from './lib/logger';
import { TimeoutScheduler, type Scheduler } from './lib/scheduler';
import {
  ChargeRepository,
  IdempotencyRepository,
  KycRepository,
  MerchantRepository,
  RefundRepository,
  TokenRepository,
  WebhookDeliveryRepository,
} from './repositories';

export interface AppModuleOptions {
  /** Already resolved by `createApp`, which needs the same values to build the adapter. */
  config: PseudoPayConfig;
  /** Pass an already-open database (tests use `:memory:`). */
  db?: Db;
  /** Pass a ManualScheduler to drive simulated time by hand. */
  scheduler?: Scheduler;
  /** Stub the webhook transport. */
  fetchImpl?: typeof fetch;
  /** Control the approvalRate coin flip. */
  random?: () => number;
  /** Fastify's own logger, so domain code and request logs land in the same place. */
  log?: Logger;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions): DynamicModule {
    // A database the app opened itself is one it has to close again; one that was handed in
    // belongs to the caller.
    const ownsDb = !options.db;
    const db = options.db ?? openDb({ databasePath: options.config.databasePath });
    const log = options.log ?? silentLogger;

    return {
      module: AppModule,
      controllers: [
        HealthController,
        ApiController,
        SessionController,
        PanelTokensController,
        PanelChargesController,
        PanelKycController,
        PanelWebhooksController,
        PanelSettingsController,
      ],
      providers: [
        { provide: DB, useValue: db },
        { provide: LOGGER, useValue: log },
        { provide: SCHEDULER, useValue: options.scheduler ?? new TimeoutScheduler() },
        { provide: FETCH, useValue: options.fetchImpl ?? globalThis.fetch },
        { provide: RANDOM, useValue: options.random ?? Math.random },
        { provide: ConfigStore, useValue: new ConfigStore(options.config) },
        {
          // Timers outlive a request, so they have to be released explicitly or the process
          // never exits.
          provide: 'SHUTDOWN',
          inject: [SCHEDULER],
          useFactory: (scheduler: Scheduler) => ({
            onApplicationShutdown() {
              scheduler.clearAll();
              if (ownsDb) db.$client.close();
            },
          }),
        },
        // Persistence: every Drizzle query lives behind one of these.
        MerchantRepository,
        ChargeRepository,
        RefundRepository,
        TokenRepository,
        KycRepository,
        WebhookDeliveryRepository,
        IdempotencyRepository,
        // Business rules, which reach the database only through the repositories above.
        WebhookDispatcher,
        ChargeService,
        RefundService,
        MerchantService,
        TokenService,
        KycService,
        IdempotencyStore,
        SettingsService,
        ApiGuard,
        MerchantGuard,
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    };
  }
}
