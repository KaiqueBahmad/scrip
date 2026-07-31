import { openDb } from '../src/db/index.js';
import { ManualScheduler } from '../src/lib/scheduler.js';
import { buildServer, type PseudoPayServer } from '../src/server.js';
import type { PseudoPayConfig } from '../src/config.js';

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Stub webhook transport. `respond` decides the status per call, so a test can fail the
 * first attempt and succeed on the retry.
 */
export function createFetchStub(respond: (call: number, url: string) => number | Error = () => 200) {
  const calls: RecordedRequest[] = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }

    calls.push({ url, headers, body: String(init?.body ?? '') });

    const outcome = respond(calls.length, url);
    if (outcome instanceof Error) throw outcome;

    return new Response('{"ok":true}', {
      status: outcome,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

export interface TestHarness {
  app: PseudoPayServer;
  scheduler: ManualScheduler;
  calls: RecordedRequest[];
  close: () => Promise<void>;
}

/**
 * In-memory database plus a virtual clock, so nothing in the suite sleeps and every
 * simulated delay is advanced explicitly.
 */
export async function createHarness(
  options: {
    config?: Partial<PseudoPayConfig>;
    respond?: (call: number, url: string) => number | Error;
    random?: () => number;
  } = {},
): Promise<TestHarness> {
  const db = openDb({ databasePath: ':memory:' });
  const scheduler = new ManualScheduler(Date.parse('2026-01-01T12:00:00.000Z'));
  const { calls, fetchImpl } = createFetchStub(options.respond);

  const app = await buildServer({
    db,
    scheduler,
    fetchImpl,
    logger: false,
    ...(options.random ? { random: options.random } : {}),
    config: {
      databasePath: ':memory:',
      jwtSigningSecret: 'test-secret',
      webhookDelayMs: 1000,
      webhookRetryBackoffMs: 1000,
      pixConfirmationDelayMs: 4000,
      pixMinConfirmationDelayMs: 500,
      // Long by default so advancing time for webhook retries does not trip expiry;
      // tests that exercise expiration set their own value.
      pixQrCodeExpirationMs: 600_000,
      ...options.config,
    },
  });

  return {
    app,
    scheduler,
    calls,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

/**
 * Creates a merchant and one of its integration tokens, returning ready-to-use headers.
 * The merchant is the panel identity now, so `basic` authenticates as the merchant itself.
 */
export async function seedMerchantAndToken(
  harness: TestHarness,
  options: {
    webhookUrl?: string | null;
    permissions?: string[];
    name?: string;
  } = {},
) {
  const { app } = harness;

  const created = app.services.merchants.create({
    name: options.name ?? 'Loja de Teste',
    webhookSecret: 'whsec_fixed_for_tests',
  });

  // Creation never sets a webhook, so tests that need one configure it the way the panel
  // does. `??` would swallow an explicit null, which is exactly the "no webhook_url" case.
  const webhookUrl = 'webhookUrl' in options ? options.webhookUrl : 'https://merchant.test/hooks';

  const merchant = webhookUrl
    ? app.services.merchants.update(created.id, { webhookUrl })
    : created;

  const token = app.services.tokens.issue({
    merchantId: merchant.id,
    name: 'test',
    permissions: options.permissions ?? ['*'],
  });

  return {
    merchant,
    token,
    bearer: { authorization: `Bearer ${token.token}` },
    basic: { authorization: `Basic ${Buffer.from(`${merchant.id}:`).toString('base64')}` },
  };
}

/** POST /v1/integration/pix/charges, returning the parsed body. */
export async function createCharge(
  harness: TestHarness,
  bearer: Record<string, string>,
  body: Record<string, unknown> = {},
) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/integration/pix/charges',
    headers: bearer,
    payload: { amount: 15000, ...body },
  });

  return { status: response.statusCode, body: response.json() as Record<string, any> };
}
