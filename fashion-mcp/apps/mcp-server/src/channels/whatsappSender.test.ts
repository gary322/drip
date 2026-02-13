import test from "node:test";
import assert from "node:assert/strict";
import { createWhatsAppSender } from "./whatsappSender.js";
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

test("createWhatsAppSender sends a text message payload", async () => {
  await withEnv(
    {
      DATABASE_URL: "postgres://fashion:fashion@localhost:5432/fashion",
      WHATSAPP_ACCESS_TOKEN: "wa_token",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_BASE_URL: "https://graph.facebook.com",
      WHATSAPP_API_VERSION: "v19.0",
    },
    async () => {
      let seenUrl: string | null = null;
      let seenBody: any = null;

      const stubFetch = (async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
        if (typeof url !== "string" || !url.includes("/v19.0/123/messages")) {
          throw new Error(`unexpected_url:${String(url)}`);
        }
        seenUrl = url;
        seenBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as any;

      const sender = createWhatsAppSender({ fetchFn: stubFetch });
      const result = await sender.send({
        id: "row1",
        direction: "outbound",
        channel: "whatsapp",
        user_id: null,
        channel_user_id: "+15551234567",
        channel_conversation_id: "+15551234567",
        provider_message_id: null,
        correlation_id: "corr",
        idempotency_key: "idk",
        payload: {
          messageId: "m1",
          correlationId: "corr",
          channel: "whatsapp",
          channelConversationId: "+15551234567",
          recipientId: "+15551234567",
          parts: [{ type: "text", text: "hello" }],
          idempotencyKey: "idk_hello_123",
          metadata: {},
        },
        status: "queued",
        attempt_count: 0,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      assert.ok((seenUrl ?? "").includes("/v19.0/123/messages"));
      assert.equal(seenBody?.type, "text");
      assert.equal(seenBody?.text?.body, "hello");
      assert.equal(result.providerMessageId, "wamid.TEST");
    }
  );
});
