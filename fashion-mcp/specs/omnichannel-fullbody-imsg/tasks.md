# Tasks: Omnichannel fashion assistant with enforced full-body photos and iMessage bridge

## Overview

Total tasks: 18

POC-first workflow:
1. Make it work (POC)
2. Refactor
3. Tests
4. Quality gates
5. (Optional) PR/release lifecycle

## Task format

For each task, include:

- **Do**: exact steps
- **Files**: paths to create/modify
- **Done when**: explicit success criteria
- **Verify**: command(s) or manual checks

## Phase 1: Make it work (POC)

- [x] 1.1 Fix channel sender tests (remove Node test runner crash)
  - **Do**: make senders injectable and fix TS type errors in tests.
  - **Files**:
    - `apps/mcp-server/src/channels/telegramSender.ts`
    - `apps/mcp-server/src/channels/whatsappSender.ts`
    - `apps/mcp-server/src/channels/telegramSender.test.ts`
    - `apps/mcp-server/src/channels/whatsappSender.test.ts`
  - **Done when**: `npm test` passes.
  - **Verify**: `cd apps/mcp-server && npm test`

- [x] 1.2 Enforce server-retrievable photo URLs for full-body validation
  - **Do**: if `TRYON_REQUIRE_FULL_BODY_PHOTOS=true` and no `photoUrls`, return `reason="photo_urls_required"`.
  - **Files**: `apps/mcp-server/src/domain/profile.ts`
  - **Done when**: non-URL photo ingests are rejected when full-body gating is enabled.
  - **Verify**: run `scripts/e2e_fullbody_enforcement.mjs` with an upload that omits `photoUrls` (manual).
  - _Reqs: AC-1.3_

- [x] 1.3 Add iMessage attachment upload endpoint (bridge -> backend)
  - **Do**: add `POST /channels/imessage/upload` (bridge auth) and increase JSON body limit to support image payloads.
  - **Files**:
    - `apps/mcp-server/src/routes/channelOutbox.ts`
    - `apps/mcp-server/src/index.ts`
  - **Done when**: endpoint returns `remoteUrl` for base64 image uploads.
  - **Verify**: `npm test` (and a manual curl in dev).
  - _Reqs: AC-2.1, AC-2.3_

- [x] 1.4 Implement macOS iMessage bridge daemon (imsg rpc)
  - **Do**: create `apps/imsg-bridge` which:
    - spawns `imsg rpc`
    - subscribes to `watch.subscribe`
    - uploads inbound attachments to backend
    - forwards inbound events to backend
    - claims outbox + sends replies (text/images)
  - **Files**: `apps/imsg-bridge/*`
  - **Done when**: `npm --workspace apps/imsg-bridge run test` passes; bridge can start with `.env`.
  - **Verify**: `npm test` at repo root.
  - _Reqs: FR-4, AC-2.1, AC-2.2_

- [x] 1.5 Quality checkpoint
  - **Verify**: `npm test` + `npm run build`
  - **Done when**: all checks pass

- [ ] 1.6 POC checkpoint (manual end-to-end)
  - **Do**:
    - Start backend: `docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev`
    - Start strict validator (optional): `cd services/fullbody-validator && uvicorn app.main:app --host 0.0.0.0 --port 8090`
    - On macOS with `imsg` installed, run: `cd apps/imsg-bridge && npm run dev`
    - Send an iMessage with "budget $120" and a full-body photo, then "outfits", then "try on prod_001"
  - **Done when**: try-on result is received back as an image in iMessage.

## Phase 2: Refactor

- [ ] 2.1 Replace local media storage with S3 + signed URLs (production)
  - **Do**: add storage abstraction for inbound/outbound media; move `/media` and `/generated` off disk.
  - **Files**: `apps/mcp-server/src/media/*`, `apps/mcp-server/src/tryon/worker.ts`, config/env docs
  - **Done when**: providers can fetch images via HTTPS URLs; no public local disk hosting required.
  - **Verify**: unit tests + manual provider fetch checks.

- [ ] 2.2 Upgrade strict validator with a real landmark model
  - **Do**: replace `services/fullbody-validator/app/pose.py` heuristics with MediaPipe/OpenPose landmarks.
  - **Done when**: validator detects feet/head/front-facing more reliably than aspect ratio.
  - **Verify**: `cd services/fullbody-validator && pytest`.

- [ ] 2.3 Quality checkpoint
  - **Verify**: `npm test` + `npm run build`

## Phase 3: Tests

- [ ] 3.1 Add route-level tests for iMessage upload + bridge auth
  - **Do**: add integration-style tests that hit `channelOutboxRoutes` handlers with fake requests.
  - **Files**: `apps/mcp-server/src/routes/*.test.ts`
  - **Verify**: `cd apps/mcp-server && npm test`

- [ ] 3.2 Add an end-to-end mocked iMessage bridge test
  - **Do**: simulate an inbound iMessage event -> backend -> outbox -> bridge send (without a real `imsg` binary).
  - **Files**: `apps/imsg-bridge/src/*`, `apps/mcp-server/src/channels/*`
  - **Verify**: `npm test`

## Phase 4: Quality gates

- [ ] 4.1 CI pipeline (GitHub Actions)
  - **Do**: add CI for build + tests; optionally run Python validator tests.
  - **Verify**: CI green on PR.

- [ ] 4.2 Production runbook + alerting checklist
  - **Do**: add docs for secrets, backups, retention, incident response.

## Phase 5: PR / release (optional)

- [ ] 5.1 Update docs/changelog (if needed)
- [ ] 5.2 Monitor CI and resolve failures
