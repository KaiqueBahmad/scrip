import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { KycBadge } from '../components/StatusBadge';
import { Alert, Button, Field, Input, Panel, PanelHeader } from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { setLanguage } from '../lib/i18n';
import { useSession } from '../lib/session';
import { formatMoney } from '../lib/utils';

/**
 * There is no login screen: you pick which store to be. When the database is
 * empty the same screen creates the first one, because store creation is unauthenticated —
 * Basic auth resolves an existing merchant, so otherwise nothing could ever be created.
 */
export function SelectMerchant() {
  const { t, i18n } = useTranslation();
  const { merchants, selectMerchant, refreshMerchants, error } = useSession();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setFormError(null);

    try {
      // A webhook_url é configurada depois, em Minha loja — o cadastro só precisa
      // identificar a loja.
      const merchant = await api.createMerchant({ name: name.trim(), webhook_url: null });

      await refreshMerchants();
      selectMerchant(merchant);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('selectMerchant.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-dvh bg-ink px-4 py-[10vh]">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-sm font-semibold tracking-[0.18em] text-white">
              SCR<span className="text-trace">IP</span>
            </span>
            <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-white/40 uppercase">
              {t('selectMerchant.subtitle')}
            </p>
          </div>

          <div
            role="group"
            aria-label={t('selectMerchant.language')}
            className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-panel)] border border-white/15 p-0.5"
          >
            {(['en', 'pt'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                className={
                  i18n.language === lang
                    ? 'rounded-[calc(var(--radius-panel)-2px)] bg-trace px-2 py-1 font-mono text-[10px] font-medium text-white uppercase'
                    : 'rounded-[calc(var(--radius-panel)-2px)] px-2 py-1 font-mono text-[10px] text-white/50 uppercase hover:text-white/80'
                }
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <Panel className="mb-4">
          <PanelHeader
            title={t('selectMerchant.chooseStoreTitle')}
            hint={t('selectMerchant.chooseStoreHint')}
          />

          {error ? (
            <div className="p-4">
              <Alert>{error}</Alert>
            </div>
          ) : null}

          {merchants.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-[var(--text-muted)]">
              {t('selectMerchant.noStores')}
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
                        {formatMoney(merchant.balance?.available ?? 0)}
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
          <PanelHeader
            title={t('selectMerchant.createStoreTitle')}
            hint={t('selectMerchant.createStoreHint')}
          />
          <form className="grid gap-3 p-4" onSubmit={create}>
            {formError ? <Alert>{formError}</Alert> : null}

            <Field label={t('selectMerchant.nameLabel')} htmlFor="new-merchant-name">
              <Input
                id="new-merchant-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('selectMerchant.namePlaceholder')}
                required
              />
            </Field>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={creating}>
                {creating ? t('selectMerchant.creating') : t('selectMerchant.createAndEnter')}
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
