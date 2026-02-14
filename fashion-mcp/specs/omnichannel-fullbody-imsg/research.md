---
spec: omnichannel-fullbody-imsg
phase: research
created: 2026-02-13T00:47:48+00:00
---

# Research: omnichannel-fullbody-imsg

## Goal

Omnichannel fashion assistant with enforced full-body photos and iMessage bridge

## Executive summary

- Feasibility: **High**
  - The codebase already has a working MCP server, full-body photo gating hooks, try-on job queue, and omnichannel inbox/outbox tables.
  - Remaining work is primarily wiring and operational hardening: iMessage bridge daemon (macOS), strict validator service deployment, and production storage/secrets.
- Key constraints:
  - **iMessage cannot run on AWS**. Any iMessage “connector” must run on **macOS** (Mac mini, MacStadium, etc.) and talk to the AWS backend over HTTPS.
  - **WhatsApp/Telegram require public URLs** for webhooks and media links. `localhost` image URLs are not usable in real deployments.
  - “All data on server” is not strictly possible for ChatGPT/WhatsApp/Telegram/iMessage: user messages and photos transit those providers; Google Vertex try-on also processes data externally.
- Primary risks:
  - Privacy expectations vs reality (third-party processors).
  - Media delivery reliability (signed URLs, retention, provider fetch failures).
  - Full-body validation accuracy (heuristics vs real landmark detection).

## Codebase scan

### Relevant existing components

- `apps/mcp-server/src/domain/*.ts` — domain layer used by both MCP tools and channel orchestrator.
- `apps/mcp-server/src/channels/*` — omnichannel routing, idempotent inbox/outbox, senders for WhatsApp/Telegram.
- `apps/mcp-server/src/photos/fullBody.ts` — full-body gating (heuristic + strict validator mode).
- `services/fullbody-validator/*` — strict validator service (`GET /healthz`, `POST /validate`) with reason codes.
- `apps/mcp-server/src/tryon/*` — job queue + worker; supports `TRYON_PROVIDER=local|google_vertex`.
- `apps/mcp-server/src/checkout/*` — deep-link approvals + optional Stripe checkout.
- `apps/mcp-server/src/auth/*` — dev tokens or OAuth/JWKS verification (Auth0-compatible).

### Patterns to follow

- Zod-based config parsing: `apps/mcp-server/src/config.ts`
- Idempotency patterns: `apps/mcp-server/src/db/repos/idempotencyRepo.ts`, `apps/mcp-server/src/db/repos/channelRepo.ts`
- E2E scripts that hit MCP over HTTP: `scripts/e2e_*.mjs`

### Gaps / missing pieces

- iMessage transport: needs a macOS-side bridge to translate Messages.app events into `ChannelInboundEvent` and to drain the backend outbox to send replies.
- Production media storage: local `/media` and `/generated` are OK for dev, but production needs private object storage + signed URLs.
- Validator accuracy: strict validator service is currently conservative heuristics; production should use a real landmark model (MediaPipe/OpenPose/etc.).
- Ops: IaC, secret management, alerting, and runbooks.

## External research (optional)

- `imsg` RPC protocol (`docs/rpc.md`) — JSON-RPC over stdio with `watch.subscribe` + `send`; attachment metadata includes resolved file paths on the Mac.

## Open questions

- What is the iMessage bridge hosting plan (local Mac, MacStadium, etc.) and who operates Apple ID + permissions?
- For “server-only data”, do we accept Google Vertex try-on (data processed by Google) or do we require an in-house GPU pipeline on AWS?
- How should media be delivered in production (S3 presigned URLs vs proxy downloads)?

## Sources

- (removed from repo) `sop.txt`
- `imsg/docs/rpc.md`
- `apps/mcp-server/src/*`
- `services/fullbody-validator/*`
