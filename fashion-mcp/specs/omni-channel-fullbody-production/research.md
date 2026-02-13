---
spec: omni-channel-fullbody-production
phase: research
created: 2026-02-12T22:33:35+00:00
updated: 2026-02-12T23:58:00+00:00
---

# Research: omni-channel-fullbody-production

## Goal

Enforce full head-to-toe photo quality at ingest time (every time), and make the styling + try-on + budget workflow usable through iMessage (`imsg`), ChatGPT Apps SDK, WhatsApp, and Telegram while preserving production security/compliance constraints.

## Executive summary

- Feasibility: High for ChatGPT, WhatsApp, Telegram; Medium for iMessage at scale.
- Core reason: existing codebase already has strong MCP foundation, async try-on jobs, Stripe checkout, and baseline full-body checks. Missing pieces are stricter CV validation, multi-channel ingress/egress abstraction, and channel-specific adapter services.
- Highest risk: iMessage transport operational model is macOS-bound and not cloud-native; needs a dedicated macOS bridge layer.

## Fixed decisions from user

- Cloud: AWS for primary deployment.
- Auth: Auth0.
- Commerce: deep-link is acceptable.
- Payments/budget flow: Stripe remains enabled for approval/payment link generation.
- Data handling intent: data should remain server-side and private.

## Existing codebase baseline

### Relevant components already in place

- `apps/mcp-server/src/mcp/server.ts`: MCP server with tool registration.
- `apps/mcp-server/src/mcp/transport.ts`: stateless Streamable HTTP request handling.
- `apps/mcp-server/src/mcp/tools/profile.ts`: photo ingest tool and consent workflow.
- `apps/mcp-server/src/photos/fullBody.ts`: current full-body check based on width/height/aspect ratio.
- `apps/mcp-server/src/tryon/worker.ts`: async try-on worker with queued job processing.
- `apps/mcp-server/src/tryon/googleVirtualTryon.ts`: Google Vertex virtual try-on integration.
- `apps/mcp-server/src/mcp/tools/checkout.ts`: budget gate + approval link + Stripe session support.
- `apps/mcp-server/src/routes/approval.ts`: approval page and decision flow.
- `apps/mcp-server/src/routes/stripeWebhook.ts`: Stripe signature-verified webhook handling.

### What is missing for the requested outcome

- No deterministic body landmark validation. Current full-body check is heuristic only (resolution + aspect ratio).
- No channel abstraction outside ChatGPT MCP.
- No WhatsApp webhook/send API adapter.
- No Telegram webhook/send API adapter.
- No iMessage transport bridge from `imsg rpc` into backend workflows.
- No channel identity-linking flow to unify users across Auth0 + external handles.
- No cross-channel conversation state machine.
- No capture-guidance UX contract that enforces and explains head-to-toe requirements before upload.

## Full-body validation research conclusions

### Current implementation weakness

- Current `evaluateFullBodyFrame()` can pass portrait crops that still omit feet or are non-frontal.
- It cannot detect:
- Whether ankles/feet are visible.
- Whether pose is front-facing.
- Whether person occupies sufficient area.
- Whether photo is heavily occluded or blurred.

### Production validation strategy

A 4-stage server-side validator is required.

- Stage A: File and quality gate.
- Enforce MIME type, minimum resolution, blur threshold, brightness range.
- Stage B: Human body landmark gate.
- Use pose landmarks and require visibility/confidence for nose, shoulders, hips, knees, ankles, heels/feet landmarks.
- Stage C: Frontal orientation gate.
- Use shoulder/hip symmetry and face yaw threshold; reject side-profile as primary photo.
- Stage D: Framing coverage gate.
- Verify person bounding box vertical coverage and feet near lower frame boundary with head clearance.

### Recommended implementation options

- Preferred: dedicated Python microservice using MediaPipe Pose Landmarker in server mode, exposed behind internal HTTP/gRPC.
- Alternative: ML Kit mobile-side validation for client apps, but this does not fit server-only channel ingestion and cannot be trusted as sole gate.

## Channel integration research conclusions

