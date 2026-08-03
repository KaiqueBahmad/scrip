import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runtime configuration. The keys documented in the README are the public contract; the
 * rest are additions this implementation needs.
 */
export interface ScripConfig {
  /** Port the Fastify server listens on. */
  port: number;
  /** Interface to bind. Defaults to loopback — this is a dev tool, not a public service. */
  host: string;
  /** SQLite file. `:memory:` is honored and used by the test suite. */
  databasePath: string;

  /** Probability a charge from an unrecognized payer_document confirms. 0..1 */
  approvalRate: number;
  /** Delay before a charge auto-confirms. */
  pixConfirmationDelayMs: number;
  /** Floor used by the "always confirms" test CPF. */
  pixMinConfirmationDelayMs: number;
  /** Lifetime of a QR code before the charge expires. */
  pixQrCodeExpirationMs: number;

  /** Delay between an event happening and its first webhook attempt. */
  webhookDelayMs: number;
  /** Total attempts per delivery, first included. */
  webhookMaxRetries: number;
  /** Base backoff between webhook attempts; grows linearly with the attempt number. */
  webhookRetryBackoffMs: number;
  /** Per-attempt HTTP timeout. */
  webhookTimeoutMs: number;

  /** Secret used to sign API JWTs. */
  jwtSigningSecret: string;
  /** Default `expiresIn` for issued tokens. Empty string issues a token with no `exp`. */
  jwtDefaultExpiration: string;

  /** Upload ceiling for KYC documents, in megabytes. */
  kycMaxFileSizeMb: number;
  /**
   * When true, a merchant whose kyc_status is not 'approved' cannot create charges.
   * Defaults to false so the README quickstart works against a fresh install; flip it on
   * to exercise the blocking path.
   */
  requireApprovedKycForCharges: boolean;

  /** PIX key baked into generated BR Codes. */
  pixKey: string;
  /** Receiver name baked into generated BR Codes. */
  pixReceiverName: string;
  /** Receiver city baked into generated BR Codes. */
  pixReceiverCity: string;
}

export const CONFIG_DEFAULTS: ScripConfig = {
  port: 4242,
  host: '127.0.0.1',
  databasePath: 'data/scrip.sqlite',

  approvalRate: 0.85,
  pixConfirmationDelayMs: 4000,
  pixMinConfirmationDelayMs: 500,
  pixQrCodeExpirationMs: 900000,

  webhookDelayMs: 3000,
  webhookMaxRetries: 3,
  webhookRetryBackoffMs: 2000,
  webhookTimeoutMs: 5000,

  jwtSigningSecret: 'change-me',
  jwtDefaultExpiration: '24h',

  kycMaxFileSizeMb: 5,
  requireApprovedKycForCharges: false,

  pixKey: 'scrip@localhost',
  pixReceiverName: 'SCRIP',
  pixReceiverCity: 'SAO PAULO',
};

export const CONFIG_FILE = 'scrip.config.json';

/** `approvalRate` -> `SCRIP_APPROVAL_RATE` */
function envNameFor(key: string): string {
  return `SCRIP_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

function coerce(key: keyof ScripConfig, raw: unknown): unknown {
  const fallback = CONFIG_DEFAULTS[key];

  if (typeof fallback === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) {
      throw new Error(`Config "${key}" must be a number, got ${JSON.stringify(raw)}`);
    }
    return n;
  }

  if (typeof fallback === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    throw new Error(`Config "${key}" must be a boolean, got ${JSON.stringify(raw)}`);
  }

  return String(raw);
}

function validate(config: ScripConfig): ScripConfig {
  if (config.approvalRate < 0 || config.approvalRate > 1) {
    throw new Error(`Config "approvalRate" must be between 0 and 1, got ${config.approvalRate}`);
  }
  if (config.webhookMaxRetries < 1) {
    throw new Error(`Config "webhookMaxRetries" must be at least 1, got ${config.webhookMaxRetries}`);
  }
  if (config.kycMaxFileSizeMb <= 0) {
    throw new Error(`Config "kycMaxFileSizeMb" must be positive, got ${config.kycMaxFileSizeMb}`);
  }
  for (const key of ['pixConfirmationDelayMs', 'pixQrCodeExpirationMs', 'webhookDelayMs'] as const) {
    if (config[key] < 0) throw new Error(`Config "${key}" cannot be negative, got ${config[key]}`);
  }
  return config;
}

/**
 * Layers, lowest precedence first: defaults, scrip.config.json, SCRIP_* env vars,
 * then explicit overrides (used by tests).
 */
export function loadConfig(
  overrides: Partial<ScripConfig> = {},
  cwd = process.cwd(),
): ScripConfig {
  const config: ScripConfig = { ...CONFIG_DEFAULTS };

  let fromFile: Record<string, unknown> = {};
  try {
    fromFile = JSON.parse(readFileSync(resolve(cwd, CONFIG_FILE), 'utf8')) as Record<string, unknown>;
  } catch (err) {
    // A missing config file is fine — defaults plus env are enough to boot.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  for (const key of Object.keys(CONFIG_DEFAULTS) as (keyof ScripConfig)[]) {
    if (key in fromFile && fromFile[key] !== undefined && fromFile[key] !== null) {
      Object.assign(config, { [key]: coerce(key, fromFile[key]) });
    }

    const fromEnv = process.env[envNameFor(key)];
    if (fromEnv !== undefined && fromEnv !== '') {
      Object.assign(config, { [key]: coerce(key, fromEnv) });
    }
  }

  const unknownFileKeys = Object.keys(fromFile).filter((k) => !(k in CONFIG_DEFAULTS));
  if (unknownFileKeys.length > 0) {
    console.warn(`[scrip] ignoring unknown config keys: ${unknownFileKeys.join(', ')}`);
  }

  return validate(Object.assign(config, overrides));
}

/**
 * Holds the config resolved at boot. Nothing changes it while the process runs — the file
 * is the only place a value is edited — but everything still reads through this so the
 * whole app sees one instance.
 */
export class ConfigStore {
  readonly #config: ScripConfig;

  constructor(config: ScripConfig) {
    this.#config = config;
  }

  current(): ScripConfig {
    return this.#config;
  }

  get<K extends keyof ScripConfig>(key: K): ScripConfig[K] {
    return this.#config[key];
  }
}
