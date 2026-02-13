# Design: Build a production-grade fashion MCP platform on AWS with Auth0 auth, deep-link commerce, in-house data controls, and full testing

## Overview

Evolve the current single-process MCP server into a production-grade application slice with strict authorization, expanded persistence model, modular tool handlers, and automated tests. Keep one deployable API service for now, but structure code as domain modules so internal services can be split later without contract changes. Implement deep-link checkout with explicit approval tracking and asynchronous try-on job orchestration while keeping user data in first-party storage metadata.

## Architecture

### Component diagram (edit to match the codebase)

```mermaid
graph TB
  User[ChatGPT User] --> MCP[MCP Server (Express + Streamable HTTP)]
  MCP --> Auth[Auth Context + Scope Guard]
  MCP --> Tools[Tool Handlers]
  Tools --> DB[(Postgres)]
  Tools --> Store[(Asset Metadata / URL references)]
  Tools --> Audit[(Audit Events)]
  MCP --> Widget[Map Widget Resource]
```

### Key components

- **`config` module**: Validates runtime env and exposes strongly typed config.
- **`authz` module**: Declares scope requirements and enforces them in tool handlers.
- **`repositories` module**: Encapsulates SQL operations for profile/catalog/feedback/try-on/approval/audit.
- **`tool modules`**: Register tools by domain with input validation and scoped access.
- **`test harness`**: Runs unit tests for auth/config and integration-style tests for tool behavior.

## Data model / state

- `profiles`: adds durable `sizes`, budget/goals/style tags.
- `consents`: `(user_id, consent_type, granted, granted_at, revoked_at, metadata)`.
- `photo_sets` and `photos`: user-owned photo collections for try-on inputs.
- `tryon_jobs`: async job state machine with input refs, output refs, and error field.
- `audit_events`: immutable log with `actor_user_id`, `event_type`, `entity_type`, `entity_id`, `payload`.
- `idempotency_keys`: request-level dedupe support scaffold.
- `approvals`: keep existing table but add audit tracking on creation/status checks.

## Interfaces / APIs

- **Inputs**: Zod-validated tool args in shared package for profile/catalog/style-map/feedback/planning/try-on/checkout domains.
- **Outputs**: MCP tool responses with `structuredContent` contracts and optional widget metadata.
- **Errors**:
  - `401 unauthorized` when token missing/invalid.
  - `403 insufficient_scope` for scope mismatch.
  - Tool-level validation errors from schema parsing.
  - `404 not_found` for user-owned records missing.

## File-level changes

| File | Action | Purpose |
|------|--------|---------|
| `apps/mcp-server/src/config.ts` | Create | runtime env validation and config loading |
| `apps/mcp-server/src/auth/authz.ts` | Create | declarative per-tool scope enforcement helper |
| `apps/mcp-server/src/mcp/server.ts` | Modify | replace monolithic handlers with scoped, modular registration |
| `apps/mcp-server/src/mcp/tools/*.ts` | Create | domain-separated tool handlers |
| `apps/mcp-server/src/db/migrations/002_production_foundation.sql` | Create | expanded production entities |
| `apps/mcp-server/src/db/repos/*.ts` | Create | DB query encapsulation |
| `packages/shared/src/index.ts` | Modify | expanded schemas/contracts |
| `apps/mcp-server/package.json` | Modify | test tooling and scripts |
| `apps/mcp-server/src/**/*.test.ts` | Create | automated test coverage |
| `.gitignore` | Create | avoid committing secrets/build artifacts |

## Failure modes & error handling

- Missing/invalid token -> return OAuth challenge -> user prompted to reconnect account.
- Scope mismatch -> fail fast in tool wrapper -> explicit insufficient scope response.
- Missing user-owned resources (photo set/job/approval) -> return structured not found.
- DB write errors -> map to internal MCP error and log event with request correlation.

## Edge cases

- User requests try-on without consent — reject request until consent record granted.
- Duplicate tool mutation retries — reserve idempotency framework with stable keys.
- Empty map viewport query — return empty items/clusters with consistent schema.
- Approval token requested by non-owner — return not found.

## Security & privacy

- Token verification from Auth0 JWKS in oauth mode plus strict audience/issuer checks.
- Per-tool scopes mapped by domain and enforced inside tool registration wrapper.
- Sensitive mutations emit audit events.
- No external try-on API calls; only metadata and internal references are stored.

## Performance considerations

- Add indexes for frequent lookup paths (`products` by coordinates/category/price, `tryon_jobs` by user/status).
- Keep viewport and catalog queries bounded by limit parameters.
- Split heavy operations into async jobs (try-on).

## Test strategy

Map tests back to acceptance criteria.

- **Unit**: config validation, auth scope guard behavior, schema parsing.
- **Integration**: tool handlers against test DB for profile/map/feedback/try-on/approval.
- **E2E**: local script path: set profile -> query map -> submit feedback -> create try-on job -> create approval link -> check status.

## Rollout / migration plan (if needed)

1. Apply migration `002_production_foundation.sql`.
2. Deploy server changes with dual-compatible tool contracts.
3. Run automated test suite.
4. Smoke-test in dev mode, then oauth mode.
