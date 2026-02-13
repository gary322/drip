import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, getPool } from "../db/pool.js";
import { ensureUser } from "../db/repos/profileRepo.js";
import {
  upsertChannelIdentity,
  getChannelIdentityByExternal,
  createChannelLinkToken,
  consumeChannelLinkToken,
  enqueueOutboundChannelMessage,
  claimNextOutboundChannelMessage,
  markChannelMessageFailed,
  markChannelMessageSent,
  recordInboundChannelMessage,
} from "../db/repos/channelRepo.js";

async function canConnect(): Promise<boolean> {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("channel identity + link token flow", async (t) => {
  if (!(await canConnect())) {
    t.skip("database not reachable for integration test");
    return;
  }

  const runId = randomUUID().replaceAll("-", "");
  const userId = `channel_user_${runId}`;
  await ensureUser(userId);

  const identity = await upsertChannelIdentity({
    userId,
    channel: "telegram",
    channelUserId: `tg_${runId}`,
    channelConversationId: `chat_${runId}`,
    metadata: { source: "integration" },
  });
  assert.equal(identity.user_id, userId);

  const fetched = await getChannelIdentityByExternal({
    channel: "telegram",
    channelUserId: `tg_${runId}`,
  });
  assert.ok(fetched);
  assert.equal(fetched?.channel_conversation_id, `chat_${runId}`);

  const token = await createChannelLinkToken({
    channel: "telegram",
    channelUserId: `tg_${runId}`,
    channelConversationId: `chat_${runId}`,
  });
  assert.ok(token.token.length > 16);

  const consumed = await consumeChannelLinkToken({ token: token.token });
  assert.ok(consumed);
  assert.equal(consumed?.channel, "telegram");

  const consumedAgain = await consumeChannelLinkToken({ token: token.token });
  assert.equal(consumedAgain, null);
});

test("channel outbound queue flow with retries and dead-letter", async (t) => {
  if (!(await canConnect())) {
    t.skip("database not reachable for integration test");
    return;
  }

  const runId = randomUUID().replaceAll("-", "");
  const userId = `channel_user_${runId}`;
  await ensureUser(userId);

  const inbound = await recordInboundChannelMessage({
    channel: "whatsapp",
    channelUserId: `wa_${runId}`,
    channelConversationId: `thread_${runId}`,
    userId,
    correlationId: `corr_${runId}`,
    payload: { text: "hello" },
  });
  assert.equal(inbound.direction, "inbound");

  const queued = await enqueueOutboundChannelMessage({
    channel: "whatsapp",
    channelUserId: `wa_${runId}`,
    channelConversationId: `thread_${runId}`,
    userId,
    correlationId: `corr_${runId}`,
    idempotencyKey: `idk_${runId}`,
    payload: { parts: [{ type: "text", text: "hi" }] },
  });
  assert.equal(queued.status, "queued");

  const claimed = await claimNextOutboundChannelMessage({ channel: "whatsapp" });
  assert.ok(claimed);
  assert.equal(claimed?.id, queued.id);
  assert.equal(claimed?.status, "processing");

  await markChannelMessageSent({
    channelMessageId: queued.id,
    providerMessageId: `provider_${runId}`,
    responseCode: 200,
    responseBody: "ok",
  });

  const pool = getPool();
  const sentRow = await pool.query(
    "SELECT status, provider_message_id, attempt_count FROM channel_messages WHERE id=$1",
    [queued.id]
  );
  assert.equal(sentRow.rows[0].status, "sent");
  assert.equal(sentRow.rows[0].provider_message_id, `provider_${runId}`);
  assert.equal(Number(sentRow.rows[0].attempt_count), 1);

  const queued2 = await enqueueOutboundChannelMessage({
    channel: "whatsapp",
    channelUserId: `wa_${runId}`,
    channelConversationId: `thread_${runId}`,
    userId,
    correlationId: `corr2_${runId}`,
    idempotencyKey: `idk2_${runId}`,
    payload: { parts: [{ type: "text", text: "retry me" }] },
  });

  const fail1 = await markChannelMessageFailed({
    channelMessageId: queued2.id,
    error: "provider timeout",
    maxAttempts: 2,
  });
  assert.equal(fail1.deadLettered, false);

  const fail2 = await markChannelMessageFailed({
    channelMessageId: queued2.id,
    error: "provider timeout again",
    maxAttempts: 2,
  });
  assert.equal(fail2.deadLettered, true);

  const deadLetter = await pool.query(
    "SELECT COUNT(*)::int AS count FROM dead_letter_events WHERE reference_id=$1",
    [queued2.id]
  );
  assert.equal(deadLetter.rows[0].count, 1);
});

after(async () => {
  await closePool();
});
