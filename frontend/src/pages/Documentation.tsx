import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FileText, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  descriptionKey: string;
  /** Playground input widget for query fields. Plain text unless set. */
  input?: 'datetime';
}

/** Response object shapes, keyed by the `object` value the API returns. Shared across routes so each is documented once. */
const MODELS = {
  charge: [
    { name: 'id', type: 'string', descriptionKey: 'documentation.models.charge.id' },
    { name: 'object', type: '"charge"', descriptionKey: 'documentation.models.charge.object' },
    { name: 'merchant_id', type: 'string', descriptionKey: 'documentation.models.charge.merchant_id' },
    { name: 'payment_method', type: '"pix"', descriptionKey: 'documentation.models.charge.payment_method' },
    { name: 'status', type: "'pending' | 'paid' | 'expired' | 'canceled' | 'partially_refunded' | 'refunded'", descriptionKey: 'documentation.models.charge.status' },
    { name: 'amount', type: 'integer', descriptionKey: 'documentation.models.charge.amount' },
    { name: 'amount_refunded', type: 'integer', descriptionKey: 'documentation.models.charge.amount_refunded' },
    { name: 'payer_document', type: 'string | null', descriptionKey: 'documentation.models.charge.payer_document' },
    { name: 'payer_name', type: 'string | null', descriptionKey: 'documentation.models.charge.payer_name' },
    { name: 'description', type: 'string | null', descriptionKey: 'documentation.models.charge.description' },
    { name: 'metadata', type: 'object', descriptionKey: 'documentation.models.charge.metadata' },
    { name: 'callback_url', type: 'string | null', descriptionKey: 'documentation.models.charge.callback_url' },
    { name: 'pix', type: 'object', descriptionKey: 'documentation.models.charge.pix' },
    { name: 'pix.qr_code', type: 'string', descriptionKey: 'documentation.models.charge.pixQrCode' },
    { name: 'pix.qr_code_txid', type: 'string', descriptionKey: 'documentation.models.charge.pixQrCodeTxid' },
    { name: 'pix.qr_code_expires_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.charge.pixQrCodeExpiresAt' },
    { name: 'pix.e2e_id', type: 'string | null', descriptionKey: 'documentation.models.charge.pixE2eId' },
    { name: 'paid_at', type: 'string (ISO 8601) | null', descriptionKey: 'documentation.models.charge.paid_at' },
    { name: 'expired_at', type: 'string (ISO 8601) | null', descriptionKey: 'documentation.models.charge.expired_at' },
    { name: 'canceled_at', type: 'string (ISO 8601) | null', descriptionKey: 'documentation.models.charge.canceled_at' },
    { name: 'created_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.charge.created_at' },
    { name: 'updated_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.charge.updated_at' },
  ],
  pix_refund: [
    { name: 'id', type: 'string', descriptionKey: 'documentation.models.pixRefund.id' },
    { name: 'object', type: '"pix_refund"', descriptionKey: 'documentation.models.pixRefund.object' },
    { name: 'charge_id', type: 'string', descriptionKey: 'documentation.models.pixRefund.charge_id' },
    { name: 'amount', type: 'integer', descriptionKey: 'documentation.models.pixRefund.amount' },
    { name: 'status', type: "'succeeded' | 'failed'", descriptionKey: 'documentation.models.pixRefund.status' },
    { name: 'reason', type: 'string | null', descriptionKey: 'documentation.models.pixRefund.reason' },
    { name: 'e2e_id', type: 'string | null', descriptionKey: 'documentation.models.pixRefund.e2e_id' },
    { name: 'created_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.pixRefund.created_at' },
  ],
  charge_event: [
    { name: 'id', type: 'string', descriptionKey: 'documentation.models.chargeEvent.id' },
    { name: 'charge_id', type: 'string', descriptionKey: 'documentation.models.chargeEvent.charge_id' },
    { name: 'from_status', type: 'ChargeStatus | null', descriptionKey: 'documentation.models.chargeEvent.from_status' },
    { name: 'to_status', type: 'ChargeStatus', descriptionKey: 'documentation.models.chargeEvent.to_status' },
    { name: 'reason', type: 'string | null', descriptionKey: 'documentation.models.chargeEvent.reason' },
    { name: 'created_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.chargeEvent.created_at' },
  ],
  merchant: [
    { name: 'id', type: 'string', descriptionKey: 'documentation.models.merchant.id' },
    { name: 'object', type: '"merchant"', descriptionKey: 'documentation.models.merchant.object' },
    { name: 'name', type: 'string', descriptionKey: 'documentation.models.merchant.name' },
    { name: 'webhook_url', type: 'string | null', descriptionKey: 'documentation.models.merchant.webhook_url' },
    { name: 'webhook_secret', type: 'string', descriptionKey: 'documentation.models.merchant.webhook_secret' },
    { name: 'kyc_status', type: "'pending' | 'approved' | 'rejected'", descriptionKey: 'documentation.models.merchant.kyc_status' },
    { name: 'kyc_reason', type: 'string | null', descriptionKey: 'documentation.models.merchant.kyc_reason' },
    { name: 'kyc_reviewed_at', type: 'string (ISO 8601) | null', descriptionKey: 'documentation.models.merchant.kyc_reviewed_at' },
    { name: 'created_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.merchant.created_at' },
    { name: 'updated_at', type: 'string (ISO 8601)', descriptionKey: 'documentation.models.merchant.updated_at' },
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
  descriptionKey: string;
  pathParams?: FieldDoc[];
  query?: FieldDoc[];
  body?: FieldDoc[];
  response: ResponseDoc;
  exampleBody: string;
  /** Overrides exampleBody with a translated version, for bodies that carry example prose. */
  exampleBodyKey?: string;
  /** Prefilled values for the playground's query string inputs, keyed by field name. */
  queryDefaults?: Record<string, string>;
}

const CHARGE_ID_PARAM: FieldDoc[] = [
  { name: 'id', type: 'string', required: true, descriptionKey: 'documentation.chargeIdParamDescription' },
];

const INTEGRATION_ROUTES: RouteDoc[] = [
  {
    id: 'create-charge',
    method: 'POST',
    path: '/payments/pix/charges',
    descriptionKey: 'documentation.routes.createCharge.description',
    body: [
      { name: 'amount', type: 'integer', required: true, descriptionKey: 'documentation.routes.createCharge.amount' },
      { name: 'payer_document', type: 'string | null', descriptionKey: 'documentation.routes.createCharge.payer_document' },
      { name: 'payer_name', type: 'string | null', descriptionKey: 'documentation.routes.createCharge.payer_name' },
      { name: 'description', type: 'string | null', descriptionKey: 'documentation.routes.createCharge.description_field' },
      { name: 'metadata', type: 'object | null', descriptionKey: 'documentation.routes.createCharge.metadata' },
      { name: 'callback_url', type: 'string | null', descriptionKey: 'documentation.routes.createCharge.callback_url' },
    ],
    response: { kind: 'object', model: 'charge' },
    exampleBody: '{\n  "amount": 15000,\n  "payer_document": "11111111111",\n  "description": "Pedido de teste",\n  "metadata": { "order_id": "abc-123" }\n}',
    exampleBodyKey: 'documentation.routes.createCharge.exampleBody',
  },
  {
    id: 'list-charges',
    method: 'GET',
    path: '/payments/charges',
    descriptionKey: 'documentation.routes.listCharges.description',
    query: [
      { name: 'status', type: 'ChargeStatus', descriptionKey: 'documentation.routes.listCharges.status' },
      { name: 'from', type: 'string (ISO 8601)', descriptionKey: 'documentation.routes.listCharges.from', input: 'datetime' },
      { name: 'to', type: 'string (ISO 8601)', descriptionKey: 'documentation.routes.listCharges.to', input: 'datetime' },
      { name: 'limit', type: 'integer', descriptionKey: 'documentation.routes.listCharges.limit' },
      { name: 'offset', type: 'integer', descriptionKey: 'documentation.routes.listCharges.offset' },
    ],
    response: { kind: 'list', model: 'charge', extra: [{ name: 'total', type: 'integer', descriptionKey: 'documentation.routes.listCharges.total' }] },
    exampleBody: '',
    queryDefaults: { limit: '20' },
  },
  {
    id: 'get-charge',
    method: 'GET',
    path: '/payments/charges/:id',
    descriptionKey: 'documentation.routes.getCharge.description',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'object', model: 'charge' },
    exampleBody: '',
  },
  {
    id: 'charge-events',
    method: 'GET',
    path: '/payments/charges/:id/events',
    descriptionKey: 'documentation.routes.chargeEvents.description',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'list', model: 'charge_event' },
    exampleBody: '',
  },
  {
    id: 'cancel-charge',
    method: 'POST',
    path: '/payments/charges/:id/cancel',
    descriptionKey: 'documentation.routes.cancelCharge.description',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'object', model: 'charge' },
    exampleBody: '',
  },
  {
    id: 'create-refund',
    method: 'POST',
    path: '/payments/charges/:id/refunds',
    descriptionKey: 'documentation.routes.createRefund.description',
    pathParams: CHARGE_ID_PARAM,
    body: [
      { name: 'amount', type: 'integer | null', descriptionKey: 'documentation.routes.createRefund.amount' },
      { name: 'reason', type: 'string | null', descriptionKey: 'documentation.routes.createRefund.reason' },
    ],
    response: { kind: 'object', model: 'pix_refund' },
    exampleBody: '{\n  "amount": 5000,\n  "reason": "Solicitação do cliente"\n}',
    exampleBodyKey: 'documentation.routes.createRefund.exampleBody',
  },
  {
    id: 'list-refunds',
    method: 'GET',
    path: '/payments/charges/:id/refunds',
    descriptionKey: 'documentation.routes.listRefunds.description',
    pathParams: CHARGE_ID_PARAM,
    response: { kind: 'list', model: 'pix_refund' },
    exampleBody: '',
  },
  {
    id: 'get-merchant',
    method: 'GET',
    path: '/merchants/me',
    descriptionKey: 'documentation.routes.getMerchant.description',
    response: { kind: 'object', model: 'merchant' },
    exampleBody: '',
  },
  {
    id: 'update-merchant',
    method: 'PATCH',
    path: '/merchants/me',
    descriptionKey: 'documentation.routes.updateMerchant.description',
    body: [
      { name: 'name', type: 'string', descriptionKey: 'documentation.routes.updateMerchant.name' },
      { name: 'webhook_url', type: 'string | null', descriptionKey: 'documentation.routes.updateMerchant.webhook_url' },
      { name: 'rotate_webhook_secret', type: 'boolean', descriptionKey: 'documentation.routes.updateMerchant.rotate_webhook_secret' },
    ],
    response: { kind: 'object', model: 'merchant' },
    exampleBody: '{\n  "name": "Minha loja",\n  "webhook_url": "https://example.test/webhook"\n}',
  },
];