### ChatGPT Apps SDK

- Existing MCP architecture is compatible.
- Needs only hardening:
- Tool annotations and UI metadata completeness.
- File param declaration for uploads.
- CSP/domain metadata for app submission.
- OAuth metadata and challenge flow should remain RFC-compliant.

### iMessage via `imsg`

- `imsg` provides:
- Read/watch of messages via local Messages DB.
- Send via AppleScript.
- JSON-RPC over stdio (`imsg rpc`) with methods for chats/history/watch/send.
- Operational reality:
- Requires macOS host with Messages signed in.
- Requires Full Disk Access and Automation permissions.
- Not directly deployable on AWS Linux containers.
- Design implication:
- Build an `imsg-bridge` sidecar that runs on managed Mac hardware and maintains a secure outbound connection to AWS backend.

### WhatsApp

- Official Cloud API exists and is current.
- Webhook + `/messages` endpoint model supports bidirectional bot-style messaging.
- Requires Meta app setup, phone number ID, access token management, and webhook signature verification.

### Telegram

- Bot API supports webhook mode and secret token validation header.
- Supports media uploads/downloads and bot messages.
- Easy to host via AWS public webhook endpoint.

## Security and compliance implications

- Multi-channel ingress requires per-channel signature/auth checks before accepting inbound events.
- Channel payloads must be normalized into one internal message envelope before business logic.
- PII and media should be encrypted at rest and logged with redaction.
- Third-party inference caveat:
- If using Google Vertex try-on, person and garment images are sent to Google Cloud endpoint during inference.
- If strict "never leave our infrastructure" is required, an in-house AWS-hosted try-on model is mandatory.

## Architecture constraints and risks

- iMessage availability risk.
- macOS agent can fail due to Messages permissions, user session logout, or OS updates.
- Mitigation: health checks, watchdog restarts, dual Mac hosts, failover routing.
- False rejects for body validation.
- Strict pose thresholds can reject valid user photos.
- Mitigation: reason codes, user guidance, optional manual review queue for borderline cases.
- Channel identity collisions.
- One person may message from different handles across channels.
- Mitigation: explicit account-link flow with signed one-time link and Auth0 session confirmation.
- Abuse risk.
- Public webhooks can be spammed.
- Mitigation: signature verification, rate limits, replay protection, WAF.

## Open questions that affect exact implementation

- Are generated try-on images allowed to be sent directly into third-party chat channels, or only links to hosted images?
- Desired retention for raw uploaded photos and generated outputs (days)?
- iMessage deployment model preference:
- single dedicated Mac mini,
- or redundant pair with active/passive failover.

## Sources

- Local codebase:
- `apps/mcp-server/src/mcp/server.ts`
- `apps/mcp-server/src/mcp/transport.ts`
- `apps/mcp-server/src/mcp/tools/profile.ts`
- `apps/mcp-server/src/photos/fullBody.ts`
- `apps/mcp-server/src/tryon/worker.ts`
- `apps/mcp-server/src/tryon/googleVirtualTryon.ts`
- `apps/mcp-server/src/mcp/tools/checkout.ts`
- `apps/mcp-server/src/routes/approval.ts`
- `apps/mcp-server/src/routes/stripeWebhook.ts`
- `packages/shared/src/index.ts`
- iMessage bridge source:
- `/Users/nish/Downloads/drip/imsg/README.md`
- `/Users/nish/Downloads/drip/imsg/docs/rpc.md`
- `/Users/nish/Downloads/drip/imsg/Sources/imsg/RPCServer.swift`
- `/Users/nish/Downloads/drip/imsg/Sources/IMsgCore/MessageSender.swift`
- External docs:
- https://developers.openai.com/apps-sdk/build/auth/
- https://developers.openai.com/apps-sdk/build/mcp-server/
- https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- https://developers.openai.com/apps-sdk/build/chatgpt-ui
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/virtual-try-on-api
- https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-virtual-try-on-images
- https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- https://core.telegram.org/bots/api
- https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api
- https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-fbe3952c-c67c-4a5c-941d-0be9613cbc19
