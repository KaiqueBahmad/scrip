import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';

import { Copyable } from '../components/Copyable';
import { LifecycleTrace, describeReason } from '../components/LifecycleTrace';
import { DeliveryBadge, StatusBadge } from '../components/StatusBadge';
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api, ApiError, type ChargeDetail } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatBRL, formatDateTime, maskDocument, relativeToNow } from '../lib/utils';

/** The BR Code rendered as an actual QR — not scannable by a bank app (specs.md:140). */
function QrPreview({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(payload, {
      margin: 1,
      width: 320,
      color: { dark: '#0e1626', light: '#ffffff' },
    }).then((url) => {
      if (active) setDataUrl(url);
    });

    return () => {
      active = false;
    };
  }, [payload]);

  // Displayed at 160px but generated at 320 so it stays sharp on hidpi screens.
  const frame = 'mx-auto aspect-square w-full max-w-[160px] rounded-[var(--radius-panel)] border';

  if (!dataUrl) {
    return <div className={`${frame} bg-[var(--surface)]`} />;
  }

  return <img src={dataUrl} alt="QR code da cobrança" className={`${frame} bg-white`} />;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline-soft)] px-4 py-2 last:border-0">
      <span className="eyebrow shrink-0">{label}</span>
      <span className="min-w-0 text-right text-xs">{children}</span>
    </div>
  );
}

