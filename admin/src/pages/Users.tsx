import { useState } from 'react';

import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import {
  Alert,
  Button,
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
import { api, ApiError, type ApiUser } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { cn, formatDateTime } from '../lib/utils';

/** Permission picker. Selecting "*" collapses the rest, since it already grants everything. */
function PermissionPicker({
  all,
  selected,
  onChange,
}: {
  all: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const hasWildcard = selected.includes('*');

  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((permission) => {
        const active = selected.includes(permission);
        const dimmed = hasWildcard && permission !== '*';

        return (
          <button
            key={permission}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (permission === '*') {
                onChange(hasWildcard ? [] : ['*']);
                return;
              }
              const withoutWildcard = selected.filter((p) => p !== '*');
              onChange(
                active
                  ? withoutWildcard.filter((p) => p !== permission)
                  : [...withoutWildcard, permission],
              );
            }}
            className={cn(
              'rounded-[var(--radius-panel)] border px-2 py-1 font-mono text-[11px]',
              active
                ? 'border-trace/40 bg-trace-soft text-trace'
                : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]',
              dimmed && 'opacity-40',
            )}
          >
            {permission === '*' ? 'todas (*)' : permission}
          </button>
        );
      })}
    </div>
  );
}

export function Users() {
  const { user: acting, refreshUsers } = useSession();
  const users = useAsync(() => api.users(), []);
  const merchants = useAsync(() => api.merchants(), []);
  const permissions = useAsync(() => api.permissions(), []);

  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = users.data?.data ?? [];

  const remove = async (user: ApiUser) => {
    if (!window.confirm(`Excluir ${user.name}? Os tokens dele param de funcionar.`)) return;

    try {
      await api.deleteUser(user.id);
      await Promise.all([users.reload(), refreshUsers()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível excluir');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="identidades do painel"
        title="Usuários"
        description="Qualquer sessão pode criar usuários com quaisquer permissões — o painel não tem controle de acesso real."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Novo usuário
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader title="Cadastrados" hint={`${rows.length} usuário(s)`} />
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th>Permissões</Th>
              <Th>Comerciante</Th>
              <Th>Criado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="hover:bg-[var(--hairline-soft)]">
                <Td className="font-medium">
                  {user.name}
                  {acting?.id === user.id ? (
                    <span className="eyebrow ml-2 text-trace">você</span>
                  ) : null}
                </Td>
                <Td className="tnum text-xs">{user.email}</Td>
                <Td className="text-xs">
                  {user.permissions.includes('*') ? (
                    <span className="font-mono text-trace">todas (*)</span>
                  ) : user.permissions.length === 0 ? (
                    <span className="text-[var(--text-muted)]">nenhuma</span>
                  ) : (
                    <span className="font-mono text-[11px]">
                      {user.permissions.length} · {user.permissions.slice(0, 2).join(', ')}
                      {user.permissions.length > 2 ? '…' : ''}
                    </span>
                  )}
                </Td>
                <Td className="text-xs">
                  {user.merchant_id ? (
                    <Copyable value={user.merchant_id} truncate={{ head: 10, tail: 4 }} />
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </Td>
                <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                  {formatDateTime(user.created_at)}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                      editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-halt"
                      onClick={() => void remove(user)}
                    >
                      excluir
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <UserForm
        open={creating}
        allPermissions={permissions.data?.data ?? []}
        merchants={merchants.data?.data ?? []}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await Promise.all([users.reload(), refreshUsers()]);
        }}
      />

      <UserForm
        key={editing?.id}
        user={editing}
        open={editing !== null}
        allPermissions={permissions.data?.data ?? []}
        merchants={merchants.data?.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await Promise.all([users.reload(), refreshUsers()]);
        }}
      />
    </>
  );
}

function UserForm({
  user,
  open,
  allPermissions,
  merchants,
  onClose,
  onSaved,
}: {
  user?: ApiUser | null;
  open: boolean;
  allPermissions: string[];
  merchants: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [permissions, setPermissions] = useState<string[]>(user?.permissions ?? ['*']);
  const [merchantId, setMerchantId] = useState(user?.merchant_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        email: email.trim(),
        permissions,
        merchant_id: merchantId || null,
      };

      if (user) await api.updateUser(user.id, payload);
      else await api.createUser(payload);

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
      title={user ? 'Editar usuário' : 'Novo usuário'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <Field label="Nome" htmlFor="user-name">
        <Input id="user-name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>

      <Field label="E-mail" htmlFor="user-email" hint="Serve como usuário no HTTP Basic do painel.">
        <Input
          id="user-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field
        label="Permissões"
        hint="Um token só pode receber permissões que o usuário já tem."
      >
        <PermissionPicker all={allPermissions} selected={permissions} onChange={setPermissions} />
      </Field>

      <Field
        label="Comerciante"
        htmlFor="user-merchant"
        hint="Vincular define o comerciante padrão dos tokens deste usuário."
      >
        <Select
          id="user-merchant"
          value={merchantId}
          onChange={(event) => setMerchantId(event.target.value)}
        >
          <option value="">Nenhum</option>
          {merchants.map((merchant) => (
            <option key={merchant.id} value={merchant.id}>
              {merchant.name}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
