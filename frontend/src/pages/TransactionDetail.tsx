import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { Copyable } from '../components/Copyable';
import { LifecycleTrace, describeReason } from '../components/LifecycleTrace';
import { DeliveryBadge, StatusBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError, type ChargeDetail } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { formatMoney, formatDateTime, maskDocument, relativeToNow } from '../lib/utils';

/** The BR Code rendered as an actual QR — not scannable by a bank app. */
function QrPreview({ payload }: { payload: string }) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(payload, {
      margin: 1,
      width: 320,
      color: { dark: '#0e1626', light: '#ffffff' },
    }).then((url) => {
      if (active) setDataUrl(url);
    });

    return () => {
      active = false;
    };
  }, [payload]);

  // Displayed at 160px but generated at 320 so it stays sharp on hidpi screens.
  const frame = 'mx-auto aspect-square w-full max-w-[160px] rounded-[var(--radius-panel)] border';

  if (!dataUrl) {
    return <div className={`${frame} bg-[var(--surface)]`} />;
  }

  return <img src={dataUrl} alt={t('transactionDetail.qrCodeAlt')} className={`${frame} bg-white`} />;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline-soft)] px-4 py-2 last:border-0">
      <span className="eyebrow shrink-0">{label}</span>
      <span className="min-w-0 text-right text-xs">{children}</span>
    </div>
  );
}

