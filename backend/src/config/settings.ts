import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import { nowIso, type Db } from '../db/index';
import { settings } from '../db/schema';
import { badRequest } from '../lib/errors';
import type { Logger } from '../lib/logger';
import { ConfigStore, MUTABLE_CONFIG_KEYS, type PseudoPayConfig } from './config';

/**
 * Loads the persisted settings overrides on top of file/env config, so a value changed in
 * the Settings screen still applies after a restart. Runs while the ConfigStore is being
 * built, before anything can read from it.
 */
export function applyStoredSettings(db: Db, config: ConfigStore, log: Logger): void {
  const rows = db.select({ key: settings.key, value: settings.value }).from(settings).all();
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

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigStore,
  ) {}

  /**
   * Settings are instance-wide, not per store: they control how the simulation behaves.
   * The signing secret is redacted — this project is lax about access control
   * (specs.md:112-118), but handing out the key that mints tokens is a different order of
   * leak from showing the tokens themselves.
   */
  read() {
    const { jwtSigningSecret, ...rest } = this.config.current();

    return {
      object: 'settings' as const,
      editable: MUTABLE_CONFIG_KEYS,
      values: { ...rest, jwtSigningSecret: jwtSigningSecret ? '[redacted]' : '' },
    };
  }

  /** Applies a runtime settings change and persists it so it survives a restart. */
  save(patch: Record<string, unknown>) {
    let next: PseudoPayConfig;

    try {
      next = this.config.apply(patch);
    } catch (err) {
      throw badRequest(
        'invalid_setting',
        err instanceof Error ? err.message : 'Could not apply settings',
      );
    }

    const at = nowIso();

    this.db.transaction((tx) => {
      for (const key of Object.keys(patch)) {
        tx.insert(settings)
          .values({ key, value: JSON.stringify(next[key as keyof PseudoPayConfig]), updated_at: at })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: sql`excluded.value`, updated_at: sql`excluded.updated_at` },
          })
          .run();
      }
    });

    return this.read();
  }
}
