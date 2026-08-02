/**
 * drizzle-kit only runs at development time (`npm run db:generate`). At runtime the app
 * applies the files in src/db/migrations itself — see openDb — so this config never ships.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  // Beside the db module, so the same relative path resolves from src/ (ts-node) and dist/.
  out: './src/db/migrations',
});
