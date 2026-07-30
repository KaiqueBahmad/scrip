import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { CodeBlock } from '../components/CodeBlock';
import { Copyable } from '../components/Copyable';
import { PageHeader } from '../components/Layout';
import {
  Alert,
  Field,
  Panel,
  PanelHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/primitives';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/utils';

const SECTIONS = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'credenciais', label: 'Credenciais' },
  { id: 'fluxo', label: 'Fluxo completo' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'testes', label: 'CPFs de teste' },
  { id: 'status', label: 'Status da cobrança' },
  { id: 'idempotencia', label: 'Idempotência' },
  { id: 'erros', label: 'Erros' },
];

function Section({
  id,
  title,
  children,
  hint,
}: {
  id: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <Panel>
        <PanelHeader title={title} hint={hint} />
        <div className="grid gap-3 p-4">{children}</div>
      </Panel>
    </section>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-[13px] leading-relaxed">{children}</p>;
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[2px] bg-[var(--surface)] px-1 py-0.5 font-mono text-[11.5px]">
      {children}
    </code>
  );
}

/**
 * Integration guide. Everything here is generated against the live instance — the base URL
 * comes from the browser, and the merchant and token pickers substitute real credentials
 * into every snippet, so a reader can paste a command and have it work instead of
 * hand-replacing placeholders.
 */
