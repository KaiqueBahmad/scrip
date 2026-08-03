import { useTranslation } from 'react-i18next';

import type { ChargeStatus } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Status is the most important column in the product, so it gets both a color and a
 * three-cell signal meter — readable at a glance, and still legible without color.
 */
const CHARGE_STATUS_TONE: Record<ChargeStatus, { tone: string; filled: number }> = {
  pending: { tone: 'text-trace border-trace/30 bg-trace-soft', filled: 1 },
  paid: { tone: 'text-settle border-settle/30 bg-settle-soft', filled: 3 },
  partially_refunded: { tone: 'text-[#8a5d00] border-flag/40 bg-flag-soft', filled: 2 },
  refunded: { tone: 'text-[#8a5d00] border-flag/40 bg-flag-soft', filled: 3 },
  expired: { tone: 'text-halt border-halt/30 bg-halt-soft', filled: 2 },
  canceled: { tone: 'text-[var(--text-muted)] border-[var(--hairline)] bg-[var(--surface)]', filled: 2 },
};

function Meter({ filled, className }: { filled: number; className?: string }) {
  return (
    <span aria-hidden className={cn('flex items-center gap-[2px]', className)}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'h-2.5 w-[3px] rounded-[1px]',
            index < filled ? 'bg-current' : 'bg-current opacity-25',
          )}
        />
      ))}
    </span>
  );
}

export function StatusBadge({ status }: { status: ChargeStatus }) {
  const { t } = useTranslation();
  const config = CHARGE_STATUS_TONE[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-panel)] border px-1.5 py-0.5',
        'font-mono text-[11px] font-medium whitespace-nowrap',
        config.tone,
      )}
    >
      <Meter filled={config.filled} />
      {t(`status.${status}`)}
    </span>
  );
}

const KYC_TONE = {
  pending: 'text-trace border-trace/30 bg-trace-soft',
  approved: 'text-settle border-settle/30 bg-settle-soft',
  rejected: 'text-halt border-halt/30 bg-halt-soft',
} as const;

export function KycBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-panel)] border px-1.5 py-0.5',
        'font-mono text-[11px] font-medium whitespace-nowrap',
        KYC_TONE[status],
      )}
    >
      {t(`kyc.${status}`)}
    </span>
  );
}

const DELIVERY_TONE = {
  pending: 'text-trace border-trace/30 bg-trace-soft',
  delivered: 'text-settle border-settle/30 bg-settle-soft',
  failed: 'text-halt border-halt/30 bg-halt-soft',
} as const;

export function DeliveryBadge({ status }: { status: 'pending' | 'delivered' | 'failed' }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-panel)] border px-1.5 py-0.5',
        'font-mono text-[11px] font-medium whitespace-nowrap',
        DELIVERY_TONE[status],
      )}
    >
      {t(`delivery.${status}`)}
    </span>
  );
}
