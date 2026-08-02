/**
 * src/db/schema.ts is the schema; src/db/migrations is generated from it. Nothing at runtime
 * checks that the migrations were regenerated after the schema changed, so this suite does:
 * it opens a real database — which applies the migrations — and compares every Drizzle table
 * against the one SQLite ended up with. Forgetting `npm run db:generate` fails here.
 */
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { openDb } from '../src/db/index';
import * as schema from '../src/db/schema';

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

const db = openDb({ databasePath: ':memory:' });
const sqlite = db.$client;

after(() => sqlite.close());

const tables = Object.values(schema).filter(
  (value): value is (typeof schema.TABLES_CHILD_FIRST)[number] =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'getSQL' in value,
);

describe('drizzle schema matches the applied migrations', () => {
  it('covers every table in the database', () => {
    const created = sqlite
      .prepare<[], { name: string }>(
        // __drizzle_migrations is the migrator's own bookkeeping, not part of the schema.
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`,
      )
      .all()
      .map((row) => row.name)
      .sort();

    const declared = tables.map((table) => getTableConfig(table).name).sort();

    assert.deepEqual(declared, created);
  });

  for (const table of tables) {
    const config = getTableConfig(table);

    it(`${config.name} has the same columns`, () => {
      const actual = sqlite
        .prepare<[], TableInfoRow>(`PRAGMA table_info(${config.name})`)
        .all();

      assert.deepEqual(
        config.columns.map((column) => column.name).sort(),
        actual.map((column) => column.name).sort(),
        'column names',
      );

      for (const column of config.columns) {
        const found = actual.find((row) => row.name === column.name)!;

        assert.equal(
          column.getSQLType().toLowerCase(),
          found.type.toLowerCase(),
          `${config.name}.${column.name} type`,
        );
        assert.equal(
          column.notNull,
          found.notnull === 1 || found.pk > 0,
          `${config.name}.${column.name} nullability`,
        );
      }
    });

    it(`${config.name} has the same primary key`, () => {
      const actual = sqlite
        .prepare<[], TableInfoRow>(`PRAGMA table_info(${config.name})`)
        .all()
        .filter((row) => row.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((row) => row.name);

      const declared = config.primaryKeys[0]
        ? config.primaryKeys[0].columns.map((column) => column.name)
        : config.columns.filter((column) => column.primary).map((column) => column.name);

      assert.deepEqual(declared, actual);
    });
  }
});
