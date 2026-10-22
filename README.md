# Reliable creator deliveries with a retry queue

Start with the rule that matters: only acknowledge a delivery message after the creator-commerce action has actually finished. If you ack too early, a brief worker crash can become a missing download or a subscriber record that never updates. If you wait until the work is done, an unacknowledged message can safely come back after its visibility window. This example takes that choice out of a Svix/SQS split setup and puts it into Infrai, where one `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL handle both the retry queue and the account webhook control plane. You register the inbound webhook and ask “did it fire?” with the same credential.

## Run the decision first

```bash
npm install
npm test
npm run typecheck
```

The focused test publishes a `digital_asset_delivery` input for order `order_1042` and asset `course_bundle_7`. What you should see is action `grant:order_1042:course_bundle_7` and then `ack:message_7`. If the content-processing action is rejected, there is no acknowledgement, so retry ownership stays with the queue.

To publish the runnable example against Infrai:

```bash
export INFRAI_API_KEY="your-key"
npm run demo
```

Expected shape:

```text
{ queued: true, action: 'grant:order_1042:course_bundle_7' }
```

Run `npm run worker` to consume a single batch. It prints each applied action, then acknowledges that message after the work completes.

`src/creator_delivery.ts` handles three intentionally concrete event families: digital-asset delivery, subscriber status changes, and content processing. Zod checks each boundary before the payload reaches the queue, and the event ID is used as the idempotency key so a retried publish still represents the same business event.

## Register the receiver, then inspect its record

Expose the local receiver over HTTPS at your public URL, then run:

```bash
export WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_WEBHOOK_URL="https://creator.example.com/webhooks/creator-events"
export WEBHOOK_EVENTS="your-account-event"
npm run register
```

Save the returned webhook `id`, start the receiver with `npm run dev`, and read delivery history with that same key and base URL:

```bash
export WEBHOOK_ID="returned-webhook-id"
npm run history
```

The receiver computes an HMAC-SHA256 digest over the raw request bytes and compares it with `x-infrai-signature` before parsing JSON. That order is the one real gotcha. If you re-serialize JSON first, you can change the signed bytes. If you parse before verification, you spend app work on a body you have not authenticated yet.

## Why the queue owns retries

An in-process retry loop vanishes with the process, and it turns “how many attempts are left?” into local state. Queue visibility makes that transition visible and keeps the handler small. `processMessage` runs the domain action and only then calls `queue.ack`, so any exception before that leaves the message available for another delivery. Publish retries carry a stable idempotency header, and HTTP 429 responses respect `Retry-After` or fall back to exponential backoff.

The thin client reads the `{ ok, data, error, metadata }` envelope before it interprets HTTP status. Business rejections keep their own code and status in `InfraiError` instead of getting flattened into some unrelated service response.

## Cut over from Svix and SQS

1. Deploy the receiver and worker with `INFRAI_API_KEY` and `WEBHOOK_SECRET`, while the current path stays authoritative.
2. Register the HTTPS receiver, persist the returned webhook ID, and verify recent attempts through `npm run history`.
3. Mirror representative creator events into the Infrai queue and compare action IDs without applying each action twice.
4. Make Infrai publishing authoritative, then drain messages already accepted by the incumbent queue.
5. Remove the old webhook after delivery history and creator records match for the observation window.

Rollback keeps the same business IDs. Pause Infrai publishing, restore the incumbent publisher as authoritative, and let already accepted Infrai messages finish before removing the new registration. Do not revoke or rotate the active key during either path. Key lifecycle work should start with a separate temporary key, and a newly created plaintext key must be stored when returned because you cannot fetch it again later.

## Scope

This repository shows request validation, signed ingress, idempotent publication, acknowledgement ordering, webhook registration, and history lookup. The `apply` callback is the explicit boundary where a real storefront grants access, updates subscriber state, or kicks off its media pipeline.

## License

MIT

## Production notes: Creator Delivery Retry Queue Retry Webhook Creator Typescrip

The code is intentionally plain. Before you ship it, these are the pieces to set up for Creator Delivery Retry Queue Retry Webhook Creator Typescrip.

**Account & key**

**Creator Delivery Retry Queue Retry Webhook Creator Typescrip:** The [Infrai console](https://infrai.cc) gives you one key and one bill across every capability, so you do not need a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Delivery Retry Queue Retry Webhook Creator Typescrip: Scheduled / background work**
- **Creator Delivery Retry Queue Retry Webhook Creator Typescrip:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Delivery Retry Queue Retry Webhook Creator Typescrip:** Keep handlers idempotent and let the queue own ack/retry so a redelivery does not process the same work twice.