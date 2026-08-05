import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createCharge, createHarness, seedMerchantAndToken, type TestHarness } from './helpers';

let harness: TestHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe('pix fee configuration', () => {
  it('defaults new merchants to zero fees', async () => {
    harness = await createHarness();
    const { merchant } = await seedMerchantAndToken(harness);

    assert.equal(merchant.pix_fee_in_bps, 0);
    assert.equal(merchant.pix_fee_out_bps, 0);
  });

  it('lets the store configure its entry and exit fee over the panel', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/panel/merchants/me',
      headers: basic,
      payload: { pix_fee_in_bps: 250, pix_fee_out_bps: 100 },
    });

    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().pix_fee_in_bps, 250);
    assert.equal(updated.json().pix_fee_out_bps, 100);
  });

  it('rejects a fee outside 0-10000 basis points', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const tooHigh = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/panel/merchants/me',
      headers: basic,
      payload: { pix_fee_in_bps: 10001 },
    });
    assert.equal(tooHigh.statusCode, 400);
    assert.equal(tooHigh.json().error.code, 'invalid_pix_fee_in_bps');

    const negative = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/panel/merchants/me',
      headers: basic,
      payload: { pix_fee_out_bps: -1 },
    });
    assert.equal(negative.statusCode, 400);
    assert.equal(negative.json().error.code, 'invalid_pix_fee_out_bps');
  });

  it('rejects a fractional basis-point value', async () => {
    harness = await createHarness();
    const { basic } = await seedMerchantAndToken(harness);

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/panel/merchants/me',
      headers: basic,
      payload: { pix_fee_in_bps: 2.5 },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_pix_fee_in_bps');
  });
});

describe('pix entry fee applied on settlement', () => {
  it('snapshots the fee onto the charge and nets it out of the available balance', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeInBps: 250 }); // 2.5%

    const { body: charge } = await createCharge(harness, bearer, { amount: 20000 });
    const paid = await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    assert.equal(paid.statusCode, 200);
    // 2.5% of 20000 = 500
    assert.equal(paid.json().fee_amount, 500);

    const balance = harness.app.services.merchants.balanceFor(merchant.id);
    assert.equal(balance.gross_received, 20000);
    assert.equal(balance.fees_in, 500);
    assert.equal(balance.available, 19500);
  });

  it('keeps the fee already charged even once the charge is refunded', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeInBps: 1000 }); // 10%

    const { body: charge } = await createCharge(harness, bearer, { amount: 10000 });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    await harness.app.inject({
      method: 'POST',
      url: `/v1/api/payments/charges/${charge.id}/refunds`,
      headers: bearer,
      payload: {},
    });

    const balance = harness.app.services.merchants.balanceFor(merchant.id);
    // Full refund still leaves the 1000 fee charged, so the merchant nets negative on this charge.
    assert.equal(balance.refunded, 10000);
    assert.equal(balance.fees_in, 1000);
    assert.equal(balance.available, -1000);
  });

  it('a rate change never reaches back into a charge that already settled', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeInBps: 500 });

    const { body: charge } = await createCharge(harness, bearer, { amount: 10000 });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });

    harness.app.services.merchants.update(merchant.id, { pixFeeInBps: 0 });

    const balance = harness.app.services.merchants.balanceFor(merchant.id);
    assert.equal(balance.fees_in, 500);
  });
});

describe('pix exit fee applied on withdrawal', () => {
  async function seedBalance(harness: TestHarness, bearer: Record<string, string>, basic: Record<string, string>, amount: number) {
    const { body: charge } = await createCharge(harness, bearer, { amount });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/charges/${charge.id}/simulate`,
      headers: basic,
      payload: { result: 'paid' },
    });
  }

  it('snapshots the fee onto the withdrawal and holds amount + fee against the balance', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeOutBps: 200 }); // 2%
    await seedBalance(harness, bearer, basic, 10000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/api/withdrawals',
      headers: bearer,
      payload: { amount: 5000 },
    });

    assert.equal(created.statusCode, 201);
    // 2% of 5000 = 100
    assert.equal(created.json().fee_amount, 100);
    assert.equal(
      harness.app.services.merchants.balanceFor(merchant.id).available,
      10000 - 5000 - 100,
    );
  });

  it('rejects a withdrawal whose amount plus fee exceeds the available balance', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeOutBps: 1000 }); // 10%
    await seedBalance(harness, bearer, basic, 10000);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/api/withdrawals',
      headers: bearer,
      // amount + 10% fee = 11000 > 10000 available
      payload: { amount: 10000 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'insufficient_balance');
  });

  it('confirming reflects the exit fee in fees_out, informationally on top of withdrawn', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeOutBps: 200 });
    await seedBalance(harness, bearer, basic, 10000);

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

    const balance = harness.app.services.merchants.balanceFor(merchant.id);
    assert.equal(balance.withdrawn, 5000);
    assert.equal(balance.fees_out, 100);
    assert.equal(balance.available, 10000 - 5000 - 100);
  });

  it('denying releases both the amount and its fee back to available', async () => {
    harness = await createHarness();
    const { bearer, basic, merchant } = await seedMerchantAndToken(harness);
    harness.app.services.merchants.update(merchant.id, { pixFeeOutBps: 200 });
    await seedBalance(harness, bearer, basic, 10000);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/panel/withdrawals',
      headers: basic,
      payload: { amount: 5000 },
    });
    const withdrawalId = created.json().id;

    await harness.app.inject({
      method: 'POST',
      url: `/v1/panel/withdrawals/${withdrawalId}/deny`,
      headers: basic,
      payload: { reason: 'test' },
    });

    assert.equal(harness.app.services.merchants.balanceFor(merchant.id).available, 10000);
  });
});