/**
 * Left-nav structure: users browse to the routes they want instead of scrolling a flat
 * list. Only 'routes' leaves resolve to actual RouteDoc entries; 'wip' leaves are payment
 * methods that don't exist yet but are worth listing so people know they're planned.
 */
interface NavGroup {
  kind: 'group';
  id: string;
  labelKey: string;
  children: NavNode[];
}
interface NavRoutesLeaf {
  kind: 'routes';
  id: string;
  labelKey: string;
  descriptionKey?: string;
  routeIds: string[];
}
interface NavWipLeaf {
  kind: 'wip';
  id: string;
  labelKey: string;
}
type NavNode = NavGroup | NavRoutesLeaf | NavWipLeaf;

const NAV_TREE: NavNode[] = [
  {
    kind: 'group',
    id: 'payments',
    labelKey: 'documentation.nav.payments',
    children: [
      {
        kind: 'group',
        id: 'payment-methods',
        labelKey: 'documentation.nav.paymentMethods',
        children: [
          {
            kind: 'routes',
            id: 'pix',
            labelKey: 'documentation.nav.pix',
            descriptionKey: 'documentation.nav.pixDescription',
            routeIds: ['create-charge'],
          },
          { kind: 'wip', id: 'card', labelKey: 'documentation.nav.card' },
          { kind: 'wip', id: 'boleto', labelKey: 'documentation.nav.boleto' },
        ],
      },
      {
        kind: 'routes',
        id: 'general',
        labelKey: 'documentation.nav.general',
        descriptionKey: 'documentation.nav.generalDescription',
        routeIds: ['list-charges', 'get-charge', 'charge-events', 'cancel-charge', 'create-refund', 'list-refunds'],
      },
    ],
  },
  {
    kind: 'routes',
    id: 'store',
    labelKey: 'documentation.nav.store',
    routeIds: ['get-merchant', 'update-merchant'],
  },
];

