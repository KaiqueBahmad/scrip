import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeSignature, parseSignatureHeader, signPayload, verifySignature } from '../src/lib/hmac.js';
import { decodeExpiry, signIntegrationToken, verifyIntegrationToken } from '../src/lib/jwt.js';
import { AppError } from '../src/lib/errors.js';
import {
  assertPermission,
  hasPermission,
  normalizePermissions,
} from '../src/auth/permissions.js';

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'pix.charge.paid', data: { amount: 15000 } });

  it('signs <timestamp>.<body> and verifies', () => {
    const at = Date.parse('2026-01-01T12:00:00.000Z');
    const signed = signPayload(secret, body, at);

    assert.equal(signed.timestamp, Math.floor(at / 1000));
    assert.equal(signed.header, `t=${signed.timestamp},v1=${signed.signature}`);
    assert.equal(signed.signature, computeSignature(secret, body, signed.timestamp));

    assert.ok(verifySignature({ secret, rawBody: body, header: signed.header, now: at }));
  });

  it('rejects a wrong secret, a changed body, and a swapped timestamp', () => {
    const at = Date.parse('2026-01-01T12:00:00.000Z');
    const { header } = signPayload(secret, body, at);

    assert.equal(
      verifySignature({ secret: 'whsec_other', rawBody: body, header, now: at }),
      false,
      'wrong secret',
    );
    assert.equal(
      verifySignature({ secret, rawBody: `${body} `, header, now: at }),
      false,
      'body changed by one byte',
    );

    // Same digest replayed under a different timestamp must not verify.
    const { signature } = parseSignatureHeader(header).signatures.length
      ? { signature: parseSignatureHeader(header).signatures[0]! }
      : { signature: '' };
    assert.equal(
      verifySignature({
        secret,
        rawBody: body,
        header: `t=${Math.floor(at / 1000) + 1},v1=${signature}`,
        now: at,
      }),
      false,
      'timestamp swapped',
    );
  });

  it('enforces the freshness window', () => {
    const at = Date.parse('2026-01-01T12:00:00.000Z');
    const { header } = signPayload(secret, body, at);

    const later = at + 10 * 60 * 1000;
    assert.equal(
      verifySignature({ secret, rawBody: body, header, now: later }),
      false,
      'outside the default 5 minute tolerance',
    );
    assert.ok(
      verifySignature({ secret, rawBody: body, header, now: later, toleranceSeconds: 0 }),
      'tolerance disabled',
    );
  });

  it('parses a header with multiple v1 values', () => {
    const parsed = parseSignatureHeader('t=1700000000,v1=aaa,v1=bbb');
    assert.equal(parsed.timestamp, 1700000000);
    assert.deepEqual(parsed.signatures, ['aaa', 'bbb']);
  });

  it('rejects a malformed header', () => {
    assert.equal(verifySignature({ secret, rawBody: body, header: 'garbage' }), false);
  });
});

describe('integration tokens', () => {
  const secret = 'test-secret';

  const sign = (overrides: Partial<Parameters<typeof signIntegrationToken>[0]> = {}) =>
    signIntegrationToken({
      secret,
      tokenId: 'tok_1',
      merchantId: 'mch_1',
      userId: 'usr_1',
      permissions: ['charges:read'],
      ...overrides,
    });

  it('round-trips the claims', () => {
    const claims = verifyIntegrationToken(sign(), secret);

    assert.equal(claims.sub, 'tok_1');
    assert.equal(claims.merchant_id, 'mch_1');
    assert.equal(claims.user_id, 'usr_1');
    assert.deepEqual(claims.permissions, ['charges:read']);
  });

  it('omits exp when no expiry is requested', () => {
    const token = sign();
    assert.equal(decodeExpiry(token), null);
    assert.equal(verifyIntegrationToken(token, secret).exp, undefined);
  });

  it('sets exp when an expiry is requested', () => {
    const token = sign({ expiresIn: '24h' });
    const expiry = decodeExpiry(token);

    assert.ok(expiry, 'expiry decoded');
    assert.ok(new Date(expiry).getTime() > Date.now(), 'expiry is in the future');
  });

  it('rejects a token signed with another secret', () => {
    const foreign = signIntegrationToken({
      secret: 'other-secret',
      tokenId: 'tok_1',
      merchantId: 'mch_1',
      userId: 'usr_1',
      permissions: [],
    });

    assert.throws(
      () => verifyIntegrationToken(foreign, secret),
      (err: unknown) => err instanceof AppError && err.code === 'invalid_token',
    );
  });

  it('rejects an expired token', () => {
    const expired = sign({ expiresIn: '-1s' });

    assert.throws(
      () => verifyIntegrationToken(expired, secret),
      (err: unknown) => err instanceof AppError && err.code === 'token_expired',
    );
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = sign().split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'tok_1', merchant_id: 'mch_evil', user_id: 'usr_1', permissions: ['*'] }),
    ).toString('base64url');

    assert.throws(() => verifyIntegrationToken(`${header}.${forged}.${signature}`, secret));
  });
});

describe('permissions', () => {
  it('treats the wildcard as everything', () => {
    assert.ok(hasPermission(['*'], 'charges:write'));
    assert.ok(hasPermission(['charges:write'], 'charges:write'));
    assert.equal(hasPermission(['charges:read'], 'charges:write'), false);
  });

  it('throws a 403 with the required permission named', () => {
    assert.throws(
      () => assertPermission(['charges:read'], 'refunds:write'),
      (err: unknown) =>
        err instanceof AppError && err.statusCode === 403 && err.code === 'insufficient_permission',
    );
  });

  it('de-duplicates and rejects unknown permissions', () => {
    assert.deepEqual(normalizePermissions(['charges:read', 'charges:read']), ['charges:read']);
    assert.deepEqual(normalizePermissions(undefined), []);
    assert.throws(() => normalizePermissions(['charges:teleport']), /Unknown permissions/);
    assert.throws(() => normalizePermissions('charges:read'), /must be an array/);
  });
});
