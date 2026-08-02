import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import * as schema from './schema';

/**
 * Drizzle over better-sqlite3. `$client` is the raw connection, kept reachable for the two
 * things Drizzle has no opinion about: pragmas and closing.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/**
 * A Drizzle transaction handle. Query builders that may run inside `db.transaction` take
 * `DbOrTx` so the caller decides.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** Migrations sit beside this module, so the path resolves from both src/ and dist/. */
const MIGRATIONS_FOLDER = resolve(__dirname, 'migrations');

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

  const sqlite = new Database(databasePath, options.verbose ? { verbose: options.verbose } : {});

  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (!inMemory) {
    // WAL keeps the panel's reads from blocking on webhook/charge writes. SQLite is still
    // the wrong choice under real write concurrency — fine for a dev tool.
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  }

  const db = drizzle(sqlite, { schema });

  // src/db/schema.ts is the only description of the schema; the DDL under migrations/ is
  // generated from it by `npm run db:generate`. Applying it on every boot keeps the previous
  // behaviour — the app still opens an existing database and brings it up to date by itself,
  // with no separate migrate step to remember.
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return db;
}

/** Drops all rows but keeps the schema. */
export function resetData(db: Db): void {
  db.transaction((tx) => {
    for (const table of schema.TABLES_CHILD_FIRST) tx.delete(table).run();
  });
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
