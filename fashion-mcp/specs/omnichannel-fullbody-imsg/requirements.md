# Requirements: Omnichannel fashion assistant with enforced full-body photos and iMessage bridge

## Goal

Deliver a production-grade fashion assistant that works via **ChatGPT (MCP)**, **WhatsApp**, **Telegram**, and **iMessage**, while enforcing a **full head-to-toe, front-facing photo requirement** for try-on and reliably delivering try-on results back to the same channel.

## Users / personas

- Primary: shoppers who want outfit recommendations and virtual try-on from chat apps.
- Secondary: operators/engineers who need safe deployment, observability, and predictable behavior across channels.

## User stories

### US-1: Full-Body Photo Requirement (Hard Gate)

**As a** user
**I want** the system to reject non-full-body photos and require a head-to-toe, front-facing photo (feet visible)
**So that** try-on outputs are reliable and consistent.

**Acceptance criteria**
- AC-1.1: When a user uploads a photo that fails validation, the system returns `reason="full_body_photo_required"` with a clear instruction to upload a full head-to-toe, front-facing photo with feet visible.
- AC-1.2: Try-on tools must refuse to queue jobs unless an **approved primary** full-body photo exists (per user).
- AC-1.3: When `TRYON_REQUIRE_FULL_BODY_PHOTOS=true`, `profile.ingestPhotos` must require server-retrievable `photoUrls` so validation can run.

### US-2: iMessage Omnichannel Support (Bridge)

**As a** user
**I want** to use the assistant from iMessage/SMS on my phone
**So that** I can get recommendations and try-on results without using a separate app.

**Acceptance criteria**
- AC-2.1: Inbound iMessage texts and image attachments are forwarded to the backend as `ChannelInboundEvent(channel="imessage")`.
- AC-2.2: Outbound replies (text + links + images) are delivered back to the same iMessage chat, including group chats when `channelConversationId` is present.
- AC-2.3: The bridge is authenticated to the backend via a shared secret; unauthenticated calls are rejected.

### US-3: Channel Account Linking

**As a** user
**I want** to link my chat identity (WhatsApp/Telegram/iMessage) to my backend profile
**So that** my budget/photos/preferences follow me across messages.

**Acceptance criteria**
- AC-3.1: If an inbound channel user is unlinked, the system responds with a one-time account linking URL.
- AC-3.2: After linking, subsequent messages are associated with the same `userId` and can set budget, upload photos, request try-on, and request checkout approvals.

## Functional requirements (FR)

| ID | Requirement | Priority | Verification |
|----|-------------|----------|--------------|
| FR-1 | Accept inbound events from WhatsApp/Telegram webhooks and iMessage bridge, normalize to `ChannelInboundEvent`, and process via orchestrator. | High | Unit tests + webhook integration tests + manual live provider tests |
| FR-2 | Persist inbound and outbound channel messages with idempotency, retries, and dead-lettering. | High | DB tests + sender worker tests |
| FR-3 | Enforce full-body photo gating at ingestion and at try-on request time. | High | `scripts/e2e_fullbody_enforcement.mjs` + strict validator health check |
| FR-4 | iMessage bridge can upload attachments to backend and can drain backend outbox to send replies. | High | `apps/imsg-bridge` unit tests + manual on macOS |
| FR-5 | Support Stripe optional checkout (deep-link-only is acceptable). | Medium | `checkout.createApprovalLink` unit tests + Stripe webhook test |

## Non-functional requirements (NFR)

| ID | Category | Target | Notes |
|----|----------|--------|-------|
| NFR-1 | Performance | p95 tool calls < 800ms (excluding try-on render) | Try-on is async job-based |
| NFR-2 | Security | Secrets never logged; authenticated channels; OAuth/JWKS for users | Prefer AWS Secrets Manager in production |
| NFR-3 | Reliability | At-least-once delivery from channels; idempotent processing | Idempotency via unique constraints + idempotency keys |

## Out of scope / non-goals

- Full merchant-of-record commerce (tax, returns, chargebacks).
- Guaranteed “no third-party processing” while using ChatGPT/WhatsApp/Telegram/iMessage or Google Vertex.
- Perfect pose/landmark accuracy without integrating a landmark model (MediaPipe/OpenPose/etc.).

## Assumptions

- Cloud target: AWS.
- Auth provider: Auth0 (JWT/JWKS verification).
- Commerce: deep-link checkout is acceptable; Stripe checkout is optional.
- Try-on provider: Google Vertex supported; local fallback supported.

## Dependencies

- `imsg` binary on macOS for iMessage bridge.
- WhatsApp Business Platform (Meta) credentials for webhook + sending.
- Telegram bot token + webhook secret.
- Stripe (optional) for checkout sessions and webhooks.
- Google Cloud Vertex AI (optional) for virtual try-on.

## Success metrics

- >= 99% webhook/bridge inbound events processed without duplication (idempotent).
- >= 95% outbound delivery success for enabled channels (excluding provider outages).
- Full-body photo rejection reasons are understandable (reduced user confusion / retries).
