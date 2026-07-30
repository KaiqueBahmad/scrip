import type { ChargeStatus } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Status is the most important column in the product, so it gets both a color and a
 * three-cell signal meter — readable at a glance, and still legible without color.
 */
const CHARGE_STATUS: Record<ChargeStatus, { label: string; tone: string; filled: number }> = {
  pending: { label: 'pendente', tone: 'text-trace border-trace/30 bg-trace-soft', filled: 1 },
  paid: { label: 'pago', tone: 'text-settle border-settle/30 bg-settle-soft', filled: 3 },
  partially_refunded: {
    label: 'devolvido em parte',
    tone: 'text-[#8a5d00] border-flag/40 bg-flag-soft',
    filled: 2,
  },
  refunded: { label: 'devolvido', tone: 'text-[#8a5d00] border-flag/40 bg-flag-soft', filled: 3 },
  expired: { label: 'expirado', tone: 'text-halt border-halt/30 bg-halt-soft', filled: 2 },
  canceled: {
    label: 'cancelado',
    tone: 'text-[var(--text-muted)] border-[var(--hairline)] bg-[var(--surface)]',
    filled: 2,
  },
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
  const config = CHARGE_STATUS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-panel)] border px-1.5 py-0.5',
        'font-mono text-[11px] font-medium whitespace-nowrap',
        config.tone,
      )}
    >
      <Meter filled={config.filled} />
      {config.label}
    </span>
  );
}

const KYC_STATUS = {
  pending: { label: 'em análise', tone: 'text-trace border-trace/30 bg-trace-soft' },
  approved: { label: 'aprovado', tone: 'text-settle border-settle/30 bg-settle-soft' },
  rejected: { label: 'recusado', tone: 'text-halt border-halt/30 bg-halt-soft' },
} as const;

export function KycBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const config = KYC_STATUS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-panel)] border px-1.5 py-0.5',
        'font-mono text-[11px] font-medium whitespace-nowrap',
        config.tone,
      )}
    >
      {config.label}
    </span>
  );
}

const DELIVERY_STATUS = {
  pending: { label: 'na fila', tone: 'text-trace border-trace/30 bg-trace-soft' },
  delivered: { label: 'entregue', tone: 'text-settle border-settle/30 bg-settle-soft' },
  failed: { label: 'falhou', tone: 'text-halt border-halt/30 bg-halt-soft' },
} as const;

export function DeliveryBadge({ status }: { status: 'pending' | 'delivered' | 'failed' }) {
  const config = DELIVERY_STATUS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-panel)] border px-1.5 py-0.5',
        'font-mono text-[11px] font-medium whitespace-nowrap',
        config.tone,
      )}
    >
      {config.label}
    </span>
  );
}
