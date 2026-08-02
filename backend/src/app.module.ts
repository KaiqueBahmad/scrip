import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HealthController } from './api/health.controller';
import { IntegrationController } from './api/integration/integration.controller';
import { PanelChargesController } from './api/panel/charges.controller';
import { PanelKycController } from './api/panel/kyc.controller';
import { SessionController } from './api/panel/session.controller';
import { PanelSettingsController } from './api/panel/settings.controller';
import { PanelTokensController } from './api/panel/tokens.controller';
import { PanelWebhooksController } from './api/panel/webhooks.controller';
import { IntegrationGuard } from './auth/integration.guard';
import { MerchantGuard } from './auth/merchant.guard';
import { AppExceptionFilter } from './common/app-exception.filter';
import { DB, FETCH, LOGGER, RANDOM, SCHEDULER } from './common/injection-tokens';
import { ConfigStore, type PseudoPayConfig } from './config';
import { applyStoredSettings, SettingsService } from './config';
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
  SettingsRepository,
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
        IntegrationController,
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
        {
          provide: ConfigStore,
          inject: [SettingsRepository, LOGGER],
          useFactory: (settings: SettingsRepository, logger: Logger) => {
            const store = new ConfigStore(options.config);
            applyStoredSettings(settings, store, logger);
            return store;
          },
        },
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
        SettingsRepository,
        // Business rules, which reach the database only through the repositories above.
        WebhookDispatcher,
        ChargeService,
        RefundService,
        MerchantService,
        TokenService,
        KycService,
        IdempotencyStore,
        SettingsService,
        IntegrationGuard,
        MerchantGuard,
        { provide: APP_FILTER, useClass: AppExceptionFilter },
      ],
    };
  }
}
