import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import { DeliveryBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError, type ApiDelivery } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/utils';

const EVENTS = [
  'pix.charge.created',
  'pix.charge.paid',
  'pix.charge.expired',
  'pix.charge.refunded',
  'kyc.approved',
  'kyc.rejected',
  'withdrawal.confirmed',
  'withdrawal.denied',
];

/** Delivery log with the signature and payload visible — the point of the whole feature. */
export function Webhooks() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');
  const [selected, setSelected] = useState<ApiDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deliveries = useAsync(
    () =>
      api.deliveries({
        ...(status ? { status } : {}),
        ...(event ? { event } : {}),
        limit: '200',
      }),
    [status, event],
    { pollMs: 3000 },
  );

  const rows = deliveries.data?.data ?? [];
  const failed = rows.filter((delivery) => delivery.status === 'failed').length;

  const retry = async (delivery: ApiDelivery) => {
    setError(null);
    try {
      await api.retryDelivery(delivery.id);
      await deliveries.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('webhooks.retryFailed'));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('webhooks.eyebrow')}
        title={t('webhooks.title')}
        description={t('webhooks.description')}
        actions={
          <span className="eyebrow">
            {t('webhooks.attemptsCount', { count: rows.length })} ·{' '}
            {t('webhooks.failuresCount', { count: failed })}
          </span>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title={t('webhooks.historyTitle')}
          actions={
            <div className="flex items-center gap-2">
              <Select
                aria-label={t('webhooks.filterEventLabel')}
                className="h-7 text-xs"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
              >
                <option value="">{t('webhooks.allEvents')}</option>
                {EVENTS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('webhooks.filterStatusLabel')}
                className="h-7 text-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">{t('webhooks.allStatuses')}</option>
                <option value="pending">{t('webhooks.statusPendingFilter')}</option>
                <option value="delivered">{t('webhooks.statusDeliveredFilter')}</option>
                <option value="failed">{t('webhooks.statusFailedFilter')}</option>
              </Select>
            </div>
          }
        />

        {rows.length === 0 && !deliveries.loading ? (
          <EmptyState title={t('webhooks.emptyTitle')}>
            {t('webhooks.emptyBody')}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('webhooks.colEvent')}</Th>
                <Th>{t('webhooks.colStatus')}</Th>
                <Th>{t('webhooks.colAttempts')}</Th>
                <Th>{t('webhooks.colCharge')}</Th>
                <Th>{t('webhooks.colResponse')}</Th>
                <Th>{t('webhooks.colWhen')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((delivery) => (
                <tr
                  key={delivery.id}
                  className="cursor-pointer hover:bg-[var(--hairline-soft)]"
                  onClick={() => setSelected(delivery)}
                >
                  <Td className="tnum text-xs">{delivery.event}</Td>
                  <Td>
                    <DeliveryBadge status={delivery.status} />
                  </Td>
                  <Td className="tnum text-xs">
                    {delivery.attempt}/{delivery.max_attempts}
                  </Td>
                  <Td className="text-xs">
                    {delivery.charge_id ? (
                      <Link
                        to={`/transactions/${delivery.charge_id}`}
                        className="tnum text-trace hover:underline"
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                      >
                        {delivery.charge_id.slice(0, 12)}…
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </Td>
                  <Td className="max-w-[180px] truncate text-xs">
                    {delivery.response_status ?? (
                      <span className="text-halt">{delivery.error ?? '—'}</span>
                    )}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {formatDateTime(delivery.delivered_at ?? delivery.updated_at)}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        void retry(delivery);
                      }}
                    >
                      <RotateCcw className="size-3" /> {t('webhooks.retry')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {selected ? (
        <Panel className="mt-4">
          <PanelHeader
            title={t('webhooks.detailTitle')}
            hint={selected.id}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                {t('webhooks.close')}
              </Button>
            }
          />
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <div>
                <p className="eyebrow mb-1">{t('webhooks.destinationLabel')}</p>
                <Copyable value={selected.url} label="url" />
              </div>
              <div>
                <p className="eyebrow mb-1">{t('webhooks.signatureLabel')}</p>
                {selected.signature ? (
                  <Copyable
                    value={selected.signature}
                    truncate={{ head: 24, tail: 10 }}
                    label={t('webhooks.signatureLabel')}
                  />
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {t('webhooks.signatureHintPre')} <span className="font-mono">X-Scrip-Signature</span>
                  {t('webhooks.signatureHintMid')}{' '}
                  <span className="font-mono">t=&lt;unix&gt;,v1=&lt;hmac&gt;</span>
                  {t('webhooks.signatureHintPost')}{' '}
                  <span className="font-mono">&lt;t&gt;.&lt;corpo&gt;</span> {t('webhooks.signatureHintEnd')}
                </p>
              </div>
              {selected.error ? (
                <div>
                  <p className="eyebrow mb-1">{t('webhooks.errorLabel')}</p>
                  <p className="font-mono text-xs text-halt">{selected.error}</p>
                </div>
              ) : null}
              {selected.response_body ? (
                <div>
                  <p className="eyebrow mb-1">{t('webhooks.endpointResponseLabel')}</p>
                  <pre className="max-h-32 overflow-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-2 font-mono text-[11px]">
                    {selected.response_body}
                  </pre>
                </div>
              ) : null}
            </div>

            <div>
              <p className="eyebrow mb-1">{t('webhooks.payloadLabel')}</p>
              <pre className="max-h-72 overflow-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
