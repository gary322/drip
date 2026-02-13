import { randomUUID } from "node:crypto";
import type { ChannelType } from "@fashion/shared";
import { getPool } from "../pool.js";

export type ChannelIdentityRow = {
  id: string;
  user_id: string | null;
  channel: ChannelType;
  channel_user_id: string;
  channel_conversation_id: string;
  status: "active" | "blocked" | "unlinked";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChannelMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  channel: ChannelType;
  user_id: string | null;
  channel_user_id: string;
  channel_conversation_id: string;
  provider_message_id: string | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  status:
    | "received"
    | "queued"
    | "processing"
    | "processed"
    | "sent"
    | "failed"
    | "dead_lettered";
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export async function upsertChannelIdentity(input: {
  userId?: string;
  channel: ChannelType;
  channelUserId: string;
  channelConversationId: string;
  status?: "active" | "blocked" | "unlinked";
  metadata?: Record<string, unknown>;
}): Promise<ChannelIdentityRow> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO channel_identities(
      user_id, channel, channel_user_id, channel_conversation_id, status, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (channel, channel_user_id)
    DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, channel_identities.user_id),
      channel_conversation_id = EXCLUDED.channel_conversation_id,
      status = EXCLUDED.status,
      metadata = channel_identities.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING *`,
    [
      input.userId ?? null,
      input.channel,
      input.channelUserId,
      input.channelConversationId,
      input.status ?? "active",
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return rows[0] as ChannelIdentityRow;
}

export async function getChannelIdentityByExternal(input: {
  channel: ChannelType;
  channelUserId: string;
}): Promise<ChannelIdentityRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT *
       FROM channel_identities
      WHERE channel=$1 AND channel_user_id=$2
      LIMIT 1`,
    [input.channel, input.channelUserId]
  );
  return (rows[0] as ChannelIdentityRow | undefined) ?? null;
}

