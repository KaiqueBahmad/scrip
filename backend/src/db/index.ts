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

  return db;
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
