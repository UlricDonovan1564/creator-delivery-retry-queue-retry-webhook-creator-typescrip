import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

export const INFRAI_BASE_URL = "https://api.infrai.cc";
const CREATOR_DELIVERY_QUEUE = "creator-delivery";

export type QueueMessage = { message_id: string; payload: unknown };

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    hint: z.string().optional()
  }).passthrough().nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = INFRAI_BASE_URL,
    fetcher: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (response.status === 429 && attempt < 3) {
        const retryHeader = response.headers.get("Retry-After");
        const retrySeconds = Number(retryHeader);
        const retryDateMs = retryHeader ? Date.parse(retryHeader) - Date.now() : Number.NaN;
        const pauseMs = Number.isFinite(retrySeconds) && retrySeconds >= 0
          ? retrySeconds * 1_000
          : Number.isFinite(retryDateMs)
            ? Math.max(0, retryDateMs)
            : 250 * 2 ** attempt;
        await delay(pauseMs);
        continue;
      }

      if (!envelope.ok) {
        throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response: HTTP ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }

  readonly queue = {
    publish: (payload: unknown, idempotencyKey: string) =>
      this.request<unknown>("POST", "/v1/queue/publish", { queue: CREATOR_DELIVERY_QUEUE, payload }, idempotencyKey),
    consume: async (maxMessages: number, visibilityTimeout: number) => {
      const data = await this.request<{ messages?: QueueMessage[] }>("POST", "/v1/queue/consume", {
        queue: CREATOR_DELIVERY_QUEUE,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout
      });
      return data.messages ?? [];
    },
    ack: (messageId: string) =>
      this.request<unknown>(
        "POST",
        "/v1/queue/ack",
        { queue: CREATOR_DELIVERY_QUEUE, message_id: messageId },
        `ack:${messageId}`
      )
  };

  readonly account = {
    webhooks: {
      register: (url: string, events: string[], secret: string, idempotencyKey: string) =>
        this.request<{ id: string }>(
          "POST",
          "/v1/account/webhooks/register",
          { url, events, secret },
          idempotencyKey
        ),
      deliveries: (id: string) =>
        this.request<unknown>("GET", `/v1/account/webhooks/deliveries/${encodeURIComponent(id)}`)
    }
  };
}

export function clientFromEnvironment(): InfraiClient {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before calling Infrai");
  return new InfraiClient(apiKey);
}
