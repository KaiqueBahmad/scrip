import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/Layout';
import { Panel } from '../components/ui/primitives';

const INTEGRATION_ROUTES = [
  {
    method: 'POST',
    path: '/v1/integration/pix/charges',
    description: 'Cria uma cobrança PIX.',
    payload: '{ amount, payer_document?, payer_name?, description?, metadata? }',
    returns: 'pix_charge',
  },
  {
    method: 'GET',
    path: '/v1/integration/pix/charges',
    description: 'Lista as cobranças da loja.',
    payload: 'Filtros: status, from, to, limit, offset',
    returns: '{ object: "list", data: pix_charge[], total }',
  },
  {
    method: 'GET',
    path: '/v1/integration/pix/charges/:id',
    description: 'Consulta uma cobrança.',
    payload: '—',
    returns: 'pix_charge',
  },
  {
    method: 'GET',
    path: '/v1/integration/pix/charges/:id/events',
    description: 'Lista o histórico de status.',
    payload: '—',
    returns: '{ object: "list", data: charge_event[] }',
  },
  {
    method: 'POST',
    path: '/v1/integration/pix/charges/:id/cancel',
    description: 'Cancela uma cobrança.',
    payload: '—',
    returns: 'pix_charge',
  },
  {
    method: 'POST',
    path: '/v1/integration/pix/charges/:id/refunds',
    description: 'Solicita o reembolso.',
    payload: '{ amount?, reason? }',
    returns: 'pix_refund',
  },
  {
    method: 'GET',
    path: '/v1/integration/pix/charges/:id/refunds',
    description: 'Lista os reembolsos da cobrança.',
    payload: '—',
    returns: '{ object: "list", data: pix_refund[] }',
  },
  {
    method: 'GET',
    path: '/v1/integration/merchants/me',
    description: 'Consulta os dados da loja.',
    payload: '—',
    returns: 'merchant',
  },
  {
    method: 'PATCH',
    path: '/v1/integration/merchants/me',
    description: 'Atualiza os dados da loja.',
    payload: '{ name?, webhook_url?, rotate_webhook_secret? }',
    returns: 'merchant',
  },
] as const;

export function Documentation() {
  return (
    <div className="min-h-dvh bg-[var(--surface)] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/transacoes"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <ArrowLeft className="size-3.5" />
          voltar ao painel
        </Link>

        <PageHeader eyebrow="integração" title="Documentação" />

        <div className="grid gap-3">
          {INTEGRATION_ROUTES.map((route) => (
            <Panel key={`${route.method}-${route.path}`}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3">
                <span className="rounded-[var(--radius-panel)] bg-trace-soft px-2 py-0.5 font-mono text-[11px] font-medium text-trace">
                  {route.method}
                </span>
                <code className="min-w-0 break-all text-xs">{route.path}</code>
                <p className="w-full text-[13px] text-[var(--text-muted)]">{route.description}</p>
              </div>

              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div>
                  <p className="eyebrow mb-1.5">payload</p>
                  <code className="block rounded-[var(--radius-panel)] border bg-[var(--surface)] px-3 py-2 text-xs break-words text-[var(--text-muted)]">
                    {route.payload}
                  </code>
                </div>
                <div>
                  <p className="eyebrow mb-1.5">retorno</p>
                  <code className="block rounded-[var(--radius-panel)] border bg-[var(--surface)] px-3 py-2 text-xs break-words text-[var(--text-muted)]">
                    {route.returns}
                  </code>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}