export function TransactionDetail() {
  const { id = '' } = useParams();
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');

  const detail = useAsync<ChargeDetail>(() => api.charge(id), [id], { pollMs: 3000 });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setAction(label);
    setError(null);
    try {
      await fn();
      await detail.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'A ação falhou');
    } finally {
      setAction(null);
    }
  };

  if (detail.error) {
    return (
      <>
        <Link to="/transacoes" className="eyebrow mb-3 inline-flex items-center gap-1.5">
          <ArrowLeft className="size-3" /> voltar
        </Link>
        <Alert>{detail.error}</Alert>
      </>
    );
  }

  if (!detail.data) {
    return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;
  }

  const { charge, events, refunds, deliveries } = detail.data;
  const outstanding = charge.amount - charge.amount_refunded;
  const canRefund = charge.status === 'paid' || charge.status === 'partially_refunded';

  return (
    <>
      <Link to="/transacoes" className="eyebrow mb-3 inline-flex items-center gap-1.5">
        <ArrowLeft className="size-3" /> transações
      </Link>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="tnum text-lg font-semibold">{charge.id}</h1>
            <StatusBadge status={charge.status} />
          </div>
          <p className="tnum mt-0.5 text-2xl font-semibold">{formatBRL(charge.amount)}</p>
          {charge.amount_refunded > 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {formatBRL(charge.amount_refunded)} devolvido · {formatBRL(outstanding)} em aberto
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {charge.status === 'pending' ? (
            <>
              <Button
                variant="settle"
                disabled={action !== null}
                onClick={() => run('paid', () => api.simulate(charge.id, 'paid'))}
              >
                Confirmar pagamento
              </Button>
              <Button
                disabled={action !== null}
                onClick={() => run('expired', () => api.simulate(charge.id, 'expired'))}
              >
                Forçar expiração
              </Button>
              <Button
                disabled={action !== null}
                onClick={() => run('cancel', () => api.cancelCharge(charge.id))}
              >
                Cancelar
              </Button>
            </>
          ) : null}

          {canRefund ? (
            <Button variant="primary" onClick={() => setRefundOpen(true)}>
              Devolver
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {/* The signature view: the state machine as a timing trace. */}
      <Panel className="mb-4">
        <PanelHeader
          title="Ciclo de vida"
          hint="Cada faixa é um status; a duração é o tempo que a cobrança ficou nele."
        />
        <LifecycleTrace events={events} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4">
          <Panel>
            <PanelHeader title="Dados da cobrança" />
            <Detail label="comerciante">
              <Link
                to="/comerciantes"
                className="tnum text-trace hover:underline"
              >
                {charge.merchant_id}
              </Link>
            </Detail>
            <Detail label="pagador">{maskDocument(charge.payer_document)}</Detail>
            <Detail label="nome do pagador">{charge.payer_name ?? '—'}</Detail>
            <Detail label="descrição">{charge.description ?? '—'}</Detail>
            <Detail label="txid">
              <Copyable value={charge.qr_code_txid} label="txid" />
            </Detail>
            <Detail label="e2e id">
              {charge.e2e_id ? <Copyable value={charge.e2e_id} label="e2e id" /> : '—'}
            </Detail>
            <Detail label="public token">
              <Copyable value={charge.public_token} truncate={{ head: 12, tail: 6 }} label="public token" />
            </Detail>
            <Detail label="criada em">{formatDateTime(charge.created_at)}</Detail>
            <Detail label="expira em">
              {formatDateTime(charge.qr_code_expires_at)}
              {charge.status === 'pending' ? (
                <span className="text-[var(--text-muted)]"> · {relativeToNow(charge.qr_code_expires_at)}</span>
              ) : null}
            </Detail>
            <Detail label="paga em">{formatDateTime(charge.paid_at)}</Detail>
          </Panel>

          {Object.keys(charge.metadata).length > 0 ? (
            <Panel>
              <PanelHeader title="Metadata" hint="Enviada pelo lojista na criação da cobrança." />
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(charge.metadata, null, 2)}
              </pre>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Devoluções" hint={`${refunds.length} registro(s)`} />
            {refunds.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                Nenhuma devolução.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Devolução</Th>
                    <Th className="text-right">Valor</Th>
                    <Th>Motivo</Th>
                    <Th>Quando</Th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr key={refund.id}>
                      <Td>
                        <Copyable value={refund.id} truncate={{ head: 12, tail: 5 }} />
                      </Td>
                      <Td className="tnum text-right">{formatBRL(refund.amount)}</Td>
                      <Td className="text-xs">{refund.reason ?? '—'}</Td>
                      <Td className="text-xs whitespace-nowrap text-[var(--text-muted)]">
                        {formatDateTime(refund.created_at)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Webhooks desta cobrança"
              hint={`${deliveries.length} tentativa(s) registrada(s)`}
            />
            {deliveries.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                Nenhum webhook — o comerciante não tem webhook_url configurada.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Evento</Th>
                    <Th>Status</Th>
                    <Th>Tentativas</Th>
                    <Th>Resposta</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <Td className="tnum text-xs">{delivery.event}</Td>
                      <Td>
                        <DeliveryBadge status={delivery.status} />
                      </Td>
                      <Td className="tnum text-xs">
                        {delivery.attempt}/{delivery.max_attempts}
                      </Td>
                      <Td className="text-xs">
                        {delivery.response_status ?? (
                          <span className="text-halt">{delivery.error ?? '—'}</span>
                        )}
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action !== null}
                          onClick={() =>
                            run(`retry-${delivery.id}`, () => api.retryDelivery(delivery.id))
                          }
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
        </div>

        <div className="grid gap-4">
          <Panel>
            <PanelHeader title="QR code" hint="Payload no formato BR Code." />
            <div className="p-4">
              <QrPreview payload={charge.qr_code} />
              <div className="mt-3">
                <p className="eyebrow mb-1">pix copia e cola</p>
                <div className="rounded-[var(--radius-panel)] border bg-[var(--surface)] p-2">
                  <Copyable
                    value={charge.qr_code}
                    truncate={{ head: 34, tail: 12 }}
                    label="BR Code"
                    className="w-full"
                  />
                </div>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Este payload imita um PIX real, mas não é reconhecido por aplicativos de
                  banco de verdade.
                </p>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Transições" />
            <ol className="px-4 py-3">
              {events.map((event) => (
                <li key={event.id} className="border-b border-[var(--hairline-soft)] py-1.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">{event.to_status}</span>
                    <span className="tnum text-[10px] text-[var(--text-muted)]">
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {describeReason(event.reason)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <Modal
        open={refundOpen}
        title="Devolver cobrança"
        onClose={() => setRefundOpen(false)}
        footer={
          <>
            <Button onClick={() => setRefundOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={action !== null}
              onClick={async () => {
                const centavos = refundAmount.trim()
                  ? Math.round(Number(refundAmount.replace(',', '.')) * 100)
                  : null;

                await run('refund', () =>
                  api.refundCharge(charge.id, { amount: centavos, reason: 'devolvido pelo painel' }),
                );
                setRefundOpen(false);
                setRefundAmount('');
              }}
            >
              Devolver
            </Button>
          </>
        }
      >
        <Field
          label="Valor em reais"
          htmlFor="refund-amount"
          hint={`Deixe vazio para devolver tudo que está em aberto (${formatBRL(outstanding)}).`}
        >
          <Input
            id="refund-amount"
            inputMode="decimal"
            placeholder={(outstanding / 100).toFixed(2)}
            value={refundAmount}
            onChange={(event) => setRefundAmount(event.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
