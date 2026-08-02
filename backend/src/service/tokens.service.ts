import { Injectable } from '@nestjs/common';

import { ConfigStore } from '../config';
import { nowIso } from '../db/index';
import { badRequest, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { decodeExpiry, signIntegrationToken } from '../lib/jwt';
import { MerchantRepository, TokenRepository } from '../repositories';
import type { IntegrationTokenRow, Scope } from '../repositories/types';

export interface IssueTokenInput {
  /** The merchant whose session is issuing this token; it is always the token's scope. */
  merchantId: string;
  name?: string | null;
  /** Overrides jwtDefaultExpiration. Pass "" (or "never") for a token with no exp. */
  expiresIn?: string | null;
}

/**
 * Integration tokens. Only a merchant session can mint one, and it is
 * always scoped to that merchant — inside that scope it reaches every integration route.
 * The JWT itself is stored so the panel can show it again at any time.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly tokens: TokenRepository,
    private readonly merchants: MerchantRepository,
    private readonly config: ConfigStore,
  ) {}

  issue(input: IssueTokenInput): IntegrationTokenRow {
    const merchantId = input.merchantId;

    if (!merchantId) {
      throw badRequest('merchant_required', 'A token must be scoped to a merchant');
    }

    if (!this.merchants.findById(merchantId)) {
      throw badRequest('merchant_not_found', `No merchant ${merchantId}`);
    }

    const configuredExpiry = this.config.get('jwtDefaultExpiration');
    const requestedExpiry = input.expiresIn === undefined ? configuredExpiry : input.expiresIn;
    const expiresIn =
      !requestedExpiry || requestedExpiry === 'never' ? undefined : requestedExpiry;

    const id = newId('token');

    let token: string;
    try {
      token = signIntegrationToken({
        secret: this.config.get('jwtSigningSecret'),
        tokenId: id,
        merchantId,
        expiresIn,
      });
    } catch (err) {
      throw badRequest(
        'invalid_expiration',
        `Could not sign token with expiration "${expiresIn}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const row: IntegrationTokenRow = {
      id,
      merchant_id: merchantId,
      name: input.name?.trim() || null,
      token,
      expires_at: decodeExpiry(token),
      revoked_at: null,
      created_at: nowIso(),
    };

    this.tokens.insert(row);

    return row;
  }

  get(tokenId: string, scope: Scope = {}): IntegrationTokenRow {
    const row = this.find(tokenId);

    if (!row || (scope.merchantId && row.merchant_id !== scope.merchantId)) {
      throw notFound('token_not_found', `No integration token ${tokenId}`);
    }

    return row;
  }

  find(tokenId: string): IntegrationTokenRow | undefined {
    return this.tokens.findById(tokenId);
  }

  listForMerchant(merchantId: string): IntegrationTokenRow[] {
    return this.tokens.listByMerchant(merchantId);
  }

  revoke(tokenId: string, scope: Scope = {}): IntegrationTokenRow {
    const token = this.get(tokenId, scope);
    if (token.revoked_at) return token;

    this.tokens.markRevoked(tokenId, nowIso());

    return this.get(tokenId);
  }

  delete(tokenId: string, scope: Scope = {}): void {
    this.get(tokenId, scope);
    this.tokens.delete(tokenId);
  }
}
