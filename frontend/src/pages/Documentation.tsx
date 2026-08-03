import { ArrowLeft, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/Layout';
import { Alert, Button, CONTROL_CLASS, Field, Input, Panel, Select, Table, Td, Textarea, Th } from '../components/ui/primitives';
import { api, ApiError, type ApiToken } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/utils';

interface FieldDoc {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  /** Playground input widget for query fields. Plain text unless set. */
  input?: 'datetime';
}

/** Response object shapes, keyed by the `object` value the API returns. Shared across routes so each is documented once. */
const MODELS = {
  pix_charge: [
    { name: 'id', type: 'string', description: 'Identificador da cobrança.' },
    { name: 'object', type: '"pix_charge"', description: 'Tipo do objeto.' },
    { name: 'merchant_id', type: 'string', description: 'Loja dona da cobrança.' },
    { name: 'status', type: "'pending' | 'paid' | 'expired' | 'canceled' | 'partially_refunded' | 'refunded'", description: 'Situação atual da cobrança.' },
    { name: 'amount', type: 'integer', description: 'Valor total, em centavos.' },
    { name: 'amount_refunded', type: 'integer', description: 'Total já reembolsado, em centavos.' },
    { name: 'payer_document', type: 'string | null', description: 'CPF/CNPJ do pagador, se informado.' },
    { name: 'payer_name', type: 'string | null', description: 'Nome do pagador, se informado.' },
    { name: 'description', type: 'string | null', description: 'Descrição livre da cobrança.' },
    { name: 'metadata', type: 'object', description: 'Dados livres definidos na criação.' },
    { name: 'qr_code', type: 'string', description: 'Payload "copia e cola" do QR Code PIX.' },
    { name: 'qr_code_txid', type: 'string', description: 'TXID do QR Code.' },
    { name: 'qr_code_expires_at', type: 'string (ISO 8601)', description: 'Quando o QR Code expira.' },
    { name: 'e2e_id', type: 'string | null', description: 'Identificador end-to-end do PIX, presente após o pagamento.' },
    { name: 'paid_at', type: 'string (ISO 8601) | null', description: 'Quando a cobrança foi paga.' },
    { name: 'expired_at', type: 'string (ISO 8601) | null', description: 'Quando a cobrança expirou.' },
    { name: 'canceled_at', type: 'string (ISO 8601) | null', description: 'Quando a cobrança foi cancelada.' },
    { name: 'created_at', type: 'string (ISO 8601)', description: 'Quando a cobrança foi criada.' },
    { name: 'updated_at', type: 'string (ISO 8601)', description: 'Última atualização.' },
  ],
  pix_refund: [
    { name: 'id', type: 'string', description: 'Identificador do reembolso.' },
    { name: 'object', type: '"pix_refund"', description: 'Tipo do objeto.' },
    { name: 'charge_id', type: 'string', description: 'Cobrança reembolsada.' },
    { name: 'amount', type: 'integer', description: 'Valor reembolsado, em centavos.' },
    { name: 'status', type: "'succeeded' | 'failed'", description: 'Resultado do reembolso.' },
    { name: 'reason', type: 'string | null', description: 'Motivo informado na solicitação.' },
    { name: 'e2e_id', type: 'string | null', description: 'Identificador end-to-end do reembolso.' },
    { name: 'created_at', type: 'string (ISO 8601)', description: 'Quando o reembolso foi criado.' },
  ],
  charge_event: [
    { name: 'id', type: 'string', description: 'Identificador do evento.' },
    { name: 'charge_id', type: 'string', description: 'Cobrança relacionada.' },
    { name: 'from_status', type: 'ChargeStatus | null', description: 'Status anterior (nulo no primeiro evento).' },
    { name: 'to_status', type: 'ChargeStatus', description: 'Novo status após a transição.' },
    { name: 'reason', type: 'string | null', description: 'Motivo da transição, quando houver.' },
    { name: 'created_at', type: 'string (ISO 8601)', description: 'Quando o evento ocorreu.' },
  ],
  merchant: [
    { name: 'id', type: 'string', description: 'Identificador da loja.' },
    { name: 'object', type: '"merchant"', description: 'Tipo do objeto.' },
    { name: 'name', type: 'string', description: 'Nome da loja.' },
    { name: 'webhook_url', type: 'string | null', description: 'URL que recebe os webhooks.' },
    { name: 'webhook_secret', type: 'string', description: 'Segredo usado para assinar os webhooks.' },
    { name: 'kyc_status', type: "'pending' | 'approved' | 'rejected'", description: 'Situação da verificação KYC.' },
    { name: 'kyc_reason', type: 'string | null', description: 'Motivo informado na revisão do KYC.' },
    { name: 'kyc_reviewed_at', type: 'string (ISO 8601) | null', description: 'Quando o KYC foi revisado.' },
    { name: 'created_at', type: 'string (ISO 8601)', description: 'Quando a loja foi criada.' },
    { name: 'updated_at', type: 'string (ISO 8601)', description: 'Última atualização.' },
  ],
} satisfies Record<string, FieldDoc[]>;

type ModelName = keyof typeof MODELS;

type ResponseDoc =
  | { kind: 'object'; model: ModelName }
  | { kind: 'list'; model: ModelName; extra?: FieldDoc[] };

interface RouteDoc {
  id: string;
  method: string;
  path: string;
  description: string;
  pathParams?: FieldDoc[];
  query?: FieldDoc[];
  body?: FieldDoc[];
  response: ResponseDoc;
  exampleBody: string;
  /** Prefilled values for the playground's query string inputs, keyed by field name. */
  queryDefaults?: Record<string, string>;
}

const CHARGE_ID_PARAM: FieldDoc[] = [
  { name: 'id', type: 'string', required: true, description: 'Identificador da cobrança, na URL.' },
];

const INTEGRATION_ROUTES: RouteDoc[] = [
  {
    id: 'create-charge',
    method: 'POST',
    path: '/pix/charges',
    description: 'Cria uma cobrança PIX.',
    body: [
      { name: 'amount', type: 'integer', required: true, description: 'Valor da cobrança, em centavos.' },
      { name: 'payer_document', type: 'string | null', description: 'CPF/CNPJ do pagador.' },
      { name: 'payer_name', type: 'string | null', description: 'Nome do pagador.' },
      { name: 'description', type: 'string | null', description: 'Descrição livre da cobrança.' },
      { name: 'metadata', type: 'object | null', description: 'Dados livres, devolvidos como estão.' },
    ],
    response: { kind: 'object', model: 'pix_charge' },
    exampleBody: '{\n  "amount": 15000,\n  "payer_document": "11111111111",\n  "description": "Pedido de teste",\n  "metadata": { "order_id": "abc-123" }\n}',
  },
  {
    id: 'list-charges',
    method: 'GET',
    path: '/pix/charges',
    description: 'Lista as cobranças da loja.',
    query: [
      { name: 'status', type: 'ChargeStatus', description: 'Filtra por situação da cobrança.' },
      { name: 'from', type: 'string (ISO 8601)', description: 'Data inicial do filtro por criação.', input: 'datetime' },
      { name: 'to', type: 'string (ISO 8601)', description: 'Data final do filtro por criação.', input: 'datetime' },
      { name: 'limit', type: 'integer', description: 'Quantidade máxima de itens.' },
      { name: 'offset', type: 'integer', description: 'Quantidade de itens a pular, para paginação.' },
    ],
    response: { kind: 'list', model: 'pix_charge', extra: [{ name: 'total', type: 'integer', description: 'Total de cobranças que atendem ao filtro.' }] },
    exampleBody: '',
    queryDefaults: { limit: '20' },
  },
  {
    id: 'get-charge',
    method: 'GET',
    path: '/pix/charges/:id',
    description: 'Consulta uma cobrança.',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'object', model: 'pix_charge' },
    exampleBody: '',
  },
  {
    id: 'charge-events',
    method: 'GET',
    path: '/pix/charges/:id/events',
    description: 'Lista o histórico de status.',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'list', model: 'charge_event' },
    exampleBody: '',
  },
  {
    id: 'cancel-charge',
    method: 'POST',
    path: '/pix/charges/:id/cancel',
    description: 'Cancela uma cobrança.',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'object', model: 'pix_charge' },
    exampleBody: '',
  },
  {
    id: 'create-refund',
    method: 'POST',
    path: '/pix/charges/:id/refunds',
    description: 'Solicita o reembolso.',
    pathParams: CHARGE_ID_PARAM,
    body: [
      { name: 'amount', type: 'integer | null', description: 'Valor a reembolsar, em centavos. Omitido reembolsa o saldo restante.' },
      { name: 'reason', type: 'string | null', description: 'Motivo do reembolso.' },
    ],
    response: { kind: 'object', model: 'pix_refund' },
    exampleBody: '{\n  "amount": 5000,\n  "reason": "Solicitação do cliente"\n}',
  },
  {
    id: 'list-refunds',
    method: 'GET',
    path: '/pix/charges/:id/refunds',
    description: 'Lista os reembolsos da cobrança.',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'list', model: 'pix_refund' },
    exampleBody: '',
  },
  {
    id: 'get-merchant',
    method: 'GET',
    path: '/merchants/me',
    description: 'Consulta os dados da loja.',
    response: { kind: 'object', model: 'merchant' },
    exampleBody: '',
  },
  {
    id: 'update-merchant',
    method: 'PATCH',
    path: '/merchants/me',
    description: 'Atualiza os dados da loja.',
    body: [
      { name: 'name', type: 'string', description: 'Novo nome da loja.' },
      { name: 'webhook_url', type: 'string | null', description: 'Nova URL de webhook; null remove a atual.' },
      { name: 'rotate_webhook_secret', type: 'boolean', description: 'Quando true, gera um novo webhook_secret.' },
    ],
    response: { kind: 'object', model: 'merchant' },
    exampleBody: '{\n  "name": "Minha loja",\n  "webhook_url": "https://example.test/webhook"\n}',
  },
];

