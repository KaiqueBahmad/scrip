import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { SIGNATURE_HEADER, verifySignature } from '../src/lib/hmac.js';
import { createCharge, createHarness, seedMerchantAndToken, type TestHarness } from './helpers.js';

let harness: TestHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe('webhook delivery', () => {
  it('signs the payload with the merchant secret and marks it delivered', async () => {
    harness = await createHarness();
    const { bearer, merchant } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(2000);

    assert.equal(harness.calls.length, 1);
    const call = harness.calls[0]!;

    assert.equal(call.url, 'https://merchant.test/hooks');
    assert.equal(call.headers['x-pseudopay-event'], 'pix.charge.created');
    assert.equal(call.headers['x-pseudopay-attempt'], '1');

    const header = call.headers[SIGNATURE_HEADER]!;
    assert.ok(
      verifySignature({
        secret: merchant.webhook_secret,
        rawBody: call.body,
        header,
        toleranceSeconds: 0,
      }),
      'signature verifies with the merchant secret',
    );
    assert.equal(
      verifySignature({
        secret: 'whsec_wrong',
        rawBody: call.body,
        header,
        toleranceSeconds: 0,
      }),
      false,
    );

    const envelope = JSON.parse(call.body);
    assert.equal(envelope.event, 'pix.charge.created');
    assert.equal(envelope.data.charge.id, charge.id);

    const deliveries = harness.app.services.webhooks.listForMerchant(merchant.id);
    assert.equal(deliveries[0]?.status, 'delivered');
    assert.equal(deliveries[0]?.response_status, 200);
  });

  it('waits webhookDelayMs before the first attempt', async () => {
    harness = await createHarness({ config: { webhookDelayMs: 3000 } });
    const { bearer } = await seedMerchantAndToken(harness);
    await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(2999);
    assert.equal(harness.calls.length, 0);

    await harness.scheduler.advance(2);
    assert.equal(harness.calls.length, 1);
  });

  it('retries on a non-2xx response and stops after webhookMaxRetries', async () => {
    harness = await createHarness({
      respond: () => 500,
      config: { webhookMaxRetries: 3, webhookRetryBackoffMs: 1000 },
    });
    const { bearer, merchant } = await seedMerchantAndToken(harness);
    await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(30_000);

    assert.equal(harness.calls.length, 3, 'exactly three attempts');
    assert.deepEqual(
      harness.calls.map((call) => call.headers['x-pseudopay-attempt']),
      ['1', '2', '3'],
    );

    const delivery = harness.app.services.webhooks.listForMerchant(merchant.id)[0]!;
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.attempt, 3);
    assert.equal(delivery.response_status, 500);
    assert.match(delivery.error ?? '', /responded 500/);
  });

  it('stops retrying once the endpoint recovers', async () => {
    harness = await createHarness({ respond: (call) => (call === 1 ? 500 : 200) });
    const { bearer, merchant } = await seedMerchantAndToken(harness);
    await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(30_000);

    assert.equal(harness.calls.length, 2, 'failed once, then succeeded');
    const delivery = harness.app.services.webhooks.listForMerchant(merchant.id)[0]!;
    assert.equal(delivery.status, 'delivered');
    assert.equal(delivery.attempt, 2);
    assert.equal(delivery.error, null);
  });

  it('records a transport error as a failed attempt', async () => {
    harness = await createHarness({
      respond: () => new Error('connect ECONNREFUSED'),
      config: { webhookMaxRetries: 2 },
    });
    const { bearer, merchant } = await seedMerchantAndToken(harness);
    await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(30_000);

    const delivery = harness.app.services.webhooks.listForMerchant(merchant.id)[0]!;
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.attempt, 2);
    assert.match(delivery.error ?? '', /ECONNREFUSED/);
    assert.equal(delivery.response_status, null);
  });

  it('does not enqueue anything when the merchant has no webhook_url', async () => {
    harness = await createHarness();
    const { bearer, merchant } = await seedMerchantAndToken(harness, { webhookUrl: null });
    await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(30_000);

    assert.equal(harness.calls.length, 0);
    assert.equal(harness.app.services.webhooks.listForMerchant(merchant.id).length, 0);
  });

  it('re-sends a failed delivery on manual retry', async () => {
    let failing = true;
    harness = await createHarness({ respond: () => (failing ? 500 : 200) });
    const { bearer, merchant } = await seedMerchantAndToken(harness);
    await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(30_000);
    const failed = harness.app.services.webhooks.listForMerchant(merchant.id)[0]!;
    assert.equal(failed.status, 'failed');

    failing = false;
    const retried = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/webhooks/deliveries/${failed.id}/retry`,
      headers: bearer,
    });

    assert.equal(retried.statusCode, 200);
    assert.equal(retried.json().status, 'pending', 'reset to pending, attempt counter cleared');
    assert.equal(retried.json().attempt, 0);

    await harness.scheduler.advance(30_000);
    assert.equal(harness.app.services.webhooks.get(failed.id).status, 'delivered');
  });

  it('emits the full documented event set', async () => {
    // Short expiry so pix.charge.expired lands inside the advance below.
    harness = await createHarness({ config: { pixQrCodeExpirationMs: 5000 } });
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/simulate`,
      headers: bearer,
      payload: { result: 'paid' },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: {},
    });
    await harness.app.inject({
      method: 'POST',
      url: `/admin/api/merchants/${merchant.id}/kyc/approve`,
      headers: basic,
      payload: { reason: 'ok' },
    });

    // A second charge left to expire covers pix.charge.expired.
    const { body: expiring } = await createCharge(harness, bearer, {
      payer_document: '22222222222',
    });
    await harness.scheduler.advance(30_000);
    assert.equal(harness.app.services.charges.get(expiring.id).status, 'expired');

    const events = new Set(
      harness.app.services.webhooks.listForMerchant(merchant.id).map((d) => d.event),
    );

    for (const expected of [
      'pix.charge.created',
      'pix.charge.paid',
      'pix.charge.refunded',
      'pix.charge.expired',
      'kyc.approved',
    ]) {
      assert.ok(events.has(expected), `${expected} was dispatched`);
    }
  });

  it('rejects retrying another merchant’s delivery', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);

    await createCharge(harness, first.bearer, { payer_document: '22222222222' });
    await harness.scheduler.advance(30_000);

    const delivery = harness.app.services.webhooks.listForMerchant(first.merchant.id)[0]!;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/webhooks/deliveries/${delivery.id}/retry`,
      headers: second.bearer,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'delivery_not_found');
  });
});
