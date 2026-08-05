import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '../components/Layout';
import { WithdrawalBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError, type ApiWithdrawal } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { formatBps, formatDateTime, formatMoney } from '../lib/utils';

/** Requesting, confirming and denying your own withdrawal — a simulation control, the same idea as forcing a payment. */
export function Withdrawals() {
  const { t } = useTranslation();
  const { refreshSession } = useSession();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [denying, setDenying] = useState<ApiWithdrawal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withdrawals = useAsync(
    () => api.withdrawals({ ...(status ? { status } : {}), limit: '100' }),
    [status],
    { pollMs: 3000 },
  );

  const rows = withdrawals.data?.data ?? [];

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([withdrawals.reload(), refreshSession()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.actionFailed'));
    }
  };

  return (
    <>
      <PageHeader
        title={t('withdrawals.title')}
        description={t('withdrawals.description')}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('withdrawals.requestWithdrawal')}
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title={t('withdrawals.historyTitle')}
          hint={t('withdrawals.historyHint', { count: withdrawals.data?.total ?? 0 })}
          actions={
            <Select
              aria-label={t('withdrawals.filterStatusAriaLabel')}
              className="h-7 text-xs"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t('withdrawals.filterAll')}</option>
              <option value="pending">{t('withdrawals.statusPending')}</option>
              <option value="confirmed">{t('withdrawals.statusConfirmed')}</option>
              <option value="denied">{t('withdrawals.statusDenied')}</option>
            </Select>
          }
        />

        {rows.length === 0 && !withdrawals.loading ? (
          <EmptyState title={t('withdrawals.emptyTitle')}>{t('withdrawals.emptyBody')}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('withdrawals.colId')}</Th>
                <Th className="text-right">{t('withdrawals.colAmount')}</Th>
                <Th className="text-right">{t('withdrawals.colFee')}</Th>
                <Th>{t('withdrawals.colStatus')}</Th>
                <Th>{t('withdrawals.colCreated')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((withdrawal) => (
                <tr key={withdrawal.id} className="hover:bg-[var(--hairline-soft)]">
                  <Td className="tnum text-xs">{withdrawal.id}</Td>
                  <Td className="tnum text-right whitespace-nowrap">{formatMoney(withdrawal.amount)}</Td>
                  <Td className="tnum text-right whitespace-nowrap text-[var(--text-muted)]">
                    {formatMoney(withdrawal.fee_amount)}
                  </Td>
                  <Td>
                    <WithdrawalBadge status={withdrawal.status} />
                    {withdrawal.status === 'denied' && withdrawal.reason ? (
                      <span className="ml-2 text-[11px] text-[var(--text-muted)]">{withdrawal.reason}</span>
                    ) : null}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {formatDateTime(withdrawal.created_at)}
                  </Td>
                  <Td>
                    {withdrawal.status === 'pending' ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="settle"
                          onClick={() => void act(() => api.confirmWithdrawal(withdrawal.id))}
                        >
                          {t('withdrawals.confirmAction')}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDenying(withdrawal)}>
                          {t('withdrawals.denyAction')}
                        </Button>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <WithdrawalForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await Promise.all([withdrawals.reload(), refreshSession()]);
        }}
      />

      <DenyForm
        withdrawal={denying}
        onClose={() => setDenying(null)}
        onSaved={async () => {
          setDenying(null);
          await Promise.all([withdrawals.reload(), refreshSession()]);
        }}
      />
    </>
  );
}

function WithdrawalForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { merchant } = useSession();
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feeOutBps = merchant?.pix_fee_out_bps ?? 0;
  const centavos = Math.round(Number(amount.replace(',', '.')) * 100);
  const feePreview =
    feeOutBps > 0 && Number.isFinite(centavos) && centavos > 0
      ? Math.round((centavos * feeOutBps) / 10000)
      : 0;

  const create = async () => {
    setSaving(true);
    setError(null);

    try {
      await api.createWithdrawal({ amount: centavos });
      setAmount('');
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('withdrawals.requestFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('withdrawals.requestWithdrawal')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={saving || !amount.trim()} onClick={() => void create()}>
            {saving ? t('withdrawals.requesting') : t('withdrawals.requestWithdrawal')}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <Field
        label={t('withdrawals.amountLabel')}
        htmlFor="withdrawal-amount"
        hint={
          feeOutBps > 0
            ? t('withdrawals.amountHintWithFee', { fee: formatBps(feeOutBps), amount: formatMoney(feePreview) })
            : t('withdrawals.amountHint')
        }
      >
        <Input
          id="withdrawal-amount"
          inputMode="decimal"
          placeholder="100.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
    </Modal>
  );
}

function DenyForm({
  withdrawal,
  onClose,
  onSaved,
}: {
  withdrawal: ApiWithdrawal | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deny = async () => {
    if (!withdrawal) return;
    setSaving(true);
    setError(null);

    try {
      await api.denyWithdrawal(withdrawal.id, reason.trim() || null);
      setReason('');
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('withdrawals.denyFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={withdrawal !== null}
      title={t('withdrawals.denyModalTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" disabled={saving} onClick={() => void deny()}>
            {saving ? t('withdrawals.denying') : t('withdrawals.denyAction')}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <Field label={t('withdrawals.denyReasonLabel')} htmlFor="withdrawal-deny-reason" hint={t('withdrawals.denyReasonHint')}>
        <Input
          id="withdrawal-deny-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('withdrawals.denyReasonPlaceholder')}
        />
      </Field>
    </Modal>
  );
}
