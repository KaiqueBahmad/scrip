import { ArrowLeft, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/Layout';
import { Alert, Button, Field, Panel, PanelHeader, Select, Textarea } from '../components/ui/primitives';
import { api, ApiError, type ApiCharge, type ApiToken } from '../lib/api';
import { useAsync } from '../lib/useAsync';

const INTEGRATION_ROUTES = [
  { id: 'create-charge', method: 'POST', path: '/pix/charges', description: 'Cria uma cobrança PIX.', payload: '{ amount, payer_document?, payer_name?, description?, metadata? }', returns: 'pix_charge', exampleBody: '{\n  "amount": 15000,\n  "payer_document": "11111111111",\n  "description": "Pedido de teste",\n  "metadata": { "order_id": "abc-123" }\n}', query: '' },
  { id: 'list-charges', method: 'GET', path: '/pix/charges', description: 'Lista as cobranças da loja.', payload: 'Filtros: status, from, to, limit, offset', returns: '{ object: "list", data: pix_charge[], total }', exampleBody: '', query: '?limit=20' },
  { id: 'get-charge', method: 'GET', path: '/pix/charges/:id', description: 'Consulta uma cobrança.', payload: '—', returns: 'pix_charge', exampleBody: '', query: '' },
  { id: 'charge-events', method: 'GET', path: '/pix/charges/:id/events', description: 'Lista o histórico de status.', payload: '—', returns: '{ object: "list", data: charge_event[] }', exampleBody: '', query: '' },
  { id: 'cancel-charge', method: 'POST', path: '/pix/charges/:id/cancel', description: 'Cancela uma cobrança.', payload: '—', returns: 'pix_charge', exampleBody: '', query: '' },
  { id: 'create-refund', method: 'POST', path: '/pix/charges/:id/refunds', description: 'Solicita o reembolso.', payload: '{ amount?, reason? }', returns: 'pix_refund', exampleBody: '{\n  "amount": 5000,\n  "reason": "Solicitação do cliente"\n}', query: '' },
  { id: 'list-refunds', method: 'GET', path: '/pix/charges/:id/refunds', description: 'Lista os reembolsos da cobrança.', payload: '—', returns: '{ object: "list", data: pix_refund[] }', exampleBody: '', query: '' },
  { id: 'get-merchant', method: 'GET', path: '/merchants/me', description: 'Consulta os dados da loja.', payload: '—', returns: 'merchant', exampleBody: '', query: '' },
  { id: 'update-merchant', method: 'PATCH', path: '/merchants/me', description: 'Atualiza os dados da loja.', payload: '{ name?, webhook_url?, rotate_webhook_secret? }', returns: 'merchant', exampleBody: '{\n  "name": "Minha loja",\n  "webhook_url": "https://example.test/webhook"\n}', query: '' },
] as const;

type RouteDoc = (typeof INTEGRATION_ROUTES)[number];

export function Documentation() {
  const resources = useAsync(async () => {
    const [tokenResponse, chargeResponse] = await Promise.all([api.tokens(), api.charges({ limit: '50' })]);
    return { tokens: tokenResponse.data, charges: chargeResponse.data };
  }, []);

  const tokens = resources.data?.tokens.filter((token) => !token.revoked) ?? [];
  const charges = resources.data?.charges ?? [];

  return (
    <div className="min-h-dvh bg-[var(--surface)] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <Link to="/transacoes" className="mb-6 inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowLeft className="size-3.5" /> voltar ao painel
        </Link>
        <PageHeader
          eyebrow="integração"
          title="Documentação"
          description="Cada rota possui sua própria área de teste. Os tokens ficam disponíveis novamente sempre que você precisar."
        />
        {resources.error ? <div className="mb-4"><Alert>{resources.error}</Alert></div> : null}
        {!resources.loading && tokens.length === 0 ? (
          <div className="mb-4"><Alert tone="flag">Nenhum token ativo encontrado. <Link className="underline" to="/tokens">Gerar token</Link> para usar os playgrounds.</Alert></div>
        ) : null}
        <div className="grid gap-3">
          {INTEGRATION_ROUTES.map((route) => <RouteCard key={route.id} route={route} tokens={tokens} charges={charges} />)}
        </div>
      </div>
    </div>
  );
}

function RouteCard({ route, tokens, charges }: { route: RouteDoc; tokens: ApiToken[]; charges: ApiCharge[] }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="rounded-[var(--radius-panel)] bg-trace-soft px-2 py-0.5 font-mono text-[11px] font-medium text-trace">{route.method}</span>
        <code className="min-w-0 break-all text-xs">/v1/integration{route.path}</code>
        <p className="w-full text-[13px] text-[var(--text-muted)]">{route.description}</p>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div><p className="eyebrow mb-1.5">payload</p><code className="block rounded-[var(--radius-panel)] border bg-[var(--surface)] px-3 py-2 text-xs break-words text-[var(--text-muted)]">{route.payload}</code></div>
        <div><p className="eyebrow mb-1.5">retorno</p><code className="block rounded-[var(--radius-panel)] border bg-[var(--surface)] px-3 py-2 text-xs break-words text-[var(--text-muted)]">{route.returns}</code></div>
      </div>
      <RoutePlayground route={route} tokens={tokens} charges={charges} />
    </Panel>
  );
}