export function Documentation() {
  const resources = useAsync(async () => {
    const tokenResponse = await api.tokens();
    return { tokens: tokenResponse.data };
  }, []);

  const tokens = resources.data?.tokens.filter((token) => !token.revoked) ?? [];

  const [tokenId, setTokenId] = useState('');
  const token = tokens.find((item) => item.id === tokenId) ?? tokens[0];

  useEffect(() => { if (!tokenId && tokens[0]) setTokenId(tokens[0].id); }, [tokenId, tokens]);

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
          actions={
            tokens.length ? (
              <div className="w-48">
                <Field label="Token" htmlFor="doc-token">
                  <Select id="doc-token" value={token?.id ?? ''} onChange={(event) => setTokenId(event.target.value)}>
                    {tokens.map((item) => <option key={item.id} value={item.id}>{item.name || 'Token sem nome'}</option>)}
                  </Select>
                </Field>
              </div>
            ) : undefined
          }
        />
        {resources.error ? <div className="mb-4"><Alert>{resources.error}</Alert></div> : null}
        {!resources.loading && tokens.length === 0 ? (
          <div className="mb-4"><Alert tone="flag">Nenhum token ativo encontrado. <Link className="underline" to="/tokens">Gerar token</Link> para usar os playgrounds.</Alert></div>
        ) : null}
        <div className="grid gap-3">
          {INTEGRATION_ROUTES.map((route) => <RouteCard key={route.id} route={route} token={token} />)}
        </div>
      </div>
    </div>
  );
}

