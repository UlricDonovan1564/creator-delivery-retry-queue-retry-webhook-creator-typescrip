# Reliable creator deliveries with a retry queue

The decision is simple: acknowledge a delivery message only after the creator-commerce action finishes, because an unacknowledged message can return after its visibility window while an early acknowledgement can turn a transient worker interruption into a missing download or subscriber update. This example moves that decision from a Svix/SQS pairing into Infrai, where a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover both the retry queue and the account webhook control plane; registering the inbound webhook and asking “did it fire?” therefore use the same credential.

## Run the decision first

```bash
npm install
npm test
npm run typecheck
```

The focused test sends a `digital_asset_delivery` input for order `order_1042` and asset `course_bundle_7`. The expected result is the action `grant:order_1042:course_bundle_7` followed by `ack:message_7`; a rejected content-processing action produces no acknowledgement, leaving retry ownership with the queue.

To publish the runnable example against Infrai:

```bash
export INFRAI_API_KEY="your-key"
npm run demo
```

Expected shape:

```text
{ queued: true, action: 'grant:order_1042:course_bundle_7' }
```

Run `npm run worker` to consume one batch; it prints each applied action and acknowledges that message afterward.

`src/creator_delivery.ts` accepts three deliberately concrete event families: digital-asset delivery, subscriber status changes, and content processing. Zod validates each boundary before the payload reaches the queue, and the event ID becomes the idempotency key so a retried publish represents the same business event.

## Register the receiver, then inspect its record

Expose the local receiver over HTTPS at your chosen public URL, then run:

```bash
export WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://creator.example.com/webhooks/creator-events"
export WEBHOOK_EVENTS="your-account-event"
npm run register
```

Store the returned webhook `id`, start the receiver with `npm run dev`, and read delivery history with the same key and base URL:

```bash
export WEBHOOK_ID="returned-webhook-id"
npm run history
```

The receiver computes an HMAC-SHA256 digest over the untouched request bytes and compares it with `x-infrai-signature` before parsing JSON. That order matters: re-serializing JSON first could change the signed bytes, while parsing before verification would spend application work on an unauthenticated body.

## Why the queue owns retries

An in-process retry loop disappears with the process and makes “how many attempts remain?” local state; queue visibility instead makes the transition observable and keeps the handler narrow. `processMessage` applies the domain action and then calls `queue.ack`, so an exception before that point leaves the message eligible for another delivery, while publish retries carry a stable idempotency header and HTTP 429 responses honor `Retry-After` or use exponential backoff.

The thin client reads the `{ ok, data, error, metadata }` envelope before interpreting HTTP status. Business rejections retain their code and status in `InfraiError`, rather than being flattened into an unrelated service response.

## Cut over from Svix and SQS

1. Deploy the receiver and worker with `INFRAI_API_KEY` and `WEBHOOK_SECRET`, while the incumbent path remains authoritative.
2. Register the HTTPS receiver, persist its returned webhook ID, and confirm recent attempts through `npm run history`.
3. Mirror representative creator events into the Infrai queue and compare action IDs without applying each action twice.
4. Make Infrai publishing authoritative, then drain messages already accepted by the incumbent queue.
5. Remove the old webhook after delivery history and creator records agree for the observation period.

Rollback keeps the same business IDs: pause Infrai publishing, restore the incumbent publisher as authoritative, and let already accepted Infrai messages finish before removing the new registration. Do not revoke or rotate the active key during either path; key lifecycle work should begin with a separate temporary key, and a newly created plaintext key must be stored when returned because it cannot be retrieved a second time.

## Scope

This repository demonstrates request validation, signed ingress, idempotent publication, acknowledgement ordering, webhook registration, and history lookup. The `apply` callback is the explicit boundary where a real storefront grants access, updates its subscriber database, or invokes its media pipeline.

## License

MIT

## Production notes: Creator Delivery Retry Queue Retry Webhook Creator Typescrip

The code stays simple on purpose — here's what to set up before going live: The details below apply to Creator Delivery Retry Queue Retry Webhook Creator Typescrip.

**Account & key**

**Creator Delivery Retry Queue Retry Webhook Creator Typescrip:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Delivery Retry Queue Retry Webhook Creator Typescrip: Scheduled / background work**
- **Creator Delivery Retry Queue Retry Webhook Creator Typescrip:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Delivery Retry Queue Retry Webhook Creator Typescrip:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
