import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createCharge, createHarness, seedMerchantAndToken, type TestHarness } from './helpers.js';

let harness: TestHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe('integration auth', () => {
  it('rejects a missing, malformed or revoked token', async () => {
    harness = await createHarness();
    const { bearer, token } = await seedMerchantAndToken(harness);

    const missing = await harness.app.inject({ method: 'GET', url: '/v1/integration/pix/charges' });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().error.code, 'integration_auth_required');

    const malformed = await harness.app.inject({
      method: 'GET',
      url: '/v1/integration/pix/charges',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    assert.equal(malformed.statusCode, 401);
    assert.equal(malformed.json().error.code, 'invalid_token');

    harness.app.services.tokens.revoke(token.id);

    const revoked = await harness.app.inject({
      method: 'GET',
      url: '/v1/integration/pix/charges',
      headers: bearer,
    });
    assert.equal(revoked.statusCode, 401);
    assert.equal(revoked.json().error.code, 'token_revoked');
  });

  it('enforces permissions per route', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness, { permissions: ['charges:read'] });

    const write = await createCharge(harness, bearer);
    assert.equal(write.status, 403);
    assert.equal(write.body.error.code, 'insufficient_permission');
    assert.equal(write.body.error.details.required, 'charges:write');

    const read = await harness.app.inject({
      method: 'GET',
      url: '/v1/integration/pix/charges',
      headers: bearer,
    });
    assert.equal(read.statusCode, 200);
  });

  it('never lets one merchant read another merchant’s charge', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);

    const { body: charge } = await createCharge(harness, first.bearer, {
      payer_document: '22222222222',
    });

    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/v1/integration/pix/charges/${charge.id}`,
      headers: second.bearer,
    });

    assert.equal(foreign.statusCode, 404, 'reported as missing, not forbidden');
    assert.equal(foreign.json().error.code, 'charge_not_found');

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/integration/pix/charges',
      headers: second.bearer,
    });
    assert.deepEqual(list.json().data, []);
  });

  it('refuses to issue a token with permissions the user lacks', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness, { permissions: ['charges:read'] });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/admin/api/tokens',
      headers: basic,
      payload: { permissions: ['charges:write'] },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'permission_escalation');
  });
});

describe('app surface', () => {
  it('reads a charge with its public_token and hides merchant data', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, {
      payer_document: '22222222222',
      metadata: { order_id: 'secret-order' },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/app/pix/charges/${charge.id}`,
      headers: { authorization: `Bearer ${charge.public_token}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.id, charge.id);
    assert.equal(body.status, 'pending');
    assert.equal(body.qr_code, charge.qr_code);
    assert.equal(body.metadata, undefined, 'metadata is not exposed to the payer');
    assert.equal(body.merchant_id, undefined);
    assert.equal(body.public_token, undefined);
    assert.equal(body.payer_document, undefined);
  });

  it('rejects a bad token and a token for a different charge', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: first } = await createCharge(harness, bearer, { payer_document: '22222222222' });
    const { body: second } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    const bad = await harness.app.inject({
      method: 'GET',
      url: `/v1/app/pix/charges/${first.id}`,
      headers: { authorization: 'Bearer pub_nope' },
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.json().error.code, 'invalid_public_token');

    // A valid token for another charge must not unlock this one.
    const crossed = await harness.app.inject({
      method: 'GET',
      url: `/v1/app/pix/charges/${first.id}`,
      headers: { authorization: `Bearer ${second.public_token}` },
    });
    assert.equal(crossed.statusCode, 404);
  });

  it('serves the qrcode endpoint', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/app/pix/charges/${charge.id}/qrcode`,
      headers: { authorization: `Bearer ${charge.public_token}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().qr_code, charge.qr_code);
    assert.equal(response.json().txid, charge.qr_code_txid);
  });

  it('reflects settlement on the next poll', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '11111111111' });

    await harness.scheduler.advance(1000);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/app/pix/charges/${charge.id}`,
      headers: { authorization: `Bearer ${charge.public_token}` },
    });

    assert.equal(response.json().status, 'paid');
    assert.ok(response.json().paid_at);
  });
});

