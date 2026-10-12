# @couryo/node

Official Node.js SDK for the [Couryo](https://couryo.com) email API. [Leia em português](./README.pt-BR.md).

- Types from the API contract (the same schemas that generate the OpenAPI).
- Automatic `Idempotency-Key` on every POST, reused on retries: a send that timed out but went through is never duplicated.
- Retries with backoff for network errors, `5xx` and `rate_limited` (honors `Retry-After`). Errors that would fail again (`domain_not_verified`, `daily_limit_reached`...) are thrown right away.
- Webhook verification (Standard Webhooks) in one call.
- Node 20.3 or newer, ESM.

> Not on npm yet. Inside the Couryo monorepo it is the `@couryo/node` workspace package.

## Install

```bash
npm install @couryo/node
```

## Send an email

```ts
import { Couryo } from "@couryo/node";

const couryo = new Couryo({ apiKey: process.env.COURYO_API_KEY }); // ck_live_... or ck_test_...

const { id, status } = await couryo.emails.send({
  from: "Shop <orders@example.com>",
  to: "ana@example.com",
  subject: "Order 1042 confirmed",
  html: "<p>Thanks!</p>",
  text: "Thanks!",
  tags: { kind: "order" },
});
```

Pass your own key when the same business event may be sent twice: `couryo.emails.send(body, { idempotencyKey: "order-1042-confirmation" })`.

## Saved templates

```ts
await couryo.templates.create({ name: "welcome", subject: "Welcome, {{name}}!", html: "<h1>Hi, {{name}}</h1>" });
await couryo.emails.send({ from: "Shop <hi@example.com>", to: "ana@example.com", template: "welcome", variables: { name: "Ana" } });
```

## Errors

```ts
import { CouryoError } from "@couryo/node";

try {
  await couryo.emails.send(body);
} catch (e) {
  if (e instanceof CouryoError) console.log(e.status, e.code, e.message, e.param, e.requestId);
}
```

`message` follows the `language` option (`pt-BR` by default, or `en`).

## Webhooks

Use the raw body exactly as it arrived:

```ts
import express from "express";
import { verifyWebhook } from "@couryo/node";

app.post("/webhooks/couryo", express.raw({ type: "application/json" }), (req, res) => {
  const event = verifyWebhook({ secret: process.env.COURYO_WEBHOOK_SECRET!, headers: req.headers, body: req.body });
  if (event.type === "bounced") {
    // event.data.email_id, event.data.recipient, event.data.explanation...
  }
  res.sendStatus(200);
});
```

`verifyWebhook` throws `WebhookVerificationError` for a wrong signature or a timestamp older than 5 minutes. For the contact and suppression events (`contact.unsubscribed`, `contact.topic_changed`, `suppression.created`, `suppression.deleted`), use `verifyWebhook<AnyWebhookPayload>(...)` and switch on `event.type`.

## Everything else

| Resource | Methods |
|---|---|
| `emails` | `send`, `batch` (up to 100), `check`, `get`, `list`, `iterate`, `reschedule`, `cancel` |
| `dailyLimit` | `get`, `update`: reject or keep for the next day when the daily limit is reached (`on_daily_limit` per send) |
| `domains` | `list`, `create`, `get`, `delete`, `verify`, `health` (deliverability diagnosis) |
| `webhooks` | `list`, `create`, `get`, `update`, `delete` |
| `suppressions` | `list` (`since` to sync by cron), `add`, `remove` |
| `events` | `list`, `iterate` (delivery events), `track` (contact event) |
| `templates` | `list`, `create`, `get`, `update`, `delete`, `versions`, `preview` |
| `contacts` | `create` (upsert by email), `list`, `iterate`, `get`, `update`, `delete`, `count` (audience) |
| `campaigns` | `create`, `list`, `get`, `update`, `delete`, `preflight`, `send`, `schedule`, `pause`, `resume`, `cancel`, `test`, `stats` |

`iterate` walks every page: `for await (const email of couryo.emails.iterate({ status: "bounced" })) { ... }`.

Options: `apiKey`, `baseUrl`, `maxRetries` (2), `timeoutMs` (30 s), `language`, `fetch`.

Docs: https://couryo.com/en/docs
