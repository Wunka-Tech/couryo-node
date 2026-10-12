# @couryo/node

SDK oficial em Node.js da API de e-mail do [Couryo](https://couryo.com). [Read in English](./README.md).

- Tipos saem do contrato da API (os mesmos esquemas que geram o OpenAPI).
- `Idempotency-Key` automático em todo POST, repetido nas novas tentativas: um envio que deu tempo esgotado mas passou nunca sai duplicado.
- Novas tentativas com espera crescente para erro de rede, `5xx` e `rate_limited` (respeita o `Retry-After`). Erros que falhariam de novo (`domain_not_verified`, `daily_limit_reached`...) voltam na hora.
- Verificação de webhook (Standard Webhooks) numa chamada.
- Node 20.3 ou mais novo, ESM.

> Ainda não está no npm. Dentro do monorepo do Couryo, é o pacote `@couryo/node` do workspace.

## Instalar

```bash
npm install @couryo/node
```

## Enviar um e-mail

```ts
import { Couryo } from "@couryo/node";

const couryo = new Couryo({ apiKey: process.env.COURYO_API_KEY }); // ck_live_... ou ck_test_...

const { id, status } = await couryo.emails.send({
  from: "Loja <pedidos@exemplo.com.br>",
  to: "ana@exemplo.com.br",
  subject: "Pedido 1042 confirmado",
  html: "<p>Obrigado!</p>",
  text: "Obrigado!",
  tags: { tipo: "pedido" },
});
```

Passe a sua própria chave quando o mesmo evento do seu sistema puder disparar duas vezes: `couryo.emails.send(corpo, { idempotencyKey: "pedido-1042-confirmacao" })`.

## Templates salvos

```ts
await couryo.templates.create({ name: "boas-vindas", subject: "Bem-vinda, {{nome}}!", html: "<h1>Olá, {{nome}}</h1>" });
await couryo.emails.send({ from: "Loja <oi@exemplo.com.br>", to: "ana@exemplo.com.br", template: "boas-vindas", variables: { nome: "Ana" } });
```

## Erros

```ts
import { CouryoError } from "@couryo/node";

try {
  await couryo.emails.send(corpo);
} catch (e) {
  if (e instanceof CouryoError) console.log(e.status, e.code, e.message, e.param, e.requestId);
}
```

A `message` segue a opção `language` (`pt-BR` por padrão, ou `en`).

## Webhooks

Use o corpo cru, exatamente como chegou:

```ts
import express from "express";
import { verifyWebhook } from "@couryo/node";

app.post("/webhooks/couryo", express.raw({ type: "application/json" }), (req, res) => {
  const evento = verifyWebhook({ secret: process.env.COURYO_WEBHOOK_SECRET!, headers: req.headers, body: req.body });
  if (evento.type === "bounced") {
    // evento.data.email_id, evento.data.recipient, evento.data.explanation...
  }
  res.sendStatus(200);
});
```

`verifyWebhook` lança `WebhookVerificationError` quando a assinatura não bate ou o horário tem mais de 5 minutos. Para os eventos de contato e supressão (`contact.unsubscribed`, `contact.topic_changed`, `suppression.created`, `suppression.deleted`), use `verifyWebhook<AnyWebhookPayload>(...)` e confira `evento.type`.

## Todo o resto

| Recurso | Métodos |
|---|---|
| `emails` | `send`, `batch` (até 100), `check`, `get`, `list`, `iterate`, `reschedule`, `cancel` |
| `dailyLimit` | `get`, `update`: recusar ou guardar para o dia seguinte quando bater o limite diário (`on_daily_limit` por envio) |
| `domains` | `list`, `create`, `get`, `delete`, `verify`, `health` (diagnóstico de entregabilidade) |
| `webhooks` | `list`, `create`, `get`, `update`, `delete` |
| `suppressions` | `list` (`since` para sincronizar por cron), `add`, `remove` |
| `events` | `list`, `iterate` (eventos de entrega), `track` (evento do contato) |
| `templates` | `list`, `create`, `get`, `update`, `delete`, `versions`, `preview` |
| `contacts` | `create` (cria ou atualiza pelo e-mail), `list`, `iterate`, `get`, `update`, `delete`, `count` (público) |
| `campaigns` | `create`, `list`, `get`, `update`, `delete`, `preflight`, `send`, `schedule`, `pause`, `resume`, `cancel`, `test`, `stats` |

`iterate` percorre todas as páginas: `for await (const email of couryo.emails.iterate({ status: "bounced" })) { ... }`.

Opções: `apiKey`, `baseUrl`, `maxRetries` (2), `timeoutMs` (30 s), `language`, `fetch`.

Docs: https://couryo.com/docs
