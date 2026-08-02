import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { settings } from '../db/schema';

export interface SettingRow {
  key: string;
  value: string;
}

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  readAll(): SettingRow[] {
    return this.db.select({ key: settings.key, value: settings.value }).from(settings).all();
  }

  /** Every key in one transaction, so a partial save can never be observed. */
  upsertMany(rows: readonly (SettingRow & { updated_at: string })[]): void {
    this.db.transaction((tx) => {
      for (const row of rows) {
        tx.insert(settings)
          .values(row)
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: sql`excluded.value`, updated_at: sql`excluded.updated_at` },
          })
          .run();
      }
    });
  }
}
