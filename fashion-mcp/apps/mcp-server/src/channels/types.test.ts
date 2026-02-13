import test from "node:test";
import assert from "node:assert/strict";
import { parseChannelInboundEvent, parseChannelOutboundMessage } from "./types.js";

test("parseChannelInboundEvent validates canonical envelope", () => {
  const parsed = parseChannelInboundEvent({
    eventId: "evt_1",
    channel: "chatgpt",
    channelUserId: "u1",
    channelConversationId: "c1",
    receivedAt: new Date().toISOString(),
    text: "hello",
    media: [],
    metadata: {},
    signatureValidated: true,
  });

  assert.equal(parsed.channel, "chatgpt");
});

test("parseChannelOutboundMessage validates message parts", () => {
  const parsed = parseChannelOutboundMessage({
    messageId: "msg_1",
    correlationId: "corr_1",
    channel: "telegram",
    channelConversationId: "thread_1",
    recipientId: "recipient_1",
    idempotencyKey: "idempotency_1234",
    parts: [
      { type: "text", text: "hi" },
      { type: "link", url: "https://example.com/approve/abc" },
    ],
    metadata: {},
  });

  assert.equal(parsed.parts.length, 2);
});
