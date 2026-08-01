import type { ConfigStore } from '../config.js';
import { nowIso, type Db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { decodeExpiry, signIntegrationToken } from '../lib/jwt.js';
import type { IntegrationTokenRow } from '../types.js';

export interface IssueTokenInput {
  /** The merchant whose session is issuing this token; it is always the token's scope. */
  merchantId: string;
  name?: string | null;
  /** Overrides jwtDefaultExpiration. Pass "" (or "never") for a token with no exp. */
  expiresIn?: string | null;
}

export interface TokenServiceDeps {
  db: Db;
  config: ConfigStore;
}

/**
 * Integration tokens (specs.md:60-62). Only a merchant session can mint one, and it is
 * always scoped to that merchant — inside that scope it reaches every integration route.
 * The JWT itself is stored so the panel can show it again at any time.
 */
export class TokenService {
  #db: Db;
  #config: ConfigStore;

  constructor(deps: TokenServiceDeps) {
    this.#db = deps.db;
    this.#config = deps.config;
  }

  issue(input: IssueTokenInput): IntegrationTokenRow {
    const merchantId = input.merchantId;

    if (!merchantId) {
      throw badRequest('merchant_required', 'A token must be scoped to a merchant');
    }

    const merchantExists = this.#db
      .prepare<[string], { id: string }>('SELECT id FROM merchants WHERE id = ?')
      .get(merchantId);

    if (!merchantExists) throw badRequest('merchant_not_found', `No merchant ${merchantId}`);

    const configuredExpiry = this.#config.get('jwtDefaultExpiration');
    const requestedExpiry = input.expiresIn === undefined ? configuredExpiry : input.expiresIn;
    const expiresIn =
      !requestedExpiry || requestedExpiry === 'never' ? undefined : requestedExpiry;

    const id = newId('token');

    let token: string;
    try {
      token = signIntegrationToken({
        secret: this.#config.get('jwtSigningSecret'),
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

    this.#db
      .prepare(
        `INSERT INTO integration_tokens
           (id, merchant_id, name, token, expires_at, revoked_at, created_at)
         VALUES (@id, @merchant_id, @name, @token, @expires_at,
                 @revoked_at, @created_at)`,
      )
      .run(row);

    return row;
  }

  get(tokenId: string): IntegrationTokenRow {
    const row = this.find(tokenId);
    if (!row) throw notFound('token_not_found', `No integration token ${tokenId}`);
    return row;
  }

  find(tokenId: string): IntegrationTokenRow | undefined {
    return this.#db
      .prepare<[string], IntegrationTokenRow>('SELECT * FROM integration_tokens WHERE id = ?')
      .get(tokenId);
  }

  listForMerchant(merchantId: string): IntegrationTokenRow[] {
    return this.#db
      .prepare<[string], IntegrationTokenRow>(
        'SELECT * FROM integration_tokens WHERE merchant_id = ? ORDER BY created_at DESC',
      )
      .all(merchantId);
  }

  revoke(tokenId: string): IntegrationTokenRow {
    const token = this.get(tokenId);
    if (token.revoked_at) return token;

    this.#db
      .prepare('UPDATE integration_tokens SET revoked_at = ? WHERE id = ?')
      .run(nowIso(), tokenId);

    return this.get(tokenId);
  }

  delete(tokenId: string): void {
    this.get(tokenId);
    this.#db.prepare('DELETE FROM integration_tokens WHERE id = ?').run(tokenId);
  }
}
