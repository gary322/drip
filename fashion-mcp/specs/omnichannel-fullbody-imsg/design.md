# Design: Omnichannel fashion assistant with enforced full-body photos and iMessage bridge

## Overview

Keep **all business logic** in the `apps/mcp-server` domain layer and expose it through multiple transports:
ChatGPT uses MCP (`POST /mcp`), WhatsApp/Telegram use webhooks, and iMessage uses a macOS bridge daemon that forwards inbound messages and drains a backend outbox for replies.
Full-body photo enforcement is applied at **photo ingestion** and again at **try-on request time**.

## Architecture

### Component diagram (edit to match the codebase)

```mermaid
graph TB
  User[User] --> ChatGPT[ChatGPT App (MCP)]
  User --> WA[WhatsApp]
  User --> TG[Telegram]
  User --> IM[iMessage/SMS]

  ChatGPT -->|tools/call| MCP[apps/mcp-server\nPOST /mcp]
  WA -->|webhook| MCP
  TG -->|webhook| MCP
  IM -->|imsg rpc watch| Bridge[apps/imsg-bridge\nmacOS daemon]
  Bridge -->|POST /channels/imessage/events| MCP

  MCP --> PG[(Postgres)]
  MCP --> Media[(Local / S3 media storage)]
  MCP --> TryonWorker[Try-on worker]
  TryonWorker --> Vertex[Google Vertex VTO (optional)]
  MCP --> FullBody[services/fullbody-validator (strict mode)]

  MCP -->|outbox queue| PG
  MCP --> WASender[WA sender worker]
  MCP --> TGSender[TG sender worker]
  Bridge -->|claim outbox| MCP
  WASender --> WA
  TGSender --> TG
  Bridge -->|imsg rpc send| IM
```

### Key components

- **`apps/mcp-server`**: MCP server + omnichannel webhook handlers + orchestrator; owns DB, validation, planning, try-on job queue, checkout approvals.
- **`services/fullbody-validator`**: strict validation service (reason codes like `feet_missing`, `not_front_facing`).
- **`apps/imsg-bridge`**: macOS daemon that runs `imsg rpc`, forwards inbound iMessage events, uploads attachments, drains backend outbox and sends replies.

## Data model / state

- `channel_identities`:
  - Unique `(channel, channel_user_id)`, stores `user_id` when linked, last seen `channel_conversation_id`.
- `channel_link_tokens`:
  - One-time link tokens with TTL used to connect a channel identity to a user profile.
- `channel_messages`:
  - Inbound/outbound queue with statuses (`received|processed|queued|processing|sent|failed|dead_lettered`).
  - Unique on `(channel, direction, provider_message_id)` for inbound dedupe.
  - Unique on `(channel, idempotency_key)` for outbound idempotency.
- `photo_sets` / `photos`:
  - Photos store `validation_status` and `is_primary`; try-on requires an approved primary photo when full-body is required.
- `tryon_jobs`:
  - Async jobs; record requested channel metadata to notify back to the originating channel.

## Interfaces / APIs

- **Inbound webhooks**
  - `GET/POST /channels/whatsapp/webhook` (verify token + signature)
  - `POST /channels/telegram/webhook` (secret token header)
- **iMessage bridge**
  - `POST /channels/imessage/events` (bridge-auth; accepts `ChannelInboundEvent(channel="imessage")`)
  - `POST /channels/imessage/upload` (bridge-auth; uploads base64 image, returns `remoteUrl`)
  - `POST /channels/outbox/claim` (bridge-auth; claim outbound iMessage messages)
  - `POST /channels/outbox/:id/sent` / `failed` (bridge-auth; ack results)
- **MCP**
  - `POST /mcp` Streamable HTTP transport for `tools/list` and `tools/call`
- **Errors**
  - `full_body_photo_required` (ingest or try-on hard gate)
  - `photo_urls_required` (cannot validate/try-on without server-retrievable image URLs)
  - `unauthorized_bridge` (missing/invalid bridge bearer token)
  - Provider send failures are retried via `channel_messages` attempts and dead-lettering.

## File-level changes

| File | Action | Purpose |
|------|--------|---------|
| `apps/mcp-server/src/domain/profile.ts` | Modify | Require `photoUrls` when full-body validation is required |
| `apps/mcp-server/src/routes/channelOutbox.ts` | Modify | Add `POST /channels/imessage/upload` for iMessage attachments |
| `apps/mcp-server/src/index.ts` | Modify | Raise JSON body limit to support image payloads |
| `apps/imsg-bridge/*` | Create | macOS bridge daemon + tests |

## Failure modes & error handling

- Invalid webhook signature → reject + audit event → user sees "signature validation failed" (channel reply).
- Unlinked channel identity → create link token → user gets link URL; nothing else is processed until linked.
- Non-full-body photo → reject validation results → user is told to upload full head-to-toe, front-facing photo with feet visible.
- Strict validator down → if `FULLBODY_VALIDATOR_MODE=strict`, reject with `validator_unavailable` (operator needs alerting).
- Outbound send fails (provider outage) → mark `failed` and retry until max attempts → dead-letter with last error.

## Edge cases

- iMessage group chats — backend stores `channelConversationId=chat_id`; bridge sends to `chat_id` when possible.
- Duplicate provider events — DB uniqueness makes inbound processing idempotent.
- Attachments missing paths in Messages DB — bridge skips upload and forwards text-only event.

## Security & privacy

- OAuth/JWKS verification supports Auth0 (set `AUTH_MODE=oauth`, `JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`).
- Bridge endpoints require `IMESSAGE_BRIDGE_SHARED_SECRET` bearer token.
- WhatsApp webhook HMAC verification and Telegram secret header verification.
- Do not log raw tokens, attachment base64, or private keys. Use secret managers in production.

## Performance considerations

- Try-on is async; tool calls are fast and return `jobId` quickly.
- Sender workers and bridge outbox draining are batch-based with backoff via retry attempts.
- Production should move `/generated` and `/media` to object storage + CDN for provider-friendly delivery.

## Test strategy

Map tests back to acceptance criteria.

- **Unit**
  - Channel routing/intents/senders (`apps/mcp-server/src/channels/*.test.ts`)
  - Full-body gating (`apps/mcp-server/src/photos/fullBody.test.ts`)
  - Bridge RPC framing + formatting (`apps/imsg-bridge/src/*.test.ts`)
- **Integration**
  - DB repository flows (`apps/mcp-server/src/db/repositories.integration.test.ts`)
  - Try-on worker flow (`apps/mcp-server/src/tryon/worker.integration.test.ts`)
- **E2E**
  - `scripts/e2e_fullbody_enforcement.mjs`
  - `scripts/e2e_internet_budget_tryon.mjs`

## Rollout / migration plan (if needed)

- Apply DB migrations (`npm run db:migrate`).
- Deploy backend (AWS) with channels disabled; validate MCP flow.
- Enable Telegram/WhatsApp in a staged rollout (secrets + public URLs).
- Deploy `apps/imsg-bridge` on macOS and enable `IMESSAGE_BRIDGE_ENABLED=true` in backend.
- Switch full-body validator to strict mode after validator service is deployed and health-checked.