export async function createChannelLinkToken(input: {
  channel: ChannelType;
  channelUserId: string;
  channelConversationId: string;
  ttlMinutes?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ token: string; expiresAt: string }> {
  const pool = getPool();
  const token = randomUUID().replaceAll("-", "");
  const ttlMinutes = input.ttlMinutes ?? 15;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  await pool.query(
    `INSERT INTO channel_link_tokens(
      token, channel, channel_user_id, channel_conversation_id, metadata, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      token,
      input.channel,
      input.channelUserId,
      input.channelConversationId,
      JSON.stringify(input.metadata ?? {}),
      expiresAt,
    ]
  );

  return { token, expiresAt };
}

export async function consumeChannelLinkToken(input: {
  token: string;
}): Promise<{
  channel: ChannelType;
  channelUserId: string;
  channelConversationId: string;
  metadata: Record<string, unknown>;
} | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT *
         FROM channel_link_tokens
        WHERE token=$1
          AND used_at IS NULL
          AND expires_at > now()
        FOR UPDATE`,
      [input.token]
    );
    const row = rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query("UPDATE channel_link_tokens SET used_at=now() WHERE token=$1", [input.token]);
    await client.query("COMMIT");

    return {
      channel: row.channel as ChannelType,
      channelUserId: row.channel_user_id as string,
      channelConversationId: row.channel_conversation_id as string,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordInboundChannelMessage(input: {
  channel: ChannelType;
  channelUserId: string;
  channelConversationId: string;
  providerMessageId?: string;
  userId?: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}): Promise<ChannelMessageRow> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO channel_messages(
      direction, channel, user_id, channel_user_id, channel_conversation_id,
      provider_message_id, correlation_id, payload, status
    ) VALUES ('inbound', $1, $2, $3, $4, $5, $6, $7, 'received')
    ON CONFLICT (channel, direction, provider_message_id)
    DO UPDATE SET updated_at = channel_messages.updated_at
    RETURNING *`,
    [
      input.channel,
      input.userId ?? null,
      input.channelUserId,
      input.channelConversationId,
      input.providerMessageId ?? null,
      input.correlationId ?? null,
      JSON.stringify(input.payload),
    ]
  );
  return rows[0] as ChannelMessageRow;
}

export async function markInboundChannelMessageProcessed(input: {
  channelMessageId: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE channel_messages
        SET status='processed', updated_at=now()
      WHERE id=$1 AND direction='inbound' AND status IN ('received','processing')`,
    [input.channelMessageId]
  );
}

export async function enqueueOutboundChannelMessage(input: {
  channel: ChannelType;
  channelUserId: string;
  channelConversationId: string;
  userId?: string;
  correlationId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): Promise<ChannelMessageRow> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO channel_messages(
      direction, channel, user_id, channel_user_id, channel_conversation_id,
      correlation_id, idempotency_key, payload, status
    ) VALUES ('outbound', $1, $2, $3, $4, $5, $6, $7, 'queued')
    ON CONFLICT (channel, idempotency_key)
    DO UPDATE SET payload=EXCLUDED.payload
    RETURNING *`,
    [
      input.channel,
      input.userId ?? null,
      input.channelUserId,
      input.channelConversationId,
      input.correlationId,
      input.idempotencyKey,
      JSON.stringify(input.payload),
    ]
  );
  return rows[0] as ChannelMessageRow;
}

export async function claimNextOutboundChannelMessage(input?: {
  channel?: ChannelType;
}): Promise<ChannelMessageRow | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const values: unknown[] = [];
    let whereClause = "direction='outbound' AND status='queued'";
    if (input?.channel) {
      values.push(input.channel);
      whereClause += ` AND channel=$${values.length}`;
    }

    const selectQuery = `SELECT id
      FROM channel_messages
      WHERE ${whereClause}
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`;
    const selected = await client.query(selectQuery, values);

    const messageId = selected.rows[0]?.id as string | undefined;
    if (!messageId) {
      await client.query("ROLLBACK");
      return null;
    }

    const updated = await client.query(
      `UPDATE channel_messages
          SET status='processing',
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [messageId]
    );

    await client.query("COMMIT");
    return updated.rows[0] as ChannelMessageRow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markChannelMessageSent(input: {
  channelMessageId: string;
  providerMessageId?: string;
  responseBody?: string;
  responseCode?: number;
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT attempt_count
         FROM channel_messages
        WHERE id=$1
        FOR UPDATE`,
      [input.channelMessageId]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return;
    }
    const nextAttempt = Number(current.rows[0].attempt_count ?? 0) + 1;

    await client.query(
      `UPDATE channel_messages
          SET status='sent',
              provider_message_id=COALESCE($2, provider_message_id),
              attempt_count=$3,
              updated_at=now(),
              last_error=NULL
        WHERE id=$1`,
      [input.channelMessageId, input.providerMessageId ?? null, nextAttempt]
    );

    await client.query(
      `INSERT INTO channel_delivery_attempts(
        channel_message_id, attempt_no, status, response_code, response_body
      ) VALUES ($1, $2, 'sent', $3, $4)`,
      [
        input.channelMessageId,
        nextAttempt,
        input.responseCode ?? null,
        input.responseBody ?? null,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markChannelMessageFailed(input: {
  channelMessageId: string;
  error: string;
  responseBody?: string;
  responseCode?: number;
  maxAttempts?: number;
}): Promise<{ deadLettered: boolean }> {
  const pool = getPool();
  const maxAttempts = input.maxAttempts ?? 8;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT attempt_count, channel, payload
         FROM channel_messages
        WHERE id=$1
        FOR UPDATE`,
      [input.channelMessageId]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { deadLettered: false };
    }

    const nextAttempt = Number(row.attempt_count ?? 0) + 1;
    const deadLettered = nextAttempt >= maxAttempts;

    await client.query(
      `UPDATE channel_messages
          SET status=$2,
              attempt_count=$3,
              last_error=$4,
              updated_at=now()
        WHERE id=$1`,
      [
        input.channelMessageId,
        deadLettered ? "dead_lettered" : "failed",
        nextAttempt,
        input.error.slice(0, 500),
      ]
    );

    await client.query(
      `INSERT INTO channel_delivery_attempts(
        channel_message_id, attempt_no, status, response_code, response_body
      ) VALUES ($1, $2, 'failed', $3, $4)`,
      [
        input.channelMessageId,
        nextAttempt,
        input.responseCode ?? null,
        input.responseBody ?? null,
      ]
    );

    if (deadLettered) {
      await client.query(
        `INSERT INTO dead_letter_events(channel, source, reference_id, payload, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.channel,
          "channel_sender",
          input.channelMessageId,
          JSON.stringify(row.payload ?? {}),
          input.error.slice(0, 500),
        ]
      );
    }

    await client.query("COMMIT");
    return { deadLettered };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
