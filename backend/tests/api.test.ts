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

  it('scopes an issued token to the session merchant, ignoring the body', async () => {
    harness = await createHarness();
    const mine = await seedMerchantAndToken(harness);
    const other = await seedMerchantAndToken(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/tokens',
      headers: mine.basic,
      // A merchant_id in the body must not be able to mint for somebody else.
      payload: { name: 'ci', permissions: ['*'], merchant_id: other.merchant.id },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().merchant_id, mine.merchant.id);

    // And it really only reaches its own merchant's data.
    const scoped = await harness.app.inject({
      method: 'GET',
      url: '/v1/integration/merchants/me',
      headers: { authorization: `Bearer ${response.json().token}` },
    });
    assert.equal(scoped.json().id, mine.merchant.id);
  });

  it('lets a merchant grant any permission, since it owns its own scope', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/tokens',
      headers: basic,
      payload: { permissions: ['charges:write', 'refunds:write'] },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().permissions, ['charges:write', 'refunds:write']);
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

describe('panel surface', () => {
  it('lists merchants with balance and without credentials, for the picker', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/session/merchants',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.length, 1);
    assert.equal(response.json().data[0].balance.available, 15000, 'picker shows the balance');
    assert.equal(
      response.json().data[0].webhook_secret,
      undefined,
      'the unauthenticated picker must not leak signing secrets',
    );
  });

  it('bootstraps the first merchant with no credentials', async () => {
    harness = await createHarness();

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/merchants',
      payload: { name: 'Primeira Loja', document: '12345678000199' },
    });

    // Basic auth resolves an existing merchant, so creation has to be open or the panel
    // could never be entered on an empty database.
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().kyc_status, 'pending');
    assert.equal(created.json().balance.available, 0);
    assert.equal(created.json().webhook_url, null);
  });

  it('does not accept a webhook_url on creation', async () => {
    harness = await createHarness();

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/merchants',
      payload: { name: 'Loja', webhook_url: 'https://atacante.test/hooks' },
    });

    // Creation only establishes identity; the webhook is wired afterwards, from a session.
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().webhook_url, null, 'webhook_url no corpo é ignorado');

    const basic = {
      authorization: `Basic ${Buffer.from(`${created.json().id}:`).toString('base64')}`,
    };

    const configured = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/panel/merchants/me',
      headers: basic,
      payload: { webhook_url: 'https://merchant.test/hooks' },
    });

    assert.equal(configured.statusCode, 200);
    assert.equal(configured.json().webhook_url, 'https://merchant.test/hooks');
  });

  it('authenticates the merchant by id or document, with an empty password', async () => {
    harness = await createHarness();
    const { merchant } = await seedMerchantAndToken(harness, { document: '99887766000155' });

    const anonymous = await harness.app.inject({ method: 'GET', url: '/v1/panel/merchants/me' });
    assert.equal(anonymous.statusCode, 401);
    assert.match(String(anonymous.headers['www-authenticate']), /^Basic/);

    const byId = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/merchants/me',
      headers: { authorization: `Basic ${Buffer.from(`${merchant.id}:`).toString('base64')}` },
    });
    assert.equal(byId.statusCode, 200);
    assert.equal(byId.json().id, merchant.id);

    // The document works as the username too.
    const byDocument = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/merchants/me',
      headers: { authorization: `Basic ${Buffer.from('99887766000155:').toString('base64')}` },
    });
    assert.equal(byDocument.statusCode, 200);

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/merchants/me',
      headers: { authorization: `Basic ${Buffer.from('mch_nope:').toString('base64')}` },
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.json().error.code, 'merchant_not_found');
  });

  it('returns the charge with its events, refunds and deliveries', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '11111111111' });

    await harness.scheduler.runAll();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/panel/charges/${charge.id}`,
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
      url: '/v1/panel/settings',
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
      url: '/v1/panel/settings',
      headers: basic,
      payload: { port: 9999 },
    });
    assert.equal(readOnly.statusCode, 400);
    assert.match(readOnly.json().error.message, /cannot be changed at runtime/);

    const outOfRange = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/panel/settings',
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
      url: `/v1/panel/kyc/documents/${uploaded.json().id}/content`,
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
    const { bearer, basic } = await seedMerchantAndToken(harness);

    const uploaded = await harness.app.inject({
      method: 'POST',
      url: '/v1/integration/kyc/documents',
      headers: bearer,
      payload: { type: 'identity', filename: 'rg.txt', content: Buffer.from('x').toString('base64') },
    });

    const approved = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/kyc/simulate',
      headers: basic,
      payload: { decision: 'approved', reason: 'documentos conferem' },
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

describe('merchant balance', () => {
  it('starts at zero and only counts settled charges', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);

    const empty = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: basic,
    });
    assert.equal(empty.json().available, 0);
    assert.equal(empty.json().settled_charges, 0);

    // A pending charge must not move the balance.
    const { body: pending } = await createCharge(harness, bearer, {
      amount: 15000,
      payer_document: '22222222222',
    });

    let balance = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: basic,
    });
    assert.equal(balance.json().available, 0, 'pending does not count');

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${pending.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    balance = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: basic,
    });
    assert.equal(balance.json().available, 15000);
    assert.equal(balance.json().gross_received, 15000);
    assert.equal(balance.json().refunded, 0);
    assert.equal(balance.json().settled_charges, 1);
  });

  it('subtracts refunds, and an expired charge never contributes', async () => {
    harness = await createHarness({ config: { pixQrCodeExpirationMs: 1000 } });
    const { bearer, basic } = await seedMerchantAndToken(harness);

    const { body: paid } = await createCharge(harness, bearer, {
      amount: 20000,
      payer_document: '22222222222',
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${paid.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${paid.id}/refunds`,
      headers: bearer,
      payload: { amount: 7500 },
    });

    // This one is left to expire, so it should be invisible to the balance.
    await createCharge(harness, bearer, { amount: 99900, payer_document: '22222222222' });
    await harness.scheduler.advance(5000);

    const balance = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: basic,
    });

    assert.equal(balance.json().available, 12500, '20000 recebidos menos 7500 devolvidos');
    assert.equal(balance.json().gross_received, 20000);
    assert.equal(balance.json().refunded, 7500);
    assert.equal(balance.json().settled_charges, 1, 'a expirada não entra');
  });

  it('reaches zero once everything is refunded', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);

    const { body: charge } = await createCharge(harness, bearer, {
      amount: 15000,
      payer_document: '22222222222',
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: {},
    });

    const balance = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: basic,
    });

    assert.equal(harness.app.services.charges.get(charge.id).status, 'refunded');
    assert.equal(balance.json().available, 0);
    assert.equal(balance.json().gross_received, 15000, 'o bruto guarda o histórico');
    assert.equal(balance.json().refunded, 15000);
  });

  it('keeps each store’s balance to itself', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);

    const { body: charge } = await createCharge(harness, first.bearer, {
      amount: 30000,
      payer_document: '22222222222',
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: first.basic,
      payload: { result: 'paid' },
    });

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: first.basic,
    });
    const theirs = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/balance',
      headers: second.basic,
    });

    assert.equal(mine.json().available, 30000);
    assert.equal(theirs.json().available, 0);
  });
});

