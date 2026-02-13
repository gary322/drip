# Tasks: Enforce full head-to-toe capture and deliver try-on via iMessage, ChatGPT, WhatsApp, Telegram

## Overview

Total tasks: 41

Execution strategy:
1. Build strict full-body enforcement first.
2. Introduce shared channel orchestration layer.
3. Add WhatsApp and Telegram adapters.
4. Add iMessage bridge via `imsg`.
5. Harden security, observability, and release gates.

## Phase 1: Strict full-body enforcement (make it work)

- [x] 1.1 Add photo validation schema fields and migration
  - **Do**: create migration adding `validation_status`, `validation_report`, `is_primary` to `photos` table and supporting indexes.
  - **Files**: `apps/mcp-server/src/db/migrations/004_channel_and_photo_validation.sql`
  - **Done when**: migration applies successfully and schema includes new columns.
  - **Verify**: `npm run db:migrate`
  - _Reqs: FR-7, FR-28_

- [x] 1.2 Implement strict validation client contract
  - **Do**: create typed validator client and response reason codes; keep heuristic fallback behind config.
  - **Files**: `apps/mcp-server/src/photos/fullBody.ts`, `apps/mcp-server/src/config.ts`
  - **Done when**: fullBody module can call strict service and return standardized reason codes.
  - **Verify**: `npm run test --workspace apps/mcp-server -- fullBody`
  - _Reqs: FR-2, FR-5_

- [x] 1.3 Add photo validation repository helpers
  - **Do**: implement repository methods to persist validation reports and primary-photo selection.
  - **Files**: `apps/mcp-server/src/db/repos/photoValidationRepo.ts`, `apps/mcp-server/src/db/repos/profileRepo.ts`
  - **Done when**: ingest flow can persist and fetch validated photo status.
  - **Verify**: `npm run test --workspace apps/mcp-server -- repositories`
  - _Reqs: FR-7, FR-6_

- [x] 1.4 Enforce strict validation in `profile.ingestPhotos`
  - **Do**: block non-compliant photos, return remediation guidance text + structured reasons.
  - **Files**: `apps/mcp-server/src/mcp/tools/profile.ts`
  - **Done when**: invalid images are rejected with actionable feedback and no photo set marked eligible.
  - **Verify**: `npm run test --workspace apps/mcp-server -- profile`
  - _Reqs: AC-1.1, AC-1.4, FR-1, FR-33_

- [x] 1.5 Gate try-on on approved primary photo
  - **Do**: update try-on tools to require at least one approved primary photo in the target photo set.
  - **Files**: `apps/mcp-server/src/mcp/tools/tryon.ts`
  - **Done when**: try-on requests return `full_body_photo_required` when no approved photo exists.
  - **Verify**: `npm run test --workspace apps/mcp-server -- tryon`
  - _Reqs: AC-1.5, FR-6_

- [x] 1.6 Quality checkpoint
  - **Do**: run build and unit tests after full-body changes.
  - **Verify**: `npm run build && npm run test`
  - **Done when**: all commands pass.

- [x] 1.7 POC checkpoint for full-body flow
  - **Do**: run an E2E where first image is headshot-only (reject), second is full-body front-facing (accept), then run try-on.
  - **Files**: `scripts/e2e_fullbody_enforcement.mjs`
  - **Done when**: script demonstrates rejection + acceptance + successful try-on queueing.
  - **Verify**: `node scripts/e2e_fullbody_enforcement.mjs`

## Phase 2: Full-body validator service (production quality)

- [x] 2.1 Scaffold `services/fullbody-validator`
  - **Do**: create Python service with REST endpoint `/validate` and typed response schema.
  - **Files**: `services/fullbody-validator/app/main.py`, `services/fullbody-validator/requirements.txt`, `services/fullbody-validator/README.md`
  - **Done when**: service runs locally and returns response stub.
  - **Verify**: `uvicorn app.main:app --port 8090`
  - _Reqs: FR-2, FR-3_

- [x] 2.2 Implement quality metrics (blur/brightness/size)
  - **Do**: add quality gate checks and reason codes.
  - **Files**: `services/fullbody-validator/app/quality.py`, `services/fullbody-validator/tests/test_quality.py`
  - **Done when**: low-quality fixtures fail with expected codes.
  - **Verify**: `pytest services/fullbody-validator/tests/test_quality.py`
  - _Reqs: FR-5_

