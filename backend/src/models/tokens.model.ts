import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { integrationTokens } from '../db/schema';
import type { IntegrationTokenRow } from './types';

@Injectable()
export class TokenModel {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(row: IntegrationTokenRow): void {
    this.db.insert(integrationTokens).values(row).run();
  }

  findById(tokenId: string): IntegrationTokenRow | undefined {
    return this.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.id, tokenId))
      .get();
  }

  listByMerchant(merchantId: string): IntegrationTokenRow[] {
    return this.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.merchant_id, merchantId))
      .orderBy(desc(integrationTokens.created_at))
      .all();
  }

  markRevoked(tokenId: string, at: string): void {
    this.db
      .update(integrationTokens)
      .set({ revoked_at: at })
      .where(eq(integrationTokens.id, tokenId))
      .run();
  }

  delete(tokenId: string): void {
    this.db.delete(integrationTokens).where(eq(integrationTokens.id, tokenId)).run();
  }
}