function FieldTable({ title, fields }: { title: string; fields: FieldDoc[] }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{title}</p>
      <div className="rounded-[var(--radius-panel)] border">
        <Table>
          <thead>
            <tr>
              <Th className="px-3 py-1.5">campo</Th>
              <Th className="px-3 py-1.5">tipo</Th>
              <Th className="px-3 py-1.5">descrição</Th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.name}>
                <Td className="px-3 py-1.5 font-mono text-xs">
                  {field.name}
                  {field.required ? <span className="text-trace"> *</span> : null}
                </Td>
                <Td className="px-3 py-1.5 font-mono text-xs text-[var(--text-muted)]">{field.type}</Td>
                <Td className="px-3 py-1.5 text-xs text-[var(--text-muted)]">{field.description}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function ResponseTables({ response }: { response: ResponseDoc }) {
  if (response.kind === 'object') {
    return <FieldTable title="retorno" fields={MODELS[response.model]} />;
  }

  const wrapper: FieldDoc[] = [
    { name: 'object', type: '"list"', description: 'Tipo do objeto retornado.' },
    { name: 'data', type: `${response.model}[]`, description: 'Itens encontrados — ver estrutura abaixo.' },
    ...(response.extra ?? []),
  ];

  return (
    <>
      <FieldTable title="retorno" fields={wrapper} />
      <FieldTable title={`objeto ${response.model}`} fields={MODELS[response.model]} />
    </>
  );
}

