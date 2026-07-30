import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import {
  Alert,
  EmptyState,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, type ChargeStatus } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatBRL, formatDateTime, maskDocument, relativeToNow } from '../lib/utils';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'paid', label: 'Pagas' },
  { value: 'partially_refunded', label: 'Devolvidas em parte' },
  { value: 'refunded', label: 'Devolvidas' },
  { value: 'expired', label: 'Expiradas' },
  { value: 'canceled', label: 'Canceladas' },
];

const CURL_EXAMPLE = `curl -X POST http://localhost:4242/v1/integration/pix/charges \\
  -H "Authorization: Bearer {seu_jwt}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 15000, "payer_document": "11111111111"}'`;

export function Transactions() {
  const [status, setStatus] = useState('');
  const [merchantId, setMerchantId] = useState('');

  const merchants = useAsync(() => api.merchants(), []);

  // Pending charges settle on a timer, so the list refreshes itself.
  const charges = useAsync(
    () =>
      api.charges({
        ...(status ? { status } : {}),
        ...(merchantId ? { merchant_id: merchantId } : {}),
        limit: '100',
      }),
    [status, merchantId],
    { pollMs: 3000 },
  );

  const rows = charges.data?.data ?? [];
  const pending = rows.filter((charge) => charge.status === 'pending').length;

  return (
    <>
      <PageHeader
        eyebrow="ciclo de vida pix"
        title="Transações"
        description="Cobranças criadas pela API de integração. Pendentes confirmam ou expiram sozinhas conforme a configuração."
        actions={
          <span className="eyebrow">
            {charges.data?.total ?? 0} no total · {pending} pendentes
          </span>
        }
      />

      <Panel>
        <PanelHeader
          title="Cobranças"
          actions={
            <div className="flex items-center gap-2">
              <Select
                aria-label="Filtrar por comerciante"
                className="h-7 text-xs"
                value={merchantId}
                onChange={(event) => setMerchantId(event.target.value)}
              >
                <option value="">Todos os comerciantes</option>
                {(merchants.data?.data ?? []).map((merchant) => (
                  <option key={merchant.id} value={merchant.id}>
                    {merchant.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filtrar por status"
                className="h-7 text-xs"
                value={status}
                onChange={(event) => setStatus(event.target.value as ChargeStatus | '')}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        {charges.error ? (
          <div className="p-4">
            <Alert>{charges.error}</Alert>
          </div>
        ) : null}

        {rows.length === 0 && !charges.loading ? (
          <EmptyState title="Nenhuma cobrança ainda">
            <p className="mb-2">
              Crie a primeira pela API de integração com um token gerado em{' '}
              <Link to="/tokens" className="text-trace underline">
                Meus tokens
              </Link>
              :
            </p>
            <pre className="overflow-x-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-3 text-left font-mono text-[11px] leading-relaxed">
              {CURL_EXAMPLE}
            </pre>
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cobrança</Th>
                <Th className="text-right">Valor</Th>
                <Th>Status</Th>
                <Th>Pagador</Th>
                <Th>Criada</Th>
                <Th>Expira</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((charge) => (
                <tr key={charge.id} className="hover:bg-[var(--hairline-soft)]">
                  <Td>
                    <Link
                      to={`/transacoes/${charge.id}`}
                      className="tnum text-xs text-trace hover:underline"
                    >
                      {charge.id}
                    </Link>
                  </Td>
                  <Td className="tnum text-right whitespace-nowrap">
                    {formatBRL(charge.amount)}
                    {charge.amount_refunded > 0 ? (
                      <span className="block text-[11px] text-[var(--text-muted)]">
                        −{formatBRL(charge.amount_refunded)} devolvido
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={charge.status} />
                  </Td>
                  <Td className="tnum text-xs whitespace-nowrap">
                    {maskDocument(charge.payer_document)}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {formatDateTime(charge.created_at)}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {charge.status === 'pending' ? relativeToNow(charge.qr_code_expires_at) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {rows.length > 0 ? (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Dica: os CPFs <Copyable value="11111111111" className="text-trace" /> (confirma
          sempre), <Copyable value="22222222222" className="text-trace" /> (nunca confirma) e{' '}
          <Copyable value="33333333333" className="text-trace" /> (webhook falha) têm
          comportamento fixo.
        </p>
      ) : null}
    </>
  );
}