describe('idempotency', () => {
  it('replays the stored response for a repeated key', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    const payload = { amount: 15000, payer_document: '22222222222' };
    const headers = { ...bearer, 'idempotency-key': 'order-1' };

    const first = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/pix/charges',
      headers,
      payload,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/pix/charges',
      headers,
      payload,
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(second.json().id, first.json().id, 'no second charge created');
    assert.equal(second.headers['idempotent-replay'], 'true');
    assert.equal(harness.app.services.charges.count({}), 1);
  });

  it('rejects the same key with a different body', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const headers = { ...bearer, 'idempotency-key': 'order-1' };

    await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/pix/charges',
      headers,
      payload: { amount: 15000 },
    });

    const changed = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/pix/charges',
      headers,
      payload: { amount: 9999 },
    });

    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, 'idempotency_key_reused');
  });

  it('scopes keys per merchant', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);
    const payload = { amount: 15000, payer_document: '22222222222' };

    const a = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/pix/charges',
      headers: { ...first.bearer, 'idempotency-key': 'shared' },
      payload,
    });
    const b = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/pix/charges',
      headers: { ...second.bearer, 'idempotency-key': 'shared' },
      payload,
    });

    assert.notEqual(a.json().id, b.json().id, 'different merchants get their own charges');
  });

  it('creates two charges when no key is sent', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    const a = await createCharge(harness, bearer, { payer_document: '22222222222' });
    const b = await createCharge(harness, bearer, { payer_document: '22222222222' });

    assert.notEqual(a.body.id, b.body.id);
  });
});

