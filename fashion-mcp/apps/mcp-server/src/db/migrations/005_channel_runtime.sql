-- Omnichannel runtime entities for identity mapping and message delivery tracking.

CREATE TABLE IF NOT EXISTS channel_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('chatgpt', 'imessage', 'whatsapp', 'telegram')),
  channel_user_id TEXT NOT NULL,
  channel_conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'unlinked')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_unique_external
  ON channel_identities(channel, channel_user_id);

CREATE INDEX IF NOT EXISTS idx_channel_identities_user
  ON channel_identities(user_id);

CREATE TABLE IF NOT EXISTS channel_link_tokens (
  token TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('chatgpt', 'imessage', 'whatsapp', 'telegram')),
  channel_user_id TEXT NOT NULL,
  channel_conversation_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_link_tokens_expiry
  ON channel_link_tokens(expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS channel_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT NOT NULL CHECK (channel IN ('chatgpt', 'imessage', 'whatsapp', 'telegram')),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel_user_id TEXT NOT NULL,
  channel_conversation_id TEXT NOT NULL,
  provider_message_id TEXT,
  correlation_id TEXT,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (
    status IN ('received', 'queued', 'processing', 'sent', 'failed', 'dead_lettered')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_messages_idempotency
  ON channel_messages(channel, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_messages_status
  ON channel_messages(direction, status, created_at);

CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation
  ON channel_messages(channel, channel_conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_message_id UUID NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  response_code INTEGER,
  response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_delivery_attempts_message
  ON channel_delivery_attempts(channel_message_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('chatgpt', 'imessage', 'whatsapp', 'telegram')),
  source TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_events_open
  ON dead_letter_events(channel, created_at DESC)
  WHERE resolved_at IS NULL;
