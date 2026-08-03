import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import {
  Alert,
  EmptyState,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, type ChargeStatus } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatMoney, formatDateTime, maskDocument, relativeToNow } from '../lib/utils';

const CURL_EXAMPLE = `curl -X POST http://localhost:4242/v1/api/payments/pix/charges \\
  -H "Authorization: Bearer {your_jwt}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 15000, "payer_document": "11111111111"}'`;

export function Transactions() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');

  const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: '', label: t('transactions.filterAll') },
    { value: 'pending', label: t('transactions.filterPending') },
    { value: 'paid', label: t('transactions.filterPaid') },
    { value: 'partially_refunded', label: t('transactions.filterPartial') },
    { value: 'refunded', label: t('transactions.filterRefunded') },
    { value: 'expired', label: t('transactions.filterExpired') },
    { value: 'canceled', label: t('transactions.filterCanceled') },
  ];

  // Scoped to the session's store by the server; pending charges settle on a timer, so the
  // list refreshes itself.
  const charges = useAsync(
    () => api.charges({ ...(status ? { status } : {}), limit: '100' }),
    [status],
    { pollMs: 3000 },
  );

  const rows = charges.data?.data ?? [];
  const pending = rows.filter((charge) => charge.status === 'pending').length;

  return (
    <>
      <PageHeader
        title={t('transactions.title')}
        description={t('transactions.description')}
        actions={
          <span className="eyebrow">
            {t('transactions.totalCount', { count: charges.data?.total ?? 0 })} ·{' '}
            {t('transactions.pendingCount', { count: pending })}
          </span>
        }
      />

      <Panel>
        <PanelHeader
          title={t('transactions.cardTitle')}
          actions={
            <Select
              aria-label={t('transactions.filterStatusAriaLabel')}
              className="h-7 text-xs"
              value={status}
              onChange={(event) => setStatus(event.target.value as ChargeStatus | '')}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          }
        />

        {charges.error ? (
          <div className="p-4">
            <Alert>{charges.error}</Alert>
          </div>
        ) : null}

        {rows.length === 0 && !charges.loading ? (
          <EmptyState title={t('transactions.emptyTitle')}>
            <p className="mb-2">
              {t('transactions.emptyBodyIntro')}{' '}
              <Link to="/tokens" className="text-trace underline">
                {t('transactions.emptyBodyTokensLink')}
              </Link>
              :
            </p>
            <pre className="overflow-x-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-3 text-left font-mono text-[11px] leading-relaxed">
              {CURL_EXAMPLE}
            </pre>
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('transactions.colCharge')}</Th>
                <Th className="text-right">{t('transactions.colAmount')}</Th>
                <Th>{t('transactions.colStatus')}</Th>
                <Th>{t('transactions.colPayer')}</Th>
                <Th>{t('transactions.colCreated')}</Th>
                <Th>{t('transactions.colExpires')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((charge) => (
                <tr key={charge.id} className="hover:bg-[var(--hairline-soft)]">
                  <Td>
                    <Link
                      to={`/transactions/${charge.id}`}
                      className="tnum text-xs text-trace hover:underline"
                    >
                      {charge.id}
                    </Link>
                  </Td>
                  <Td className="tnum text-right whitespace-nowrap">
                    {formatMoney(charge.amount)}
                    {charge.amount_refunded > 0 ? (
                      <span className="block text-[11px] text-[var(--text-muted)]">
                        −{formatMoney(charge.amount_refunded)} {t('transactions.refundedSuffix')}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={charge.status} />
                  </Td>
                  <Td className="tnum text-xs whitespace-nowrap">
                    {maskDocument(charge.payer_document)}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {formatDateTime(charge.created_at)}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {charge.status === 'pending' ? relativeToNow(charge.pix.qr_code_expires_at) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {rows.length > 0 ? (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          {t('transactions.tipIntro')} <Copyable value="11111111111" className="text-trace" />{' '}
          {t('transactions.tipAlwaysConfirms')}{' '}
          <Copyable value="22222222222" className="text-trace" /> {t('transactions.tipNeverConfirms')}{' '}
          <Copyable value="33333333333" className="text-trace" /> {t('transactions.tipWebhookFails')}
        </p>
      ) : null}
    </>
  );
}
