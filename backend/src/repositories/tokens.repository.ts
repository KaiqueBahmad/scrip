import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { DB } from '../common/injection-tokens';
import type { Db } from '../db/index';
import { apiTokens } from '../db/schema';
import type { ApiTokenRow } from './types';

@Injectable()
export class TokenRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(row: ApiTokenRow): void {
    this.db.insert(apiTokens).values(row).run();
  }

  findById(tokenId: string): ApiTokenRow | undefined {
    return this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, tokenId))
      .get();
  }

  listByMerchant(merchantId: string): ApiTokenRow[] {
    return this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.merchant_id, merchantId))
      .orderBy(desc(apiTokens.created_at))
      .all();
  }

  markRevoked(tokenId: string, at: string): void {
    this.db
      .update(apiTokens)
      .set({ revoked_at: at })
      .where(eq(apiTokens.id, tokenId))
      .run();
  }

  delete(tokenId: string): void {
    this.db.delete(apiTokens).where(eq(apiTokens.id, tokenId)).run();
  }
}