function RoutePlayground({ route, tokens, charges }: { route: RouteDoc; tokens: ApiToken[]; charges: ApiCharge[] }) {
  const [tokenId, setTokenId] = useState('');
  const [chargeId, setChargeId] = useState('');
  const [body, setBody] = useState<string>(route.exampleBody);
  const [response, setResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const token = tokens.find((item) => item.id === tokenId) ?? tokens[0];
  const resolvedPath = route.path.replace(':id', chargeId || 'ch_example');

  useEffect(() => { if (!tokenId && tokens[0]) setTokenId(tokens[0].id); }, [tokenId, tokens]);
  useEffect(() => { if (!chargeId && charges[0]) setChargeId(charges[0].id); }, [chargeId, charges]);

  const execute = async () => {
    if (!token) { setError('Gere ou selecione um token ativo para executar a chamada.'); return; }
    setRunning(true); setError(null); setResponse(null);
    try {
      const result = await api.integrationRequest<unknown>(route.method, `${resolvedPath}${route.query}`, token.token, body.trim() ? JSON.parse(body) : undefined);
      setResponse(result);
    } catch (err) {
      setError(err instanceof SyntaxError ? 'O payload não contém um JSON válido.' : err instanceof ApiError ? `${err.code}: ${err.message}` : 'Não foi possível executar a chamada');
    } finally { setRunning(false); }
  };

  return (
    <div className="border-t bg-[var(--hairline-soft)]/30 p-4">
      <div className="mt-3 grid gap-4">
        <Field label="Token" htmlFor={`${route.id}-token`}>
          <Select id={`${route.id}-token`} value={token?.id ?? ''} onChange={(event) => setTokenId(event.target.value)}>
            {!tokens.length ? <option value="">Nenhum token ativo</option> : null}
            {tokens.map((item) => <option key={item.id} value={item.id}>{item.name || 'Token sem nome'}</option>)}
          </Select>
        </Field>
        {route.path.includes(':id') ? (
          <Field label="ID da cobrança" htmlFor={`${route.id}-charge-id`} hint="Preenchido com uma cobrança existente quando disponível.">
            <Select id={`${route.id}-charge-id`} value={chargeId} onChange={(event) => setChargeId(event.target.value)}>
              {!charges.length ? <option value="">ch_example</option> : null}
              {charges.map((charge) => <option key={charge.id} value={charge.id}>{charge.id} · {charge.status}</option>)}
            </Select>
          </Field>
        ) : null}
        {route.method !== 'GET' && route.exampleBody ? (
          <Field label="Payload JSON" htmlFor={`${route.id}-body`}>
            <Textarea id={`${route.id}-body`} value={body} onChange={(event) => setBody(event.target.value)} rows={7} />
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <code className="min-w-0 break-all text-xs text-[var(--text-muted)]">/v1/integration{resolvedPath}{route.query}</code>
          <Button variant="primary" disabled={running || !token} onClick={() => void execute()}><Play className="size-3.5" />{running ? 'executando…' : 'executar'}</Button>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {response !== null ? <div className="min-w-0"><p className="eyebrow mb-1.5">resposta</p><pre className="max-h-96 max-w-full overflow-y-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{JSON.stringify(response, null, 2)}</pre></div> : null}
      </div>
    </div>
  );
}
