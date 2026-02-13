import test from "node:test";
import assert from "node:assert/strict";
import { buildTelegramInboundEvent } from "./telegram.js";
import { resetConfigForTests } from "../config.js";

function withEnv(temp: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(temp)) {
    original[key] = process.env[key];
    const next = temp[key];
    if (next == null) delete process.env[key];
    else process.env[key] = next;
  }
  resetConfigForTests();
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(temp)) {
      const prev = original[key];
      if (prev == null) delete process.env[key];
      else process.env[key] = prev;
    }
    resetConfigForTests();
  });
}

test("buildTelegramInboundEvent normalizes a text update", async () => {
  await withEnv(
    {
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "test_bot_token",
      TELEGRAM_WEBHOOK_SECRET_TOKEN: "test_secret",
    },
    async () => {
      const event = await buildTelegramInboundEvent({
        signatureValidated: true,
        update: {
          update_id: 123,
          message: {
            message_id: 7,
            date: 1710000000,
            from: { id: 42 },
            chat: { id: 42, type: "private" },
            text: "budget $120",
          },
        },
      });
      assert.ok(event);
      assert.equal(event?.channel, "telegram");
      assert.equal(event?.channelUserId, "42");
      assert.equal(event?.channelConversationId, "42");
      assert.equal(event?.text, "budget $120");
      assert.equal(Array.isArray(event?.media), true);
    }
  );
});

