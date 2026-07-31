# PseudoPay

Um gateway de pagamento **PIX** simulado, self-hosted, para desenvolvimento e testes de integração — no mesmo espírito de ferramentas como MinIO (S3) ou LocalStack (AWS), mas para o ciclo de vida de um gateway de pagamento.

---

## O que é

O PseudoPay reproduz o comportamento de um gateway PIX de verdade — geração de QR code, confirmação assíncrona, expiração, estorno, webhooks assinados, KYC de merchant — sem depender de nenhum provedor externo. Ideal para:

- Testar integrações de checkout sem depender de sandbox de terceiros
- Rodar cenários determinísticos em CI (forçar pagamento, forçar expiração)
- Testar idempotência, retry e validação de assinatura de webhook
- Demonstrar/desenvolver fluxos de KYC e aprovação de merchant localmente

## Escopo

- **Somente PIX** nesta versão. Cartão, boleto e outros métodos ficam fora do escopo (arquitetura já preparada para extensão futura).
- **Duas superfícies de API**, fisicamente separadas por rota mesmo quando a lógica é a mesma:
  - `/v1/integration/*` — consumida pelo backend do merchant, com JWT
  - `/v1/panel/*` — consumida pelo painel, com HTTP Basic
- **Sem fila de verdade** — assincronia (confirmação de pagamento, expiração de QR code, retry de webhook) é simulada com `setTimeout` in-process.
- **Sem storage externo** — documentos de KYC são salvos como BLOB direto no SQLite; nenhuma dependência de S3/disco externo.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend / API | Node.js + TypeScript + Fastify |
| Banco | SQLite (better-sqlite3) |
| Painel | Vite + React + TypeScript + react-router-dom |
| Estilo | Tailwind + shadcn/ui |
| Auth do painel | HTTP Basic (merchant id + senha vazia) |
| Auth da API de Integração | JWT emitido pelo próprio merchant no painel |
| Assincronia | `setTimeout` in-process (sem Redis/BullMQ) |
| Upload de KYC | BLOB no SQLite |

## Instalação e uso

O repositório tem dois projetos npm independentes: `backend/` (API Fastify) e `frontend/` (painel Vite + React).

```bash
npm --prefix backend install   # dependências da API
npm --prefix frontend install  # dependências do painel

cd backend
npm run build               # compila API + painel
npm start                   # sobe API (Fastify) + painel
npm run dev                 # API com reload (painel: npm --prefix ../frontend run dev)
npm run reset               # limpa o banco, mantém o schema
npm test                    # suíte de testes
```

> A CLI `npx pseudopay <comando>` (fase 8 do roadmap) ainda não existe — os scripts npm acima cumprem o mesmo papel. O banco é criado sozinho na primeira execução, então não há passo de `init`.

Por padrão o servidor sobe em `http://localhost:4242`. Configurações ficam em `pseudopay.config.json` (ou variáveis de ambiente com prefixo `PSEUDOPAY_`, ex.: `PSEUDOPAY_PORT=5000`, `PSEUDOPAY_APPROVAL_RATE=1`).

## Como usar

### 1. Acesse o painel

Abra `http://localhost:4242`. Não há tela de login tradicional — **o merchant é a identidade do painel**: você verá a lista de lojas cadastradas, com o saldo de cada uma, e escolhe qual usar na sessão.

