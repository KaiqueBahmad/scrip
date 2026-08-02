import type { PseudoPayConfig } from '../config';

/**
 * Deterministic test CPFs. These are what make PseudoPay usable in CI:
 * the same payer_document always produces the same outcome, no coin flip involved.
 */
export const TEST_DOCUMENTS = {
  /** Always confirms, at the minimum configured delay. */
  alwaysConfirms: '11111111111',
  /** Never confirms, so the charge runs to expiration. */
  neverConfirms: '22222222222',
  /** Confirms, but its webhook deliveries fail on purpose so retry can be tested. */
  webhookFails: '33333333333',
} as const;

/** Normalizes a document to digits only, so "111.111.111-11" also matches. */
export function normalizeDocument(document: string | null | undefined): string {
  return (document ?? '').replace(/\D/g, '');
}

export function isWebhookFailingDocument(document: string | null | undefined): boolean {
  return normalizeDocument(document) === TEST_DOCUMENTS.webhookFails;
}

export interface ConfirmationPlan {
  /** Whether this charge will ever be confirmed. */
  confirm: boolean;
  /** Delay before confirmation, when `confirm` is true. */
  delayMs: number;
  /** Why this outcome was chosen — recorded on the charge_events row. */
  reason: string;
}

/**
 * Decides if and when a charge auto-confirms. Known test CPFs short-circuit; everything
 * else follows `approvalRate`.
 */
export function planConfirmation(
  payerDocument: string | null | undefined,
  config: PseudoPayConfig,
  random: () => number = Math.random,
): ConfirmationPlan {
  const document = normalizeDocument(payerDocument);

  if (document === TEST_DOCUMENTS.alwaysConfirms) {
    return {
      confirm: true,
      delayMs: config.pixMinConfirmationDelayMs,
      reason: 'test_document_always_confirms',
    };
  }

  if (document === TEST_DOCUMENTS.neverConfirms) {
    return { confirm: false, delayMs: 0, reason: 'test_document_never_confirms' };
  }

  if (document === TEST_DOCUMENTS.webhookFails) {
    return {
      confirm: true,
      delayMs: config.pixConfirmationDelayMs,
      reason: 'test_document_webhook_failure',
    };
  }

  const confirm = random() < config.approvalRate;
  return {
    confirm,
    delayMs: config.pixConfirmationDelayMs,
    reason: confirm ? 'approval_rate_hit' : 'approval_rate_miss',
  };
}
