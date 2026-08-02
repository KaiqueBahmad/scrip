import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** dist/panel sits beside the compiled code, and at ../dist/panel when run via tsx. */
export function findPanelBuild(): string | null {
  const candidates = [
    resolve(__dirname, 'panel'),
    resolve(__dirname, '../dist/panel'),
    resolve(process.cwd(), 'dist/panel'),
  ];

  return candidates.find((path) => existsSync(resolve(path, 'index.html'))) ?? null;
}

/** The SPA shell, for client-side routes like /transactions. Null when not built yet. */
export function readPanelShell(): string | null {
  const root = findPanelBuild();
  return root ? readFileSync(resolve(root, 'index.html'), 'utf8') : null;
}

/**
 * Shown instead of a 404 when the panel has not been compiled — running only the API with
 * `npm run dev` is normal, so the page explains the missing step rather than failing.
 */
export const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><title>PseudoPay</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6;padding:0 1rem">
<h1>Painel não compilado</h1>
<p>A API está rodando normalmente — só o painel ainda não foi compilado. Rode:</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem">npm run build:panel</pre>
<p>Ou, para desenvolver o painel com hot reload:</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem">npm --prefix ../frontend run dev</pre>
</body>`;
