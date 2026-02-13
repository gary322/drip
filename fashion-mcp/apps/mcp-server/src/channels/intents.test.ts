import test from "node:test";
import assert from "node:assert/strict";
import { classifyChannelIntent } from "./intents.js";
import type { ChannelInboundEvent } from "./types.js";

function makeEvent(overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent {
  return {
    eventId: "evt_test_1",
    channel: "telegram",
    channelUserId: "tg_user_1",
    channelConversationId: "tg_chat_1",
    receivedAt: new Date().toISOString(),
    text: "hello",
    media: [],
    metadata: {},
    signatureValidated: true,
    ...overrides,
  };
}

test("classifyChannelIntent identifies budget updates", () => {
  const intent = classifyChannelIntent(
    makeEvent({ text: "set my monthly budget to $250" })
  );
  assert.equal(intent.kind, "set_budget");
  if (intent.kind === "set_budget") {
    assert.equal(intent.monthlyBudget, 250);
  }
});

test("classifyChannelIntent identifies photo upload via media", () => {
  const intent = classifyChannelIntent(
    makeEvent({ media: [{ mediaId: "m1", mimeType: "image/png", remoteUrl: "https://example.com/a.png" }] })
  );
  assert.equal(intent.kind, "upload_photo");
});

test("classifyChannelIntent identifies tryon with item id", () => {
  const intent = classifyChannelIntent(
    makeEvent({ text: "please try on prod_005" })
  );
  assert.equal(intent.kind, "tryon");
  if (intent.kind === "tryon") {
    assert.equal(intent.itemId, "prod_005");
  }
});

test("classifyChannelIntent identifies checkout with item ids", () => {
  const intent = classifyChannelIntent(
    makeEvent({ text: "checkout prod_001 prod_002" })
  );
  assert.equal(intent.kind, "checkout");
  if (intent.kind === "checkout") {
    assert.deepEqual(intent.itemIds, ["prod_001", "prod_002"]);
  }
});
