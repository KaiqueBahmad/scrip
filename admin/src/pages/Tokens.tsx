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
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { cn, formatDateTime } from '../lib/utils';

/**
 * Integration tokens (specs.md:60-62). Only this store can mint them, and each one is
 * scoped to it. The JWT stays visible forever instead of being shown once — that is a
 * deliberate convenience of this tool, not an oversight.
 */
export function Tokens() {
  const { merchant } = useSession();
  const tokens = useAsync(() => api.tokens(), []);
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
        title="Tokens"
        description="Só esta loja pode emitir tokens, e todo token nasce escopado nela. Use no header Authorization do seu backend."
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
          title={`Tokens de ${merchant?.name ?? ''}`}
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
        allPermissions={permissions.data?.data ?? []}
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
  onClose,
  onSaved,
}: {
  open: boolean;
  allPermissions: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>(['*']);
  const [expiresIn, setExpiresIn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setSaving(true);
    setError(null);

    try {
      await api.createToken({
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

      <Field label="Permissões" hint="A loja é dona do próprio escopo, então pode conceder qualquer uma.">
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