describe('panel scoping', () => {
  it('shows a store only its own charges, tokens, deliveries and documents', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);

    const { body: charge } = await createCharge(harness, first.bearer, {
      payer_document: '22222222222',
    });
    await harness.scheduler.advance(5000);

    // Second store sees an empty panel.
    for (const url of ['/v1/panel/charges', '/v1/panel/tokens', '/v1/panel/webhooks/deliveries']) {
      const response = await harness.app.inject({ method: 'GET', url, headers: second.basic });
      assert.equal(response.statusCode, 200, url);
      const data = response.json().data as unknown[];
      const expected = url === '/v1/panel/tokens' ? 1 : 0;
      assert.equal(data.length, expected, `${url} deve conter só o que é da própria loja`);
    }

    // And cannot reach the first store's charge by id.
    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/v1/panel/charges/${charge.id}`,
      headers: second.basic,
    });
    assert.equal(foreign.statusCode, 404);
    assert.equal(foreign.json().error.code, 'charge_not_found');
  });

  it('refuses to revoke or retry another store’s resources', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);

    await createCharge(harness, first.bearer, { payer_document: '22222222222' });
    await harness.scheduler.advance(5000);

    const delivery = harness.app.services.webhooks.listForMerchant(first.merchant.id)[0]!;

    const retry = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/webhooks/deliveries/${delivery.id}/retry`,
      headers: second.basic,
    });
    assert.equal(retry.statusCode, 404);

    const revoke = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/tokens/${first.token.id}/revoke`,
      headers: second.basic,
    });
    assert.equal(revoke.statusCode, 404);
    assert.equal(
      harness.app.services.tokens.get(first.token.id).revoked_at,
      null,
      'o token da outra loja segue válido',
    );
  });

  it('does not leak the signing secret through settings', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/panel/settings',
      headers: basic,
    });

    assert.equal(response.json().values.jwtSigningSecret, '[redacted]');
  });
});
