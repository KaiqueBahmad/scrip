import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { canTransition } from '../src/domain/charges.js';
import { isValidBrCode } from '../src/lib/pix.js';
import { createCharge, createHarness, seedMerchantAndToken, type TestHarness } from './helpers.js';

let harness: TestHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe('state machine', () => {
  it('allows only the documented transitions', () => {
    assert.ok(canTransition('pending', 'paid'));
    assert.ok(canTransition('pending', 'expired'));
    assert.ok(canTransition('pending', 'canceled'));
    assert.ok(canTransition('paid', 'refunded'));
    assert.ok(canTransition('paid', 'partially_refunded'));
    assert.ok(canTransition('partially_refunded', 'refunded'));

    // Terminal states are terminal.
    assert.equal(canTransition('paid', 'expired'), false);
    assert.equal(canTransition('paid', 'pending'), false);
    assert.equal(canTransition('expired', 'paid'), false);
    assert.equal(canTransition('canceled', 'paid'), false);
    assert.equal(canTransition('refunded', 'refunded'), false);
  });

  it('rejects an illegal transition over the API with 409', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    const second = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'expired' },
    });

    assert.equal(second.statusCode, 409);
    const error = second.json().error;
    assert.equal(error.code, 'invalid_state_transition');
    assert.equal(error.details.from, 'paid');
    assert.equal(error.details.to, 'expired');
  });
});

describe('charge creation', () => {
  it('returns a QR code, expiry and public token', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    const { status, body } = await createCharge(harness, bearer, {
      payer_document: '22222222222',
      metadata: { order_id: 'abc-123' },
    });

    assert.equal(status, 201);
    assert.equal(body.status, 'pending');
    assert.equal(body.amount, 15000);
    assert.equal(body.amount_refunded, 0);
    assert.ok(isValidBrCode(body.qr_code));
    assert.deepEqual(body.metadata, { order_id: 'abc-123' });
    assert.equal(body.e2e_id, null, 'no e2e id before settlement');
  });

  it('rejects a non-positive or fractional amount', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    for (const amount of [0, -100, 10.5]) {
      const { status, body } = await createCharge(harness, bearer, { amount });
      assert.equal(status, 400, `amount ${amount}`);
      assert.equal(body.error.code, 'invalid_amount');
    }
  });

  it('rejects non-object metadata', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    const { status, body } = await createCharge(harness, bearer, { metadata: ['nope'] });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'invalid_metadata');
  });

  it('records a charge_created event', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    const events = harness.app.services.charges.listEvents(charge.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.from_status, null);
    assert.equal(events[0]?.to_status, 'pending');
    assert.equal(events[0]?.reason, 'charge_created');
  });
});

