import type {
  InboxTest,
  CreateInboxTestRequest,
  ContactImport,
  CreateContactImportRequest,
  Topic,
  Audience,
  AudienceCount,
  BatchSendResponse,
  Campaign,
  CampaignPreflight,
  CampaignStats,
  CampaignStatus,
  Contact,
  CreateCampaignRequest,
  TrackEventRequest,
  TrackEventResponse,
  UpdateCampaignRequest,
  CheckEmailResponse,
  CreateTemplateRequest,
  Domain,
  DomainHealth,
  Email,
  EmailEvent,
  EmailEventType,
  EmailStatus,
  List,
  Period,
  PreviewTemplateResponse,
  SendEmailRequest,
  SendEmailResponse,
  Suppression,
  SuppressionReason,
  SuppressionStream,
  Template,
  TemplateVersion,
  UpdateTemplateRequest,
  Webhook,
  WebhookEventType,
  DailyLimitResponse,
  DailyLimitSettings,
} from "./types.gen.js";
import { HttpClient, type CouryoOptions, type RequestOptions } from "./client.js";

export { CouryoError, DEFAULT_BASE_URL, SDK_VERSION, type CouryoOptions, type RequestOptions } from "./client.js";
export { signWebhook, verifyWebhook, WebhookVerificationError } from "./webhooks.js";
export type {
  InboxTest,
  CreateInboxTestRequest,
  ContactImport,
  CreateContactImportRequest,
  Topic,
  Audience,
  AudienceCount,
  BatchSendResponse,
  Campaign,
  CampaignPreflight,
  CampaignStats,
  Contact,
  CreateCampaignRequest,
  TrackEventRequest,
  TrackEventResponse,
  UpdateCampaignRequest,
  CheckEmailResponse,
  CreateTemplateRequest,
  Domain,
  DomainHealth,
  Email,
  EmailEvent,
  EmailEventType,
  List,
  PreviewTemplateResponse,
  SendEmailRequest,
  SendEmailResponse,
  Suppression,
  Template,
  TemplateVersion,
  UpdateTemplateRequest,
  Webhook,
  WebhookPayload,
  WebhookEventType,
  AnyWebhookPayload,
  ContactUnsubscribedPayload,
  ContactTopicChangedPayload,
  SuppressionWebhookPayload,
  DailyLimitSettings,
  DailyLimitResponse,
} from "./types.gen.js";

const enc = encodeURIComponent;

export type ListEmailsParams = { limit?: number; starting_after?: string; status?: EmailStatus; recipient?: string; tag?: string; period?: Period };
export type ListEventsParams = { limit?: number; starting_after?: string; type?: EmailEventType; email_id?: string };
/** `since` (ISO 8601): only entries created at or after it, oldest first, to sync by cron. */
export type ListSuppressionsParams = { limit?: number; starting_after?: string; q?: string; reason?: SuppressionReason; stream?: SuppressionStream; since?: string };
export type ListContactsParams = { limit?: number; starting_after?: string; q?: string };
export type ListCampaignsParams = { limit?: number; starting_after?: string; status?: CampaignStatus };
/** Contact attributes: flat values; null removes the key on update. */
export type ContactAttributes = Record<string, string | number | boolean | null>;
export type UpsertContactParams = { email: string; attributes?: ContactAttributes; tags?: string[] };
export type UpdateContactParams = { email?: string; attributes?: ContactAttributes; tags?: string[] };
export type TestCampaignResponse = { data: { id: string; status: "queued" | "captured"; to: string }[] };

/** Walks every page (cursor pagination, newest first). */
async function* paginate<T extends { id: string }>(fetchPage: (startingAfter?: string) => Promise<List<T>>): AsyncGenerator<T> {
  let after: string | undefined;
  for (;;) {
    const page = await fetchPage(after);
    for (const item of page.data) yield item;
    if (!page.has_more || !page.data.length) return;
    after = page.data[page.data.length - 1]!.id;
  }
}

