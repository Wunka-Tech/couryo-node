import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookPayload } from "./types.gen.js";

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const bag = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name);
  const v = key ? bag[key] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Standard Webhooks signature: v1,base64(HMAC-SHA256(base64decode(secret without whsec_), "id.timestamp.body")). */
export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/**
 * Checks a Couryo webhook (Standard Webhooks headers webhook-id, webhook-timestamp, webhook-signature)
 * and returns the parsed event. Pass the raw body exactly as received (not re-serialized JSON).
 * Throws WebhookVerificationError when the signature or the timestamp (5 minutes) is wrong.
 * Email events by default; `verifyWebhook<AnyWebhookPayload>(...)` also types contact.unsubscribed,
 * contact.topic_changed, suppression.created and suppression.deleted (switch on `type`).
 */
export function verifyWebhook<T = WebhookPayload>(input: { secret: string; headers: HeaderBag; body: string | Buffer; toleranceSeconds?: number; now?: Date }): T {
  const body = typeof input.body === "string" ? input.body : input.body.toString("utf8");
  const id = header(input.headers, "webhook-id");
  const ts = header(input.headers, "webhook-timestamp");
  const sigs = header(input.headers, "webhook-signature");
  if (!id || !ts || !sigs) throw new WebhookVerificationError("missing webhook-id, webhook-timestamp or webhook-signature header");
  const seconds = Number(ts);
  if (!Number.isInteger(seconds)) throw new WebhookVerificationError("invalid webhook-timestamp");
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - seconds) > (input.toleranceSeconds ?? 300)) throw new WebhookVerificationError("timestamp too old or in the future");
  const expected = Buffer.from(signWebhook(input.secret, id, seconds, body).slice(3));
  const ok = sigs.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookVerificationError("signature does not match");
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new WebhookVerificationError("body is not JSON");
  }
}
