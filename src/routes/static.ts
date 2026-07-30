import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyPluginAsync } from 'fastify';

const here = dirname(fileURLToPath(import.meta.url));

/** dist/admin sits beside the compiled routes, and at ../../dist/admin when run via tsx. */
export function findAdminBuild(): string | null {
  const candidates = [
    resolve(here, '../admin'),
    resolve(here, '../../dist/admin'),
    resolve(process.cwd(), 'dist/admin'),
  ];

  return candidates.find((path) => existsSync(resolve(path, 'index.html'))) ?? null;
}

const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><title>PseudoPay</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6;padding:0 1rem">
<h1>Painel não compilado</h1>
<p>A API está rodando normalmente — só o painel ainda não foi compilado. Rode:</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem">npm run build:admin</pre>
<p>Ou, para desenvolver o painel com hot reload:</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:.5rem">npm --prefix admin run dev</pre>
</body>`;

/**
 * Serves the built panel at /admin (specs.md:52-54). When it has not been built the route
 * explains how instead of 404ing — running only the API with `npm run dev` is normal.
 */
export const adminUiRoutes: FastifyPluginAsync = async (app) => {
  const root = findAdminBuild();

  if (!root) {
    app.get('/admin', async (_request, reply) =>
      reply.status(503).type('text/html').send(NOT_BUILT_PAGE),
    );
    return;
  }

  await app.register(fastifyStatic, { root, prefix: '/admin/', decorateReply: false });

  // /admin without the trailing slash.
  app.get('/admin', async (_request, reply) =>
    reply.type('text/html').send(readFileSync(resolve(root, 'index.html'), 'utf8')),
  );
};

/** The SPA shell, for client-side routes like /admin/transactions. */
export function readAdminShell(): string | null {
  const root = findAdminBuild();
  return root ? readFileSync(resolve(root, 'index.html'), 'utf8') : null;
}
