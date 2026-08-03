import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
 * API tokens. Only this store can mint them, and each one is
 * scoped to it — within that scope a token reaches every API route. The JWT stays
 * visible forever instead of being shown once — that is a deliberate convenience of this
 * tool, not an oversight.
 */
export function Tokens() {
  const { t } = useTranslation();
  const { merchant } = useSession();
  const tokens = useAsync(() => api.tokens(), []);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = tokens.data?.data ?? [];

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await tokens.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.actionFailed'));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('tokens.eyebrow')}
        title={t('tokens.title')}
        description={t('tokens.description')}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('tokens.generateToken')}
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
          title={t('tokens.tokensOf', { name: merchant?.name ?? '' })}
          hint={t('tokens.tokensHint', { count: rows.length })}
        />

        {rows.length === 0 && !tokens.loading ? (
          <EmptyState title={t('tokens.emptyTitle')}>
            {t('tokens.emptyBodyPre')} <span className="font-mono">/v1/api/*</span> {t('tokens.emptyBodyPost')}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('tokens.colName')}</Th>
                <Th>{t('tokens.colToken')}</Th>
                <Th>{t('tokens.colExpires')}</Th>
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
                      <span className="eyebrow ml-2 text-halt">{t('tokens.revoked')}</span>
                    ) : null}
                  </Td>
                  <Td className="max-w-[260px]">
                    <Copyable value={token.token} truncate={{ head: 18, tail: 8 }} label="token" />
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {token.expires_at ? formatDateTime(token.expires_at) : t('common.never')}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {token.revoked ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void act(() => api.revokeToken(token.id))}
                        >
                          {t('tokens.revokeAction')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-halt"
                        onClick={() => void act(() => api.deleteToken(token.id))}
                      >
                        {t('tokens.deleteAction')}
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
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setSaving(true);
    setError(null);

    try {
      await api.createToken({
        name: name.trim() || null,
        ...(expiresIn.trim() ? { expires_in: expiresIn.trim() } : {}),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tokens.generateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('tokens.modalTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={saving} onClick={() => void create()}>
            {saving ? t('tokens.generating') : t('tokens.generateToken')}
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <Field label={t('selectMerchant.nameLabel')} htmlFor="token-name" hint={t('tokens.nameHint')}>
        <Input
          id="token-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('tokens.namePlaceholder')}
        />
      </Field>

      <Field
        label={t('tokens.validityLabel')}
        htmlFor="token-expires"
        hint={t('tokens.validityHint')}
      >
        <Input
          id="token-expires"
          value={expiresIn}
          onChange={(event) => setExpiresIn(event.target.value)}
          placeholder={t('tokens.validityPlaceholder')}
        />
      </Field>
    </Modal>
  );
}
