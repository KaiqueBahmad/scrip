import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

/** Reads schema.sql from beside this module — works from both src/ (tsx) and dist/. */
function readSchema(): string {
  return readFileSync(resolve(here, 'schema.sql'), 'utf8');
}

export function nowIso(at: number | Date = Date.now()): string {
  return new Date(at).toISOString();
}

export interface OpenDbOptions {
  databasePath: string;
  /** Fastify logs through pino; pass a sink here to trace SQL during development. */
  verbose?: (message?: unknown, ...args: unknown[]) => void;
}

export function openDb(options: OpenDbOptions): Db {
  const { databasePath } = options;
  const inMemory = databasePath === ':memory:' || databasePath.startsWith('file::memory:');

  if (!inMemory) {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath, options.verbose ? { verbose: options.verbose } : {});

  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!inMemory) {
    // WAL keeps the panel's reads from blocking on webhook/charge writes. SQLite is still
    // the wrong choice under real write concurrency (specs.md:139) — fine for a dev tool.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  db.exec(readSchema());
  migrate(db);

  return db;
}

/**
 * schema.sql is all `CREATE TABLE IF NOT EXISTS`, so it never alters a table that already
 * exists. Anything that changes an existing column has to be applied here.
 */
export function migrate(db: Db): void {
  relaxTokenUserId(db);
}

/**
 * `integration_tokens.user_id` used to be NOT NULL, back when a token was minted by a panel
 * user. Tokens are now issued by a merchant session, which has no user behind it, so an
 * existing database would reject every new token with a constraint error. SQLite cannot drop
 * NOT NULL in place, so the table is rebuilt.
 */
function relaxTokenUserId(db: Db): void {
  const columns = db
    .prepare<[], { name: string; notnull: number }>('PRAGMA table_info(integration_tokens)')
    .all();

  const userId = columns.find((column) => column.name === 'user_id');
  if (!userId || userId.notnull === 0) return;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE integration_tokens_migrated (
        id          TEXT PRIMARY KEY,
        user_id     TEXT REFERENCES users (id) ON DELETE SET NULL,
        merchant_id TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
        name        TEXT,
        permissions TEXT NOT NULL DEFAULT '[]',
        token       TEXT NOT NULL,
        expires_at  TEXT,
        revoked_at  TEXT,
        created_at  TEXT NOT NULL
      );

      INSERT INTO integration_tokens_migrated
        (id, user_id, merchant_id, name, permissions, token, expires_at, revoked_at, created_at)
      SELECT id, user_id, merchant_id, name, permissions, token, expires_at, revoked_at, created_at
        FROM integration_tokens;

      DROP TABLE integration_tokens;
      ALTER TABLE integration_tokens_migrated RENAME TO integration_tokens;

      CREATE INDEX IF NOT EXISTS idx_tokens_user ON integration_tokens (user_id);
      CREATE INDEX IF NOT EXISTS idx_tokens_merchant ON integration_tokens (merchant_id);
    `);
  })();

  console.log('[pseudopay] migrated integration_tokens.user_id to nullable');
}

/** Drops all rows but keeps the schema — the behaviour specs.md:45 describes for `reset`. */
export function resetData(db: Db): void {
  const tables = [
    'idempotency_keys',
    'webhook_deliveries',
    'charge_events',
    'pix_refunds',
    'pix_charges',
    'kyc_documents',
    'integration_tokens',
    'users',
    'merchants',
    'settings',
  ];

  db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
    db.pragma('foreign_keys = ON');
  })();
}

/** Parses a JSON text column, falling back rather than throwing on corrupt rows. */
export function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
