import test from "node:test";
import assert from "node:assert/strict";
import { processChannelSenderBatch } from "./senderWorker.js";

test("processChannelSenderBatch marks sent messages", async () => {
  const claimed: any[] = [
    {
      id: "msg_1",
      direction: "outbound",
      channel: "telegram",
      user_id: null,
      channel_user_id: "u1",
      channel_conversation_id: "c1",
      provider_message_id: null,
      correlation_id: "corr",
      idempotency_key: "idk_1",
      payload: {},
      status: "processing",
      attempt_count: 0,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const sent: string[] = [];
  const failed: string[] = [];

  const result = await processChannelSenderBatch(
    {
      channel: "telegram",
      sender: {
        send: async () => ({ providerMessageId: "p1", responseCode: 200, responseBody: "ok" }),
      },
      maxBatchSize: 5,
      maxAttempts: 2,
    },
    {
      claimNextOutboundChannelMessage: async () => claimed.shift() ?? null,
      markChannelMessageSent: async ({ channelMessageId }) => {
        sent.push(channelMessageId);
      },
      markChannelMessageFailed: async ({ channelMessageId }) => {
        failed.push(channelMessageId);
        return { deadLettered: false };
      },
    }
  );

  assert.deepEqual(result, { processed: 1, sent: 1, failed: 0, deadLettered: 0 });
  assert.deepEqual(sent, ["msg_1"]);
  assert.deepEqual(failed, []);
});

test("processChannelSenderBatch dead-letters after max attempts", async () => {
  const claimed: any[] = [
    {
      id: "msg_2",
      direction: "outbound",
      channel: "whatsapp",
      user_id: null,
      channel_user_id: "u2",
      channel_conversation_id: "c2",
      provider_message_id: null,
      correlation_id: "corr",
      idempotency_key: "idk_2",
      payload: {},
      status: "processing",
      attempt_count: 0,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const result = await processChannelSenderBatch(
    {
      channel: "whatsapp",
      sender: {
        send: async () => {
          throw new Error("provider down");
        },
      },
      maxBatchSize: 2,
      maxAttempts: 1,
    },
    {
      claimNextOutboundChannelMessage: async () => claimed.shift() ?? null,
      markChannelMessageSent: async () => {},
      markChannelMessageFailed: async () => ({ deadLettered: true }),
    }
  );

  assert.deepEqual(result, { processed: 1, sent: 0, failed: 1, deadLettered: 1 });
});

