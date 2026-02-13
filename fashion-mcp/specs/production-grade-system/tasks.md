# Tasks: Build a production-grade fashion MCP platform on AWS with Auth0 auth, deep-link commerce, in-house data controls, and full testing

## Overview

Total tasks: 16

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

- [x] 1.1 Security baseline and runtime config
  - **Do**: remove committed secret artifact from runtime usage, add `.gitignore`, add typed config loader, wire config usage in server startup.
  - **Files**: `.gitignore`, `apps/mcp-server/src/config.ts`, `apps/mcp-server/src/index.ts`, `README.md`
  - **Done when**: server refuses startup on invalid env and docs reflect required env.
  - **Verify**: `npm --workspace apps/mcp-server run build`
  - _Reqs: FR-1, AC-1.1_

- [x] 1.2 Scope-enforced tool registration
  - **Do**: add authz helper and enforce required scopes on each protected tool.
  - **Files**: `apps/mcp-server/src/auth/authz.ts`, `apps/mcp-server/src/mcp/server.ts`
  - **Done when**: unauthorized scopes are rejected per tool contract.
  - **Verify**: automated tests + local tool invocation checks

- [x] 1.3 Expand persistence model
  - **Do**: add migration for consents, photo sets/photos, try-on jobs, audit events, idempotency keys, and useful indexes.
  - **Files**: `apps/mcp-server/src/db/migrations/002_production_foundation.sql`
  - **Done when**: migration applies cleanly after `001_init.sql`.
  - **Verify**: `npm run db:migrate`

- [x] 1.4 Implement domain repositories
  - **Do**: create reusable DB repository modules for profile/catalog/feedback/try-on/approval/audit.
  - **Files**: `apps/mcp-server/src/db/repos/*.ts`
  - **Done when**: tool handlers no longer embed raw duplicated SQL.
  - **Verify**: `npm --workspace apps/mcp-server run build`

- [x] 1.5 Quality checkpoint
  - **Do**: run local checks to catch regressions early
  - **Verify**: `npm --workspace packages/shared run build` + `npm --workspace apps/mcp-server run build`
  - **Done when**: all checks pass

- [x] 1.6 POC checkpoint (end-to-end)
  - **Do**: validate the feature works in a realistic environment
  - **Verify**: run local server and call `profile.get`, `styleMap.getViewportItems`, `tryon.renderItemOnUser`, `checkout.createApprovalLink`
  - **Done when**: the core flow can be demonstrated

## Phase 2: Refactor

- [x] 2.1 Extract and align with project patterns
  - **Do**: split tool registration by domain module and centralize schema contracts in shared package.
  - **Files**: `apps/mcp-server/src/mcp/tools/*.ts`, `packages/shared/src/index.ts`, `apps/mcp-server/src/mcp/server.ts`
  - **Done when**: code is idiomatic for this repo
  - **Verify**: `npm --workspace packages/shared run build` + `npm --workspace apps/mcp-server run build`

- [x] 2.2 Quality checkpoint
  - **Verify**: `npm run build`

## Phase 3: Tests

- [x] 3.1 Unit tests
  - **Do**: add tests for config validation, auth scope guard, and schema boundaries.
  - **Verify**: `npm --workspace apps/mcp-server run test`
  - _Reqs: AC-1.x_

- [x] 3.2 Integration tests (if applicable)
  - **Do**: validate key tool handlers with DB-backed flows (profile, map, feedback, try-on, approvals).
  - **Verify**: `npm --workspace apps/mcp-server run test:integration`
  - _Reqs: AC-2.1, AC-2.2, AC-3.1, AC-3.2_

## Phase 4: Quality gates

- [x] 4.1 Lint/format/types
  - **Verify**: `npm run build`

- [x] 4.2 Full test suite / build
  - **Verify**: `npm --workspace apps/mcp-server run test && npm --workspace apps/mcp-server run test:integration && npm run build`

## Phase 5: PR / release (optional)

- [ ] 5.1 Update docs/changelog (if needed)
- [ ] 5.2 Monitor CI and resolve failures