- [x] 2.3 Implement pose landmark detection and frontal scoring
  - **Do**: integrate pose model inference and frontal orientation thresholds.
  - **Files**: `services/fullbody-validator/app/pose.py`, `services/fullbody-validator/tests/test_pose.py`
  - **Done when**: fixtures validate feet/head/front-facing conditions.
  - **Verify**: `pytest services/fullbody-validator/tests/test_pose.py`
  - _Reqs: FR-3, FR-4_

- [x] 2.4 Add contract and performance tests for validator
  - **Do**: add API schema tests and latency benchmark for representative image sizes.
  - **Files**: `services/fullbody-validator/tests/test_api_contract.py`, `services/fullbody-validator/tests/test_perf.py`
  - **Done when**: response format stable and latency within target.
  - **Verify**: `pytest services/fullbody-validator/tests`
  - _Reqs: NFR-2, NFR-12_

- [x] 2.5 Integrate validator service health in main app
  - **Do**: add health dependency checks and circuit breaker fallback policy.
  - **Files**: `apps/mcp-server/src/routes/health.ts`, `apps/mcp-server/src/photos/fullBody.ts`
  - **Done when**: `/healthz` reports validator status and graceful fallback behavior.
  - **Verify**: `curl http://localhost:8787/healthz`
  - _Reqs: AC-5.1_

- [x] 2.6 Quality checkpoint
  - **Verify**: `npm run build && npm run test && pytest services/fullbody-validator/tests`
  - **Done when**: all checks pass.

## Phase 3: Shared omnichannel core

- [x] 3.1 Create canonical channel event/message types
  - **Do**: define `ChannelInboundEvent` and `ChannelOutboundMessage` types with validation schema.
  - **Files**: `apps/mcp-server/src/channels/types.ts`, `packages/shared/src/index.ts`
  - **Done when**: all adapters compile against shared types.
  - **Verify**: `npm run build`
  - _Reqs: FR-13_

- [x] 3.2 Add channel identity and message persistence tables
  - **Do**: migration for `channel_identities`, `channel_messages`, `channel_delivery_attempts`, `dead_letter_events`, `channel_link_tokens`.
  - **Files**: `apps/mcp-server/src/db/migrations/005_channel_runtime.sql`
  - **Done when**: tables and indexes exist.
  - **Verify**: `npm run db:migrate`
  - _Reqs: FR-14, FR-16, FR-26_

- [x] 3.3 Implement channel repositories
  - **Do**: CRUD for identity linking, inbound dedupe, outbound queue state transitions.
  - **Files**: `apps/mcp-server/src/db/repos/channelRepo.ts`
  - **Done when**: repository tests pass and idempotency works.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channelRepo`
  - _Reqs: FR-14, FR-16, FR-25_

- [x] 3.4 Implement channel command router
  - **Do**: map text/media intents to existing domain commands (budget, photos, recommend, try-on, checkout).
  - **Files**: `apps/mcp-server/src/channels/router.ts`, `apps/mcp-server/src/channels/intents.ts`
  - **Done when**: sample inbound events route to expected commands.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/router`
  - _Reqs: FR-31_

- [x] 3.5 Implement account-linking flow
  - **Do**: signed one-time token generation, verification endpoint, Auth0 user binding.
  - **Files**: `apps/mcp-server/src/channels/linking.ts`, `apps/mcp-server/src/routes/channelLinking.ts`
  - **Done when**: unknown channel identity can link and become active.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/linking`
  - _Reqs: FR-15_

- [x] 3.6 Implement outbound sender worker framework
  - **Do**: queue consumer with retry/backoff/dead-letter behavior.
  - **Files**: `apps/mcp-server/src/channels/senderWorker.ts`
  - **Done when**: failed sends retry and dead-letter after max attempts.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/senderWorker`
  - _Reqs: FR-25, FR-26_

- [x] 3.7 Quality checkpoint
  - **Verify**: `npm run build && npm run test`
  - **Done when**: all checks pass.

## Phase 4: WhatsApp and Telegram adapters

- [ ] 4.1 Build WhatsApp webhook receiver
  - **Do**: add verification route, parse inbound events, verify signatures, normalize payload.
  - **Files**: `apps/mcp-server/src/channels/whatsapp.ts`, `apps/mcp-server/src/routes/channelWebhooks.ts`
  - **Done when**: valid payload accepted, invalid signature rejected.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/whatsapp`
  - _Reqs: FR-10, FR-23_

- [ ] 4.2 Build WhatsApp sender adapter
  - **Do**: implement send text/image/link with provider response tracking.
  - **Files**: `apps/mcp-server/src/channels/whatsappSender.ts`
  - **Done when**: outbound API client serializes valid payloads and records provider IDs.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/whatsappSender`
  - _Reqs: FR-35_

