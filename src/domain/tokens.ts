import { normalizePermissions } from '../auth/permissions.js';
import type { ConfigStore } from '../config.js';
import { nowIso, parseJsonColumn, type Db } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { decodeExpiry, signIntegrationToken } from '../lib/jwt.js';
import type { IntegrationTokenRow, UserRow } from '../types.js';

export interface IssueTokenInput {
  user: UserRow;
  merchantId?: string | null;
  name?: string | null;
  permissions?: unknown;
  /** Overrides jwtDefaultExpiration. Pass "" (or "never") for a token with no exp. */
  expiresIn?: string | null;
}

export interface TokenServiceDeps {
  db: Db;
  config: ConfigStore;
}

/**
 * Integration tokens (specs.md:60-62). Scoped to a merchant and a permission subset; the
 * JWT itself is stored so the panel can show it again at any time.
 */
export class TokenService {
  #db: Db;
  #config: ConfigStore;

  constructor(deps: TokenServiceDeps) {
    this.#db = deps.db;
    this.#config = deps.config;
  }

  issue(input: IssueTokenInput): IntegrationTokenRow {
    const merchantId = input.merchantId ?? input.user.merchant_id;

    if (!merchantId) {
      throw badRequest(
        'merchant_required',
        'A token must be scoped to a merchant: pass merchant_id, or link the user to one',
      );
    }

    const merchantExists = this.#db
      .prepare<[string], { id: string }>('SELECT id FROM merchants WHERE id = ?')
      .get(merchantId);

    if (!merchantExists) throw badRequest('merchant_not_found', `No merchant ${merchantId}`);

    const userPermissions = parseJsonColumn<string[]>(input.user.permissions, []);
    const requested = normalizePermissions(input.permissions ?? userPermissions);

    // A token may narrow the user's permissions, never widen them.
    if (!userPermissions.includes('*')) {
      const escalated = requested.filter((p) => !userPermissions.includes(p));
      if (escalated.length > 0) {
        throw forbidden(
          'permission_escalation',
          `User ${input.user.id} cannot grant permissions it does not hold: ${escalated.join(', ')}`,
          { escalated, user_permissions: userPermissions },
        );
      }
    }

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
        userId: input.user.id,
        permissions: requested,
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
      user_id: input.user.id,
      merchant_id: merchantId,
      name: input.name?.trim() || null,
      permissions: JSON.stringify(requested),
      token,
      expires_at: decodeExpiry(token),
      revoked_at: null,
      created_at: nowIso(),
    };

    this.#db
      .prepare(
        `INSERT INTO integration_tokens
           (id, user_id, merchant_id, name, permissions, token, expires_at, revoked_at, created_at)
         VALUES (@id, @user_id, @merchant_id, @name, @permissions, @token, @expires_at,
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

  listForUser(userId: string): IntegrationTokenRow[] {
    return this.#db
      .prepare<[string], IntegrationTokenRow>(
        'SELECT * FROM integration_tokens WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(userId);
  }

  listAll(): IntegrationTokenRow[] {
    return this.#db
      .prepare<[], IntegrationTokenRow>(
        'SELECT * FROM integration_tokens ORDER BY created_at DESC',
      )
      .all();
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