/**
 * Couryo API client.
 *
 * ```ts
 * import { Couryo } from "@couryo/node";
 * const couryo = new Couryo({ apiKey: process.env.COURYO_API_KEY });
 * const { id } = await couryo.emails.send({ from: "Loja <oi@loja.com.br>", to: "ana@gmail.com", subject: "Oi", text: "Olá!" });
 * ```
 */
export class Couryo {
  private readonly http: HttpClient;

  constructor(options: CouryoOptions = {}) {
    this.http = new HttpClient(options);
  }

  readonly emails = {
    /** Queues one email (202). A POST retried by the SDK reuses the same Idempotency-Key. */
    send: (body: SendEmailRequest, opts?: RequestOptions) => this.http.request<SendEmailResponse>("POST", "/emails", { body, ...opts }),
    /** Up to 100 emails; one result per item, in order. */
    batch: (emails: SendEmailRequest[], opts?: RequestOptions) => this.http.request<BatchSendResponse>("POST", "/emails/batch", { body: { emails }, ...opts }),
    /** Checks content and sender before sending (nothing is sent). */
    check: (body: SendEmailRequest, opts?: RequestOptions) => this.http.request<CheckEmailResponse>("POST", "/emails/check", { body, ...opts }),
    get: (id: string) => this.http.request<Email>("GET", `/emails/${enc(id)}`),
    list: (params: ListEmailsParams = {}) => this.http.request<List<Email>>("GET", "/emails", { query: params }),
    /** Moves a scheduled email that has not started sending (409 email_not_scheduled otherwise). */
    reschedule: (id: string, scheduledAt: string | Date) =>
      this.http.request<Email>("PATCH", `/emails/${enc(id)}`, { body: { scheduled_at: scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt } }),
    /** Cancels a scheduled email that has not started sending: nothing is sent and the quota goes back. */
    cancel: (id: string, opts?: RequestOptions) => this.http.request<Email>("POST", `/emails/${enc(id)}/cancel`, opts),
    /** `for await (const email of couryo.emails.iterate({ status: "bounced" }))` */
    iterate: (params: Omit<ListEmailsParams, "starting_after"> = {}) =>
      paginate<Email>((after) => this.http.request<List<Email>>("GET", "/emails", { query: { limit: 100, ...params, starting_after: after } })),
  };

  readonly domains = {
    list: () => this.http.request<List<Domain>>("GET", "/domains"),
    create: (name: string, opts?: RequestOptions) => this.http.request<Domain>("POST", "/domains", { body: { name }, ...opts }),
    get: (id: string) => this.http.request<Domain>("GET", `/domains/${enc(id)}`),
    delete: (id: string) => this.http.request<void>("DELETE", `/domains/${enc(id)}`),
    verify: (id: string, opts?: RequestOptions) => this.http.request<Domain>("POST", `/domains/${enc(id)}/verify`, opts),
    /** Deliverability diagnosis (read only). `refresh: true` runs every check now. */
    health: (id: string, params: { refresh?: boolean } = {}) =>
      this.http.request<DomainHealth>("GET", `/domains/${enc(id)}/health`, { query: params.refresh ? { refresh: 1 } : {} }),
  };

  /** Inbox placement test (where the email lands at Gmail, Outlook/Hotmail, Yahoo, UOL, BOL, Terra and iCloud). */
  readonly deliverability = {
    inboxTests: {
      /** Sends one copy per test mailbox; poll `get` until `status` is "completed" (up to 10 minutes). */
      create: (body: CreateInboxTestRequest, opts?: RequestOptions) => this.http.request<InboxTest>("POST", "/deliverability/inbox-tests", { body, ...opts }),
      get: (id: string) => this.http.request<InboxTest>("GET", `/deliverability/inbox-tests/${enc(id)}`),
      list: (params: { limit?: number; starting_after?: string } = {}) => this.http.request<List<InboxTest>>("GET", "/deliverability/inbox-tests", { query: params }),
    },
  };

