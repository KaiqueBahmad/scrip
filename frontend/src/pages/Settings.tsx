import { useTranslation } from 'react-i18next';

import { PageHeader } from '../components/Layout';
import { Alert, Panel, PanelHeader } from '../components/ui/primitives';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

const CONFIG_KEYS = [
  'port',
  'host',
  'databasePath',
  'approvalRate',
  'pixConfirmationDelayMs',
  'pixMinConfirmationDelayMs',
  'pixQrCodeExpirationMs',
  'webhookDelayMs',
  'webhookMaxRetries',
  'webhookRetryBackoffMs',
  'webhookTimeoutMs',
  'jwtSigningSecret',
  'jwtDefaultExpiration',
  'kycMaxFileSizeMb',
  'requireApprovedKycForCharges',
  'pixKey',
  'pixReceiverName',
  'pixReceiverCity',
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];

function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

export function Settings() {
  const { t } = useTranslation();
  const settings = useAsync(() => api.settings(), []);

  const source = settings.data?.source ?? 'pseudopay.config.json';
  const values = settings.data?.values ?? {};
  const entries = Object.entries(values);

  const display = (key: string, value: string | number | boolean): string => {
    if (key === 'jwtSigningSecret') return '••••••••';
    if (typeof value === 'boolean') return value ? t('settings.on') : t('settings.off');
    return String(value);
  };

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={t('settings.description', { source })}
      />

      {settings.error ? (
        <div className="mb-4">
          <Alert>{settings.error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title={t('settings.valuesInUse')}
          hint={t('settings.valuesHint', { source })}
        />
        <dl className="divide-y divide-[var(--hairline-soft)]">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-start"
            >
              <div>
                <dt className="text-[13px] font-medium">
                  {isConfigKey(key) ? t(`settings.labels.${key}`) : key}
                </dt>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{key}</p>
                {isConfigKey(key) ? (
                  <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
                    {t(`settings.descriptions.${key}`)}
                  </p>
                ) : null}
              </div>
              <dd className="tnum break-all font-mono text-xs sm:text-right">
                {display(key, value)}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <p className="mt-4 text-[11px] text-[var(--text-muted)]">{t('settings.footer')}</p>
    </>
  );
}
