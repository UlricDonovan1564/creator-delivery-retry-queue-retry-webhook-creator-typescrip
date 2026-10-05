import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { processMessage, verifySignature } from "../src/creator_delivery.ts";

test("verifies the signature over the original webhook bytes", () => {
  const body = Buffer.from('{"kind":"subscriber_update","event_id":"event_6"}');
  const signature = createHmac("sha256", "test-secret").update(body).digest("hex");

  assert.equal(verifySignature(body, signature, "test-secret"), true);
  assert.equal(verifySignature(Buffer.concat([body, Buffer.from(" ")]), signature, "test-secret"), false);
});

test("acknowledges a digital asset only after its grant completes", async () => {
  const order: string[] = [];
  const client = {
    queue: {
      publish: async () => undefined,
      consume: async () => undefined,
      ack: async (messageId: string) => { order.push(`ack:${messageId}`); }
    }
  };

  const result = await processMessage(client, "message_7", {
    kind: "digital_asset_delivery",
    event_id: "event_7",
    order_id: "order_1042",
    asset_id: "course_bundle_7",
    recipient_email: "reader@example.com"
  }, async (action) => { order.push(action); });

  assert.equal(result, "acknowledged");
  assert.deepEqual(order, ["grant:order_1042:course_bundle_7", "ack:message_7"]);
});

test("leaves the message unacknowledged when the delivery action rejects", async () => {
  let acknowledged = false;
  const client = {
    queue: {
      publish: async () => undefined,
      consume: async () => undefined,
      ack: async () => { acknowledged = true; }
    }
  };

  await assert.rejects(() => processMessage(client, "message_8", {
    kind: "content_processing",
    event_id: "event_8",
    content_id: "lesson_3",
    operation: "index"
  }, async () => { throw new Error("processor rejected the job"); }));

  assert.equal(acknowledged, false);
});
