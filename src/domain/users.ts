import { normalizePermissions } from '../auth/permissions.js';
import { nowIso, type Db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import type { UserRow } from '../types.js';

export interface CreateUserInput {
  name: string;
  email: string;
  permissions?: unknown;
  merchantId?: string | null;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  permissions?: unknown;
  merchantId?: string | null;
}

/**
 * Users are the panel's identity (specs.md:56-58). CRUD is deliberately unguarded — any
 * session may create a user with any permissions (specs.md:114).
 */
export class UserService {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  create(input: CreateUserInput): UserRow {
    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();

    if (!name) throw badRequest('invalid_name', 'name is required');
    if (!email || !email.includes('@')) {
      throw badRequest('invalid_email', 'a valid email is required');
    }

    if (this.findByEmail(email)) {
      throw conflict('email_taken', `A user with email ${email} already exists`);
    }

    this.#assertMerchantExists(input.merchantId);

    const at = nowIso();
    const row: UserRow = {
      id: newId('user'),
      name,
      email,
      permissions: JSON.stringify(normalizePermissions(input.permissions)),
      merchant_id: input.merchantId ?? null,
      created_at: at,
      updated_at: at,
    };

    this.#db
      .prepare(
        `INSERT INTO users (id, name, email, permissions, merchant_id, created_at, updated_at)
         VALUES (@id, @name, @email, @permissions, @merchant_id, @created_at, @updated_at)`,
      )
      .run(row);

    return row;
  }

  get(userId: string): UserRow {
    const row = this.#db
      .prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?')
      .get(userId);

    if (!row) throw notFound('user_not_found', `No user ${userId}`);
    return row;
  }

  findByEmail(email: string): UserRow | undefined {
    return this.#db
      .prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase());
  }

  /** Basic auth accepts either the user id or the email as the username. */
  findByIdentifier(identifier: string): UserRow | undefined {
    const trimmed = identifier.trim();

    return (
      this.#db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(trimmed) ??
      this.findByEmail(trimmed)
    );
  }

  list(): UserRow[] {
    return this.#db.prepare<[], UserRow>('SELECT * FROM users ORDER BY created_at ASC').all();
  }

  update(userId: string, input: UpdateUserInput): UserRow {
    const current = this.get(userId);

    let email = current.email;
    if (input.email !== undefined) {
      email = input.email.trim().toLowerCase();
      if (!email.includes('@')) throw badRequest('invalid_email', 'a valid email is required');

      const clash = this.findByEmail(email);
      if (clash && clash.id !== userId) {
        throw conflict('email_taken', `A user with email ${email} already exists`);
      }
    }

    if (input.name !== undefined && !input.name.trim()) {
      throw badRequest('invalid_name', 'name cannot be empty');
    }

    if (input.merchantId !== undefined) this.#assertMerchantExists(input.merchantId);

    this.#db
      .prepare(
        `UPDATE users
            SET name = @name, email = @email, permissions = @permissions,
                merchant_id = @merchant_id, updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({
        id: userId,
        name: input.name?.trim() ?? current.name,
        email,
        permissions:
          input.permissions === undefined
            ? current.permissions
            : JSON.stringify(normalizePermissions(input.permissions)),
        merchant_id: input.merchantId === undefined ? current.merchant_id : input.merchantId,
        updated_at: nowIso(),
      });

    return this.get(userId);
  }

  delete(userId: string): void {
    this.get(userId);
    this.#db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  #assertMerchantExists(merchantId: string | null | undefined): void {
    if (!merchantId) return;

    const exists = this.#db
      .prepare<[string], { id: string }>('SELECT id FROM merchants WHERE id = ?')
      .get(merchantId);

    if (!exists) throw badRequest('merchant_not_found', `No merchant ${merchantId}`);
  }
}