- [ ] 4.3 Build Telegram webhook receiver
  - **Do**: verify webhook secret token, normalize update payloads, fetch media metadata.
  - **Files**: `apps/mcp-server/src/channels/telegram.ts`
  - **Done when**: inbound updates are normalized to canonical event.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/telegram`
  - _Reqs: FR-11, FR-23_

- [ ] 4.4 Build Telegram sender adapter
  - **Do**: implement sendMessage/sendPhoto wrappers with delivery tracking.
  - **Files**: `apps/mcp-server/src/channels/telegramSender.ts`
  - **Done when**: outbound messages are serialized correctly and errors are typed.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/telegramSender`
  - _Reqs: FR-35_

- [ ] 4.5 Wire adapters into app bootstrap
  - **Do**: mount webhook routes and sender worker startup in `index.ts` with feature flags.
  - **Files**: `apps/mcp-server/src/index.ts`, `apps/mcp-server/src/config.ts`
  - **Done when**: app boots with channels enabled/disabled via env flags.
  - **Verify**: `npm run dev`
  - _Reqs: FR-8_

- [ ] 4.6 Adapter integration tests
  - **Do**: simulate inbound webhook -> command router -> outbound queue -> mocked provider send.
  - **Files**: `apps/mcp-server/src/channels/whatsapp.integration.test.ts`, `apps/mcp-server/src/channels/telegram.integration.test.ts`
  - **Done when**: end-to-end mocked channel flow passes.
  - **Verify**: `npm run test:integration`
  - _Reqs: FR-36_

- [ ] 4.7 Quality checkpoint
  - **Verify**: `npm run build && npm run test && npm run test:integration`
  - **Done when**: all checks pass.

## Phase 5: iMessage bridge via `imsg`

- [ ] 5.1 Scaffold `services/imsg-bridge`
  - **Do**: Node/TS daemon with process supervisor wrapper for `imsg rpc` stdio session.
  - **Files**: `services/imsg-bridge/src/index.ts`, `services/imsg-bridge/package.json`
  - **Done when**: bridge starts and can issue `chats.list` RPC command.
  - **Verify**: `npm --workspace services/imsg-bridge run dev`
  - _Reqs: FR-12, FR-34_

- [ ] 5.2 Implement inbound subscription relay
  - **Do**: subscribe to `watch.subscribe`, parse notifications, forward to backend `/channels/imessage/events`.
  - **Files**: `services/imsg-bridge/src/rpcClient.ts`, `services/imsg-bridge/src/relay.ts`
  - **Done when**: inbound messages appear in backend channel message table.
  - **Verify**: `npm --workspace services/imsg-bridge run test`
  - _Reqs: FR-12_

- [ ] 5.3 Implement outbound iMessage send worker integration
  - **Do**: bridge consumes outbound queue items for `imessage`, calls `send` RPC method, reports delivery status.
  - **Files**: `services/imsg-bridge/src/sender.ts`
  - **Done when**: backend can trigger iMessage text/image sends via bridge.
  - **Verify**: `npm --workspace services/imsg-bridge run test`
  - _Reqs: FR-12, FR-14_

- [ ] 5.4 Add bridge authentication and heartbeat
  - **Do**: signed service JWT or mTLS for bridge->backend calls; heartbeat endpoint and stale-agent detection.
  - **Files**: `services/imsg-bridge/src/auth.ts`, `apps/mcp-server/src/channels/imessage.ts`
  - **Done when**: unauthorized bridge calls are rejected and stale bridge alerts trigger.
  - **Verify**: `npm run test --workspace apps/mcp-server -- channels/imessage`
  - _Reqs: FR-24, AC-5.1_

- [ ] 5.5 Build macOS deployment/runbook docs
  - **Do**: document permissions, launchd service, crash recovery, and failover procedures.
  - **Files**: `docs/runbook-imsg-bridge.md`
  - **Done when**: operator can set up new bridge host from scratch.
  - **Verify**: manual runbook dry-run
  - _Reqs: AC-5.2_

- [ ] 5.6 iMessage staging validation
  - **Do**: execute staging test with real iMessage chat and verify two-way communication + try-on link send.
  - **Files**: `scripts/e2e_imsg_staging_checklist.md`
  - **Done when**: scripted checklist passes and evidence artifacts are stored.
  - **Verify**: manual staging run
  - _Reqs: FR-36_