  readonly webhooks = {
    list: () => this.http.request<List<Webhook>>("GET", "/webhooks"),
    /** The secret (whsec_...) comes back only here: store it. */
    create: (body: { url: string; events: WebhookEventType[] }, opts?: RequestOptions) => this.http.request<Webhook>("POST", "/webhooks", { body, ...opts }),
    get: (id: string) => this.http.request<Webhook>("GET", `/webhooks/${enc(id)}`),
    update: (id: string, body: { url?: string; events?: WebhookEventType[]; enabled?: boolean }) => this.http.request<Webhook>("PATCH", `/webhooks/${enc(id)}`, { body }),
    delete: (id: string) => this.http.request<void>("DELETE", `/webhooks/${enc(id)}`),
  };

  /** What a send does at the account's daily limit (reject or queue for the next day) and the queue now. */
  readonly dailyLimit = {
    get: () => this.http.request<DailyLimitResponse>("GET", "/daily-limit"),
    /** Scope admin. both streams queue by default; a send can still choose with on_daily_limit. */
    update: (body: Partial<DailyLimitSettings>) => this.http.request<DailyLimitResponse>("PATCH", "/daily-limit", { body }),
  };

  readonly suppressions = {
    list: (params: ListSuppressionsParams = {}) => this.http.request<List<Suppression>>("GET", "/suppressions", { query: params }),
    add: (body: { email: string; stream?: SuppressionStream }, opts?: RequestOptions) =>
      this.http.request<Suppression>("POST", "/suppressions", { body: { stream: "all", ...body }, ...opts }),
    remove: (email: string) => this.http.request<void>("DELETE", `/suppressions/${enc(email)}`),
  };

  readonly events = {
    /** Delivery events (for whoever missed a webhook). */
    list: (params: ListEventsParams = {}) => this.http.request<List<EmailEvent>>("GET", "/events", { query: params }),
    iterate: (params: Omit<ListEventsParams, "starting_after"> = {}) =>
      paginate<EmailEvent>((after) => this.http.request<List<EmailEvent>>("GET", "/events", { query: { limit: 100, ...params, starting_after: after } })),
    /** Contact event (e.g. user.signed_up): upserts the contact and starts the sequences with this trigger. */
    track: (body: TrackEventRequest, opts?: RequestOptions) => this.http.request<TrackEventResponse>("POST", "/events", { body, ...opts }),
  };

  readonly contacts = {
    /** Creates the contact or merges the attributes of the existing one (same email). */
    create: (body: UpsertContactParams, opts?: RequestOptions) => this.http.request<Contact>("POST", "/contacts", { body, ...opts }),
    list: (params: ListContactsParams = {}) => this.http.request<List<Contact>>("GET", "/contacts", { query: params }),
    iterate: (params: Omit<ListContactsParams, "starting_after"> = {}) =>
      paginate<Contact>((after) => this.http.request<List<Contact>>("GET", "/contacts", { query: { limit: 100, ...params, starting_after: after } })),
    /** By id (con_...) or email. */
    get: (idOrEmail: string) => this.http.request<Contact>("GET", `/contacts/${enc(idOrEmail)}`),
    update: (idOrEmail: string, body: UpdateContactParams) => this.http.request<Contact>("PATCH", `/contacts/${enc(idOrEmail)}`, { body }),
    delete: (idOrEmail: string) => this.http.request<void>("DELETE", `/contacts/${enc(idOrEmail)}`),
    /** CSV import (asynchronous, 202): `consent: true` is required. Follow it with `getImport`. */
    import: (body: CreateContactImportRequest, opts?: RequestOptions) => this.http.request<ContactImport>("POST", "/contacts/import", { body, ...opts }),
    getImport: (id: string) => this.http.request<ContactImport>("GET", `/contacts/imports/${enc(id)}`),
    /** How many contacts match an audience (all, subscribed, suppressed). */
    count: (audience: Audience, opts?: RequestOptions) => this.http.request<AudienceCount>("POST", "/contacts/count", { body: { audience }, ...opts }),
  };

