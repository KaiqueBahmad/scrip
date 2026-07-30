import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { openDb } from '../src/db/index.js';

/**
 * schema.sql only ever runs CREATE TABLE IF NOT EXISTS, so a database created by an older
 * build keeps its old column definitions. This is the case that actually broke: user_id was
 * NOT NULL back when a panel user minted tokens, and a merchant session has no user.
 */
describe('existing database migration', () => {
  it('relaxes integration_tokens.user_id so a merchant can mint a token', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pseudopay-')), 'legacy.sqlite');

    // Build a current database, then put integration_tokens back the way the previous
    // version had it. Downgrading one column is a more faithful fixture than hand-writing a
    // partial schema, which would not satisfy the rest of schema.sql.
    const seeded = openDb({ databasePath: file });
    seeded.exec(`
      INSERT INTO merchants (id, name, webhook_secret, created_at, updated_at)
      VALUES ('mch_old', 'Loja Antiga', 'whsec_x', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      INSERT INTO users (id, name, email, created_at, updated_at)
      VALUES ('usr_old', 'Antigo', 'antigo@example.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      DROP TABLE integration_tokens;

      CREATE TABLE integration_tokens (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        merchant_id TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
        name        TEXT,
        permissions TEXT NOT NULL DEFAULT '[]',
        token       TEXT NOT NULL,
        expires_at  TEXT,
        revoked_at  TEXT,
        created_at  TEXT NOT NULL
      );

      INSERT INTO integration_tokens
        (id, user_id, merchant_id, name, permissions, token, created_at)
      VALUES ('tok_old', 'usr_old', 'mch_old', 'legado', '["*"]', 'jwt.old', '2026-01-01T00:00:00Z');
    `);
    seeded.close();

    const db = openDb({ databasePath: file });

    try {
      const userId = db
        .prepare<[], { name: string; notnull: number }>('PRAGMA table_info(integration_tokens)')
        .all()
        .find((column) => column.name === 'user_id');

      assert.equal(userId?.notnull, 0, 'user_id is nullable after migration');

      // The pre-existing token survived, still pointing at whoever created it.
      const kept = db
        .prepare<[string], { user_id: string | null; merchant_id: string; name: string | null }>(
          'SELECT user_id, merchant_id, name FROM integration_tokens WHERE id = ?',
        )
        .get('tok_old');

      assert.equal(kept?.user_id, 'usr_old', 'old row keeps its user');
      assert.equal(kept?.merchant_id, 'mch_old');
      assert.equal(kept?.name, 'legado');

      // And a merchant-issued token, with no user, now inserts cleanly.
      db.prepare(
        `INSERT INTO integration_tokens
           (id, user_id, merchant_id, name, permissions, token, created_at)
         VALUES ('tok_new', NULL, 'mch_old', 'novo', '["*"]', 'jwt.new', '2026-07-30T00:00:00Z')`,
      ).run();

      const inserted = db
        .prepare<[string], { user_id: string | null }>(
          'SELECT user_id FROM integration_tokens WHERE id = ?',
        )
        .get('tok_new');

      assert.equal(inserted?.user_id, null);
    } finally {
      db.close();
    }
  });

  it('is idempotent on a database that is already current', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pseudopay-')), 'fresh.sqlite');

    const first = openDb({ databasePath: file });
    first.close();

    // Opening again must not rebuild anything or throw.
    const second = openDb({ databasePath: file });
    try {
      const userId = second
        .prepare<[], { name: string; notnull: number }>('PRAGMA table_info(integration_tokens)')
        .all()
        .find((column) => column.name === 'user_id');

      assert.equal(userId?.notnull, 0);
    } finally {
      second.close();
    }
  });
});