/** First 'routes' leaf in document order — what's shown before the user picks anything. */
function firstRoutesLeaf(nodes: NavNode[]): NavRoutesLeaf | undefined {
  for (const node of nodes) {
    if (node.kind === 'routes') return node;
    if (node.kind === 'group') {
      const found = firstRoutesLeaf(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

function findLeaf(nodes: NavNode[], id: string): NavRoutesLeaf | NavWipLeaf | undefined {
  for (const node of nodes) {
    if (node.kind !== 'group') {
      if (node.id === id) return node;
      continue;
    }
    const found = findLeaf(node.children, id);
    if (found) return found;
  }
  return undefined;
}

function NavTree({
  nodes,
  depth,
  selectedId,
  onSelect,
}: {
  nodes: NavNode[];
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <ul className="grid gap-0.5">
      {nodes.map((node) => (
        <li key={node.id}>
          {node.kind === 'group' ? (
            <NavGroupItem node={node} depth={depth} selectedId={selectedId} onSelect={onSelect} />
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-[var(--radius-panel)] py-2 pr-2 text-left text-sm',
                selectedId === node.id
                  ? 'bg-trace-soft font-medium text-trace'
                  : node.kind === 'wip'
                    ? 'text-[var(--text-muted)] opacity-60 hover:bg-[var(--hairline-soft)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--hairline-soft)] hover:text-[var(--text)]',
              )}
            >
              <span>{t(node.labelKey)}</span>
              {node.kind === 'wip' ? (
                <span className="rounded-[var(--radius-panel)] border px-2 py-0.5 font-mono text-[10px] tracking-wide text-[var(--text-muted)]">WIP</span>
              ) : null}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function NavGroupItem({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: NavGroup;
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
        className="flex w-full items-center gap-1.5 rounded-[var(--radius-panel)] py-2 pr-2 text-left text-sm font-medium text-[var(--text)] hover:bg-[var(--hairline-soft)]"
      >
        <ChevronDown className={cn('size-4 shrink-0 text-[var(--text-muted)] transition-transform', !open && '-rotate-90')} />
        {t(node.labelKey)}
      </button>
      {open ? <NavTree nodes={node.children} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} /> : null}
    </div>
  );
}

export function Documentation() {
  const { t } = useTranslation();
  const resources = useAsync(async () => {
    const tokenResponse = await api.tokens();
    return { tokens: tokenResponse.data };
  }, []);

  const tokens = resources.data?.tokens.filter((token) => !token.revoked) ?? [];

  const [tokenId, setTokenId] = useState('');
  const token = tokens.find((item) => item.id === tokenId) ?? tokens[0];

  useEffect(() => { if (!tokenId && tokens[0]) setTokenId(tokens[0].id); }, [tokenId, tokens]);

  const defaultLeaf = firstRoutesLeaf(NAV_TREE);
  const [selectedId, setSelectedId] = useState(defaultLeaf?.id ?? '');
  const selected = findLeaf(NAV_TREE, selectedId);
  const routes = selected?.kind === 'routes'
    ? selected.routeIds.map((id) => INTEGRATION_ROUTES.find((route) => route.id === id)).filter((route) => route != null)
    : [];

  return (
    <div className="min-h-dvh bg-[var(--surface)] px-4 py-6 md:px-8 md:py-8">
      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/transacoes" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            <ArrowLeft className="size-4" /> {t('documentation.backToPanel')}
          </Link>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <FileText className="size-4" /> llms.txt
          </a>
        </div>
        <PageHeader
          eyebrow={t('documentation.eyebrow')}
          title={t('documentation.title')}
          description={t('documentation.description')}
          actions={
            tokens.length ? (
              <div className="w-48">
                <Field label={t('documentation.tokenLabel')} htmlFor="doc-token">
                  <Select id="doc-token" value={token?.id ?? ''} onChange={(event) => setTokenId(event.target.value)}>
                    {tokens.map((item) => <option key={item.id} value={item.id}>{item.name || t('documentation.tokenUnnamed')}</option>)}
                  </Select>
                </Field>
              </div>
            ) : undefined
          }
        />
        {resources.error ? <div className="mb-4"><Alert>{resources.error}</Alert></div> : null}
        {!resources.loading && tokens.length === 0 ? (
          <div className="mb-4">
            <Alert tone="flag">
              {t('documentation.noActiveTokenPre')}{' '}
              <Link className="underline" to="/tokens">{t('documentation.generateTokenLink')}</Link>{' '}
              {t('documentation.noActiveTokenPost')}
            </Alert>
          </div>
        ) : null}
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <nav className="shrink-0 rounded-[var(--radius-panel)] border bg-[var(--surface-raised)] p-3 md:w-64">
            <NavTree nodes={NAV_TREE} depth={0} selectedId={selectedId} onSelect={setSelectedId} />
          </nav>
          <div className="grid min-w-0 flex-1 gap-3">
            {selected?.kind === 'wip' ? (
              <Panel>
                <div className="p-6 text-center text-sm text-[var(--text-muted)]">
                  <span className="rounded-[var(--radius-panel)] border px-2 py-1 font-mono text-xs tracking-wide">WIP</span>
                  <p className="mt-3">{t('documentation.wipNotImplemented', { label: t(selected.labelKey) })}</p>
                </div>
              </Panel>
            ) : (
              <>
                {selected?.kind === 'routes' && selected.descriptionKey ? (
                  <p className="text-sm text-[var(--text-muted)]">{t(selected.descriptionKey)}</p>
                ) : null}
                {routes.map((route) => <RouteCard key={route.id} route={route} token={token} />)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldTable({ title, fields }: { title: string; fields: FieldDoc[] }) {
  const { t } = useTranslation();

  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{title}</p>
      <div className="rounded-[var(--radius-panel)] border">
        <Table>
          <thead>
            <tr>
              <Th className="px-4 py-2">{t('documentation.fieldCol')}</Th>
              <Th className="px-4 py-2">{t('documentation.typeCol')}</Th>
              <Th className="px-4 py-2">{t('documentation.descriptionCol')}</Th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.name}>
                <Td className="px-4 py-2 font-mono text-sm">
                  {field.name}
                  {field.required ? <span className="text-trace"> *</span> : null}
                </Td>
                <Td className="px-4 py-2 font-mono text-sm text-[var(--text-muted)]">{field.type}</Td>
                <Td className="px-4 py-2 text-sm text-[var(--text-muted)]">{t(field.descriptionKey)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function ResponseTables({ response }: { response: ResponseDoc }) {
  const { t } = useTranslation();

  if (response.kind === 'object') {
    return <FieldTable title={t('documentation.returnTitle')} fields={MODELS[response.model]} />;
  }

  const wrapper: FieldDoc[] = [
    { name: 'object', type: '"list"', descriptionKey: 'documentation.listObjectDesc' },
    { name: 'data', type: `${response.model}[]`, descriptionKey: 'documentation.listDataDesc' },
    ...(response.extra ?? []),
  ];

  return (
    <>
      <FieldTable title={t('documentation.returnTitle')} fields={wrapper} />
      <FieldTable title={t('documentation.objectOf', { model: response.model })} fields={MODELS[response.model]} />
    </>
  );
}

function RouteCard({ route, token }: { route: RouteDoc; token: ApiToken | undefined }) {
  const { t } = useTranslation();

  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-5 py-4">
        <span className="rounded-[var(--radius-panel)] bg-trace-soft px-2 py-1 font-mono text-xs font-medium text-trace">{route.method}</span>
        <code className="min-w-0 break-all text-sm">/v1/api{route.path}</code>
        <p className="w-full text-sm text-[var(--text-muted)]">{t(route.descriptionKey)}</p>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <div className="grid min-w-0 gap-4">
          {route.pathParams ? <FieldTable title={t('documentation.routeParamsTitle')} fields={route.pathParams} /> : null}
          {route.query ? <FieldTable title={t('documentation.queryStringTitle')} fields={route.query} /> : null}
          {route.body ? <FieldTable title={t('documentation.bodyTitle')} fields={route.body} /> : null}
          <ResponseTables response={route.response} />
        </div>
        <RoutePlayground route={route} token={token} />
      </div>
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

/** 2023-01-01 is a Sunday — an arbitrary anchor so weekday 0..6 maps to short locale labels. */
function weekdayLabels(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i)),
  );
}

function monthLabel(year: number, month: number, locale: string): string {
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Hand-rolled instead of a native `<input type="datetime-local">`: the browser renders that
 * widget's value in the OS locale's date order, which on most machines here isn't Y-M-D. This
 * component always displays and edits "YYYY-MM-DD HH:mm", independent of locale.
 */
function DateTimePicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('pt') ? 'pt-BR' : 'en-US';
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
        {parts ? formatDateTimeValue(parts).replace('T', ' ') : t('documentation.dateTimePlaceholder')}
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-72 rounded-[var(--radius-panel)] border bg-[var(--surface-raised)] p-3.5 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => changeMonth(-1)} className="rounded p-1 hover:bg-[var(--hairline-soft)]" aria-label={t('documentation.prevMonthAriaLabel')}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="font-medium">{monthLabel(viewYear, viewMonth, locale)}</span>
            <button type="button" onClick={() => changeMonth(1)} className="rounded p-1 hover:bg-[var(--hairline-soft)]" aria-label={t('documentation.nextMonthAriaLabel')}>
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-[var(--text-muted)]">
            {weekdayLabels(locale).map((label, i) => <span key={i}>{label}</span>)}
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
                    'h-7 rounded text-xs',
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
                className="h-8 w-12 rounded border bg-[var(--surface)] px-1 text-center"
                aria-label={t('documentation.hourAriaLabel')}
              />
              <span>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={parts ? pad2(parts.minute) : '00'}
                onChange={(event) => setTime(parts?.hour ?? 0, clamp(Number(event.target.value), 0, 59))}
                className="h-8 w-12 rounded border bg-[var(--surface)] px-1 text-center"
                aria-label={t('documentation.minuteAriaLabel')}
              />
            </div>
            <button type="button" onClick={() => onChange('')} className="text-[var(--text-muted)] hover:text-[var(--text)]">
              {t('documentation.clear')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RoutePlayground({ route, token }: { route: RouteDoc; token: ApiToken | undefined }) {
  const { t } = useTranslation();
  const [chargeId, setChargeId] = useState('');
  const [queryValues, setQueryValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((route.query ?? []).map((field) => [field.name, route.queryDefaults?.[field.name] ?? ''])),
  );
  const [body, setBody] = useState<string>(route.exampleBodyKey ? t(route.exampleBodyKey) : route.exampleBody);
  const [response, setResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const resolvedPath = route.path.replace(':id', chargeId || 'ch_example');
  const queryString = buildQueryString(route.query, queryValues);

  const execute = async () => {
    if (!token) { setError(t('documentation.noTokenError')); return; }
    setRunning(true); setError(null); setResponse(null);
    try {
      const result = await api.apiRequest<unknown>(route.method, `${resolvedPath}${queryString}`, token.token, body.trim() ? JSON.parse(body) : undefined);
      setResponse(result);
    } catch (err) {
      setError(err instanceof SyntaxError ? t('documentation.invalidJsonError') : err instanceof ApiError ? `${err.code}: ${err.message}` : t('documentation.executeGenericError'));
    } finally { setRunning(false); }
  };

  return (
    <div className="min-w-0 rounded-[var(--radius-panel)] border bg-[var(--hairline-soft)]/30 p-5 xl:sticky xl:top-4">
      <p className="eyebrow mb-3">{t('documentation.testRoute')}</p>
      <div className="grid gap-4">
        {route.path.includes(':id') ? (
          <Field label={t('documentation.chargeIdFieldLabel')} htmlFor={`${route.id}-charge-id`} hint={t('documentation.chargeIdHint')}>
            <Input id={`${route.id}-charge-id`} value={chargeId} onChange={(event) => setChargeId(event.target.value)} placeholder="ch_example" />
          </Field>
        ) : null}
        {route.query ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {route.query.map((field) => (
              <Field key={field.name} label={field.name} htmlFor={`${route.id}-query-${field.name}`} hint={t(field.descriptionKey)}>
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
          <Field label={t('documentation.payloadJsonLabel')} htmlFor={`${route.id}-body`}>
            <Textarea id={`${route.id}-body`} value={body} onChange={(event) => setBody(event.target.value)} rows={7} />
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <code className="min-w-0 break-all text-sm text-[var(--text-muted)]">/v1/api{resolvedPath}{queryString}</code>
          <Button variant="primary" size="md" disabled={running || !token} onClick={() => void execute()}><Play className="size-4" />{running ? t('documentation.executing') : t('documentation.execute')}</Button>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {response !== null ? <div className="min-w-0"><p className="eyebrow mb-1.5">{t('documentation.responseTitle')}</p><pre className="max-h-96 max-w-full overflow-y-auto rounded-[var(--radius-panel)] border bg-[var(--surface)] p-3.5 font-mono text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-muted)]" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{JSON.stringify(response, null, 2)}</pre></div> : null}
      </div>
    </div>
  );
}
