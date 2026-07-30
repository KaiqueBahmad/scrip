import { useEffect, useState } from 'react';

import { PageHeader } from '../components/Layout';
import { Alert, Button, Input, Panel, PanelHeader, Select } from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';

/** Plain-language descriptions: the panel explains behaviour, not field names. */
const DESCRIPTIONS: Record<string, string> = {
  approvalRate:
    'Chance de uma cobrança ser confirmada quando o CPF do pagador não é um dos de teste. 0 nunca confirma, 1 sempre confirma.',
  pixConfirmationDelayMs: 'Tempo até uma cobrança se confirmar sozinha.',
  pixMinConfirmationDelayMs: 'Tempo usado pelo CPF que confirma sempre (11111111111).',
  pixQrCodeExpirationMs: 'Validade do QR code antes da cobrança expirar.',
  webhookDelayMs: 'Espera entre o evento acontecer e a primeira tentativa de webhook.',
  webhookMaxRetries: 'Tentativas por entrega, contando a primeira.',
  webhookRetryBackoffMs: 'Base do intervalo entre tentativas; cresce a cada nova tentativa.',
  webhookTimeoutMs: 'Tempo limite de cada requisição de webhook.',
  jwtDefaultExpiration: 'Validade padrão dos tokens novos. Ex.: 24h, 7d.',
  kycMaxFileSizeMb: 'Tamanho máximo de um documento de KYC, em megabytes.',
  requireApprovedKycForCharges:
    'Quando ligado, comerciantes sem KYC aprovado não conseguem criar cobranças.',
  pixKey: 'Chave PIX que vai dentro do BR Code gerado.',
  pixReceiverName: 'Nome do recebedor no BR Code.',
  pixReceiverCity: 'Cidade do recebedor no BR Code.',
};

const LABELS: Record<string, string> = {
  approvalRate: 'Taxa de aprovação',
  pixConfirmationDelayMs: 'Atraso de confirmação',
  pixMinConfirmationDelayMs: 'Atraso mínimo de confirmação',
  pixQrCodeExpirationMs: 'Validade do QR code',
  webhookDelayMs: 'Atraso do webhook',
  webhookMaxRetries: 'Tentativas de webhook',
  webhookRetryBackoffMs: 'Intervalo entre tentativas',
  webhookTimeoutMs: 'Timeout do webhook',
  jwtDefaultExpiration: 'Validade padrão do token',
  kycMaxFileSizeMb: 'Limite de arquivo do KYC',
  requireApprovedKycForCharges: 'Exigir KYC aprovado',
  pixKey: 'Chave PIX',
  pixReceiverName: 'Nome do recebedor',
  pixReceiverCity: 'Cidade do recebedor',
};

export function Settings() {
  const settings = useAsync(() => api.settings(), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.data) return;

    const next: Record<string, string> = {};
    for (const key of settings.data.editable) {
      next[key] = String(settings.data.values[key] ?? '');
    }
    setDraft(next);
  }, [settings.data]);

  const save = async () => {
    if (!settings.data) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Only send what actually changed, so a bad field can't silently reset the others.
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (String(settings.data.values[key] ?? '') !== value) patch[key] = value;
      }

      if (Object.keys(patch).length === 0) {
        setSaved(true);
        return;
      }

      await api.updateSettings(patch);
      await settings.reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  };

  const editable = settings.data?.editable ?? [];
  const values = settings.data?.values ?? {};
  const fixed = Object.keys(values).filter((key) => !editable.includes(key));

  return (
    <>
      <PageHeader
        eyebrow="comportamento da simulação"
        title="Configurações"
        description="Mudanças valem na hora e ficam salvas no banco. Os campos abaixo controlam como a simulação se comporta."
        actions={
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {saved && !error ? (
        <div className="mb-4">
          <Alert tone="settle">Configurações salvas.</Alert>
        </div>
      ) : null}

      <Panel className="mb-4">
        <PanelHeader title="Editável agora" hint="Aplicado sem reiniciar o servidor." />
        <div className="divide-y divide-[var(--hairline-soft)]">
          {editable.map((key) => {
            const isBoolean = typeof values[key] === 'boolean';

            return (
              <div
                key={key}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-start"
              >
                <div>
                  <label htmlFor={`setting-${key}`} className="text-[13px] font-medium">
                    {LABELS[key] ?? key}
                  </label>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{key}</p>
                  {DESCRIPTIONS[key] ? (
                    <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
                      {DESCRIPTIONS[key]}
                    </p>
                  ) : null}
                </div>

                {isBoolean ? (
                  <Select
                    id={`setting-${key}`}
                    value={draft[key] ?? 'false'}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [key]: event.target.value }))
                    }
                  >
                    <option value="true">Ligado</option>
                    <option value="false">Desligado</option>
                  </Select>
                ) : (
                  <Input
                    id={`setting-${key}`}
                    className="tnum"
                    value={draft[key] ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Só na inicialização"
          hint="Mude em pseudopay.config.json ou nas variáveis PSEUDOPAY_* e reinicie."
        />
        <dl className="divide-y divide-[var(--hairline-soft)]">
          {fixed.map((key) => (
            <div key={key} className="flex items-baseline justify-between gap-4 px-4 py-2">
              <dt className="font-mono text-[11px]">{key}</dt>
              <dd className="tnum text-xs text-[var(--text-muted)]">
                {key === 'jwtSigningSecret' ? '••••••••' : String(values[key])}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <p className="mt-4 text-[11px] text-[var(--text-muted)]">
        Este servidor não tem controle de acesso real: qualquer sessão do painel pode fazer
        qualquer coisa. Não exponha uma instância publicamente.
      </p>
    </>
  );
}
