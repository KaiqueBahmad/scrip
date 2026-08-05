import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Copyable, Secret } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import { KycBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  Field,
  Input,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { formatMoney, formatDateTime } from '../lib/utils';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

/** Basis points -> the editable percentage string ("2.50"), as the fee inputs store it. */
function bpsToPercentInput(bps: number | undefined): string {
  return ((bps ?? 0) / 100).toFixed(2);
}

/** The editable percentage string back to basis points, clamped to what the API accepts. */
function percentInputToBps(value: string): number {
  const percent = Number(value.replace(',', '.'));
  if (!Number.isFinite(percent)) return 0;
  return Math.min(10000, Math.max(0, Math.round(percent * 100)));
}

/** Centavos -> the editable money string ("1.00"), as the fixed-fee inputs store it. */
function centavosToMoneyInput(centavos: number | undefined): string {
  return ((centavos ?? 0) / 100).toFixed(2);
}

/** The editable money string back to non-negative centavos. */
function moneyInputToCentavos(value: string): number {
  const reais = Number(value.replace(',', '.'));
  if (!Number.isFinite(reais)) return 0;
  return Math.max(0, Math.round(reais * 100));
}

/** One number, stated plainly. The balance is the first thing a store wants to see. */
function BalanceFigure({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="eyebrow mb-1">{label}</p>
      <p className={`tnum ${emphasis ? 'text-2xl font-semibold' : 'text-lg'}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

/**
 * The store's own page: balance, identity, webhook config and KYC. Replaces the old
 * per-user screens now that the merchant is the panel identity.
 */
export function MyStore() {
  const { t } = useTranslation();
  const { merchant, refreshSession, refreshMerchants, signOut } = useSession();
  const documents = useAsync(() => api.kycDocuments(), [], { pollMs: 5000 });

  const [name, setName] = useState(merchant?.name ?? '');
  const [webhookUrl, setWebhookUrl] = useState(merchant?.webhook_url ?? '');
  const [pixFeeIn, setPixFeeIn] = useState(bpsToPercentInput(merchant?.pix_fee_in_bps));
  const [pixFeeOut, setPixFeeOut] = useState(bpsToPercentInput(merchant?.pix_fee_out_bps));
  const [pixFeeInFixed, setPixFeeInFixed] = useState(centavosToMoneyInput(merchant?.pix_fee_in_fixed));
  const [pixFeeOutFixed, setPixFeeOutFixed] = useState(centavosToMoneyInput(merchant?.pix_fee_out_fixed));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kycReason, setKycReason] = useState('');
  const [uploadType, setUploadType] = useState('identity');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!merchant) return null;

  const balance = merchant.balance;
  const docs = documents.data?.data ?? [];
  const types = documents.data?.document_types ?? ['identity', 'other'];

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([refreshSession(), documents.reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      await api.updateMyMerchant({
        name: name.trim(),
        webhook_url: webhookUrl.trim() || null,
        pix_fee_in_bps: percentInputToBps(pixFeeIn),
        pix_fee_out_bps: percentInputToBps(pixFeeOut),
        pix_fee_in_fixed: moneyInputToCentavos(pixFeeInFixed),
        pix_fee_out_fixed: moneyInputToCentavos(pixFeeOutFixed),
      });
      await Promise.all([refreshSession(), refreshMerchants()]);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('myStore.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('myStore.eyebrow')}
        title={merchant.name}
        description={t('myStore.description')}
        actions={<KycBadge status={merchant.kyc_status} />}
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Panel className="mb-4">
        <PanelHeader title={t('myStore.balanceTitle')} hint={t('myStore.balanceHint')} />
        <div className="grid divide-y divide-[var(--hairline-soft)] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <BalanceFigure
            label={t('myStore.available')}
            value={formatMoney(balance?.available ?? 0)}
            hint={t('myStore.settledHint', { count: balance?.settled_charges ?? 0 })}
            emphasis
          />
          <BalanceFigure label={t('myStore.grossReceived')} value={formatMoney(balance?.gross_received ?? 0)} />
          <BalanceFigure label={t('myStore.refundedLabel')} value={formatMoney(balance?.refunded ?? 0)} />
          <BalanceFigure label={t('myStore.withdrawnLabel')} value={formatMoney(balance?.withdrawn ?? 0)} />
        </div>
        {balance && (balance.fees_in > 0 || balance.fees_out > 0) ? (
          <div className="grid divide-y divide-[var(--hairline-soft)] border-t border-[var(--hairline-soft)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <BalanceFigure label={t('myStore.feesInLabel')} value={formatMoney(balance.fees_in)} />
            <BalanceFigure label={t('myStore.feesOutLabel')} value={formatMoney(balance.fees_out)} />
          </div>
        ) : null}
      </Panel>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          <Panel>
            <PanelHeader
              title={t('myStore.storeDataTitle')}
              actions={
                <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
                  {saving ? t('common.saving') : t('common.save')}
                </Button>
              }
            />
            <div className="grid gap-3 p-4">
              {saved ? <Alert tone="settle">{t('myStore.saved')}</Alert> : null}

              <Field label={t('myStore.nameLabel')} htmlFor="store-name">
                <Input
                  id="store-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              <Field
                label={t('myStore.webhookUrlLabel')}
                htmlFor="store-webhook"
                hint={t('myStore.webhookUrlHint')}
              >
                <Input
                  id="store-webhook"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder="http://localhost:3000/webhooks/scrip"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t('myStore.pixFeeInLabel')}
                  htmlFor="store-pix-fee-in"
                  hint={t('myStore.pixFeeInHint')}
                >
                  <Input
                    id="store-pix-fee-in"
                    inputMode="decimal"
                    value={pixFeeIn}
                    onChange={(event) => setPixFeeIn(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>

                <Field
                  label={t('myStore.pixFeeInFixedLabel')}
                  htmlFor="store-pix-fee-in-fixed"
                  hint={t('myStore.pixFeeInFixedHint')}
                >
                  <Input
                    id="store-pix-fee-in-fixed"
                    inputMode="decimal"
                    value={pixFeeInFixed}
                    onChange={(event) => setPixFeeInFixed(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>

                <Field
                  label={t('myStore.pixFeeOutLabel')}
                  htmlFor="store-pix-fee-out"
                  hint={t('myStore.pixFeeOutHint')}
                >
                  <Input
                    id="store-pix-fee-out"
                    inputMode="decimal"
                    value={pixFeeOut}
                    onChange={(event) => setPixFeeOut(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>

                <Field
                  label={t('myStore.pixFeeOutFixedLabel')}
                  htmlFor="store-pix-fee-out-fixed"
                  hint={t('myStore.pixFeeOutFixedHint')}
                >
                  <Input
                    id="store-pix-fee-out-fixed"
                    inputMode="decimal"
                    value={pixFeeOutFixed}
                    onChange={(event) => setPixFeeOutFixed(event.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title={t('myStore.kycTitle')}
              hint={t('myStore.kycHint')}
            />
            <div className="grid gap-3 p-4">
              {merchant.kyc_reason ? (
                <p className="text-xs text-[var(--text-muted)]">
                  {t('myStore.kycReasonRegistered', { reason: merchant.kyc_reason })}
                  {merchant.kyc_reviewed_at
                    ? ` · ${formatDateTime(merchant.kyc_reviewed_at)}`
                    : ''}
                </p>
              ) : null}

              <Field label={t('myStore.kycReasonLabel')} htmlFor="kyc-reason" hint={t('myStore.kycReasonHint')}>
                <Input
                  id="kyc-reason"
                  value={kycReason}
                  onChange={(event) => setKycReason(event.target.value)}
                  placeholder={t('myStore.kycReasonPlaceholder')}
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="settle"
                  disabled={busy}
                  onClick={() => void act(() => api.simulateKyc('approved', kycReason.trim() || null))}
                >
                  {t('myStore.simulateApproval')}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void act(() => api.simulateKyc('rejected', kycReason.trim() || null))}
                >
                  {t('myStore.simulateRejection')}
                </Button>
              </div>

              <p className="text-[11px] text-[var(--text-muted)]">
                {t('myStore.kycExplainPre')} <span className="font-mono">kyc.approved</span>{' '}
                {t('myStore.kycExplainMid')} <span className="font-mono">kyc.rejected</span>
                {t('myStore.kycExplainCom')}{' '}
                <span className="font-mono">requireApprovedKycForCharges</span>{' '}
                {t('myStore.kycExplainPost')}
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('myStore.documentsTitle')} hint={t('myStore.documentsHint', { count: docs.length })} />
            {docs.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                {t('myStore.noDocuments')}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('myStore.colFile')}</Th>
                    <Th>{t('myStore.colType')}</Th>
                    <Th>{t('myStore.colSize')}</Th>
                    <Th>{t('myStore.colStatus')}</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-[var(--hairline-soft)]">
                      <Td className="max-w-[220px] truncate font-medium">{doc.filename}</Td>
                      <Td className="font-mono text-[11px]">{doc.type}</Td>
                      <Td className="tnum text-xs">{formatBytes(doc.size)}</Td>
                      <Td>
                        <KycBadge status={doc.status} />
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          <a
                            href={api.kycDocumentUrl(doc.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="eyebrow px-2 py-1 hover:text-trace"
                          >
                            {t('myStore.open')}
                          </a>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-halt"
                            disabled={busy}
                            onClick={() => void act(() => api.deleteKycDocument(doc.id))}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
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
            <PanelHeader title={t('myStore.credentialsTitle')} />
            <div className="grid gap-2 p-4">
              <div>
                <p className="eyebrow mb-1">{t('myStore.merchantIdLabel')}</p>
                <Copyable value={merchant.id} label="merchant id" />
              </div>
              <div>
                <p className="eyebrow mb-1">{t('myStore.webhookSecretLabel')}</p>
                {merchant.webhook_secret ? (
                  <Secret value={merchant.webhook_secret} label={t('myStore.webhookSecretLabel')} />
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(() => api.updateMyMerchant({ rotate_webhook_secret: true }))
                }
              >
                {t('myStore.generateNewSecret')}
              </Button>
              <p className="text-[11px] text-[var(--text-muted)]">
                {t('myStore.secretRotateHint')}
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('myStore.uploadTitle')} />
            <div className="grid gap-3 p-4">
              <Field label={t('myStore.typeLabel')} htmlFor="upload-type">
                <Select
                  id="upload-type"
                  value={uploadType}
                  onChange={(event) => setUploadType(event.target.value)}
                >
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('myStore.fileLabel')} htmlFor="upload-file">
                <input
                  id="upload-file"
                  ref={fileInput}
                  type="file"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;

                    void act(async () => {
                      await api.uploadKycDocument(file, uploadType);
                      if (fileInput.current) fileInput.current.value = '';
                    });
                  }}
                  className="w-full text-xs file:mr-2 file:rounded-[var(--radius-panel)] file:border file:border-[var(--hairline)] file:bg-[var(--surface)] file:px-2 file:py-1 file:text-xs"
                />
              </Field>

              <p className="text-[11px] text-[var(--text-muted)]">
                {t('myStore.uploadHintPre')} <span className="font-mono">kycMaxFileSizeMb</span>.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('myStore.endTitle')} />
            <div className="grid gap-2 p-4">
              <Button onClick={signOut}>{t('myStore.switchStore')}</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t('myStore.deleteConfirm', { name: merchant.name }))) {
                    return;
                  }
                  await api.deleteMyMerchant();
                  await refreshMerchants();
                  signOut();
                }}
              >
                {t('myStore.deleteStore')}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
