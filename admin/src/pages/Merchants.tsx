import { useState } from 'react';

import { Copyable, Secret } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import { KycBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError, type ApiMerchant } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDateTime, maskDocument } from '../lib/utils';

export function Merchants() {
  const merchants = useAsync(() => api.merchants(), []);
  const [editing, setEditing] = useState<ApiMerchant | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = merchants.data?.data ?? [];

  const remove = async (merchant: ApiMerchant) => {
    if (
      !window.confirm(
        `Excluir ${merchant.name}? As cobranças, tokens e documentos dele serão apagados junto.`,
      )
    ) {
      return;
    }

    try {
      await api.deleteMerchant(merchant.id);
      await merchants.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível excluir');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="contas de teste"
        title="Comerciantes"
        description="Cada comerciante representa um sistema seu. A webhook_url e o segredo de assinatura ficam aqui."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Novo comerciante
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader title="Contas" hint={`${rows.length} cadastrada(s)`} />

        {rows.length === 0 && !merchants.loading ? (
          <EmptyState title="Nenhum comerciante ainda">
            Crie uma conta de teste para representar o seu sistema e começar a gerar cobranças.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>ID</Th>
                <Th>Documento</Th>
                <Th>Webhook</Th>
                <Th>Segredo</Th>
                <Th>KYC</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((merchant) => (
                <tr key={merchant.id} className="hover:bg-[var(--hairline-soft)]">
                  <Td className="font-medium">{merchant.name}</Td>
                  <Td>
                    <Copyable value={merchant.id} truncate={{ head: 12, tail: 5 }} label="id" />
                  </Td>
                  <Td className="tnum text-xs">{maskDocument(merchant.document)}</Td>
                  <Td className="max-w-[220px] truncate text-xs">
                    {merchant.webhook_url ? (
                      <Copyable value={merchant.webhook_url} label="webhook_url" />
                    ) : (
                      <span className="text-[var(--text-muted)]">não configurada</span>
                    )}
                  </Td>
                  <Td>
                    {merchant.webhook_secret ? (
                      <Secret value={merchant.webhook_secret} label="segredo" />
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <KycBadge status={merchant.kyc_status} />
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(merchant)}>
                        editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-halt"
                        onClick={() => void remove(merchant)}
                      >
                        excluir
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <MerchantForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await merchants.reload();
        }}
      />

      <MerchantForm
        key={editing?.id}
        merchant={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await merchants.reload();
        }}
      />
    </>
  );
}

function MerchantForm({
  merchant,
  open,
  onClose,
  onSaved,
}: {
  merchant?: ApiMerchant | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(merchant?.name ?? '');
  const [document, setDocument] = useState(merchant?.document ?? '');
  const [webhookUrl, setWebhookUrl] = useState(merchant?.webhook_url ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);

    try {
      if (merchant) {
        await api.updateMerchant(merchant.id, {
          name: name.trim(),
          document: document.trim() || null,
          webhook_url: webhookUrl.trim() || null,
        });
      } else {
        await api.createMerchant({
          name: name.trim(),
          document: document.trim() || null,
          webhook_url: webhookUrl.trim() || null,
        });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={merchant ? 'Editar comerciante' : 'Novo comerciante'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          {merchant ? (
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await api.updateMerchant(merchant.id, { rotate_webhook_secret: true });
                  await onSaved();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Falha ao gerar novo segredo');
                } finally {
                  setSaving(false);
                }
              }}
            >
              Gerar novo segredo
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <Field label="Nome" htmlFor="merchant-name">
        <Input
          id="merchant-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Loja de Teste"
        />
      </Field>

      <Field label="CNPJ ou CPF" htmlFor="merchant-document">
        <Input
          id="merchant-document"
          value={document}
          onChange={(event) => setDocument(event.target.value)}
          placeholder="12345678000199"
        />
      </Field>

      <Field
        label="Webhook URL"
        htmlFor="merchant-webhook"
        hint="Sem URL, os eventos são registrados como ignorados em vez de enviados."
      >
        <Input
          id="merchant-webhook"
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          placeholder="http://localhost:3000/webhooks/pseudopay"
        />
      </Field>

      {merchant?.created_at ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          Criado em {formatDateTime(merchant.created_at)}
        </p>
      ) : null}
    </Modal>
  );
}
