# Requirements: Build a production-grade fashion MCP platform on AWS with Auth0 auth, deep-link commerce, in-house data controls, and full testing

## Goal

Deliver a production-safe MCP platform that supports authenticated multi-user styling, map exploration, preference learning, try-on orchestration, and approval-based deep-link checkout. The system must enforce strict auth scopes, persist critical domain data, and provide automated tests for core behavior.

## Users / personas

- End user in ChatGPT seeking fashion recommendations and outfit planning.
- Platform operator maintaining catalog quality, security posture, and service reliability.

## User stories

### US-1: Secure personalized styling

**As a** signed-in user
**I want** profile-aware recommendations and planning
**So that** results match my budget, sizes, and preferences

**Acceptance criteria**
- AC-1.1: Authenticated tool calls enforce required scopes and reject unauthorized requests.
- AC-1.2: Profile state (budget, goals, sizes) can be created, updated, and retrieved deterministically.

### US-2: Controlled try-on and approval workflow

**As a** signed-in user
**I want** to request try-on jobs and approve purchase intents explicitly
**So that** sensitive operations are auditable and consent-based

**Acceptance criteria**
- AC-2.1: Try-on requests create trackable async jobs with status polling and result references.
- AC-2.2: Approval links are persisted with status transitions and can be queried by owner only.

### US-3: Production observability and testability

**As an** operator
**I want** auditable sensitive events and automated tests for key paths
**So that** releases are reliable and incident response is possible

**Acceptance criteria**
- AC-3.1: Sensitive mutations write audit records with actor and event type.
- AC-3.2: Automated test suite validates auth, profile, map, try-on, and approval behaviors.

## Functional requirements (FR)

| ID | Requirement | Priority | Verification |
|----|-------------|----------|--------------|
| FR-1 | MCP tools must enforce per-tool scopes using verified JWT/dev auth context. | High | Integration test for allowed/denied access by scope |
| FR-2 | System must support profile CRUD for budget, goals, style tags, and sizes. | High | Tool tests with DB assertions |
| FR-3 | Catalog search, viewport map query, and neighbor discovery must be supported. | High | Tool tests with seed catalog |
| FR-4 | Feedback events must persist and influence future ranking hooks. | Medium | DB inserts and response validation |
| FR-5 | Try-on requests must create async jobs and support status/result retrieval. | High | Tool tests for queued -> completed states |
| FR-6 | Approval link creation and status retrieval must be owner-scoped and auditable. | High | Auth + data isolation tests |
| FR-7 | Sensitive writes must emit audit events. | High | DB assertions in integration tests |
| FR-8 | Core tool contracts must be defined in shared schemas. | Medium | Typecheck + schema tests |

## Non-functional requirements (NFR)

| ID | Category | Target | Notes |
|----|----------|--------|-------|
| NFR-1 | Performance | `styleMap.getViewportItems` p95 < 500ms for seeded dataset | cache/DB indexing follow-up for larger catalogs |
| NFR-2 | Security | Token verification + scope checks on all protected tools | Auth0 JWKS in oauth mode |
| NFR-3 | Reliability | Deterministic tool behavior and idempotent write intent scaffolding | `idempotency_keys` table and checks |
| NFR-4 | Privacy | User assets stored only in platform-controlled storage metadata | no third-party try-on API calls in this implementation |
| NFR-5 | Operability | Automated tests pass in CI-equivalent local run | `npm test` + typecheck + build |

## Out of scope / non-goals

- Full external retailer API checkout execution (deep-link only).
- Real GPU try-on inference implementation (job orchestration only in this phase).
- Full Terraform/Kubernetes production deployment assets.

## Assumptions

- Auth0 is approved as identity provider for authentication only.
- AWS remains the primary runtime and data plane.
- Deep-link checkout is acceptable for commerce execution.

## Dependencies

- Postgres database availability for local and test environments.
- Auth0 tenant configuration for oauth mode validation.
- MCP Apps host behavior consistent with Streamable HTTP expectations.

## Success metrics

- All defined tools compile and pass tests.
- Auth/scope denial tests succeed for unauthorized tool calls.
- End-to-end local flow works: profile -> map -> feedback -> try-on job -> approval link status.