describe('admin surface', () => {
  it('lists users without credentials so the panel can offer a choice', async () => {
    harness = await createHarness();
    await seedMerchantAndToken(harness);

    const response = await harness.app.inject({ method: 'GET', url: '/admin/api/session/users' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.length, 1);
  });

  it('bootstraps the first user with no credentials', async () => {
    harness = await createHarness();

    const created = await harness.app.inject({
      method: 'POST',
      url: '/admin/api/users',
      payload: { name: 'First', email: 'first@example.com', permissions: ['*'] },
    });

    assert.equal(created.statusCode, 201, 'user CRUD is public (specs.md:114)');
  });

  it('requires Basic auth elsewhere and accepts an empty password', async () => {
    harness = await createHarness();
    const { user } = await seedMerchantAndToken(harness);

    const anonymous = await harness.app.inject({ method: 'GET', url: '/admin/api/merchants' });
    assert.equal(anonymous.statusCode, 401);
    assert.match(String(anonymous.headers['www-authenticate']), /^Basic/);

    const byId = await harness.app.inject({
      method: 'GET',
      url: '/admin/api/merchants',
      headers: { authorization: `Basic ${Buffer.from(`${user.id}:`).toString('base64')}` },
    });
    assert.equal(byId.statusCode, 200);

    // The email works as the username too.
    const byEmail = await harness.app.inject({
      method: 'GET',
      url: '/admin/api/merchants',
      headers: { authorization: `Basic ${Buffer.from(`${user.email}:`).toString('base64')}` },
    });
    assert.equal(byEmail.statusCode, 200);

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/admin/api/merchants',
      headers: { authorization: `Basic ${Buffer.from('nobody@example.com:').toString('base64')}` },
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.json().error.code, 'user_not_found');
  });

  it('returns the charge with its events, refunds and deliveries', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '11111111111' });

    await harness.scheduler.runAll();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/admin/api/charges/${charge.id}`,
      headers: basic,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.charge.status, 'paid');
    assert.equal(body.events.length, 2, 'created then paid');
    assert.ok(body.deliveries.length >= 1);
  });

  it('applies and persists a settings change', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: '/admin/api/settings',
      headers: basic,
      payload: { approvalRate: 0.5, requireApprovedKycForCharges: true },
    });

    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().values.approvalRate, 0.5);
    assert.equal(patched.json().values.requireApprovedKycForCharges, true);
    assert.equal(harness.app.services.config.get('approvalRate'), 0.5);

    const stored = harness.app.services.db
      .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
      .all();
    assert.equal(stored.length, 2, 'written to the settings table');
  });

  it('refuses a restart-only setting and an out-of-range value', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const readOnly = await harness.app.inject({
      method: 'PATCH',
      url: '/admin/api/settings',
      headers: basic,
      payload: { port: 9999 },
    });
    assert.equal(readOnly.statusCode, 400);
    assert.match(readOnly.json().error.message, /cannot be changed at runtime/);

    const outOfRange = await harness.app.inject({
      method: 'PATCH',
      url: '/admin/api/settings',
      headers: basic,
      payload: { approvalRate: 5 },
    });
    assert.equal(outOfRange.statusCode, 400);
  });
});

describe('kyc', () => {
  it('stores a base64 upload as a BLOB and returns it byte-for-byte', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const content = Buffer.from('documento de teste com acentuação');

    const uploaded = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/kyc/documents',
      headers: bearer,
      payload: {
        type: 'identity',
        filename: 'rg.txt',
        mime_type: 'text/plain',
        content: content.toString('base64'),
      },
    });

    assert.equal(uploaded.statusCode, 201);
    assert.equal(uploaded.json().size, content.length);
    assert.equal(uploaded.json().status, 'pending');

    const fetched = await harness.app.inject({
      method: 'GET',
      url: `/admin/api/kyc/documents/${uploaded.json().id}/content`,
      headers: basic,
    });

    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.headers['content-type'], 'text/plain');
    assert.deepEqual(fetched.rawPayload, content);
  });

  it('enforces kycMaxFileSizeMb', async () => {
    harness = await createHarness({ config: { kycMaxFileSizeMb: 0.001 } });
    const { bearer } = await seedMerchantAndToken(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/kyc/documents',
      headers: bearer,
      payload: {
        type: 'identity',
        filename: 'big.bin',
        content: Buffer.alloc(4096).toString('base64'),
      },
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, 'document_too_large');
  });

  it('rejects an empty or missing document', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    const missing = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/kyc/documents',
      headers: bearer,
      payload: { type: 'identity', filename: 'x.txt' },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().error.code, 'missing_file');
  });

  it('approval flips the merchant and its pending documents', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);

    const uploaded = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/kyc/documents',
      headers: bearer,
      payload: { type: 'identity', filename: 'rg.txt', content: Buffer.from('x').toString('base64') },
    });

    const approved = await harness.app.inject({
      method: 'POST',
      url: `/admin/api/merchants/${merchant.id}/kyc/approve`,
      headers: basic,
      payload: { reason: 'documentos conferem' },
    });

    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().kyc_status, 'approved');
    assert.equal(approved.json().kyc_reason, 'documentos conferem');
    assert.equal(
      harness.app.services.kyc.getDocument(uploaded.json().id).status,
      'approved',
      'documents follow the merchant decision',
    );
  });

  it('blocks charges only when the gate is switched on', async () => {
    // Default: off, so the README quickstart works against a fresh install.
    harness = await createHarness();
    const open = await seedMerchantAndToken(harness);
    assert.equal(open.merchant.kyc_status, 'pending');
    assert.equal((await createCharge(harness, open.bearer)).status, 201);
    await harness.close();

    harness = await createHarness({ config: { requireApprovedKycForCharges: true } });
    const gated = await seedMerchantAndToken(harness);

    const blocked = await createCharge(harness, gated.bearer);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'kyc_required');
    assert.equal(blocked.body.error.details.kyc_status, 'pending');

    harness.app.services.kyc.approve({ merchantId: gated.merchant.id, reason: null });
    assert.equal((await createCharge(harness, gated.bearer)).status, 201, 'allowed once approved');
  });
});

describe('error envelope', () => {
  it('uses the same shape for 404s across surfaces', async () => {
    harness = await createHarness();

    const unknown = await harness.app.inject({ method: 'GET', url: '/v1/nope' });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().error.code, 'not_found');
  });

  it('reports health without credentials', async () => {
    harness = await createHarness();
    const response = await harness.app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'ok');
  });
});
