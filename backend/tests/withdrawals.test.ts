import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createCharge, createHarness, seedMerchantAndToken, type TestHarness } from './helpers';

let harness: TestHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** Creates a charge and marks it paid via the panel, so the merchant has a spendable balance. */
async function seedBalance(harness: TestHarness, bearer: Record<string, string>, basic: Record<string, string>, amount = 15000) {
  const { body: charge } = await createCharge(harness, bearer, { amount });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/panel/charges/${charge.id}/simulate`,
    headers: basic,
    payload: { result: 'paid' },
  });
  return charge;
}

describe('withdrawal creation', () => {
  it('reserves the amount against available balance immediately', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/api/withdrawals',
      headers: bearer,
      payload: { amount: 10000 },
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.json().status, 'pending');

    assert.equal(harness.app.services.merchants.balanceFor(merchant.id).available, 5000);
  });

  it('rejects a withdrawal that exceeds the available balance', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/api/withdrawals',
      headers: bearer,
      payload: { amount: 15001 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'insufficient_balance');
  });

  it('rejects a non-positive or fractional amount', async () => {
    harness = await createHarness();
    const { bearer } = await seedMerchantAndToken(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/api/withdrawals',
      headers: bearer,
      payload: { amount: 0 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_amount');
  });

  it('is also reachable from the panel', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/withdrawals',
      headers: basic,
      payload: { amount: 5000 },
    });

    assert.equal(created.statusCode, 201);
  });
});

describe('withdrawal confirm/deny', () => {
  it('confirming keeps the amount debited and fires withdrawal.confirmed', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/withdrawals',
      headers: basic,
      payload: { amount: 10000 },
    });
    const withdrawalId = created.json().id;

    const confirmed = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/withdrawals/${withdrawalId}/confirm`,
      headers: basic,
    });

    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().status, 'confirmed');
    assert.equal(harness.app.services.merchants.balanceFor(merchant.id).available, 5000);
    assert.equal(harness.app.services.merchants.balanceFor(merchant.id).withdrawn, 10000);

    await harness.scheduler.advance(2000);
    const delivery = harness.app.services.webhooks
      .listForMerchant(merchant.id)
      .find((d) => d.event === 'withdrawal.confirmed');
    assert.ok(delivery, 'withdrawal.confirmed was dispatched');
  });

  it('denying releases the reserved amount back to available and fires withdrawal.denied', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/withdrawals',
      headers: basic,
      payload: { amount: 10000 },
    });
    const withdrawalId = created.json().id;

    const denied = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/withdrawals/${withdrawalId}/deny`,
      headers: basic,
      payload: { reason: 'suspicious' },
    });

    assert.equal(denied.statusCode, 200);
    assert.equal(denied.json().status, 'denied');
    assert.equal(denied.json().reason, 'suspicious');
    assert.equal(harness.app.services.merchants.balanceFor(merchant.id).available, 15000);

    await harness.scheduler.advance(2000);
    const delivery = harness.app.services.webhooks
      .listForMerchant(merchant.id)
      .find((d) => d.event === 'withdrawal.denied');
    assert.ok(delivery, 'withdrawal.denied was dispatched');
  });

  it('refuses to confirm or deny a withdrawal that already left the pending state', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/withdrawals',
      headers: basic,
      payload: { amount: 5000 },
    });
    const withdrawalId = created.json().id;

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/withdrawals/${withdrawalId}/confirm`,
      headers: basic,
    });

    const secondConfirm = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/withdrawals/${withdrawalId}/confirm`,
      headers: basic,
    });

    assert.equal(secondConfirm.statusCode, 409);
    assert.equal(secondConfirm.json().error.code, 'invalid_withdrawal_status');
  });

  it('does not expose confirm/deny on the integration API', async () => {
    harness = await createHarness();
    const { bearer, basic } = await seedMerchantAndToken(harness);
    await seedBalance(harness, bearer, basic, 15000);

    const created = await createWithdrawal(harness, bearer, 5000);

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/api/withdrawals/${created.id}/confirm`,
      headers: bearer,
    });

    assert.equal(response.statusCode, 404);
  });
});

describe('withdrawal listing and isolation', () => {
  it('never lets one merchant read or list another merchant’s withdrawal', async () => {
    harness = await createHarness();
    const first = await seedMerchantAndToken(harness);
    const second = await seedMerchantAndToken(harness);
    await seedBalance(harness, first.bearer, first.basic, 15000);

    const created = await createWithdrawal(harness, first.bearer, 5000);

    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/v1/api/withdrawals/${created.id}`,
      headers: second.bearer,
    });
    assert.equal(foreign.statusCode, 404);
    assert.equal(foreign.json().error.code, 'withdrawal_not_found');

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/api/withdrawals',
      headers: second.bearer,
    });
    assert.deepEqual(list.json().data, []);
  });
});

async function createWithdrawal(harness: TestHarness, bearer: Record<string, string>, amount: number) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/api/withdrawals',
    headers: bearer,
    payload: { amount },
  });
  return response.json() as Record<string, any>;
}
