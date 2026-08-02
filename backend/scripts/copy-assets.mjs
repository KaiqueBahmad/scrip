// tsc only emits .ts -> .js; the generated migrations have to be copied into dist by hand.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await mkdir(resolve(root, 'dist/db'), { recursive: true });
await cp(resolve(root, 'src/db/migrations'), resolve(root, 'dist/db/migrations'), {
  recursive: true,
});

console.log('copied src/db/migrations -> dist/db/migrations');
