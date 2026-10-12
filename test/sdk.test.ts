import { describe, expect, it } from "vitest";
import { Couryo, CouryoError, signWebhook, verifyWebhook, WebhookVerificationError, type AnyWebhookPayload } from "../src/index.js";
import { HttpClient } from "../src/client.js";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** Fake fetch: answers in order, records every call. */
function fakeFetch(answers: (Response | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return a.clone();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const apiError = (status: number, code: string, type = "invalid_request", extra: Record<string, string> = {}) =>
  json(status, { error: { type, code, message: `msg ${code}`, param: "to", doc_url: `https://couryo.com/docs/errors#${code}`, request_id: "req_1" } }, extra);

const client = (answers: (Response | Error)[], opts: Partial<ConstructorParameters<typeof Couryo>[0]> = {}) => {
  const f = fakeFetch(answers);
  return { couryo: new Couryo({ apiKey: "ck_test_abc", fetch: f.fn, maxRetries: 2, ...opts }), calls: f.calls };
};

describe("@couryo/node client", () => {
  it("sends with auth, JSON and an automatic Idempotency-Key", async () => {
    const { couryo, calls } = client([json(202, { id: "msg_1", status: "queued" })]);
    const res = await couryo.emails.send({ from: "Loja <oi@loja.com.br>", to: "ana@gmail.com", subject: "Oi", text: "Olá" });
    expect(res).toEqual({ id: "msg_1", status: "queued" });
    expect(calls[0]!.url).toBe("https://api.couryo.com/v1/emails");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.authorization).toBe("Bearer ck_test_abc");
    expect(calls[0]!.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]!.headers["accept-language"]).toBe("pt-BR");
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ to: "ana@gmail.com" });
  });

  it("retries 5xx, network errors and rate limits with the same Idempotency-Key", async () => {
    const { couryo, calls } = client([new TypeError("fetch failed"), apiError(500, "internal_error", "api_error"), json(202, { id: "msg_2", status: "queued" })]);
    const res = await couryo.emails.send({ from: "oi@loja.com.br", to: "a@b.com", subject: "x", text: "y" }, { idempotencyKey: "pedido-42" });
    expect(res.id).toBe("msg_2");
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.headers["idempotency-key"]))).toEqual(new Set(["pedido-42"]));

    const rl = client([apiError(429, "rate_limited", "rate_limited", { "retry-after": "0" }), json(200, { data: [], has_more: false })]);
    await rl.couryo.emails.list();
    expect(rl.calls).toHaveLength(2);
  });

  it("does not retry errors that would fail again, and exposes the error fields", async () => {
    const { couryo, calls } = client([apiError(422, "domain_not_verified")]);
    const err = await couryo.emails.send({ from: "oi@x.com", to: "a@b.com", subject: "x", text: "y" }).catch((e) => e);
    expect(err).toBeInstanceOf(CouryoError);
    expect(err).toMatchObject({ status: 422, code: "domain_not_verified", type: "invalid_request", param: "to", requestId: "req_1" });
    expect(calls).toHaveLength(1);
    const tier = client([apiError(429, "daily_limit_reached", "tier_limit")]);
    await expect(tier.couryo.emails.send({ from: "a@b.com", to: "c@d.com", subject: "x", text: "y" })).rejects.toMatchObject({ code: "daily_limit_reached" });
    expect(tier.calls).toHaveLength(1);
  });

  it("gives up after maxRetries", async () => {
    const { couryo, calls } = client([apiError(503, "billing_unavailable", "api_error")], { maxRetries: 1 });
    await expect(couryo.domains.list()).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(2);
  });

  it("covers domains, health, webhooks, suppressions, events and templates", async () => {
    const { couryo, calls } = client([json(200, {})]);
    await couryo.domains.create("loja.com.br");
    await couryo.domains.health("dom_1", { refresh: true });
    await couryo.webhooks.update("whk_1", { enabled: false });
    await couryo.suppressions.remove("a+b@gmail.com");
    await couryo.events.list({ type: "bounced", limit: 10 });
    await couryo.templates.preview("boas-vindas", { variables: { nome: "Ana" } });
    await couryo.emails.batch([{ from: "a@b.com", to: "c@d.com", subject: "x", text: "y" }]);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.couryo.com/v1", "")}`)).toEqual([
      "POST /domains",
      "GET /domains/dom_1/health?refresh=1",
      "PATCH /webhooks/whk_1",
      "DELETE /suppressions/a%2Bb%40gmail.com",
      "GET /events?type=bounced&limit=10",
      "POST /templates/boas-vindas/preview",
      "POST /emails/batch",
    ]);
    expect(JSON.parse(calls[6]!.body!)).toEqual({ emails: [{ from: "a@b.com", to: "c@d.com", subject: "x", text: "y" }] });
  });

  it("covers the inbox placement test", async () => {
    const t = { id: "itest_1", status: "checking", results: [] };
    const { couryo, calls } = client([json(201, t), json(200, { ...t, status: "completed" }), json(200, { data: [t], has_more: false })]);
    expect((await couryo.deliverability.inboxTests.create({ from: "oi@loja.com.br", subject: "Oi", text: "Olá" })).id).toBe("itest_1");
    expect((await couryo.deliverability.inboxTests.get("itest_1")).status).toBe("completed");
    await couryo.deliverability.inboxTests.list({ limit: 5 });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.couryo.com/v1", "")}`)).toEqual([
      "POST /deliverability/inbox-tests",
      "GET /deliverability/inbox-tests/itest_1",
      "GET /deliverability/inbox-tests?limit=5",
    ]);
  });

  it("iterates every page", async () => {
    const { couryo, calls } = client([
      json(200, { data: [{ id: "msg_3" }, { id: "msg_2" }], has_more: true }),
      json(200, { data: [{ id: "msg_1" }], has_more: false }),
    ]);
    const ids: string[] = [];
    for await (const e of couryo.emails.iterate({ status: "bounced" })) ids.push(e.id);
    expect(ids).toEqual(["msg_3", "msg_2", "msg_1"]);
    expect(calls[1]!.url).toContain("starting_after=msg_2");
  });

  it("covers contacts, contact events and campaigns", async () => {
    const ok = json(200, {});
    const { couryo, calls } = client(Array.from({ length: 12 }, () => ok));
    await couryo.contacts.create({ email: "ana@exemplo.com.br", attributes: { nome: "Ana" }, tags: ["cliente"] });
    await couryo.contacts.update("ana@exemplo.com.br", { attributes: { plano: null } });
    await couryo.contacts.count({ type: "all" });
    await couryo.events.track({ contact: { email: "ana@exemplo.com.br" }, name: "user.signed_up" }, { idempotencyKey: "signup-1" });
    await couryo.campaigns.create({ name: "Outubro", template_id: "novidades" });
    await couryo.campaigns.list({ status: "draft" });
    await couryo.campaigns.preflight("cmp_1");
    await couryo.campaigns.schedule("cmp_1", new Date("2026-10-20T12:00:00Z"));
    await couryo.campaigns.test("cmp_1", ["eu@exemplo.com.br"]);
    await couryo.campaigns.test("cmp_1");
    await couryo.campaigns.stats("cmp_1");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.couryo.com/v1", "")}`)).toEqual([
      "POST /contacts",
      "PATCH /contacts/ana%40exemplo.com.br",
      "POST /contacts/count",
      "POST /events",
      "POST /campaigns",
      "GET /campaigns?status=draft",
      "POST /campaigns/cmp_1/preflight",
      "POST /campaigns/cmp_1/schedule",
      "POST /campaigns/cmp_1/test",
      "POST /campaigns/cmp_1/test",
      "GET /campaigns/cmp_1/stats",
    ]);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ audience: { type: "all" } });
    expect(calls[3]!.headers["idempotency-key"]).toBe("signup-1");
    expect(JSON.parse(calls[7]!.body!)).toEqual({ scheduled_at: "2026-10-20T12:00:00.000Z" });
    expect(JSON.parse(calls[8]!.body!)).toEqual({ to: ["eu@exemplo.com.br"] });
    expect(JSON.parse(calls[9]!.body!)).toEqual({});
  });

  it("covers reschedule, cancel, contact import and topics", async () => {
    const ok = json(200, {});
    const { couryo, calls } = client(Array.from({ length: 6 }, () => ok));
    await couryo.emails.reschedule("msg_1", new Date("2026-10-20T12:00:00Z"));
    await couryo.emails.cancel("msg_1");
    await couryo.contacts.import({ csv: "email,name", mapping: { email: "email" }, consent: true });
    await couryo.contacts.getImport("imp_1");
    await couryo.topics.create({ key: "newsletter", name: "Newsletter" });
    await couryo.topics.list();
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.couryo.com/v1", "")}`)).toEqual([
      "PATCH /emails/msg_1",
      "POST /emails/msg_1/cancel",
      "POST /contacts/import",
      "GET /contacts/imports/imp_1",
      "POST /topics",
      "GET /topics",
    ]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ scheduled_at: "2026-10-20T12:00:00.000Z" });
    expect(JSON.parse(calls[2]!.body!)).toMatchObject({ consent: true, mapping: { email: "email" } });
  });

  it("covers the daily limit queue and the suppression sync", async () => {
    const ok = json(200, { data: [], has_more: false });
    const { couryo, calls } = client(Array.from({ length: 4 }, () => ok));
    await couryo.emails.send({ from: "oi@loja.com.br", to: "a@b.com", subject: "x", text: "y", on_daily_limit: "queue" });
    await couryo.dailyLimit.get();
    await couryo.dailyLimit.update({ transactional: "queue" });
    await couryo.suppressions.list({ since: "2026-10-12T00:00:00Z", stream: "marketing" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.couryo.com/v1", "")}`)).toEqual([
      "POST /emails",
      "GET /daily-limit",
      "PATCH /daily-limit",
      "GET /suppressions?since=2026-10-12T00%3A00%3A00Z&stream=marketing",
    ]);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ on_daily_limit: "queue" });
    expect(JSON.parse(calls[2]!.body!)).toEqual({ transactional: "queue" });
  });

  it("requires an API key and computes the backoff", () => {
    const prev = process.env.COURYO_API_KEY;
    delete process.env.COURYO_API_KEY;
    expect(() => new Couryo()).toThrow("missing API key");
    process.env.COURYO_API_KEY = prev;
    expect(HttpClient.backoff(1, 2)).toBe(2000);
    const b = HttpClient.backoff(3);
    expect(b).toBeGreaterThanOrEqual(1600);
    expect(b).toBeLessThanOrEqual(2400);
  });
});

