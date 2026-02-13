-- Align idempotency uniqueness to support ON CONFLICT(channel, idempotency_key).

DROP INDEX IF EXISTS idx_channel_messages_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_messages_idempotency
  ON channel_messages(channel, idempotency_key);
