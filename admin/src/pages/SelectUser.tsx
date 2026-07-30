import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Alert, Button, Field, Input, Panel, PanelHeader } from '../components/ui/primitives';

/**
 * There is no login screen (specs.md:54): you pick who to be. When the database is empty
 * the same screen creates the first user, because user CRUD is public (specs.md:114) and
 * Basic auth has nothing to resolve until one exists.
 */
export function SelectUser() {
  const { users, selectUser, refreshUsers, error } = useSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setFormError(null);

    try {
      const user = await api.createUser({
        name: name.trim(),
        email: email.trim(),
        // The first user gets everything; specs.md:114 makes permissions a free choice.
        permissions: ['*'],
        merchant_id: null,
      });

      await refreshUsers();
      selectUser(user);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Não foi possível criar o usuário',
      );
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
            title="Escolha um usuário"
            hint="O painel não tem senha. Escolher um usuário define quem faz as ações."
          />

          {error ? (
            <div className="p-4">
              <Alert>{error}</Alert>
            </div>
          ) : null}

          {users.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-[var(--text-muted)]">
              Nenhum usuário cadastrado. Crie o primeiro abaixo para entrar.
            </p>
          ) : (
            <ul>
              {users.map((user) => (
                <li key={user.id} className="border-b border-[var(--hairline-soft)] last:border-0">
                  <button
                    type="button"
                    onClick={() => selectUser(user)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hairline-soft)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{user.name}</span>
                      <span className="tnum block truncate text-[11px] text-[var(--text-muted)]">
                        {user.email}
                      </span>
                    </span>
                    <span className="eyebrow shrink-0">
                      {user.permissions.includes('*')
                        ? 'todas as permissões'
                        : `${user.permissions.length} permissões`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Criar usuário" hint="Recebe todas as permissões." />
          <form className="grid gap-3 p-4" onSubmit={create}>
            {formError ? <Alert>{formError}</Alert> : null}

            <Field label="Nome" htmlFor="new-user-name">
              <Input
                id="new-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Kaique"
                required
              />
            </Field>

            <Field label="E-mail" htmlFor="new-user-email">
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="kaique@example.com"
                required
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
