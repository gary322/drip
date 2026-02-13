import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramSender } from "./telegramSender.js";
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

test("createTelegramSender sends a text message payload", async () => {
  await withEnv(
    {
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      TELEGRAM_BOT_TOKEN: "tg_token",
      TELEGRAM_API_BASE_URL: "https://api.telegram.org",
    },
    async () => {
      let seenUrl: string | null = null;
      let seenBody: any = null;

      const stubFetch = (async (input: any, init?: any) => {
        seenUrl = typeof input === "string" ? input : input?.url ?? null;
        seenBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as any;

      const sender = createTelegramSender({ fetchFn: stubFetch });
      const result = await sender.send({
        id: "row1",
        direction: "outbound",
        channel: "telegram",
        user_id: null,
        channel_user_id: "42",
        channel_conversation_id: "42",
        provider_message_id: null,
        correlation_id: "corr",
        idempotency_key: "idk",
        payload: {
          messageId: "m1",
          correlationId: "corr",
          channel: "telegram",
          channelConversationId: "42",
          recipientId: "42",
          parts: [{ type: "text", text: "hi" }],
          idempotencyKey: "idk_hi_123",
          metadata: {},
        },
        status: "queued",
        attempt_count: 0,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      assert.ok((seenUrl ?? "").includes("/bottg_token/sendMessage"));
      assert.equal(seenBody?.chat_id, "42");
      assert.equal(seenBody?.text, "hi");
      assert.equal(result.providerMessageId, "99");
    }
  );
});