- [ ] 5.7 Quality checkpoint
  - **Verify**: `npm run build && npm run test && npm run test:integration`
  - **Done when**: all checks pass.

## Phase 6: Security, observability, and compliance hardening

- [ ] 6.1 Add webhook replay protection and request signing middleware
  - **Do**: enforce timestamp windows and signature checks for channel webhooks.
  - **Files**: `apps/mcp-server/src/middleware/webhookAuth.ts`
  - **Done when**: replay and tampered payload tests fail as expected.
  - **Verify**: `npm run test --workspace apps/mcp-server -- webhookAuth`
  - _Reqs: FR-23, NFR-4_

- [ ] 6.2 Add log redaction and PII-safe logging contract
  - **Do**: implement structured logger serializer to redact tokens/phone/media URLs.
  - **Files**: `apps/mcp-server/src/middleware/logRedaction.ts`, `apps/mcp-server/src/index.ts`
  - **Done when**: logs show redacted fields in tests.
  - **Verify**: `npm run test --workspace apps/mcp-server -- logRedaction`
  - _Reqs: AC-4.4, NFR-6_

- [ ] 6.3 Add audit event coverage for channel lifecycle
  - **Do**: emit audit events for inbound receive, linking, outbound send, delivery failure.
  - **Files**: `apps/mcp-server/src/channels/*.ts`, `apps/mcp-server/src/db/repos/auditRepo.ts`
  - **Done when**: integration tests assert audit rows for channel operations.
  - **Verify**: `npm run test:integration`
  - _Reqs: FR-29_

- [ ] 6.4 Add retention and deletion jobs for media/channel data
  - **Do**: implement scheduled cleanup for expired media and dead-letter retention windows.
  - **Files**: `apps/mcp-server/src/jobs/retention.ts`
  - **Done when**: expired records are purged according to policy.
  - **Verify**: `npm run test --workspace apps/mcp-server -- retention`
  - _Reqs: FR-28, NFR-10_

- [ ] 6.5 Publish monitoring dashboards and alerts
  - **Do**: define CloudWatch metrics/alarms and runbook mappings.
  - **Files**: `infra/monitoring/channel-dashboard.json`, `docs/runbooks.md`
  - **Done when**: alerts fire in synthetic test and are documented.
  - **Verify**: manual synthetic alarm test
  - _Reqs: AC-5.3_

- [ ] 6.6 Quality checkpoint
  - **Verify**: `npm run build && npm run test && npm run test:integration`
  - **Done when**: all checks pass.

## Phase 7: End-to-end validation and release readiness

- [ ] 7.1 Build omnichannel E2E smoke script
  - **Do**: implement one script per channel plus aggregate runner.
  - **Files**: `scripts/e2e_chatgpt_smoke.mjs`, `scripts/e2e_whatsapp_smoke.mjs`, `scripts/e2e_telegram_smoke.mjs`, `scripts/e2e_omnichannel_smoke.mjs`
  - **Done when**: all channel scripts produce pass/fail report JSON.
  - **Verify**: `node scripts/e2e_omnichannel_smoke.mjs`
  - _Reqs: FR-36_

- [ ] 7.2 Execute load and soak tests
  - **Do**: run sustained message and queue-load tests; capture p95 latencies and failure rates.
  - **Files**: `scripts/load/channel_load_test.mjs`, `docs/perf-report.md`
  - **Done when**: NFR latency/throughput targets are met or explicitly waived.
  - **Verify**: `node scripts/load/channel_load_test.mjs`
  - _Reqs: NFR-2, NFR-3_

- [ ] 7.3 Security validation pass
  - **Do**: run dependency scan, secret scan, webhook auth tests, and manual abuse checks.
  - **Files**: `.github/workflows/ci.yml`, `docs/security-review.md`
  - **Done when**: no unresolved high-severity findings.
  - **Verify**: CI security job + manual checklist
  - _Reqs: NFR-4_

- [ ] 7.4 Documentation freeze
  - **Do**: update architecture, API contracts, channel setup guides, incident runbooks.
  - **Files**: `docs/channel-architecture.md`, `docs/tool-contracts.md`, `docs/photo-capture-policy.md`, `README.md`
  - **Done when**: docs match shipped behavior and onboarding steps.
  - **Verify**: docs review checklist

- [ ] 7.5 Final production gate
  - **Do**: run full test suite, migration dry run, rollback drill, and release checklist signoff.
  - **Verify**: `npm run build && npm run test && npm run test:integration`
  - **Done when**: release checklist is signed by engineering, security, and ops.
