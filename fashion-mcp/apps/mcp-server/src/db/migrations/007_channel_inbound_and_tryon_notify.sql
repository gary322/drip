-- Channel inbound processing improvements + try-on notification fields.

-- 1) Expand channel_messages.status to include 'processed' for inbound.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
    INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'channel_messages'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%status%IN%received%queued%processing%sent%failed%dead_lettered%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE channel_messages DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'channel_messages'
       AND c.conname = 'channel_messages_status_check'
  ) THEN
    ALTER TABLE channel_messages
      ADD CONSTRAINT channel_messages_status_check
      CHECK (status IN ('received', 'queued', 'processing', 'processed', 'sent', 'failed', 'dead_lettered'));
  END IF;
END $$;

-- 2) Add idempotency for inbound webhook replays.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_messages_provider_message_unique
  ON channel_messages(channel, direction, provider_message_id);

-- 3) Try-on job notification fields so we can message results back to the requesting channel.
ALTER TABLE tryon_jobs
  ADD COLUMN IF NOT EXISTS requested_channel TEXT,
  ADD COLUMN IF NOT EXISTS requested_channel_user_id TEXT,
  ADD COLUMN IF NOT EXISTS requested_channel_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS requested_message_id TEXT,
  ADD COLUMN IF NOT EXISTS result_notified_at TIMESTAMPTZ;

-- Optional: basic constraint for requested_channel values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'tryon_jobs'
       AND c.conname = 'tryon_jobs_requested_channel_check'
  ) THEN
    ALTER TABLE tryon_jobs
      ADD CONSTRAINT tryon_jobs_requested_channel_check
      CHECK (requested_channel IS NULL OR requested_channel IN ('chatgpt', 'imessage', 'whatsapp', 'telegram'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tryon_jobs_notify_pending
  ON tryon_jobs(status, created_at)
  WHERE status IN ('completed', 'failed') AND result_notified_at IS NULL AND requested_channel IS NOT NULL;
