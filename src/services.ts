import { ConfigStore, MUTABLE_CONFIG_KEYS, type PseudoPayConfig } from './config.js';
import { nowIso, type Db } from './db/index.js';
import { ChargeService } from './domain/charges.js';
import { IdempotencyStore } from './domain/idempotency.js';
import { KycService } from './domain/kyc.js';
import { MerchantService } from './domain/merchants.js';
import { RefundService } from './domain/refunds.js';
import { TokenService } from './domain/tokens.js';
import { UserService } from './domain/users.js';
import { WebhookDispatcher } from './domain/webhooks.js';
import type { Logger } from './lib/logger.js';
import type { Scheduler } from './lib/scheduler.js';

export interface Services {
  db: Db;
  config: ConfigStore;
  scheduler: Scheduler;
  log: Logger;
  merchants: MerchantService;
  users: UserService;
  tokens: TokenService;
  charges: ChargeService;
  refunds: RefundService;
  kyc: KycService;
  webhooks: WebhookDispatcher;
  idempotency: IdempotencyStore;
  /** Persists a runtime settings change so it survives a restart. */
  saveSettings(patch: Record<string, unknown>): PseudoPayConfig;
}

export interface BuildServicesDeps {
  db: Db;
  config: ConfigStore;
  scheduler: Scheduler;
  log: Logger;
  /** Injectable for tests: lets the webhook dispatcher hit a stub instead of the network. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests: controls the approvalRate coin flip. */
  random?: () => number;
}

/**
 * Loads the persisted settings overrides on top of file/env config, so a value changed in
 * the Settings screen still applies after a restart.
 */
function applyStoredSettings(db: Db, config: ConfigStore, log: Logger): void {
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all();
  if (rows.length === 0) return;

  const patch: Record<string, unknown> = {};
  for (const row of rows) {
    if ((MUTABLE_CONFIG_KEYS as readonly string[]).includes(row.key)) {
      patch[row.key] = JSON.parse(row.value);
    }
  }

  try {
    config.apply(patch);
    log.debug({ keys: Object.keys(patch) }, 'applied stored settings');
  } catch (err) {
    log.warn({ err }, 'ignoring invalid stored settings');
  }
}

export function buildServices(deps: BuildServicesDeps): Services {
  const { db, config, scheduler, log } = deps;

  applyStoredSettings(db, config, log);

  const webhooks = new WebhookDispatcher({
    db,
    config,
    scheduler,
    log,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  const charges = new ChargeService({
    db,
    config,
    scheduler,
    log,
    webhooks,
    ...(deps.random ? { random: deps.random } : {}),
  });

  const refunds = new RefundService({ db, scheduler, log, charges, webhooks });

  return {
    db,
    config,
    scheduler,
    log,
    webhooks,
    charges,
    refunds,
    merchants: new MerchantService(db),
    users: new UserService(db),
    tokens: new TokenService({ db, config }),
    kyc: new KycService({ db, config, log, webhooks }),
    idempotency: new IdempotencyStore(db),

    saveSettings(patch: Record<string, unknown>): PseudoPayConfig {
      const next = config.apply(patch);
      const at = nowIso();

      const upsert = db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      );

      db.transaction(() => {
        for (const key of Object.keys(patch)) {
          upsert.run(key, JSON.stringify(next[key as keyof PseudoPayConfig]), at);
        }
      })();

      return next;
    },
  };
}
