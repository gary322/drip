import test from "node:test";
import assert from "node:assert/strict";
import { routeChannelEvent } from "./router.js";
import type { ChannelInboundEvent } from "./types.js";

function makeEvent(overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent {
  return {
    eventId: "evt_router_1",
    channel: "whatsapp",
    channelUserId: "wa_user_1",
    channelConversationId: "wa_chat_1",
    receivedAt: new Date().toISOString(),
    text: "show outfits",
    media: [],
    metadata: {},
    signatureValidated: true,
    ...overrides,
  };
}

test("routeChannelEvent maps outfit request to planning tool", () => {
  const decision = routeChannelEvent(makeEvent({ text: "show me outfits" }));
  assert.equal(decision.intent.kind, "show_outfits");
  assert.equal(decision.commands.length, 1);
  assert.equal(decision.commands[0].toolName, "plan.generateOutfits");
});

test("routeChannelEvent emits hint when checkout has no selected item ids", () => {
  const decision = routeChannelEvent(makeEvent({ text: "checkout now" }));
  assert.equal(decision.intent.kind, "checkout");
  assert.equal(decision.commands.length, 0);
  assert.match(decision.responseHint ?? "", /choose one or more item ids/i);
});

test("routeChannelEvent maps checkout to approval link when selected ids are present", () => {
  const decision = routeChannelEvent(
    makeEvent({
      text: "checkout",
      metadata: { selectedItemIds: ["prod_001", "prod_003"] },
    })
  );
  assert.equal(decision.intent.kind, "checkout");
  assert.equal(decision.commands.length, 1);
  assert.equal(decision.commands[0].toolName, "checkout.createApprovalLink");
  assert.deepEqual(decision.commands[0].arguments.itemIds, ["prod_001", "prod_003"]);
});