export function TransactionDetail() {
  const { t } = useTranslation();
  const { refreshSession } = useSession();
  const { id = '' } = useParams();
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');

  const detail = useAsync<ChargeDetail>(() => api.charge(id), [id], { pollMs: 3000 });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setAction(label);
    setError(null);
    try {
      await fn();
      await Promise.all([detail.reload(), refreshSession()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.actionFailed'));
    } finally {
      setAction(null);
    }
  };

  if (detail.error) {
    return (
      <>
        <Link to="/transactions" className="eyebrow mb-3 inline-flex items-center gap-1.5">
          <ArrowLeft className="size-3" /> {t('common.back')}
        </Link>
        <Alert>{detail.error}</Alert>
      </>
    );
  }

  if (!detail.data) {
    return <p className="text-sm text-[var(--text-muted)]">{t('transactionDetail.loading')}</p>;
  }

  const { charge, events, refunds, deliveries } = detail.data;
  const outstanding = charge.amount - charge.amount_refunded;
  const canRefund = charge.status === 'paid' || charge.status === 'partially_refunded';

  return (
    <>
      <Link to="/transactions" className="eyebrow mb-3 inline-flex items-center gap-1.5">
        <ArrowLeft className="size-3" /> {t('transactionDetail.back')}
      </Link>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="tnum text-lg font-semibold">{charge.id}</h1>
            <StatusBadge status={charge.status} />
          </div>
          <p className="tnum mt-0.5 text-2xl font-semibold">{formatMoney(charge.amount)}</p>
          {charge.amount_refunded > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {t('transactionDetail.refundedOutstanding', {
                refunded: formatMoney(charge.amount_refunded),
                outstanding: formatMoney(outstanding),
              })}
            </p>
          ) : null}
          {charge.fee_amount > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {t('transactionDetail.feeNet', {
                fee: formatMoney(charge.fee_amount),
                net: formatMoney(charge.amount - charge.fee_amount),
              })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {charge.status === 'pending' ? (
            <>
              <Button
                variant="settle"
                disabled={action !== null}
                onClick={() => run('paid', () => api.simulate(charge.id, 'paid'))}
              >
                {t('transactionDetail.confirmPayment')}
              </Button>
              <Button
                disabled={action !== null}
                onClick={() => run('expired', () => api.simulate(charge.id, 'expired'))}
              >
                {t('transactionDetail.forceExpire')}
              </Button>
              <Button
                disabled={action !== null}
                onClick={() => run('cancel', () => api.cancelCharge(charge.id))}
              >
                {t('transactionDetail.cancelCharge')}
              </Button>
            </>
          ) : null}

          {canRefund ? (
            <Button variant="primary" onClick={() => setRefundOpen(true)}>
              {t('transactionDetail.refund')}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {/* The signature view: the state machine as a timing trace. */}
      <Panel className="mb-4">
        <PanelHeader
          title={t('transactionDetail.lifecycleTitle')}
          hint={t('transactionDetail.lifecycleHint')}
        />
        <LifecycleTrace events={events} />
      </Panel>

      {/*
        min-w-0 on the container and both columns: a grid item defaults to min-width:auto,
        so the wide descendants here (deliveries table, metadata JSON, the BR Code) would
        stretch the 1fr track past the viewport instead of scrolling inside themselves.
      */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHeader title={t('transactionDetail.chargeDataTitle')} />
            <Detail label={t('transactionDetail.merchantLabel')}>
              <Link
                to="/merchants"
                className="tnum text-trace hover:underline"
              >
                {charge.merchant_id}
              </Link>
            </Detail>
            <Detail label={t('transactionDetail.payerLabel')}>{maskDocument(charge.payer_document)}</Detail>
            <Detail label={t('transactionDetail.payerNameLabel')}>{charge.payer_name ?? '—'}</Detail>
            <Detail label={t('transactionDetail.descriptionLabel')}>{charge.description ?? '—'}</Detail>
            {charge.callback_url ? (
              <Detail label={t('transactionDetail.callbackUrlLabel')}>
                <Copyable value={charge.callback_url} truncate={{ head: 24, tail: 10 }} label={t('transactionDetail.callbackUrlLabel')} />
              </Detail>
            ) : null}
            <Detail label={t('transactionDetail.txidLabel')}>
              <Copyable value={charge.pix.qr_code_txid} label={t('transactionDetail.txidLabel')} />
            </Detail>
            <Detail label={t('transactionDetail.e2eIdLabel')}>
              {charge.pix.e2e_id ? (
                <Copyable value={charge.pix.e2e_id} label={t('transactionDetail.e2eIdLabel')} />
              ) : (
                '—'
              )}
            </Detail>
            <Detail label={t('transactionDetail.createdLabel')}>{formatDateTime(charge.created_at)}</Detail>
            <Detail label={t('transactionDetail.expiresLabel')}>
              {formatDateTime(charge.pix.qr_code_expires_at)}
              {charge.status === 'pending' ? (
                <span className="text-[var(--text-muted)]"> · {relativeToNow(charge.pix.qr_code_expires_at)}</span>
              ) : null}
            </Detail>
            <Detail label={t('transactionDetail.paidLabel')}>{formatDateTime(charge.paid_at)}</Detail>
          </Panel>

          {Object.keys(charge.metadata).length > 0 ? (
            <Panel>
              <PanelHeader title={t('transactionDetail.metadataTitle')} hint={t('transactionDetail.metadataHint')} />
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(charge.metadata, null, 2)}
              </pre>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title={t('transactionDetail.refundsTitle')}
              hint={t('transactionDetail.refundsHint', { count: refunds.length })}
            />
            {refunds.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                {t('transactionDetail.noRefunds')}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('transactionDetail.colRefund')}</Th>
                    <Th className="text-right">{t('transactionDetail.colAmount')}</Th>
                    <Th>{t('transactionDetail.colReason')}</Th>
                    <Th>{t('transactionDetail.colWhen')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr key={refund.id}>
                      <Td>
                        <Copyable value={refund.id} truncate={{ head: 12, tail: 5 }} />
                      </Td>
                      <Td className="tnum text-right">{formatMoney(refund.amount)}</Td>
                      <Td className="text-xs">{refund.reason ?? '—'}</Td>
                      <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                        {formatDateTime(refund.created_at)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title={t('transactionDetail.webhooksTitle')}
              hint={t('transactionDetail.webhooksHint', { count: deliveries.length })}
            />
            {deliveries.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                {t('transactionDetail.noWebhooks')}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('transactionDetail.colEvent')}</Th>
                    <Th>{t('transactionDetail.colStatus')}</Th>
                    <Th>{t('transactionDetail.colAttempts')}</Th>
                    <Th>{t('transactionDetail.colResponse')}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <Td className="tnum text-xs">{delivery.event}</Td>
                      <Td>
                        <DeliveryBadge status={delivery.status} />
                      </Td>
                      <Td className="tnum text-xs">
                        {delivery.attempt}/{delivery.max_attempts}
                      </Td>
                      <Td className="text-xs">
                        {delivery.response_status ?? (
                          <span className="text-halt">{delivery.error ?? '—'}</span>
                        )}
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action !== null}
                          onClick={() =>
                            run(`retry-${delivery.id}`, () => api.retryDelivery(delivery.id))
                          }
                        >
                          <RotateCcw className="size-3" /> {t('transactionDetail.retry')}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHeader title={t('transactionDetail.qrCodeTitle')} hint={t('transactionDetail.qrCodeHint')} />
            <div className="p-4">
              <QrPreview payload={charge.pix.qr_code} />
              <div className="mt-3">
                <p className="eyebrow mb-1">{t('transactionDetail.pixCopyPaste')}</p>
                <div className="rounded-[var(--radius-panel)] border bg-[var(--surface)] p-2">
                  <Copyable
                    value={charge.pix.qr_code}
                    truncate={{ head: 34, tail: 12 }}
                    label="BR Code"
                    className="w-full"
                  />
                </div>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  {t('transactionDetail.qrDisclaimer')}
                </p>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('transactionDetail.transitionsTitle')} />
            <ol className="px-4 py-3">
              {events.map((event) => (
                <li key={event.id} className="border-b border-[var(--hairline-soft)] py-1.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">{event.to_status}</span>
                    <span className="tnum text-[10px] text-[var(--text-muted)]">
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {describeReason(event.reason, t)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <Modal
        open={refundOpen}
        title={t('transactionDetail.refundModalTitle')}
        onClose={() => setRefundOpen(false)}
        footer={
          <>
            <Button onClick={() => setRefundOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={action !== null}
              onClick={async () => {
                const centavos = refundAmount.trim()
                  ? Math.round(Number(refundAmount.replace(',', '.')) * 100)
                  : null;

                await run('refund', () =>
                  api.refundCharge(charge.id, { amount: centavos, reason: t('transactionDetail.refundReason') }),
                );
                setRefundOpen(false);
                setRefundAmount('');
              }}
            >
              {t('transactionDetail.refund')}
            </Button>
          </>
        }
      >
        <Field
          label={t('transactionDetail.amountLabel')}
          htmlFor="refund-amount"
          hint={t('transactionDetail.refundAmountHint', { amount: formatMoney(outstanding) })}
        >
          <Input
            id="refund-amount"
            inputMode="decimal"
            placeholder={(outstanding / 100).toFixed(2)}
            value={refundAmount}
            onChange={(event) => setRefundAmount(event.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