  /** Subscription topics: the preferences page of the marketing footer and campaign audiences. */
  readonly topics = {
    list: () => this.http.request<List<Topic>>("GET", "/topics"),
    create: (body: { key: string; name: string; description?: string; default?: "opt_in" | "opt_out"; visible?: boolean }, opts?: RequestOptions) =>
      this.http.request<Topic>("POST", "/topics", { body, ...opts }),
    update: (idOrKey: string, body: { name?: string; description?: string | null; default?: "opt_in" | "opt_out"; visible?: boolean }) =>
      this.http.request<Topic>("PATCH", `/topics/${enc(idOrKey)}`, { body }),
    delete: (idOrKey: string) => this.http.request<void>("DELETE", `/topics/${enc(idOrKey)}`),
  };

  readonly campaigns = {
    /** Creates a draft. */
    create: (body: CreateCampaignRequest, opts?: RequestOptions) => this.http.request<Campaign>("POST", "/campaigns", { body, ...opts }),
    list: (params: ListCampaignsParams = {}) => this.http.request<List<Campaign>>("GET", "/campaigns", { query: params }),
    get: (id: string) => this.http.request<Campaign>("GET", `/campaigns/${enc(id)}`),
    update: (id: string, body: Partial<UpdateCampaignRequest>) => this.http.request<Campaign>("PATCH", `/campaigns/${enc(id)}`, { body }),
    delete: (id: string) => this.http.request<void>("DELETE", `/campaigns/${enc(id)}`),
    /** Real count, never-emailed share and the AI review, before sending. */
    preflight: (id: string, opts?: RequestOptions) => this.http.request<CampaignPreflight>("POST", `/campaigns/${enc(id)}/preflight`, opts),
    send: (id: string, opts?: RequestOptions) => this.http.request<Campaign>("POST", `/campaigns/${enc(id)}/send`, opts),
    schedule: (id: string, scheduledAt: string | Date, opts?: RequestOptions) =>
      this.http.request<Campaign>("POST", `/campaigns/${enc(id)}/schedule`, {
        body: { scheduled_at: scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt },
        ...opts,
      }),
    pause: (id: string, opts?: RequestOptions) => this.http.request<Campaign>("POST", `/campaigns/${enc(id)}/pause`, opts),
    resume: (id: string, opts?: RequestOptions) => this.http.request<Campaign>("POST", `/campaigns/${enc(id)}/resume`, opts),
    cancel: (id: string, opts?: RequestOptions) => this.http.request<Campaign>("POST", `/campaigns/${enc(id)}/cancel`, opts),
    /** Test send to addresses of people in your account. */
    test: (id: string, to?: string[], opts?: RequestOptions) =>
      this.http.request<TestCampaignResponse>("POST", `/campaigns/${enc(id)}/test`, { body: to ? { to } : {}, ...opts }),
    stats: (id: string) => this.http.request<CampaignStats>("GET", `/campaigns/${enc(id)}/stats`),
  };

  readonly templates = {
    list: () => this.http.request<List<Template>>("GET", "/templates"),
    create: (body: CreateTemplateRequest, opts?: RequestOptions) => this.http.request<Template>("POST", "/templates", { body, ...opts }),
    /** By id (tpl_...) or by name. */
    get: (idOrName: string) => this.http.request<Template>("GET", `/templates/${enc(idOrName)}`),
    /** Content changes create a new version. */
    update: (idOrName: string, body: UpdateTemplateRequest) => this.http.request<Template>("PATCH", `/templates/${enc(idOrName)}`, { body }),
    delete: (idOrName: string) => this.http.request<void>("DELETE", `/templates/${enc(idOrName)}`),
    versions: (idOrName: string) => this.http.request<List<TemplateVersion>>("GET", `/templates/${enc(idOrName)}/versions`),
    preview: (idOrName: string, body: { variables?: Record<string, unknown>; version?: number } = {}, opts?: RequestOptions) =>
      this.http.request<PreviewTemplateResponse>("POST", `/templates/${enc(idOrName)}/preview`, { body: { variables: {}, ...body }, ...opts }),
  };
}

export default Couryo;