Se o banco estiver vazio, a própria tela de seleção cria a primeira loja. A criação é pública (ver [Segurança](#segurança)) justamente porque o Basic Auth resolve um merchant que já existe — sem isso não haveria como entrar num banco novo.

Cada sessão vê **apenas a própria loja**: suas cobranças, tokens, webhooks, documentos e saldo. Não existe um perfil de operador que enxergue várias lojas.

### 2. Confira a loja

Na tela **Minha loja** ficam o saldo, o `merchant_id` (que é o usuário do Basic Auth), a `webhook_url`, o `webhook_secret` e o KYC. Como não há revisor externo, aprovar ou recusar o KYC ali é um **controle de simulação da própria loja** — a mesma ideia de forçar um pagamento. A decisão dispara os webhooks `kyc.approved` / `kyc.rejected` de verdade.

### 3. Gere um token de integração

Na tela **Tokens**, gere um JWT com as permissões que você quiser expor. **Só a loja emite token**, e todo token nasce escopado nela — um `merchant_id` enviado no corpo é ignorado. O token fica visível a qualquer momento (não some depois de gerado) — copie e use no seu backend.

As permissões disponíveis são `charges:read`, `charges:write`, `refunds:write`, `simulate:write`, `merchants:read`, `merchants:write`, `kyc:read`, `kyc:write`, `webhooks:read`, `webhooks:write` — ou `*` para todas. A loja é dona do próprio escopo, então pode conceder qualquer uma delas.

### 4. Crie uma cobrança PIX

```bash
curl -X POST http://localhost:4242/v1/integration/pix/charges \
  -H "Authorization: Bearer {seu_jwt}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 15000,
    "payer_document": "11111111111",
    "metadata": { "order_id": "abc-123" }
  }'
```

A resposta traz `qr_code` e `qr_code_expires_at` — repasse o `qr_code` pro seu frontend renderizar. O acompanhamento do status fica no seu backend, que é quem tem o token:

```bash
curl http://localhost:4242/v1/integration/pix/charges/ch_a1b2c3 \
  -H "Authorization: Bearer {seu_jwt}"
```

### 5. Simule o pagamento (útil em testes/CI)

```bash
curl -X POST http://localhost:4242/v1/integration/pix/charges/ch_a1b2c3/simulate \
  -H "Authorization: Bearer {seu_jwt}" \
  -H "Content-Type: application/json" \
  -d '{ "result": "paid" }'
```

Isso dispara o webhook `pix.charge.paid` pro `webhook_url` configurado no merchant, e o valor entra no saldo da loja.

## Saldo

Cada loja tem um saldo, visível em **Minha loja**, na lista de seleção e em `GET /v1/panel/balance`:

| Campo | O que é |
|---|---|
| `available` | Saldo líquido: tudo que liquidou, menos o que foi devolvido |
| `gross_received` | Soma de tudo que já liquidou, antes das devoluções |
| `refunded` | Soma de todas as devoluções |
| `settled_charges` | Quantas cobranças entraram no `gross_received` |

O saldo é **derivado das cobranças** (`SUM(amount - refunded_amount)` sobre as que estão `paid`, `partially_refunded` ou `refunded`), não uma coluna guardada. Assim ele nunca dessincroniza do que aconteceu de fato. Cobrança pendente, expirada ou cancelada não entra; uma totalmente devolvida contribui zero, mas segue somando no `gross_received`.

Não há saque: o saldo é um número observável, não uma conta com movimentação própria.

## CPFs de teste (comportamento determinístico)

| `payer_document` | Comportamento |
|---|---|
| `11111111111` | Sempre confirma no tempo mínimo configurado |
| `22222222222` | Nunca confirma (força expiração) |
| `33333333333` | Confirma, mas o webhook falha propositalmente (testa retry) |
| Qualquer outro | Segue a taxa de confirmação configurada (`approvalRate`) |

## Webhooks

Eventos disparados: `pix.charge.created`, `pix.charge.paid`, `pix.charge.expired`, `pix.charge.refunded`, `kyc.approved`, `kyc.rejected`.

Payload assinado via HMAC-SHA256 no header `X-PseudoPay-Signature`, usando o `webhook_secret` do merchant. Retry automático (até 3 tentativas) se o endpoint não responder `2xx`.

O corpo enviado tem sempre esta forma:

```json
{
  "id": "whd_...",
  "event": "pix.charge.paid",
  "created_at": "2026-07-29T23:59:00.000Z",
  "data": { "charge": { "...": "..." } }
}
```

O header segue o formato `t=<unix>,v1=<hmac>`, onde o HMAC-SHA256 é calculado sobre a string `<t>.<corpo bruto>`. Incluir o timestamp na assinatura é o que permite testar proteção contra replay:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verificar(corpoBruto, header, segredo) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=', 2)));
  const esperado = createHmac('sha256', segredo).update(`${t}.${corpoBruto}`).digest('hex');
  return v1.length === esperado.length && timingSafeEqual(Buffer.from(v1), Buffer.from(esperado));
}
```

Cada tentativa também vai com `X-PseudoPay-Event`, `X-PseudoPay-Delivery` e `X-PseudoPay-Attempt`. Todas ficam registradas e podem ser reenviadas pelo painel ou por `POST /v1/integration/webhooks/deliveries/{id}/retry`.

## Configuração

```json
{
  "port": 4242,
  "approvalRate": 0.85,
  "webhookDelayMs": 3000,
  "pixConfirmationDelayMs": 4000,
  "pixQrCodeExpirationMs": 900000,
  "webhookMaxRetries": 3,
  "jwtSigningSecret": "change-me",
  "jwtDefaultExpiration": "24h",
  "kycMaxFileSizeMb": 5
}
```

Outras chaves com valor padrão, todas sobrescrevíveis do mesmo jeito:

| Chave | Padrão | O que faz |
|---|---|---|
| `host` | `127.0.0.1` | Interface do listener. É um ambiente de dev — não abra por padrão. |
| `databasePath` | `data/pseudopay.sqlite` | Arquivo SQLite. `:memory:` funciona (os testes usam). |
| `pixMinConfirmationDelayMs` | `500` | Atraso usado pelo CPF que confirma sempre. |
| `webhookRetryBackoffMs` | `2000` | Base do intervalo entre tentativas; cresce a cada tentativa. |
| `webhookTimeoutMs` | `5000` | Timeout de cada requisição de webhook. |
| `requireApprovedKycForCharges` | `false` | Se `true`, merchant sem KYC aprovado não cria cobrança. |
| `pixKey` / `pixReceiverName` / `pixReceiverCity` | `pseudopay@localhost` / `PSEUDOPAY` / `SAO PAULO` | Dados do recebedor embutidos no BR Code. |

O bloqueio de KYC vem **desligado** por padrão para que o passo a passo acima funcione numa instalação nova — merchants nascem com `kyc_status: "pending"`. Ligue `requireApprovedKycForCharges` quando quiser testar o caminho de bloqueio (`403 kyc_required`).

Tudo na tabela acima, menos `port`, `host`, `databasePath` e `jwtSigningSecret`, também pode ser editado na tela **Configurações** e vale na hora, sem reiniciar.

## Referência da API

> Com o servidor rodando, o painel tem um guia de integração completo em
> [`/docs`](http://localhost:4242/docs): mesmos endpoints, mas com a URL da sua
> instância e o seu token já preenchidos nos exemplos, além de código pronto de verificação
> de assinatura de webhook em Node.js, Python e PHP.

**Integração** (`Authorization: Bearer <jwt>`):

| Método e rota | Permissão |
|---|---|
| `POST /v1/integration/pix/charges` (aceita `Idempotency-Key`) | `charges:write` |
| `GET /v1/integration/pix/charges` (filtros `status`, `from`, `to`, `limit`, `offset`) | `charges:read` |
| `GET /v1/integration/pix/charges/{id}` · `/events` · `/refunds` | `charges:read` |
| `POST /v1/integration/pix/charges/{id}/simulate` — `{"result":"paid"\|"expired"}` | `simulate:write` |
| `POST /v1/integration/pix/charges/{id}/cancel` | `charges:write` |
| `POST /v1/integration/pix/charges/{id}/refunds` — `amount` opcional | `refunds:write` |
| `GET`/`PATCH /v1/integration/merchants/me` | `merchants:read` / `merchants:write` |
| `GET /v1/integration/webhooks/deliveries` | `webhooks:read` |
| `POST /v1/integration/webhooks/deliveries/{id}/retry` | `webhooks:write` |
| `GET`/`POST /v1/integration/kyc/documents` | `kyc:read` / `kyc:write` |

O painel consome `/v1/panel/*` com HTTP Basic, onde o usuário é o `merchant_id` (ou o documento da loja) e a senha é vazia. Tudo ali é escopado na loja da sessão — pedir uma cobrança de outra loja responde `404`, não `403`, para que ids não possam ser sondados. Erros de qualquer superfície vêm no mesmo envelope:

```json
{ "error": { "code": "invalid_state_transition", "message": "...", "details": { "from": "paid", "to": "expired" } } }
```

## Limitações conhecidas

- Webhooks agendados via `setTimeout` são perdidos se o processo reiniciar (sem persistência de fila)
- SQLite não é adequado para alta concorrência de escrita
- O payload do QR code é visualmente similar a um PIX real, mas não é decodificável por um app de banco de verdade
- `e2e_id` simulado segue formato parecido com o real do Bacen, mas não implementa o algoritmo oficial

## Roadmap

1. ✅ Core: schema, máquina de estados PIX, QR code, rotas `/v1/integration/*` e `/v1/panel/*`
2. ✅ Identidade do painel: login por seleção de loja, Basic Auth
3. ✅ Integration Tokens: geração/validação/revogação de JWT
4. ✅ Webhooks: dispatcher, HMAC, retry
5. ✅ KYC: upload (BLOB), aprovação manual, bloqueio de charges
6. ✅ Painel: transações e saldo da loja
7. ✅ Painel: KYC e settings
8. ⬜ CLI e empacotamento — fora do escopo por ora; use os scripts npm

Métodos como cartão e boleto ficam como extensão futura, fora deste roadmap.

## Estrutura

```
backend/
  src/
    server.ts      buildServer(): instância Fastify + registro de plugins e rotas
    config.ts      pseudopay.config.json + PSEUDOPAY_* + settings salvos no banco
    db/            schema.sql, openDb, reset
    lib/           pix (BR Code + CRC16), jwt, hmac, scheduler, ids, errors
    domain/        charges (máquina de estados), refunds, webhooks, kyc, tokens, merchants
    auth/          basic (sessão da loja), bearer (integração), permissions
    routes/        integration.ts, panel.ts — superfícies separadas por arquivo
  tests/           node:test com relógio virtual, sem sleep
  data/            banco SQLite
frontend/          painel em Vite + React, compila para backend/dist/panel e é servido na raiz
```

Toda assincronia passa por `backend/src/lib/scheduler.ts`, que encapsula o `setTimeout`. Isso permite cancelar timers no shutdown e, nos testes, avançar o tempo manualmente em vez de esperar de verdade.

## Máquina de estados

```
pending ──► paid ──► partially_refunded ──► refunded
   │          └──────────────────────────► refunded
   ├──► expired
   └──► canceled
```

`expired`, `canceled` e `refunded` são terminais. Qualquer transição fora deste diagrama responde `409 invalid_state_transition`, e toda transição fica registrada em `charge_events` — que é o que o painel desenha na visão de ciclo de vida.
