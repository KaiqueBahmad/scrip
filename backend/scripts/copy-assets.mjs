// tsc only emits .ts -> .js; schema.sql has to be copied into dist by hand.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await mkdir(resolve(root, 'dist/db'), { recursive: true });
await cp(resolve(root, 'src/db/schema.sql'), resolve(root, 'dist/db/schema.sql'));

console.log('copied src/db/schema.sql -> dist/db/schema.sql');
