import { useState, type FormEvent } from 'react';

import { KycBadge } from '../components/StatusBadge';
import { Alert, Button, Field, Input, Panel, PanelHeader } from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { formatBRL } from '../lib/utils';

/**
 * There is no login screen (specs.md:54): you pick which store to be. When the database is
 * empty the same screen creates the first one, because store creation is unauthenticated —
 * Basic auth resolves an existing merchant, so otherwise nothing could ever be created.
 */
export function SelectMerchant() {
  const { merchants, selectMerchant, refreshMerchants, error } = useSession();

  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setFormError(null);

    try {
      const merchant = await api.createMerchant({
        name: name.trim(),
        document: document.trim() || null,
        webhook_url: webhookUrl.trim() || null,
      });

      await refreshMerchants();
      selectMerchant(merchant);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar a loja');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-dvh bg-ink px-4 py-[10vh]">
      <div className="mx-auto max-w-lg">
        <div className="mb-6">
          <span className="font-mono text-sm font-semibold tracking-[0.18em] text-white">
            PSEUDO<span className="text-trace">PAY</span>
          </span>
          <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-white/40 uppercase">
            gateway pix simulado · ambiente de desenvolvimento
          </p>
        </div>

        <Panel className="mb-4">
          <PanelHeader
            title="Escolha uma loja"
            hint="O painel não tem senha. A loja escolhida é quem faz as ações."
          />

          {error ? (
            <div className="p-4">
              <Alert>{error}</Alert>
            </div>
          ) : null}

          {merchants.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-[var(--text-muted)]">
              Nenhuma loja cadastrada. Crie a primeira abaixo para entrar.
            </p>
          ) : (
            <ul>
              {merchants.map((merchant) => (
                <li
                  key={merchant.id}
                  className="border-b border-[var(--hairline-soft)] last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => selectMerchant(merchant)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hairline-soft)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{merchant.name}</span>
                      <span className="tnum block truncate text-[11px] text-[var(--text-muted)]">
                        {merchant.id}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-[13px] font-medium">
                        {formatBRL(merchant.balance?.available ?? 0)}
                      </span>
                      <span className="mt-0.5 block">
                        <KycBadge status={merchant.kyc_status} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Criar loja" hint="É a conta de teste que representa o seu sistema." />
          <form className="grid gap-3 p-4" onSubmit={create}>
            {formError ? <Alert>{formError}</Alert> : null}

            <Field label="Nome" htmlFor="new-merchant-name">
              <Input
                id="new-merchant-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Loja de Teste"
                required
              />
            </Field>

            <Field label="CNPJ ou CPF" htmlFor="new-merchant-document">
              <Input
                id="new-merchant-document"
                value={document}
                onChange={(event) => setDocument(event.target.value)}
                placeholder="12345678000199"
              />
            </Field>

            <Field
              label="Webhook URL"
              htmlFor="new-merchant-webhook"
              hint="Pode ficar vazio agora e ser configurado depois em Minha loja."
            >
              <Input
                id="new-merchant-webhook"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder="http://localhost:3000/webhooks/pseudopay"
              />
            </Field>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={creating}>
                {creating ? 'Criando…' : 'Criar e entrar'}
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
