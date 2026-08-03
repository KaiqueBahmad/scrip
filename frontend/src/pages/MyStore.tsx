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
        <div className="grid divide-y divide-[var(--hairline-soft)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <BalanceFigure
            label={t('myStore.available')}
            value={formatMoney(balance?.available ?? 0)}
            hint={t('myStore.settledHint', { count: balance?.settled_charges ?? 0 })}
            emphasis
          />
          <BalanceFigure label={t('myStore.grossReceived')} value={formatMoney(balance?.gross_received ?? 0)} />
          <BalanceFigure label={t('myStore.refundedLabel')} value={formatMoney(balance?.refunded ?? 0)} />
        </div>
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
                  placeholder="http://localhost:3000/webhooks/pseudopay"
                />
              </Field>
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