function RouteCard({ route, token }: { route: RouteDoc; token: ApiToken | undefined }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="rounded-[var(--radius-panel)] bg-trace-soft px-2 py-0.5 font-mono text-[11px] font-medium text-trace">{route.method}</span>
        <code className="min-w-0 break-all text-xs">/v1/api{route.path}</code>
        <p className="w-full text-[13px] text-[var(--text-muted)]">{route.description}</p>
      </div>
      <div className="grid gap-4 p-4">
        {route.pathParams ? <FieldTable title="parâmetros de rota" fields={route.pathParams} /> : null}
        {route.query ? <FieldTable title="query string" fields={route.query} /> : null}
        {route.body ? <FieldTable title="corpo (JSON)" fields={route.body} /> : null}
        <ResponseTables response={route.response} />
      </div>
      <RoutePlayground route={route} token={token} />
    </Panel>
  );
}

/** `<input type="datetime-local">` yields local wall-clock time with no offset; the API expects `created_at`-style UTC ISO strings, so convert on the way out. */
function toIsoFromLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** Drops blank values so an untouched field doesn't show up as `?limit=`. */
function buildQueryString(fields: FieldDoc[] | undefined, values: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const field of fields ?? []) {
    const raw = values[field.name]?.trim();
    if (!raw) continue;
    params.set(field.name, field.input === 'datetime' ? toIsoFromLocal(raw) : raw);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

interface DateTimeParts {
  year: number;
  month: number; // 0-11
  day: number;
  hour: number;
  minute: number;
}

/** Same string shape `<input type="datetime-local">` produces — kept so buildQueryString/toIsoFromLocal don't care which widget filled it in. */
function parseDateTimeValue(value: string): DateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) };
}