export function Docs() {
  const { user } = useSession();
  const merchants = useAsync(() => api.merchants(), []);
  const tokens = useAsync(() => api.tokens(), []);

  const [merchantId, setMerchantId] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [language, setLanguage] = useState<'node' | 'python' | 'php'>('node');

  const baseUrl = window.location.origin;

  const allMerchants = merchants.data?.data ?? [];
  const usableTokens = (tokens.data?.data ?? []).filter((token) => !token.revoked);

  const merchant =
    allMerchants.find((candidate) => candidate.id === merchantId) ??
    allMerchants.find((candidate) => candidate.id === user?.merchant_id) ??
    allMerchants[0];

  const token =
    usableTokens.find((candidate) => candidate.id === tokenId) ??
    usableTokens.find((candidate) => candidate.merchant_id === merchant?.id) ??
    usableTokens[0];

  // Real values when available, obvious placeholders when not — never a silent mix.
  const jwt = token?.token ?? '{seu_jwt}';
  const secret = merchant?.webhook_secret ?? '{webhook_secret}';

  const createCharge = `curl -X POST ${baseUrl}/v1/integration/pix/charges \\
  -H "Authorization: Bearer ${jwt}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: pedido-1001" \\
  -d '{
    "amount": 15000,
    "payer_document": "11111111111",
    "description": "Pedido 1001",
    "metadata": { "order_id": "1001" }
  }'`;

  const createResponse = `{
  "id": "ch_a1b2c3d4e5f6g7h8",
  "object": "pix_charge",
  "status": "pending",
  "amount": 15000,
  "amount_refunded": 0,
  "qr_code": "00020101021226410014br.gov.bcb.pix...6304ABCD",
  "qr_code_txid": "K3M9P2QRSTUVWXYZ1234ABCDE",
  "qr_code_expires_at": "2026-07-30T12:15:00.000Z",
  "public_token": "pub_9f2k4m8xq1w7e3r5t6y8u0i2o4p6a8s0",
  "e2e_id": null,
  "paid_at": null,
  "created_at": "2026-07-30T12:00:00.000Z"
}`;

  const pollCharge = `curl ${baseUrl}/v1/app/pix/charges/ch_a1b2c3d4e5f6g7h8 \\
  -H "Authorization: Bearer pub_9f2k4m8xq1w7e3r5t6y8u0i2o4p6a8s0"`;

  const simulate = `curl -X POST ${baseUrl}/v1/integration/pix/charges/ch_a1b2c3d4e5f6g7h8/simulate \\
  -H "Authorization: Bearer ${jwt}" \\
  -H "Content-Type: application/json" \\
  -d '{ "result": "paid" }'`;

  const refund = `# devolução parcial (valor em centavos)
curl -X POST ${baseUrl}/v1/integration/pix/charges/ch_a1b2c3d4e5f6g7h8/refunds \\
  -H "Authorization: Bearer ${jwt}" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": 5000, "reason": "item devolvido" }'

# devolução total: omita o amount
curl -X POST ${baseUrl}/v1/integration/pix/charges/ch_a1b2c3d4e5f6g7h8/refunds \\
  -H "Authorization: Bearer ${jwt}"`;

  const webhookBody = `{
  "id": "whd_7h3k9m2p5q8r1s4t",
  "event": "pix.charge.paid",
  "created_at": "2026-07-30T12:00:04.000Z",
  "data": {
    "charge": {
      "id": "ch_a1b2c3d4e5f6g7h8",
      "status": "paid",
      "amount": 15000,
      "e2e_id": "E99999999202607301200ABCDEFGHIJK",
      "metadata": { "order_id": "1001" }
    }
  }
}`;

  const VERIFY_SNIPPETS = {
    node: `import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const WEBHOOK_SECRET = '${secret}';
const app = express();

// Importante: o HMAC é calculado sobre o corpo BRUTO, então não use
// um parser de JSON antes de verificar a assinatura.
app.post('/webhooks/pseudopay', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('X-PseudoPay-Signature') ?? '';
  const corpoBruto = req.body.toString('utf8');

  const partes = Object.fromEntries(header.split(',').map((p) => p.split('=', 2)));
  const esperado = createHmac('sha256', WEBHOOK_SECRET)
    .update(\`\${partes.t}.\${corpoBruto}\`)
    .digest('hex');

  const recebido = Buffer.from(partes.v1 ?? '', 'utf8');
  const calculado = Buffer.from(esperado, 'utf8');

  if (recebido.length !== calculado.length || !timingSafeEqual(recebido, calculado)) {
    return res.status(400).send('assinatura invalida');
  }

  // Rejeite eventos antigos para não aceitar replay.
  if (Math.abs(Date.now() / 1000 - Number(partes.t)) > 300) {
    return res.status(400).send('evento muito antigo');
  }

  const evento = JSON.parse(corpoBruto);
  console.log(evento.event, evento.data.charge.id);

  // Responda 2xx rápido: fora disso o PseudoPay reagenda a entrega.
  res.sendStatus(200);
});

app.listen(3000);`,

    python: `import hmac, hashlib, time
from flask import Flask, request

WEBHOOK_SECRET = "${secret}"
app = Flask(__name__)

@app.post("/webhooks/pseudopay")
def pseudopay():
    header = request.headers.get("X-PseudoPay-Signature", "")
    corpo_bruto = request.get_data(as_text=True)

    partes = dict(p.split("=", 1) for p in header.split(","))
    esperado = hmac.new(
        WEBHOOK_SECRET.encode(),
        f"{partes.get('t')}.{corpo_bruto}".encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(partes.get("v1", ""), esperado):
        return "assinatura invalida", 400

    if abs(time.time() - int(partes["t"])) > 300:
        return "evento muito antigo", 400

    evento = request.get_json()
    print(evento["event"], evento["data"]["charge"]["id"])

    return "", 200`,

    php: `<?php
$secret = '${secret}';

$corpoBruto = file_get_contents('php://input');
$header = $_SERVER['HTTP_X_PSEUDOPAY_SIGNATURE'] ?? '';

$partes = [];
foreach (explode(',', $header) as $parte) {
    [$chave, $valor] = array_pad(explode('=', $parte, 2), 2, null);
    $partes[trim($chave)] = $valor;
}

$esperado = hash_hmac('sha256', $partes['t'] . '.' . $corpoBruto, $secret);

if (!hash_equals($esperado, $partes['v1'] ?? '')) {
    http_response_code(400);
    exit('assinatura invalida');
}

if (abs(time() - (int) $partes['t']) > 300) {
    http_response_code(400);
    exit('evento muito antigo');
}

$evento = json_decode($corpoBruto, true);
error_log($evento['event'] . ' ' . $evento['data']['charge']['id']);

http_response_code(200);`,
  } as const;

  return (
    <>
      <PageHeader
        eyebrow="guia de integração"
        title="Documentação"
        description="Como ligar seu backend e seu checkout ao PseudoPay. Os exemplos abaixo já vêm com a URL desta instância e, se você tiver um token, com as credenciais reais."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_180px] lg:items-start">
        <div className="grid min-w-0 gap-4">
          {/* ------------------------------------------------ visão geral */}
          <Section
            id="visao-geral"
            title="Visão geral"
            hint="Três superfícies, três formas de autenticar."
          >
            <Prose>
              O PseudoPay separa quem chama a API em três superfícies. Elas existem porque cada
              uma roda num lugar diferente e merece uma credencial diferente — o token do seu
              backend nunca deveria chegar ao navegador do pagador.
            </Prose>

            <Table>
              <thead>
                <tr>
                  <Th>Superfície</Th>
                  <Th>Quem chama</Th>
                  <Th>Credencial</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="font-mono text-xs">/v1/integration/*</Td>
                  <Td className="text-xs">Seu backend</Td>
                  <Td className="text-xs">
                    JWT gerado em <Link to="/tokens" className="text-trace hover:underline">Meus tokens</Link>
                  </Td>
                </tr>
                <tr>
                  <Td className="font-mono text-xs">/v1/app/*</Td>
                  <Td className="text-xs">Checkout do pagador (navegador)</Td>
                  <Td className="text-xs">
                    <Mono>public_token</Mono> da cobrança
                  </Td>
                </tr>
                <tr>
                  <Td className="font-mono text-xs">/admin/api/*</Td>
                  <Td className="text-xs">Este painel</Td>
                  <Td className="text-xs">HTTP Basic (senha vazia)</Td>
                </tr>
              </tbody>
            </Table>

            <Prose>
              A superfície de aplicação é somente leitura e cada <Mono>public_token</Mono> dá
              acesso a exatamente uma cobrança. Tudo que movimenta dinheiro — criar, cancelar,
              devolver, simular — vive na superfície de integração.
            </Prose>

            <div>
              <p className="eyebrow mb-1">base url desta instância</p>
              <Copyable value={baseUrl} label="base url" />
            </div>
          </Section>

          {/* ------------------------------------------------ credenciais */}
          <Section
            id="credenciais"
            title="Credenciais"
            hint="Escolha aqui e todos os exemplos da página se ajustam."
          >
            {usableTokens.length === 0 ? (
              <Alert tone="flag">
                Você ainda não tem token ativo, então os exemplos usam{' '}
                <Mono>{'{seu_jwt}'}</Mono> como placeholder. Gere um em{' '}
                <Link to="/tokens" className="underline">
                  Meus tokens
                </Link>{' '}
                para os comandos ficarem prontos para copiar e colar.
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Comerciante" htmlFor="docs-merchant">
                <Select
                  id="docs-merchant"
                  value={merchant?.id ?? ''}
                  onChange={(event) => setMerchantId(event.target.value)}
                >
                  {allMerchants.length === 0 ? <option value="">Nenhum cadastrado</option> : null}
                  {allMerchants.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Token de integração" htmlFor="docs-token">
                <Select
                  id="docs-token"
                  value={token?.id ?? ''}
                  onChange={(event) => setTokenId(event.target.value)}
                >
                  {usableTokens.length === 0 ? <option value="">Nenhum ativo</option> : null}
                  {usableTokens.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name ?? candidate.id}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {merchant ? (
              <div className="grid gap-2 border-t pt-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="eyebrow">merchant_id</span>
                  <Copyable value={merchant.id} label="merchant_id" />
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="eyebrow">webhook_url</span>
                  <span className="text-xs">
                    {merchant.webhook_url ? (
                      <Copyable value={merchant.webhook_url} label="webhook_url" />
                    ) : (
                      <span className="text-[var(--text-muted)]">
                        não configurada — sem ela, nenhum webhook é enviado
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="eyebrow">webhook_secret</span>
                  {merchant.webhook_secret ? (
                    <Copyable
                      value={merchant.webhook_secret}
                      truncate={{ head: 16, tail: 6 }}
                      label="webhook_secret"
                    />
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </div>
              </div>
            ) : (
              <Alert tone="flag">
                Nenhum comerciante cadastrado. Crie um em{' '}
                <Link to="/comerciantes" className="underline">
                  Comerciantes
                </Link>{' '}
                antes de integrar.
              </Alert>
            )}
          </Section>

          {/* ----------------------------------------------------- fluxo */}
          <Section
            id="fluxo"
            title="Fluxo completo"
            hint="A ordem importa: cada passo depende do anterior."
          >
            <ol className="grid gap-5">
              <li>
                <p className="eyebrow mb-1">passo 1 — seu backend cria a cobrança</p>
                <Prose>
                  Valores são sempre inteiros em centavos: <Mono>15000</Mono> é R$&nbsp;150,00.
                  O <Mono>metadata</Mono> é seu, volta igual em toda consulta e em todo webhook.
                </Prose>
                <CodeBlock className="mt-2" code={createCharge} label="POST /v1/integration/pix/charges" />
              </li>

              <li>
                <p className="eyebrow mb-1">passo 2 — guarde o retorno</p>
                <Prose>
                  Guarde o <Mono>id</Mono> no seu pedido e entregue o <Mono>qr_code</Mono> e o{' '}
                  <Mono>public_token</Mono> ao frontend. O <Mono>qr_code</Mono> é o payload
                  “copia e cola”; o <Mono>public_token</Mono> é o que autoriza o navegador a
                  acompanhar essa cobrança.
                </Prose>
                <CodeBlock className="mt-2" code={createResponse} label="201 Created" />
              </li>

              <li>
                <p className="eyebrow mb-1">passo 3 — o checkout acompanha o status</p>
                <Prose>
                  O frontend consulta a superfície de aplicação com o <Mono>public_token</Mono>.
                  Essa resposta não traz <Mono>metadata</Mono>, <Mono>merchant_id</Mono> nem o
                  documento do pagador — é o mínimo para desenhar a tela de pagamento.
                </Prose>
                <CodeBlock className="mt-2" code={pollCharge} label="GET /v1/app/pix/charges/{id}" />
              </li>

              <li>
                <p className="eyebrow mb-1">passo 4 — confirme (ou deixe confirmar sozinho)</p>
                <Prose>
                  Em desenvolvimento a cobrança se resolve sozinha conforme o CPF do pagador e o{' '}
                  <Mono>approvalRate</Mono>. Em teste automatizado, force o resultado em vez de
                  esperar:
                </Prose>
                <CodeBlock className="mt-2" code={simulate} label="POST .../simulate" />
              </li>

              <li>
                <p className="eyebrow mb-1">passo 5 — trate o webhook</p>
                <Prose>
                  Não confie só no retorno da chamada: a confirmação oficial chega pelo webhook
                  assinado. Veja{' '}
                  <a href="#webhooks" className="text-trace hover:underline">
                    Webhooks
                  </a>{' '}
                  para o código de verificação.
                </Prose>
              </li>

              <li>
                <p className="eyebrow mb-1">passo 6 — devoluções, quando precisar</p>
                <CodeBlock className="mt-2" code={refund} label="POST .../refunds" />
              </li>
            </ol>
          </Section>

          {/* -------------------------------------------------- endpoints */}
          <Section id="endpoints" title="Endpoints" hint="Permissão exigida em cada rota.">
            <p className="eyebrow">integração — authorization: bearer &lt;jwt&gt;</p>
            <Table>
              <thead>
                <tr>
                  <Th>Rota</Th>
                  <Th>O que faz</Th>
                  <Th>Permissão</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['POST /pix/charges', 'Cria cobrança. Aceita Idempotency-Key.', 'charges:write'],
                  ['GET /pix/charges', 'Lista. Filtros: status, from, to, limit, offset.', 'charges:read'],
                  ['GET /pix/charges/{id}', 'Consulta uma cobrança.', 'charges:read'],
                  ['GET /pix/charges/{id}/events', 'Histórico de transições.', 'charges:read'],
                  ['POST /pix/charges/{id}/simulate', 'Força paid ou expired.', 'simulate:write'],
                  ['POST /pix/charges/{id}/cancel', 'Cancela cobrança pendente.', 'charges:write'],
                  ['POST /pix/charges/{id}/refunds', 'Devolve total ou parcial.', 'refunds:write'],
                  ['GET /pix/charges/{id}/refunds', 'Lista devoluções.', 'charges:read'],
                  ['GET /merchants/me', 'Dados do comerciante e webhook_secret.', 'merchants:read'],
                  ['PATCH /merchants/me', 'Altera webhook_url, nome, documento.', 'merchants:write'],
                  ['GET /webhooks/deliveries', 'Histórico de entregas.', 'webhooks:read'],
                  ['POST /webhooks/deliveries/{id}/retry', 'Reenvia uma entrega.', 'webhooks:write'],
                  ['GET /kyc/documents', 'Lista documentos e status do KYC.', 'kyc:read'],
                  ['POST /kyc/documents', 'Envia documento (multipart ou base64).', 'kyc:write'],
                ].map(([route, what, permission]) => (
                  <tr key={route}>
                    <Td className="font-mono text-[11.5px] whitespace-nowrap">{route}</Td>
                    <Td className="text-xs">{what}</Td>
                    <Td className="font-mono text-[11px] whitespace-nowrap">{permission}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <p className="eyebrow mt-2">aplicação — authorization: bearer &lt;public_token&gt;</p>
            <Table>
              <thead>
                <tr>
                  <Th>Rota</Th>
                  <Th>O que faz</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="font-mono text-[11.5px]">GET /pix/charges/{'{id}'}</Td>
                  <Td className="text-xs">Status da cobrança, em versão reduzida.</Td>
                </tr>
                <tr>
                  <Td className="font-mono text-[11.5px]">GET /pix/charges/{'{id}'}/qrcode</Td>
                  <Td className="text-xs">Só o payload do QR code e a validade.</Td>
                </tr>
              </tbody>
            </Table>
          </Section>

          {/* --------------------------------------------------- webhooks */}
          <Section
            id="webhooks"
            title="Webhooks"
            hint="Assinados com HMAC-SHA256, com retry automático."
          >
            <Prose>
              Quando uma cobrança muda de estado, o PseudoPay faz um <Mono>POST</Mono> na{' '}
              <Mono>webhook_url</Mono> do comerciante. Eventos enviados:{' '}
              <Mono>pix.charge.created</Mono>, <Mono>pix.charge.paid</Mono>,{' '}
              <Mono>pix.charge.expired</Mono>, <Mono>pix.charge.refunded</Mono>,{' '}
              <Mono>kyc.approved</Mono> e <Mono>kyc.rejected</Mono>.
            </Prose>

            <CodeBlock code={webhookBody} label="corpo da requisição" />

            <Prose>
              Além da assinatura, cada tentativa traz <Mono>X-PseudoPay-Event</Mono>,{' '}
              <Mono>X-PseudoPay-Delivery</Mono> e <Mono>X-PseudoPay-Attempt</Mono>. Se o seu
              endpoint não responder <Mono>2xx</Mono>, a entrega é reagendada até o limite de{' '}
              <Mono>webhookMaxRetries</Mono> (3 por padrão), com intervalo crescente.
            </Prose>

            <div className="border-t pt-3">
              <p className="eyebrow mb-1">assinatura</p>
              <Prose>
                O header <Mono>X-PseudoPay-Signature</Mono> vem no formato{' '}
                <Mono>t=&lt;unix&gt;,v1=&lt;hmac&gt;</Mono>. O HMAC-SHA256 é calculado sobre a
                string <Mono>&lt;t&gt;.&lt;corpo bruto&gt;</Mono> usando o{' '}
                <Mono>webhook_secret</Mono> do comerciante. O timestamp entra na assinatura
                justamente para você poder recusar eventos repetidos.
              </Prose>
            </div>

            <Alert tone="flag">
              Verifique a assinatura sobre o corpo <strong>bruto</strong>, antes de qualquer
              parser de JSON. Reserializar o objeto muda os bytes e a assinatura deixa de bater.
            </Alert>

            <div>
              <div className="mb-2 flex gap-1">
                {(
                  [
                    ['node', 'Node.js'],
                    ['python', 'Python'],
                    ['php', 'PHP'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={language === value}
                    onClick={() => setLanguage(value)}
                    className={cn(
                      'rounded-[var(--radius-panel)] border px-2 py-1 font-mono text-[11px]',
                      language === value
                        ? 'border-trace/40 bg-trace-soft text-trace'
                        : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <CodeBlock code={VERIFY_SNIPPETS[language]} label="verificação da assinatura" />
            </div>

            <Prose>
              Toda tentativa fica registrada em{' '}
              <Link to="/webhooks" className="text-trace hover:underline">
                Webhooks
              </Link>
              , com corpo, assinatura enviada e resposta do seu endpoint — é o lugar para olhar
              quando a entrega falha.
            </Prose>
          </Section>

          {/* ---------------------------------------------------- testes */}
          <Section
            id="testes"
            title="CPFs de teste"
            hint="Comportamento fixo, para cenário determinístico em CI."
          >
            <Prose>
              O <Mono>payer_document</Mono> decide o destino da cobrança. Estes três valores nunca
              dependem de sorteio, então servem para teste automatizado:
            </Prose>

            <Table>
              <thead>
                <tr>
                  <Th>payer_document</Th>
                  <Th>O que acontece</Th>
                  <Th>Serve para testar</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    document: '11111111111',
                    what: 'Confirma sempre, no tempo mínimo configurado.',
                    why: 'Caminho feliz',
                  },
                  {
                    document: '22222222222',
                    what: 'Nunca confirma — a cobrança expira.',
                    why: 'Timeout e expiração',
                  },
                  {
                    document: '33333333333',
                    what: 'Confirma, mas o webhook falha de propósito.',
                    why: 'Retry de webhook',
                  },
                  {
                    document: null,
                    what: 'Segue o approvalRate configurado.',
                    why: 'Comportamento realista',
                  },
                ].map((row) => (
                  <tr key={row.document ?? 'outros'}>
                    <Td>
                      {row.document ? (
                        <Copyable value={row.document} label="CPF" />
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">qualquer outro</span>
                      )}
                    </Td>
                    <Td className="text-xs">{row.what}</Td>
                    <Td className="text-xs text-[var(--text-muted)]">{row.why}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <Prose>
              Pontuação é ignorada: <Mono>111.111.111-11</Mono> tem o mesmo efeito que{' '}
              <Mono>11111111111</Mono>. Para tornar tudo previsível, rode a instância com{' '}
              <Mono>PSEUDOPAY_APPROVAL_RATE=1</Mono>.
            </Prose>
          </Section>

          {/* ---------------------------------------------------- status */}
          <Section id="status" title="Status da cobrança" hint="Transições fora deste mapa dão 409.">
            <CodeBlock
              code={`pending ──► paid ──► partially_refunded ──► refunded
   │          └──────────────────────────► refunded
   ├──► expired
   └──► canceled`}
              label="máquina de estados"
            />

            <Table>
              <thead>
                <tr>
                  <Th>Status</Th>
                  <Th>Significado</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['pending', 'QR code emitido, aguardando pagamento.'],
                  ['paid', 'Pago. Ganha um e2e_id neste momento.'],
                  ['partially_refunded', 'Devolvido em parte; ainda há saldo em aberto.'],
                  ['refunded', 'Devolvido integralmente. Terminal.'],
                  ['expired', 'O QR code venceu sem pagamento. Terminal.'],
                  ['canceled', 'Cancelado pelo lojista antes do pagamento. Terminal.'],
                ].map(([status, meaning]) => (
                  <tr key={status}>
                    <Td className="font-mono text-[11.5px]">{status}</Td>
                    <Td className="text-xs">{meaning}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <Prose>
              Estados terminais não voltam atrás. Tentar pagar uma cobrança expirada responde{' '}
              <Mono>409 invalid_state_transition</Mono>, com <Mono>from</Mono> e <Mono>to</Mono> no{' '}
              <Mono>details</Mono>. Não existe evento de cancelamento por webhook.
            </Prose>
          </Section>

          {/* ----------------------------------------------- idempotência */}
          <Section id="idempotencia" title="Idempotência" hint="Para não cobrar duas vezes no retry.">
            <Prose>
              Mande <Mono>Idempotency-Key</Mono> ao criar cobrança. Se a mesma chave chegar de novo
              com o mesmo corpo, você recebe a cobrança original em vez de uma nova — a resposta
              vem com <Mono>Idempotent-Replay: true</Mono>. Se a chave repetir com um corpo
              diferente, a resposta é <Mono>409 idempotency_key_reused</Mono>, porque isso quase
              sempre é bug e não intenção.
            </Prose>

            <Prose>
              A chave é escopada por comerciante, então dois comerciantes podem usar a mesma sem
              conflito. Use algo estável do seu domínio, como o id do pedido.
            </Prose>
          </Section>

          {/* ----------------------------------------------------- erros */}
          <Section id="erros" title="Erros" hint="Mesmo envelope em todas as superfícies.">
            <CodeBlock
              code={`{
  "error": {
    "code": "invalid_state_transition",
    "message": "Charge ch_a1b2c3 cannot go from paid to expired",
    "details": { "from": "paid", "to": "expired" }
  }
}`}
              label="formato do erro"
            />

            <Table>
              <thead>
                <tr>
                  <Th>HTTP</Th>
                  <Th>code</Th>
                  <Th>Quando acontece</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['400', 'invalid_amount', 'amount não é inteiro positivo em centavos.'],
                  ['400', 'refund_exceeds_charge', 'Devolução maior que o saldo em aberto.'],
                  ['401', 'integration_auth_required', 'Faltou o header Authorization.'],
                  ['401', 'invalid_token', 'JWT malformado ou assinado com outro segredo.'],
                  ['401', 'token_expired', 'O token venceu.'],
                  ['401', 'token_revoked', 'O token foi revogado no painel.'],
                  ['401', 'invalid_public_token', 'public_token não corresponde a nenhuma cobrança.'],
                  ['403', 'insufficient_permission', 'O token não tem a permissão da rota.'],
                  ['403', 'kyc_required', 'KYC não aprovado e o bloqueio está ligado.'],
                  ['404', 'charge_not_found', 'Não existe, ou é de outro comerciante.'],
                  ['409', 'invalid_state_transition', 'Transição não permitida pela máquina de estados.'],
                  ['409', 'charge_not_refundable', 'A cobrança não está paga.'],
                  ['409', 'idempotency_key_reused', 'Mesma chave, corpo diferente.'],
                  ['413', 'document_too_large', 'Documento de KYC acima de kycMaxFileSizeMb.'],
                ].map(([status, code, when]) => (
                  <tr key={code}>
                    <Td className="tnum text-xs">{status}</Td>
                    <Td className="font-mono text-[11.5px] whitespace-nowrap">{code}</Td>
                    <Td className="text-xs">{when}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <Prose>
              Uma cobrança de outro comerciante responde <Mono>404</Mono>, não{' '}
              <Mono>403</Mono>: assim um token não serve para descobrir quais ids existem.
            </Prose>
          </Section>

          <Alert tone="halt">
            O PseudoPay não tem controle de acesso real e não fala com o Banco Central. Ele é para
            desenvolvimento e teste — não exponha uma instância publicamente nem use os dados dela
            como se fossem de pagamento real.
          </Alert>
        </div>

        {/* Índice fixo: a página é longa e a leitura raramente é linear. */}
        <nav aria-label="Nesta página" className="hidden lg:sticky lg:top-6 lg:block">
          <p className="eyebrow mb-2">nesta página</p>
          <ul className="grid gap-1 border-l pl-3">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block text-xs text-[var(--text-muted)] hover:text-trace"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
