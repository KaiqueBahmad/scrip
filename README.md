# PseudoPay

Um gateway de pagamento **PIX** simulado, self-hosted, para desenvolvimento e testes de integração — no mesmo espírito de ferramentas como MinIO (S3) ou LocalStack (AWS), mas para o ciclo de vida de um gateway de pagamento.

> ⚠️ **Não é um produto de produção.** Não processa pagamentos reais, não se conecta ao Banco Central/SPI, e não deve ser exposto fora de `localhost`/rede interna de dev. Ver [Segurança](#segurança) abaixo.

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
  - `/v1/app/*` — consumida pelo checkout/frontend do pagador
  - `/v1/integration/*` — consumida pelo backend do merchant
- **Sem fila de verdade** — assincronia (confirmação de pagamento, expiração de QR code, retry de webhook) é simulada com `setTimeout` in-process.
- **Sem storage externo** — documentos de KYC são salvos como BLOB direto no SQLite; nenhuma dependência de S3/disco externo.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend / API | Node.js + TypeScript + Fastify |
| Banco | SQLite (better-sqlite3) |
| Admin UI | Vite + React + TypeScript + react-router-dom |
| Estilo | Tailwind + shadcn/ui |
| Auth do painel | HTTP Basic (usuário + senha vazia) |
| Auth da API de Integração | JWT gerado pelo próprio usuário no painel |
| Assincronia | `setTimeout` in-process (sem Redis/BullMQ) |
| Upload de KYC | BLOB no SQLite |

## Instalação e uso

```bash
npx pseudopay init      # cria pastas, config e banco inicial
npx pseudopay start     # sobe API (Fastify) + painel admin
npx pseudopay reset     # limpa o banco, mantém o schema
```

Por padrão o servidor sobe em `http://localhost:4242`. Configurações ficam em `pseudopay.config.json` (ou variáveis de ambiente com prefixo `PSEUDOPAY_`).

## Como usar

### 1. Acesse o painel

Abra `http://localhost:4242/admin`. Não há tela de login tradicional — você verá a lista de usuários cadastrados e escolhe qual usar para a sessão.

### 2. Crie um usuário e um merchant

Na tela **Usuários**, crie um novo usuário escolhendo suas `permissions` e, opcionalmente, vinculando a um `merchant_id`. Na tela **Merchants**, crie a conta de teste que vai representar seu sistema.

### 3. Gere um token de integração

Na tela **Meus tokens**, gere um JWT escopado pro merchant e pelas permissões que você quiser expor. Esse token fica visível a qualquer momento (não some depois de gerado) — copie e use no seu backend.

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

A resposta traz `qr_code`, `qr_code_expires_at` e um `public_token` — repasse esse `public_token` pro seu frontend, que consulta o status via API de Aplicação:

```bash
curl http://localhost:4242/v1/app/pix/charges/ch_a1b2c3 \
  -H "Authorization: Bearer {public_token}"
```

### 5. Simule o pagamento (útil em testes/CI)

```bash
curl -X POST http://localhost:4242/v1/integration/pix/charges/ch_a1b2c3/simulate \
  -H "Authorization: Bearer {seu_jwt}" \
  -H "Content-Type: application/json" \
  -d '{ "result": "paid" }'
```

Isso dispara o webhook `pix.charge.paid` pro `webhook_url` configurado no merchant.

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

## Segurança

Este projeto **não tem controle de acesso real** por design:

- Qualquer sessão do painel pode criar um usuário com quaisquer permissões (CRUD público)
- A "senha" da autenticação Basic é sempre vazia
- Tokens JWT ficam visíveis em texto no painel, sem expirar por padrão a menos que configurado

Isso é intencional — o PseudoPay é feito para rodar local ou em rede interna isolada, priorizando conveniência de desenvolvimento sobre segurança. **Nunca exponha uma instância publicamente sem um proxy/firewall restringindo o acesso.**

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

## Limitações conhecidas

- Webhooks agendados via `setTimeout` são perdidos se o processo reiniciar (sem persistência de fila)
- SQLite não é adequado para alta concorrência de escrita
- O payload do QR code é visualmente similar a um PIX real, mas não é decodificável por um app de banco de verdade
- `e2e_id` simulado segue formato parecido com o real do Bacen, mas não implementa o algoritmo oficial

## Roadmap

1. Core: schema, máquina de estados PIX, QR code, rotas `/v1/app/*` e `/v1/integration/*`
2. Usuários: CRUD público, login por seleção, Basic Auth
3. Integration Tokens: geração/validação/revogação de JWT
4. Webhooks: dispatcher, HMAC, retry
5. KYC: upload (BLOB), aprovação manual, bloqueio de charges
6. Admin UI: transações e merchants
7. Admin UI: KYC e settings
8. CLI e empacotamento

Métodos como cartão e boleto ficam como extensão futura, fora deste roadmap.

## Especificação completa

Ver [`pseudopay-spec.md`](./pseudopay-spec.md) para o detalhamento técnico completo (entidades, máquina de estados, contratos de API, estrutura de pastas).
