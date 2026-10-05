import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { clientFromEnvironment, InfraiClient } from "./infrai.ts";

export const creatorEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("digital_asset_delivery"),
    event_id: z.string().min(1),
    order_id: z.string().min(1),
    asset_id: z.string().min(1),
    recipient_email: z.string().email()
  }),
  z.object({
    kind: z.literal("subscriber_update"),
    event_id: z.string().min(1),
    subscriber_id: z.string().min(1),
    status: z.enum(["active", "paused", "cancelled"])
  }),
  z.object({
    kind: z.literal("content_processing"),
    event_id: z.string().min(1),
    content_id: z.string().min(1),
    operation: z.enum(["transcode", "thumbnail", "index"])
  })
]);

export type CreatorEvent = z.infer<typeof creatorEventSchema>;

export function deliveryAction(event: CreatorEvent): string {
  switch (event.kind) {
    case "digital_asset_delivery": return `grant:${event.order_id}:${event.asset_id}`;
    case "subscriber_update": return `subscriber:${event.subscriber_id}:${event.status}`;
    case "content_processing": return `process:${event.content_id}:${event.operation}`;
  }
}

export function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export async function publishCreatorEvent(client: InfraiClient, input: unknown): Promise<string> {
  const event = creatorEventSchema.parse(input);
  await client.queue.publish(event, event.event_id);
  return deliveryAction(event);
}

export async function processMessage(
  client: Pick<InfraiClient, "queue">,
  messageId: string,
  input: unknown,
  apply: (action: string) => Promise<void>
): Promise<"acknowledged"> {
  const event = creatorEventSchema.parse(input);
  await apply(deliveryAction(event));
  await client.queue.ack(messageId);
  return "acknowledged";
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export function startReceiver(client: InfraiClient, secret: string, port: number): void {
  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/webhooks/creator-events") {
      reply(response, 404, { accepted: false });
      return;
    }
    const rawBody = await readBody(request);
    const signature = request.headers["x-infrai-signature"];
    if (typeof signature !== "string" || !verifySignature(rawBody, signature, secret)) {
      reply(response, 401, { accepted: false });
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody.toString("utf8"));
    } catch {
      reply(response, 400, { accepted: false });
      return;
    }
    const result = creatorEventSchema.safeParse(parsedJson);
    if (!result.success) {
      reply(response, 400, { accepted: false, issues: result.error.issues });
      return;
    }
    const action = await publishCreatorEvent(client, result.data);
    reply(response, 202, { accepted: true, action });
  }).listen(port, () => console.log(`Creator webhook receiver listening on port ${port}`));
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "demo";
  const client = clientFromEnvironment();

  if (command === "serve") {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) throw new Error("Set WEBHOOK_SECRET before starting the receiver");
    startReceiver(client, secret, Number(process.env.PORT ?? "3000"));
    return;
  }
  if (command === "register") {
    const url = process.env.PUBLIC_WEBHOOK_URL;
    const secret = process.env.WEBHOOK_SECRET;
    const events = process.env.WEBHOOK_EVENTS?.split(",").map((event) => event.trim()).filter(Boolean);
    if (!url || !secret || !events?.length) throw new Error("Set PUBLIC_WEBHOOK_URL, WEBHOOK_SECRET, and WEBHOOK_EVENTS");
    console.log(await client.account.webhooks.register(url, events, secret, randomUUID()));
    return;
  }
  if (command === "history") {
    const webhookId = process.env.WEBHOOK_ID;
    if (!webhookId) throw new Error("Set WEBHOOK_ID to read delivery history");
    console.log(await client.account.webhooks.deliveries(webhookId));
    return;
  }
  if (command === "worker") {
    const messages = await client.queue.consume(10, 60);
    for (const message of messages) {
      await processMessage(client, message.message_id, message.payload, async (action) => {
        console.log({ applied: action });
      });
    }
    console.log({ processed: messages.length });
    return;
  }

  const action = await publishCreatorEvent(client, {
    kind: "digital_asset_delivery",
    event_id: randomUUID(),
    order_id: "order_1042",
    asset_id: "course_bundle_7",
    recipient_email: "reader@example.com"
  });
  console.log({ queued: true, action });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
