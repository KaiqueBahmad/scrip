import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import { DeliveryBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError, type ApiDelivery } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/utils';

const EVENTS = [
  'pix.charge.created',
  'pix.charge.paid',
  'pix.charge.expired',
  'pix.charge.refunded',
  'kyc.approved',
  'kyc.rejected',
];

/** Delivery log with the signature and payload visible — the point of the whole feature. */
export function Webhooks() {
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');
  const [selected, setSelected] = useState<ApiDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deliveries = useAsync(
    () =>
      api.deliveries({
        ...(status ? { status } : {}),
        ...(event ? { event } : {}),
        limit: '200',
      }),
    [status, event],
    { pollMs: 3000 },
  );

  const rows = deliveries.data?.data ?? [];
  const failed = rows.filter((delivery) => delivery.status === 'failed').length;

  const retry = async (delivery: ApiDelivery) => {
    setError(null);
    try {
      await api.retryDelivery(delivery.id);
      await deliveries.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível reenviar');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="entregas"
        title="Webhooks"
        description="Toda tentativa fica registrada, com assinatura e resposta do endpoint. Reenvie quantas vezes quiser."
        actions={
          <span className="eyebrow">
            {rows.length} tentativa(s) · {failed} falha(s)
          </span>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          title="Histórico"
          actions={
            <div className="flex items-center gap-2">
              <Select
                aria-label="Filtrar por evento"
                className="h-7 text-xs"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
              >
                <option value="">Todos os eventos</option>
                {EVENTS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filtrar por status"
                className="h-7 text-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todos os status</option>
                <option value="pending">Na fila</option>
                <option value="delivered">Entregues</option>
                <option value="failed">Falharam</option>
              </Select>
            </div>
          }
        />

        {rows.length === 0 && !deliveries.loading ? (
          <EmptyState title="Nenhuma entrega registrada">
            Webhooks aparecem aqui quando uma cobrança muda de status e o comerciante tem
            webhook_url configurada.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Evento</Th>
                <Th>Status</Th>
                <Th>Tent.</Th>
                <Th>Cobrança</Th>
                <Th>Resposta</Th>
                <Th>Quando</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((delivery) => (
                <tr
                  key={delivery.id}
                  className="cursor-pointer hover:bg-[var(--hairline-soft)]"
                  onClick={() => setSelected(delivery)}
                >
                  <Td className="tnum text-xs">{delivery.event}</Td>
                  <Td>
                    <DeliveryBadge status={delivery.status} />
                  </Td>
                  <Td className="tnum text-xs">
                    {delivery.attempt}/{delivery.max_attempts}
                  </Td>
                  <Td className="text-xs">
                    {delivery.charge_id ? (
                      <Link
                        to={`/transacoes/${delivery.charge_id}`}
                        className="tnum text-trace hover:underline"
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                      >
                        {delivery.charge_id.slice(0, 12)}…
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </Td>
                  <Td className="max-w-[180px] truncate text-xs">
                    {delivery.response_status ?? (
                      <span className="text-halt">{delivery.error ?? '—'}</span>
                    )}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                    {formatDateTime(delivery.delivered_at ?? delivery.updated_at)}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        void retry(delivery);
                      }}
                    >
                      <RotateCcw className="size-3" /> reenviar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {selected ? (
        <Panel className="mt-4">
          <PanelHeader
            title="Detalhe da entrega"
            hint={selected.id}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                fechar
              </Button>
            }
          />
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <div>
                <p className="eyebrow mb-1">destino</p>
                <Copyable value={selected.url} label="url" />
              </div>
              <div>
                <p className="eyebrow mb-1">assinatura enviada</p>
                {selected.signature ? (
                  <Copyable
                    value={selected.signature}
                    truncate={{ head: 24, tail: 10 }}
                    label="assinatura"
                  />
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Header <span className="font-mono">X-PseudoPay-Signature</span>, no formato{' '}
                  <span className="font-mono">t=&lt;unix&gt;,v1=&lt;hmac&gt;</span>. O HMAC é
                  calculado sobre <span className="font-mono">&lt;t&gt;.&lt;corpo&gt;</span> com o
                  segredo do comerciante.
                </p>
              </div>
              {selected.error ? (
                <div>
                  <p className="eyebrow mb-1">erro</p>
                  <p className="font-mono text-xs text-halt">{selected.error}</p>
                </div>
              ) : null}
              {selected.response_body ? (
                <div>
                  <p className="eyebrow mb-1">resposta do endpoint</p>
                  <pre className="max-h-32 overflow-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-2 font-mono text-[11px]">
                    {selected.response_body}
                  </pre>
                </div>
              ) : null}
            </div>

            <div>
              <p className="eyebrow mb-1">payload assinado</p>
              <pre className="max-h-72 overflow-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