function formatDateTimeValue(parts: DateTimeParts): string {
  return `${parts.year}-${pad2(parts.month + 1)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** 2023-01-01 is a Sunday — an arbitrary anchor so weekday 0..6 maps to short pt-BR labels (D, S, T, Q, Q, S, S). */
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i)),
);

function monthLabel(year: number, month: number): string {
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Hand-rolled instead of a native `<input type="datetime-local">`: the browser renders that
 * widget's value in the OS locale's date order, which on most machines here isn't Y-M-D. This
 * component always displays and edits "YYYY-MM-DD HH:mm", independent of locale.
 */
function DateTimePicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const parts = parseDateTimeValue(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parts?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parts?.month ?? today.getMonth());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openPicker = () => {
    if (parts) { setViewYear(parts.year); setViewMonth(parts.month); }
    setOpen(true);
  };

  const changeMonth = (delta: number) => {
    const raw = viewMonth + delta;
    setViewMonth(((raw % 12) + 12) % 12);
    setViewYear(viewYear + Math.floor(raw / 12));
  };

  const selectDay = (day: number) => {
    onChange(formatDateTimeValue({ year: viewYear, month: viewMonth, day, hour: parts?.hour ?? 0, minute: parts?.minute ?? 0 }));
  };

  const setTime = (hour: number, minute: number) => {
    const base = parts ?? { year: viewYear, month: viewMonth, day: today.getDate(), hour: 0, minute: 0 };
    onChange(formatDateTimeValue({ ...base, hour, minute }));
  };

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={cn(CONTROL_CLASS, 'text-left font-mono', !parts && 'text-[var(--text-muted)]')}
      >
        {parts ? formatDateTimeValue(parts).replace('T', ' ') : 'aaaa-mm-dd hh:mm'}
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-64 rounded-[var(--radius-panel)] border bg-[var(--surface-raised)] p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => changeMonth(-1)} className="rounded p-1 hover:bg-[var(--hairline-soft)]" aria-label="mês anterior">
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="font-medium">{monthLabel(viewYear, viewMonth)}</span>
            <button type="button" onClick={() => changeMonth(1)} className="rounded p-1 hover:bg-[var(--hairline-soft)]" aria-label="próximo mês">
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-[var(--text-muted)]">
            {WEEKDAY_LABELS.map((label, i) => <span key={i}>{label}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              const isSelected = !!parts && day === parts.day && viewMonth === parts.month && viewYear === parts.year;
              const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
              return (
                <button
                  key={i}
                  type="button"
                  disabled={day === null}
                  onClick={() => day !== null && selectDay(day)}
                  className={cn(
                    'h-6 rounded text-[11px]',
                    day === null ? 'invisible' : 'hover:bg-[var(--hairline-soft)]',
                    isSelected ? 'bg-trace text-white hover:bg-trace' : '',
                    !isSelected && isToday ? 'font-semibold text-trace' : '',
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
            <div className="flex items-center gap-1 font-mono">
              <input
                type="number"
                min={0}
                max={23}
                value={parts ? pad2(parts.hour) : '00'}
                onChange={(event) => setTime(clamp(Number(event.target.value), 0, 23), parts?.minute ?? 0)}
                className="h-7 w-11 rounded border bg-[var(--surface)] px-1 text-center"
                aria-label="hora"
              />
              <span>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={parts ? pad2(parts.minute) : '00'}
                onChange={(event) => setTime(parts?.hour ?? 0, clamp(Number(event.target.value), 0, 59))}
                className="h-7 w-11 rounded border bg-[var(--surface)] px-1 text-center"
                aria-label="minuto"
              />
            </div>
            <button type="button" onClick={() => onChange('')} className="text-[var(--text-muted)] hover:text-[var(--text)]">
              limpar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RoutePlayground({ route, token }: { route: RouteDoc; token: ApiToken | undefined }) {
  const [chargeId, setChargeId] = useState('');
  const [queryValues, setQueryValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((route.query ?? []).map((field) => [field.name, route.queryDefaults?.[field.name] ?? ''])),
  );
  const [body, setBody] = useState<string>(route.exampleBody);
  const [response, setResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const resolvedPath = route.path.replace(':id', chargeId || 'ch_example');
  const queryString = buildQueryString(route.query, queryValues);

  const execute = async () => {
    if (!token) { setError('Gere ou selecione um token ativo para executar a chamada.'); return; }
    setRunning(true); setError(null); setResponse(null);
    try {
      const result = await api.apiRequest<unknown>(route.method, `${resolvedPath}${queryString}`, token.token, body.trim() ? JSON.parse(body) : undefined);
      setResponse(result);
    } catch (err) {
      setError(err instanceof SyntaxError ? 'O payload não contém um JSON válido.' : err instanceof ApiError ? `${err.code}: ${err.message}` : 'Não foi possível executar a chamada');
    } finally { setRunning(false); }
  };

  return (
    <div className="border-t bg-[var(--hairline-soft)]/30 p-4">
      <div className="mt-3 grid gap-4">
        {route.path.includes(':id') ? (
          <Field label="ID da cobrança" htmlFor={`${route.id}-charge-id`} hint="Cole o id de uma cobrança existente.">
            <Input id={`${route.id}-charge-id`} value={chargeId} onChange={(event) => setChargeId(event.target.value)} placeholder="ch_example" />
          </Field>
        ) : null}
        {route.query ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {route.query.map((field) => (
              <Field key={field.name} label={field.name} htmlFor={`${route.id}-query-${field.name}`} hint={field.description}>
                {field.input === 'datetime' ? (
                  <DateTimePicker
                    id={`${route.id}-query-${field.name}`}
                    value={queryValues[field.name] ?? ''}
                    onChange={(next) => setQueryValues((prev) => ({ ...prev, [field.name]: next }))}
                  />
                ) : (
                  <Input
                    id={`${route.id}-query-${field.name}`}
                    value={queryValues[field.name] ?? ''}
                    onChange={(event) => setQueryValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
                    placeholder={field.type}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}
        {route.method !== 'GET' && route.exampleBody ? (
          <Field label="Payload JSON" htmlFor={`${route.id}-body`}>
            <Textarea id={`${route.id}-body`} value={body} onChange={(event) => setBody(event.target.value)} rows={7} />
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <code className="min-w-0 break-all text-xs text-[var(--text-muted)]">/v1/api{resolvedPath}{queryString}</code>
          <Button variant="primary" disabled={running || !token} onClick={() => void execute()}><Play className="size-3.5" />{running ? 'executando…' : 'executar'}</Button>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {response !== null ? <div className="min-w-0"><p className="eyebrow mb-1.5">resposta</p><pre className="max-h-96 max-w-full overflow-y-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{JSON.stringify(response, null, 2)}</pre></div> : null}
      </div>
    </div>
  );
}
