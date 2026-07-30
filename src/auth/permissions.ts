import { forbidden } from '../lib/errors.js';

/**
 * Permission vocabulary shared by users and integration tokens. A token can never hold a
 * permission its issuing user lacks (see TokenService.issue).
 */
export const PERMISSIONS = [
  'charges:read',
  'charges:write',
  'refunds:write',
  'simulate:write',
  'merchants:read',
  'merchants:write',
  'kyc:read',
  'kyc:write',
  'webhooks:read',
  'webhooks:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Grants everything, including permissions added in future versions. */
export const WILDCARD = '*';

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/** Accepts the wildcard alongside the known permissions. */
export function isGrantable(value: unknown): boolean {
  return value === WILDCARD || isPermission(value);
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(WILDCARD) || granted.includes(required);
}

export function assertPermission(granted: readonly string[], required: Permission): void {
  if (hasPermission(granted, required)) return;

  throw forbidden(
    'insufficient_permission',
    `This credential is missing the "${required}" permission`,
    { required, granted },
  );
}

/** Validates and de-duplicates a permission list coming off the wire. */
export function normalizePermissions(input: unknown): string[] {
  if (input === undefined || input === null) return [];

  if (!Array.isArray(input)) {
    throw forbidden('invalid_permissions', 'permissions must be an array of strings');
  }

  const invalid = input.filter((p) => !isGrantable(p));
  if (invalid.length > 0) {
    throw forbidden('invalid_permissions', `Unknown permissions: ${invalid.join(', ')}`, {
      invalid,
      allowed: [WILDCARD, ...PERMISSIONS],
    });
  }

  return [...new Set(input as string[])];
}
