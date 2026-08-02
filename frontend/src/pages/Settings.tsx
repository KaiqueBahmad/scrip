import { PageHeader } from '../components/Layout';
import { Alert, Panel, PanelHeader } from '../components/ui/primitives';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

/** Plain-language descriptions: the panel explains behaviour, not field names. */
const DESCRIPTIONS: Record<string, string> = {
  port: 'Porta em que o servidor escuta.',
  host: 'Interface em que o servidor escuta.',
  databasePath: 'Arquivo SQLite onde os dados ficam.',
  approvalRate:
    'Chance de uma cobrança ser confirmada quando o CPF do pagador não é um dos de teste. 0 nunca confirma, 1 sempre confirma.',
  pixConfirmationDelayMs: 'Tempo até uma cobrança se confirmar sozinha.',
  pixMinConfirmationDelayMs: 'Tempo usado pelo CPF que confirma sempre (11111111111).',
  pixQrCodeExpirationMs: 'Validade do QR code antes da cobrança expirar.',
  webhookDelayMs: 'Espera entre o evento acontecer e a primeira tentativa de webhook.',
  webhookMaxRetries: 'Tentativas por entrega, contando a primeira.',
  webhookRetryBackoffMs: 'Base do intervalo entre tentativas; cresce a cada nova tentativa.',
  webhookTimeoutMs: 'Tempo limite de cada requisição de webhook.',
  jwtSigningSecret: 'Segredo que assina os tokens de integração.',
  jwtDefaultExpiration: 'Validade padrão dos tokens novos. Ex.: 24h, 7d.',
  kycMaxFileSizeMb: 'Tamanho máximo de um documento de KYC, em megabytes.',
  requireApprovedKycForCharges:
    'Quando ligado, comerciantes sem KYC aprovado não conseguem criar cobranças.',
  pixKey: 'Chave PIX que vai dentro do BR Code gerado.',
  pixReceiverName: 'Nome do recebedor no BR Code.',
  pixReceiverCity: 'Cidade do recebedor no BR Code.',
};

const LABELS: Record<string, string> = {
  port: 'Porta',
  host: 'Host',
  databasePath: 'Banco de dados',
  approvalRate: 'Taxa de aprovação',
  pixConfirmationDelayMs: 'Atraso de confirmação',
  pixMinConfirmationDelayMs: 'Atraso mínimo de confirmação',
  pixQrCodeExpirationMs: 'Validade do QR code',
  webhookDelayMs: 'Atraso do webhook',
  webhookMaxRetries: 'Tentativas de webhook',
  webhookRetryBackoffMs: 'Intervalo entre tentativas',
  webhookTimeoutMs: 'Timeout do webhook',
  jwtSigningSecret: 'Segredo de assinatura',
  jwtDefaultExpiration: 'Validade padrão do token',
  kycMaxFileSizeMb: 'Limite de arquivo do KYC',
  requireApprovedKycForCharges: 'Exigir KYC aprovado',
  pixKey: 'Chave PIX',
  pixReceiverName: 'Nome do recebedor',
  pixReceiverCity: 'Cidade do recebedor',
};

function display(key: string, value: string | number | boolean): string {
  if (key === 'jwtSigningSecret') return '••••••••';
  if (typeof value === 'boolean') return value ? 'Ligado' : 'Desligado';
  return String(value);
}

export function Settings() {
  const settings = useAsync(() => api.settings(), []);

  const source = settings.data?.source ?? 'pseudopay.config.json';
  const values = settings.data?.values ?? {};
  const entries = Object.entries(values);

  return (
    <>
      <PageHeader
        eyebrow="comportamento da simulação"
        title="Configurações"
        description={`Somente leitura. Os valores abaixo vêm de ${source} e controlam como a simulação se comporta.`}
      />

      {settings.error ? (
        <div className="mb-4">
          <Alert>{settings.error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title="Valores em uso"
          hint={`Para mudar, edite ${source} (ou uma variável PSEUDOPAY_*) e reinicie o servidor.`}
        />
        <dl className="divide-y divide-[var(--hairline-soft)]">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-start"
            >
              <div>
                <dt className="text-[13px] font-medium">{LABELS[key] ?? key}</dt>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{key}</p>
                {DESCRIPTIONS[key] ? (
                  <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
                    {DESCRIPTIONS[key]}
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

      <p className="mt-4 text-[11px] text-[var(--text-muted)]">
        Este servidor não tem controle de acesso real: qualquer sessão do painel pode fazer
        qualquer coisa. Não exponha uma instância publicamente.
      </p>
    </>
  );
}
