import type { ApiChargeEvent, ChargeStatus } from '../lib/api';
import { formatDuration, formatTime } from '../lib/utils';

/**
 * The charge lifecycle drawn as a logic-analyzer trace: one lane per status the charge
 * actually entered, the signal stepping up while that status is held, and the dwell time
 * labelled on each segment.
 *
 * Built straight from the charge_events audit rows, so it shows both the path through the
 * state machine and how long each hop took — which is the thing you are usually trying to
 * find out when a simulated payment behaves unexpectedly.
 */

const LANE_COLOR: Record<ChargeStatus, string> = {
  pending: 'var(--color-trace)',
  paid: 'var(--color-settle)',
  partially_refunded: 'var(--color-flag)',
  refunded: 'var(--color-flag)',
  expired: 'var(--color-halt)',
  canceled: 'var(--color-muted)',
};

const LANE_LABEL: Record<ChargeStatus, string> = {
  pending: 'pendente',
  paid: 'pago',
  partially_refunded: 'devolv. parcial',
  refunded: 'devolvido',
  expired: 'expirado',
  canceled: 'cancelado',
};

const REASON_LABEL: Record<string, string> = {
  charge_created: 'cobrança criada',
  simulated: 'forçado via API',
  test_document_always_confirms: 'CPF de teste: confirma sempre',
  test_document_never_confirms: 'CPF de teste: nunca confirma',
  test_document_webhook_failure: 'CPF de teste: webhook falha',
  approval_rate_hit: 'sorteio: aprovado',
  approval_rate_miss: 'sorteio: recusado',
  qr_code_expired: 'QR code expirou',
  expired_while_offline: 'expirou com o servidor parado',
  canceled_by_merchant: 'cancelado pelo lojista',
  refund_applied: 'devolução aplicada',
};

export function describeReason(reason: string | null): string {
  if (!reason) return '—';
  return REASON_LABEL[reason] ?? reason;
}

const LANE_HEIGHT = 30;
const STEP = 7;
const PAD_LEFT = 118;
const PAD_RIGHT = 20;
const PAD_TOP = 16;
const WIDTH = 760;

export function LifecycleTrace({ events }: { events: ApiChargeEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
        Nenhuma transição registrada ainda.
      </p>
    );
  }

  // Lanes in the order the charge entered them, deduplicated.
  const lanes: ChargeStatus[] = [];
  for (const event of events) {
    if (!lanes.includes(event.to_status)) lanes.push(event.to_status);
  }

  const times = events.map((event) => new Date(event.created_at).getTime());
  const start = times[0] ?? 0;
  const last = times[times.length - 1] ?? start;

  // A charge that settled instantly would collapse to zero width; give it a floor so the
  // trace still reads as a sequence.
  const span = Math.max(last - start, 1);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const height = PAD_TOP * 2 + lanes.length * LANE_HEIGHT;

  const xFor = (time: number) => PAD_LEFT + ((time - start) / span) * plotWidth;
  const laneY = (status: ChargeStatus) => PAD_TOP + lanes.indexOf(status) * LANE_HEIGHT;

  // One polyline per lane: low until the status is entered, high while held, low after.
  const segments = lanes.map((status) => {
    const enteredIndex = events.findIndex((event) => event.to_status === status);
    const leftIndex = events.findIndex(
      (event, index) => index > enteredIndex && event.from_status === status,
    );

    const enteredAt = times[enteredIndex] ?? start;
    const leftAt = leftIndex === -1 ? last : (times[leftIndex] ?? last);

    const baseline = laneY(status) + STEP;
    const high = laneY(status) - STEP + 4;

    const x0 = xFor(enteredAt);
    const x1 = xFor(leftAt);
    const isOpen = leftIndex === -1;

    const points = [
      `${PAD_LEFT},${baseline}`,
      `${x0},${baseline}`,
      `${x0},${high}`,
      `${Math.max(x1, x0)},${high}`,
      ...(isOpen ? [] : [`${x1},${baseline}`, `${WIDTH - PAD_RIGHT},${baseline}`]),
    ].join(' ');

    return {
      status,
      points,
      isOpen,
      holdMs: leftAt - enteredAt,
      midX: (x0 + Math.max(x1, x0)) / 2,
      high,
      enteredAt,
      x0,
    };
  });

  return (
    <div className="overflow-x-auto px-4 py-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full min-w-[640px]"
        role="img"
        aria-label={`Ciclo de vida da cobrança: ${lanes.map((s) => LANE_LABEL[s]).join(' → ')}`}
      >
        {/* Lane guides and labels */}
        {lanes.map((status) => (
          <g key={status}>
            <text
              x={PAD_LEFT - 10}
              y={laneY(status) + 4}
              textAnchor="end"
              className="fill-[var(--text-muted)] font-mono text-[10px]"
              style={{ fontSize: 10, letterSpacing: '0.08em' }}
            >
              {LANE_LABEL[status].toUpperCase()}
            </text>
            <line
              x1={PAD_LEFT}
              y1={laneY(status) + STEP}
              x2={WIDTH - PAD_RIGHT}
              y2={laneY(status) + STEP}
              stroke="var(--hairline-soft)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          </g>
        ))}

        {/* Transition markers: a vertical tick where each event landed */}
        {events.map((event, index) => (
          <line
            key={event.id}
            x1={xFor(times[index] ?? start)}
            y1={PAD_TOP - 8}
            x2={xFor(times[index] ?? start)}
            y2={height - PAD_TOP + 6}
            stroke="var(--hairline)"
            strokeWidth={1}
          />
        ))}

        {/* The signals */}
        {segments.map((segment) => (
          <g key={segment.status}>
            <polyline
              points={segment.points}
              fill="none"
              stroke={LANE_COLOR[segment.status]}
              strokeWidth={2}
              strokeLinejoin="round"
              className="trace-line"
              style={{ ['--trace-length' as string]: '2000' }}
            />
            <circle cx={segment.x0} cy={segment.high} r={2.5} fill={LANE_COLOR[segment.status]} />

            {/* Dwell time, only where there is room to print it */}
            {segment.holdMs > 0 && segment.midX - segment.x0 > 16 ? (
              <text
                x={segment.midX}
                y={segment.high - 5}
                textAnchor="middle"
                className="fill-[var(--text-muted)] font-mono"
                style={{ fontSize: 9 }}
              >
                {formatDuration(segment.holdMs)}
              </text>
            ) : null}

            {segment.isOpen ? (
              <text
                x={WIDTH - PAD_RIGHT}
                y={segment.high - 5}
                textAnchor="end"
                className="font-mono"
                style={{ fontSize: 9, fill: LANE_COLOR[segment.status] }}
              >
                atual
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      {/* Timestamps under the trace, aligned to the ticks */}
      <ol className="mt-1 flex flex-wrap gap-x-5 gap-y-1 border-t pt-2">
        {events.map((event) => (
          <li key={event.id} className="flex items-baseline gap-1.5 text-[11px]">
            <span className="tnum text-[var(--text-muted)]">{formatTime(event.created_at)}</span>
            <span className="font-medium" style={{ color: LANE_COLOR[event.to_status] }}>
              {LANE_LABEL[event.to_status]}
            </span>
            <span className="text-[var(--text-muted)]">{describeReason(event.reason)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
