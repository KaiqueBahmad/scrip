import type { FastifyReply, FastifyRequest } from 'fastify';

import { unauthorized } from '../lib/errors.js';
import type { Services } from '../services.js';

/**
 * Panel auth (specs.md:35): HTTP Basic where the username is a user id or email and the
 * password is always empty. There is no password check at all — the panel is a user
 * *selector*, not a login (specs.md:54). Anyone who can reach the port is an admin, which
 * is why specs.md:110-118 says never to expose an instance publicly.
 */
export function requireAdminUser(services: Services) {
  return async function adminAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const match = header ? /^Basic\s+(.+)$/i.exec(header.trim()) : null;

    if (!match?.[1]) {
      reply.header('WWW-Authenticate', 'Basic realm="PseudoPay", charset="UTF-8"');
      throw unauthorized(
        'admin_auth_required',
        'Send HTTP Basic credentials: username is your user id or email, password is empty',
      );
    }

    let decoded: string;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      throw unauthorized('invalid_credentials', 'Basic credentials are not valid base64');
    }

    // The password half is intentionally ignored rather than required to be empty.
    const identifier = decoded.split(':', 1)[0] ?? '';

    if (!identifier.trim()) {
      throw unauthorized('invalid_credentials', 'Basic username (user id or email) is required');
    }

    const user = services.users.findByIdentifier(identifier);

    if (!user) {
      throw unauthorized(
        'user_not_found',
        `No panel user matches "${identifier}". Pick one from GET /admin/api/session/users`,
      );
    }

    request.adminUser = user;
  };
}

/** Reads the user resolved by `requireAdminUser`. */
export function adminUser(request: FastifyRequest) {
  const user = request.adminUser;
  if (!user) throw unauthorized('admin_auth_required', 'No panel user on this request');
  return user;
}
