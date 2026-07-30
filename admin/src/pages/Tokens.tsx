import { useState } from 'react';

import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
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
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { cn, formatDateTime } from '../lib/utils';

/**
 * "Meus tokens" (specs.md:60-62). The JWT stays visible forever instead of being shown
 * once — that is a deliberate convenience of this tool, not an oversight.
 */
export function Tokens() {
  const { user } = useSession();
  const tokens = useAsync(() => api.tokens(), []);
  const merchants = useAsync(() => api.merchants(), []);
  const permissions = useAsync(() => api.permissions(), []);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = tokens.data?.data ?? [];

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await tokens.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'A ação falhou');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="api de integração"
        title="Meus tokens"
        description="JWTs escopados por comerciante e permissões. Use no header Authorization do seu backend."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Gerar token
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
          title={`Tokens de ${user?.name ?? ''}`}
          hint={`${rows.length} token(s) · visíveis a qualquer momento`}
        />

        {rows.length === 0 && !tokens.loading ? (
          <EmptyState title="Nenhum token gerado">
            Gere um token para chamar <span className="font-mono">/v1/integration/*</span> do seu
            backend.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Comerciante</Th>
                <Th>Permissões</Th>
                <Th>Token</Th>
                <Th>Expira</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((token) => (
                <tr
                  key={token.id}
                  className={cn('hover:bg-[var(--hairline-soft)]', token.revoked && 'opacity-50')}
                >
                  <Td className="font-medium">
                    {token.name ?? '—'}
                    {token.revoked ? (
                      <span className="eyebrow ml-2 text-halt">revogado</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Copyable value={token.merchant_id} truncate={{ head: 10, tail: 4 }} />
                  </Td>
                  <Td className="font-mono text-[11px]">
                    {token.permissions.includes('*') ? 'todas (*)' : token.permissions.join(', ')}
                  </Td>
                  <Td className="max-w-[260px]">
                    <Copyable value={token.token} truncate={{ head: 18, tail: 8 }} label="token" />
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {token.expires_at ? formatDateTime(token.expires_at) : 'nunca'}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {token.revoked ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void act(() => api.revokeToken(token.id))}
                        >
                          revogar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-halt"
                        onClick={() => void act(() => api.deleteToken(token.id))}
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

      <TokenForm
        open={creating}
        allPermissions={(permissions.data?.data ?? []).filter((permission) =>
          user?.permissions.includes('*') ? true : user?.permissions.includes(permission),
        )}
        merchants={merchants.data?.data ?? []}
        defaultMerchantId={user?.merchant_id ?? ''}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await tokens.reload();
        }}
      />
    </>
  );
}

function TokenForm({
  open,
  allPermissions,
  merchants,
  defaultMerchantId,
  onClose,
  onSaved,
}: {
  open: boolean;
  allPermissions: string[];
  merchants: { id: string; name: string }[];
  defaultMerchantId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [merchantId, setMerchantId] = useState(defaultMerchantId);
  const [selected, setSelected] = useState<string[]>(['*']);
  const [expiresIn, setExpiresIn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setSaving(true);
    setError(null);

    try {
      await api.createToken({
        merchant_id: merchantId || null,
        name: name.trim() || null,
        permissions: selected,
        ...(expiresIn.trim() ? { expires_in: expiresIn.trim() } : {}),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o token');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Gerar token de integração"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={() => void create()}>
            {saving ? 'Gerando…' : 'Gerar token'}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <Field label="Nome" htmlFor="token-name" hint="Só para você identificar depois.">
        <Input
          id="token-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="backend local"
        />
      </Field>

      <Field label="Comerciante" htmlFor="token-merchant">
        <Select
          id="token-merchant"
          value={merchantId}
          onChange={(event) => setMerchantId(event.target.value)}
        >
          <option value="">Usar o comerciante do usuário</option>
          {merchants.map((merchant) => (
            <option key={merchant.id} value={merchant.id}>
              {merchant.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Permissões" hint="Limitadas ao que o seu usuário já tem.">
        <div className="flex flex-wrap gap-1.5">
          {['*', ...allPermissions.filter((p) => p !== '*')].map((permission) => {
            const active = selected.includes(permission);
            return (
              <button
                key={permission}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (permission === '*') {
                    setSelected(active ? [] : ['*']);
                    return;
                  }
                  const rest = selected.filter((p) => p !== '*');
                  setSelected(
                    active ? rest.filter((p) => p !== permission) : [...rest, permission],
                  );
                }}
                className={cn(
                  'rounded-[var(--radius-panel)] border px-2 py-1 font-mono text-[11px]',
                  active
                    ? 'border-trace/40 bg-trace-soft text-trace'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
              >
                {permission === '*' ? 'todas (*)' : permission}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Validade"
        htmlFor="token-expires"
        hint='Ex.: "24h", "7d". Vazio usa o padrão da configuração; "never" gera token sem expiração.'
      >
        <Input
          id="token-expires"
          value={expiresIn}
          onChange={(event) => setExpiresIn(event.target.value)}
          placeholder="24h"
        />
      </Field>
    </Modal>
  );
}
