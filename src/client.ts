import { randomUUID } from "node:crypto";

export const DEFAULT_BASE_URL = "https://api.couryo.com/v1";
export const SDK_VERSION = "0.1.0";

export type CouryoOptions = {
  /** API key (ck_live_... or ck_test_...). Defaults to process.env.COURYO_API_KEY. */
  apiKey?: string;
  /** Defaults to https://api.couryo.com/v1. */
  baseUrl?: string;
  /** Retries for network errors, 429 and 5xx (default 2). POSTs keep the same Idempotency-Key. */
  maxRetries?: number;
  /** Per attempt, in milliseconds (default 30 s). */
  timeoutMs?: number;
  /** Language of error messages (Accept-Language). Default pt-BR. */
  language?: "pt-BR" | "en";
  /** Custom fetch (tests, proxies). */
  fetch?: typeof fetch;
};

export type RequestOptions = {
  /** Your own key for POSTs; one is generated when omitted (and reused on retries). */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

type ErrorBody = { type?: string; code?: string; message?: string; param?: string; doc_url?: string; request_id?: string };

/** Every API error: same fields as the JSON `error` object, plus the HTTP status. */
export class CouryoError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly param?: string;
  readonly docUrl?: string;
  readonly requestId?: string;
  readonly retryAfter?: number;

  constructor(status: number, body: ErrorBody, retryAfter?: number) {
    super(body.message ?? `HTTP ${status}`);
    this.name = "CouryoError";
    this.status = status;
    this.type = body.type ?? (status === 0 ? "network" : "api_error");
    this.code = body.code ?? (status === 0 ? "network_error" : "unknown");
    this.param = body.param;
    this.docUrl = body.doc_url;
    this.requestId = body.request_id;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
    });
  });

type Query = Record<string, string | number | boolean | undefined | null>;

/** Transport: auth, JSON, retries with backoff and Retry-After, automatic Idempotency-Key on POST. */
export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly language: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CouryoOptions = {}) {
    const key = opts.apiKey ?? process.env.COURYO_API_KEY;
    if (!key) throw new Error("Couryo: missing API key. Pass { apiKey } or set COURYO_API_KEY.");
    this.apiKey = key;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.language = opts.language ?? "pt-BR";
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Delay before retry `attempt` (1-based): Retry-After when given, otherwise 0.5 s, 1 s, 2 s... with jitter, at most 8 s. */
  static backoff(attempt: number, retryAfter?: number): number {
    if (retryAfter != null && Number.isFinite(retryAfter)) return Math.min(retryAfter * 1000, 60_000);
    const base = Math.min(8000, 500 * 2 ** (attempt - 1));
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: { body?: unknown; query?: Query } & RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
      "accept-language": this.language,
      "user-agent": `couryo-node/${SDK_VERSION}`,
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    // Same key on every retry: a POST that timed out but went through is never sent twice.
    if (method === "POST") headers["idempotency-key"] = opts.idempotencyKey ?? randomUUID();
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
        res = await this.fetchImpl(url, { method, headers, body: payload, signal });
      } catch (e) {
        if (opts.signal?.aborted || attempt >= this.maxRetries) {
          throw new CouryoError(0, { message: `Network error: ${(e as Error)?.message ?? String(e)}` });
        }
        await sleep(HttpClient.backoff(attempt + 1), opts.signal);
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) return json as T;
      const body = ((json as { error?: ErrorBody } | null)?.error ?? { message: text.slice(0, 300) || `HTTP ${res.status}` }) as ErrorBody;
      const retryAfter = res.headers.get("retry-after") != null ? Number(res.headers.get("retry-after")) : undefined;
      const err = new CouryoError(res.status, body, retryAfter);
      // Retry what can change with time; never a 4xx that would fail again (and never idempotency_conflict).
      const retryable = res.status >= 500 || (res.status === 429 && body.code === "rate_limited") || body.code === "idempotency_in_progress";
      if (!retryable || attempt >= this.maxRetries) throw err;
      await sleep(HttpClient.backoff(attempt + 1, retryAfter), opts.signal);
    }
  }
}