describe("webhook verification (Standard Webhooks)", () => {
  const secret = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const body = JSON.stringify({ type: "delivered", timestamp: "2026-10-08T12:00:00Z", data: { email_id: "msg_1", event_id: "evt_1", tags: {}, metadata: {} } });
  const now = new Date("2026-10-08T12:00:10Z");
  const ts = Math.floor(now.getTime() / 1000) - 10;
  const headers = { "webhook-id": "evt_1", "webhook-timestamp": String(ts), "webhook-signature": signWebhook(secret, "evt_1", ts, body) };

  it("accepts a valid call and returns the event", () => {
    const event = verifyWebhook({ secret, headers, body, now });
    expect(event.type).toBe("delivered");
    expect(verifyWebhook({ secret, headers: new Headers(headers), body: Buffer.from(body), now }).data.email_id).toBe("msg_1");
    // Several signatures (secret rotation): any match is enough.
    expect(verifyWebhook({ secret, headers: { ...headers, "webhook-signature": `v1,AAAA ${headers["webhook-signature"]}` }, body, now }).type).toBe("delivered");
  });

  it("types the contact and suppression events too", () => {
    const b = JSON.stringify({ type: "suppression.created", timestamp: "2026-10-08T12:00:00Z", data: { event_id: "evt_2", email: "ana@gmail.com", reason: "unsubscribe", stream: "marketing", source: "one_click" } });
    const h = { "webhook-id": "evt_2", "webhook-timestamp": String(ts), "webhook-signature": signWebhook(secret, "evt_2", ts, b) };
    const event = verifyWebhook<AnyWebhookPayload>({ secret, headers: h, body: b, now });
    if (event.type !== "suppression.created") throw new Error("wrong type");
    expect(event.data).toMatchObject({ reason: "unsubscribe", source: "one_click" });
  });

  it("refuses a changed body, a wrong secret and old timestamps", () => {
    expect(() => verifyWebhook({ secret, headers, body: body.replace("delivered", "bounced"), now })).toThrow(WebhookVerificationError);
    expect(() => verifyWebhook({ secret: "whsec_" + Buffer.from("x".repeat(32)).toString("base64"), headers, body, now })).toThrow("signature");
    expect(() => verifyWebhook({ secret, headers, body, now: new Date(now.getTime() + 600_000) })).toThrow("timestamp");
    expect(() => verifyWebhook({ secret, headers: { "webhook-id": "evt_1" }, body, now })).toThrow("missing");
  });
});