describe('deterministic test CPFs', () => {
  it('11111111111 confirms at the minimum delay', async () => {
    harness = await createHarness({ config: { pixMinConfirmationDelayMs: 500 } });
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '11111111111' });

    await harness.scheduler.advance(499);
    assert.equal(harness.app.services.charges.get(charge.id).status, 'pending');

    await harness.scheduler.advance(2);
    const settled = harness.app.services.charges.get(charge.id);
    assert.equal(settled.status, 'paid');
    assert.ok(settled.e2e_id, 'e2e id assigned on settlement');
    assert.ok(settled.paid_at);
  });

  it('22222222222 never confirms and expires instead', async () => {
    harness = await createHarness({ config: { pixQrCodeExpirationMs: 60000 } });
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.scheduler.advance(59_000);
    assert.equal(harness.app.services.charges.get(charge.id).status, 'pending');

    await harness.scheduler.advance(2000);
    const expired = harness.app.services.charges.get(charge.id);
    assert.equal(expired.status, 'expired');
    assert.ok(expired.expired_at);

    const events = harness.app.services.charges.listEvents(charge.id);
    assert.equal(events.at(-1)?.reason, 'qr_code_expired');
  });

  it('33333333333 confirms but exhausts every webhook attempt', async () => {
    harness = await createHarness({ config: { webhookMaxRetries: 3 } });
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '33333333333' });

    await harness.scheduler.runAll();

    assert.equal(harness.app.services.charges.get(charge.id).status, 'paid');
    assert.equal(harness.calls.length, 0, 'no HTTP request is ever sent for this CPF');

    const deliveries = harness.app.services.webhooks.listForMerchant(charge.merchant_id, {
      chargeId: charge.id,
    });

    assert.ok(deliveries.length >= 2, 'created and paid both attempted');
    for (const delivery of deliveries) {
      assert.equal(delivery.status, 'failed');
      assert.equal(delivery.attempt, 3);
      assert.equal(delivery.error, 'forced_failure_test_document');
    }
  });

  it('follows approvalRate for any other document', async () => {
    harness = await createHarness({ random: () => 0.99, config: { approvalRate: 0.85 } });
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: unlucky } = await createCharge(harness, bearer, { payer_document: '45678912300' });

    await harness.scheduler.runAll();
    assert.equal(
      harness.app.services.charges.get(unlucky.id).status,
      'expired',
      '0.99 >= 0.85 so it never confirms',
    );
    await harness.close();

    harness = await createHarness({ random: () => 0.1, config: { approvalRate: 0.85 } });
    const seeded = await seedMerchantAndToken(harness);
    const { body: lucky } = await createCharge(harness, seeded.bearer, {
      payer_document: '45678912300',
    });

    await harness.scheduler.advance(5000);
    assert.equal(harness.app.services.charges.get(lucky.id).status, 'paid', '0.1 < 0.85 confirms');
  });

  it('normalizes a formatted document', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, {
      payer_document: '111.111.111-11',
    });

    await harness.scheduler.advance(1000);
    assert.equal(harness.app.services.charges.get(charge.id).status, 'paid');
  });
});

describe('cancel and refund', () => {
  it('cancels a pending charge and blocks later settlement', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '11111111111' });

    const canceled = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/cancel`,
      headers: bearer,
    });

    assert.equal(canceled.statusCode, 200);
    assert.equal(canceled.json().status, 'canceled');

    // The auto-confirm timer was cancelled, so advancing time changes nothing.
    await harness.scheduler.runAll();
    assert.equal(harness.app.services.charges.get(charge.id).status, 'canceled');
  });

  it('moves through partially_refunded to refunded', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    const partial = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: { amount: 5000 },
    });

    assert.equal(partial.statusCode, 201);
    let current = harness.app.services.charges.get(charge.id);
    assert.equal(current.status, 'partially_refunded');
    assert.equal(current.refunded_amount, 5000);

    // Omitting the amount refunds whatever is left.
    const rest = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: {},
    });

    assert.equal(rest.statusCode, 201);
    assert.equal(rest.json().amount, 10000);
    current = harness.app.services.charges.get(charge.id);
    assert.equal(current.status, 'refunded');
    assert.equal(current.refunded_amount, 15000);
  });

  it('refuses to refund more than the outstanding amount', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    const tooMuch = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: { amount: 15001 },
    });

    assert.equal(tooMuch.statusCode, 400);
    assert.equal(tooMuch.json().error.code, 'refund_exceeds_charge');
  });

  it('refuses to refund a charge that was never paid', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/integration/pix/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: { amount: 100 },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'charge_not_refundable');
  });
});

describe('timer restoration', () => {
  it('expires a charge whose QR lapsed while the process was down', async () => {
    harness = await createHarness({ config: { pixQrCodeExpirationMs: 1000 } });
    const { bearer } = await seedMerchantAndToken(harness);
    const { body: charge } = await createCharge(harness, bearer, { payer_document: '22222222222' });

    // Simulate a restart: jump past the expiry without running the timer, then re-arm.
    harness.scheduler.clearAll();
    await harness.scheduler.advance(5000);

    harness.app.services.charges.restorePendingTimers();

    const restored = harness.app.services.charges.get(charge.id);
    assert.equal(restored.status, 'expired');
    assert.equal(
      harness.app.services.charges.listEvents(charge.id).at(-1)?.reason,
      'expired_while_offline',
    );
  });
});
