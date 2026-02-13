---
spec: production-grade-system
phase: research
created: 2026-02-12T14:53:09+00:00
---

# Research: production-grade-system

## Goal

Build a production-grade fashion MCP platform on AWS with Auth0 auth, deep-link commerce, in-house data controls, and full testing

## Executive summary

- Feasibility: Medium. The current codebase is a solid scaffold, but it lacks production data modeling, strict authorization, and test coverage.
- Key constraints:
  - User data must remain in our AWS environment (except identity in Auth0).
  - Checkout must remain deep-link based; no autonomous order placement.
  - Existing code is single-service and needs modular expansion without breaking MCP compatibility.
- Risks:
  - Secret leakage and weak auth scope enforcement can cause immediate security incidents.
  - Broad feature scope requires incremental hardening and quality gates to avoid unstable releases.
  - Try-on quality and throughput require async job architecture and careful resource controls.

## Codebase scan

### Relevant existing components

- `apps/mcp-server/src/index.ts` — central app composition and route registration.
- `apps/mcp-server/src/mcp/server.ts` — all current tool handlers and widget resource registration.
- `apps/mcp-server/src/mcp/transport.ts` — request authentication and Streamable HTTP handling.
- `apps/mcp-server/src/auth/*` — token verification, protected resource metadata, and async auth context.
- `apps/mcp-server/src/db/migrations/001_init.sql` — initial persistence model and constraints.
- `apps/mcp-server/public/style-map.html` — map widget behavior and MCP Apps bridge integration.
- `packages/shared/src/index.ts` — shared schemas for tool inputs.

### Patterns to follow

- MCP tool registration through `registerAppTool` in `apps/mcp-server/src/mcp/server.ts`.
- Request-scoped auth context via `runWithAuth` / `getAuth` in `apps/mcp-server/src/auth/requestContext.ts`.
- Strict schema validation with Zod in `packages/shared/src/index.ts`.
- DB access through pooled Postgres client in `apps/mcp-server/src/db/pool.ts`.

### Gaps / missing pieces

- No per-tool authorization scopes — unauthorized access risk.
- Minimal schema lacks consents, photos, try-on jobs, audit logs, idempotency, and deep-link metadata.
- Approval flow is demo-only and lacks robust event tracking.
- No test framework or automated validation pipeline.
- No environment/config validation; misconfiguration can silently break auth/security.

## External research (optional)

- `sop.txt` (repo root) — defines target architecture and production expectations for MCP, map UX, auth, and safety.

## Open questions

- Is Stripe needed for subscriptions only, or should it be omitted until a payment requirement exists?
- Is Auth0 acceptable as the only third-party processor for identity data?

## Sources

- `sop.txt`
- `apps/mcp-server/src/mcp/server.ts`
- `apps/mcp-server/src/mcp/transport.ts`
- `apps/mcp-server/src/auth/verifyAccessToken.ts`
- `apps/mcp-server/src/db/migrations/001_init.sql`
