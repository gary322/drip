# Requirements: Enforce full head-to-toe capture and deliver try-on via iMessage, ChatGPT, WhatsApp, Telegram

## Goal

Deliver a production-grade omnichannel styling platform where users can interact through ChatGPT, iMessage, WhatsApp, and Telegram, and where try-on requests are accepted only when the user provides a valid full head-to-toe front-facing photo verified by server-side checks.

## Users / personas

- End user: wants styling recommendations and try-on outputs under budget through their preferred messaging channel.
- Platform operator: monitors reliability, abuse, and compliance.
- Compliance/security owner: enforces data handling, consent, retention, and audit controls.

## User stories

### US-1: Mandatory full-body capture quality gate

**As a** user
**I want** clear instructions for accepted photos and immediate rejection reasons when my photo is invalid
**So that** I can provide a valid head-to-toe image that produces usable try-on results.

**Acceptance criteria**
- AC-1.1: System rejects photos that are not full body with explicit machine-readable reason codes.
- AC-1.2: System rejects photos without visible feet/ankles for the primary try-on profile photo.
- AC-1.3: System rejects side-profile/non-frontal primary photos.
- AC-1.4: System provides remediation instructions after rejection.
- AC-1.5: Try-on tools refuse execution until at least one approved full-body photo exists.

### US-2: Omnichannel conversation continuity

**As a** user
**I want** to use the same account and context across ChatGPT, iMessage, WhatsApp, and Telegram
**So that** my budget, preferences, and prior try-on history are preserved.

**Acceptance criteria**
- AC-2.1: A channel identity can be linked to one Auth0 user profile.
- AC-2.2: Inbound messages from any channel map to the same user session context.
- AC-2.3: Outbound responses preserve channel format constraints (text, media, links).
- AC-2.4: All inbound/outbound channel events are auditable by message ID.

### US-3: Try-on and style recommendations under budget

**As a** user
**I want** recommendations and try-on options that consider my budget
**So that** purchase options remain financially aligned.

**Acceptance criteria**
- AC-3.1: Recommendation queries can include budget ceiling constraints.
- AC-3.2: Checkout link generation enforces budget by default.
- AC-3.3: Over-budget flows require explicit override (`allowOverBudget=true`).

### US-4: Secure consented media handling

**As a** compliance owner
**I want** photo storage and processing to be consent-gated and traceable
**So that** we can satisfy privacy and audit requirements.

**Acceptance criteria**
- AC-4.1: Photo ingest without consent is rejected.
- AC-4.2: Consent events are timestamped and auditable.
- AC-4.3: Photo delete request performs soft-delete immediately and hard-delete by retention policy.
- AC-4.4: Sensitive logs redact raw URLs/tokens by default.

### US-5: Operable production deployment

**As an** operator
**I want** health signals, retries, and alerting for every channel adapter and worker
**So that** incidents are detected and recovered quickly.

**Acceptance criteria**
- AC-5.1: Health endpoints include channel adapter readiness.
- AC-5.2: Dead-letter handling exists for failed inbound events.
- AC-5.3: Alerting thresholds exist for error rate, queue lag, and message delivery failures.

## Functional requirements (FR)

| ID | Requirement | Priority | Verification |
|----|-------------|----------|--------------|
| FR-1 | Profile photo ingest must require consent and file metadata integrity checks. | High | Unit + integration tests for consent and schema errors |
| FR-2 | System must run a strict full-body validator before marking any photo as try-on eligible. | High | Validator tests with pass/fail fixtures |
| FR-3 | Validator must require visible head, shoulders, hips, knees, ankles, and feet landmarks at confidence thresholds. | High | Landmark fixture tests |
| FR-4 | Validator must require front-facing posture for the primary photo. | High | Orientation fixture tests |
| FR-5 | Validator must return reason codes (`feet_missing`, `not_front_facing`, `low_resolution`, `no_person_detected`, etc.). | High | API contract tests |
| FR-6 | Try-on job creation must fail with `full_body_photo_required` if no approved profile photo is available. | High | Tool integration tests |
| FR-7 | System must store per-photo validation report JSON for audit and debugging. | High | DB assertion tests |
| FR-8 | System must expose a reusable channel-neutral message orchestration service. | High | Service unit tests |
| FR-9 | ChatGPT channel must continue using MCP tools and Apps resource widgets. | High | MCP integration tests |
| FR-10 | WhatsApp adapter must ingest webhook events and send outbound replies/media via official API. | High | Webhook contract tests + mocked outbound tests |
| FR-11 | Telegram adapter must ingest webhook updates and send outbound replies/media via Bot API. | High | Webhook contract tests + mocked outbound tests |
| FR-12 | iMessage adapter must integrate `imsg rpc` for inbound watch and outbound send. | High | Local adapter integration tests on macOS runner |
| FR-13 | Channel adapters must normalize inbound events into one canonical envelope schema. | High | Schema tests |
| FR-14 | Every outbound channel message must carry idempotency key and delivery status tracking. | High | DB assertions + retry tests |
| FR-15 | Account linking flow must map channel identity to Auth0 user ID via signed one-time link. | High | Integration test for link flow |
| FR-16 | Channel identity records must support unlink/relink and uniqueness constraints. | Medium | Repository tests |
| FR-17 | Recommendation flow must accept budget constraints and user style tags across channels. | High | API tests |
| FR-18 | Try-on results must be shareable through channel-specific media/link payloads. | High | Adapter serialization tests |
| FR-19 | Checkout link generation must work from all channels and preserve approval token ownership. | High | Cross-channel integration tests |
| FR-20 | Stripe webhook events must update approval status idempotently and be traceable. | High | Existing + expanded webhook tests |
| FR-21 | Deep-link purchase path must remain available when payment session is not used. | High | Tool tests |
| FR-22 | Rate limiting must be applied per-channel and per-user context. | High | Load tests |
| FR-23 | Webhook authenticity must be verified for WhatsApp and Telegram before processing. | High | Signature validation tests |
| FR-24 | iMessage bridge must authenticate to backend using mTLS or signed service JWT. | High | Security integration tests |
| FR-25 | Failed channel deliveries must retry with exponential backoff and dead-letter queue fallback. | High | Queue integration tests |
| FR-26 | Operators must be able to replay dead-letter events safely. | Medium | Replay integration tests |
| FR-27 | All media should be stored in server-managed storage with signed URL access only. | High | Storage integration tests |
| FR-28 | Photo and try-on deletion APIs must support compliance retention policy enforcement. | High | API + DB tests |
| FR-29 | System must emit audit events for ingest, validation, try-on, channel send/receive, and checkout actions. | High | Audit event assertions |
| FR-30 | Structured error catalog must be consistent across MCP and channel APIs. | Medium | Snapshot tests |
| FR-31 | Channel command parser must support "upload photo", "set budget", "show outfits", "try-on", "checkout" intents. | High | Parser tests |
| FR-32 | Inbound media fetcher must reject unsupported formats and files above configured limit. | High | File validation tests |
| FR-33 | Full-body guidance prompt must be sent before first ingest and after every rejection. | High | Conversation flow tests |
| FR-34 | iMessage bridge must support chat routing by `chat_id` and `chat_identifier` from `imsg`. | Medium | Bridge tests |
| FR-35 | WhatsApp/Telegram adapters must support sending image + caption for try-on results. | High | Adapter tests |
| FR-36 | End-to-end test suite must cover at least one full flow per channel from inbound message to approval link. | High | E2E CI pipeline |

## Non-functional requirements (NFR)

| ID | Category | Target | Notes |
|----|----------|--------|-------|
| NFR-1 | Availability | 99.9% monthly for core API | Excludes iMessage local bridge outages |
| NFR-2 | Latency | p95 < 700ms for non-try-on command handling | Try-on remains async job |
| NFR-3 | Throughput | Sustain 50 inbound msgs/s burst, 10 sustained | Horizontal scaling on AWS |
| NFR-4 | Security | OWASP ASVS L2 controls for API/webhook boundaries | Signature checks + authn/authz |
| NFR-5 | Privacy | PII at rest encrypted (KMS-managed keys) | RDS + S3 encryption |
| NFR-6 | Logging | No secrets/tokens/raw auth headers in logs | Redaction middleware required |
| NFR-7 | Auditability | 100% sensitive mutations produce audit event | Verified in tests |
| NFR-8 | Reliability | At-least-once processing with idempotent handlers | Queue + dedupe keys |
| NFR-9 | Disaster recovery | RPO <= 15 min, RTO <= 60 min | Backups and runbooks |
| NFR-10 | Compliance | Region-scoped deployment + retention enforcement | AWS region locks + lifecycle rules |
| NFR-11 | Cost control | Per-channel and per-user quotas with budgets | Protects against abuse spikes |
| NFR-12 | Model quality | <5% false accept rate for non-full-body primary photos | Measured on labeled eval set |

## Out of scope / non-goals

- Auto-login and direct automation of third-party retailer consumer accounts.
- Fully autonomous checkout without explicit user approval.
- Native mobile apps for iOS/Android in this phase.
- Replacing Auth0 with custom IdP in this phase.

## Assumptions

- Primary deployment runs on AWS.
- Auth0 tenant and client setup are available for production.
- WhatsApp Business and Telegram bot credentials are provisioned.
- iMessage channel is delivered through one or more managed macOS bridge hosts.
- Google Vertex try-on usage is acceptable when explicit consent is granted.

## Dependencies

- `imsg` binary available on macOS bridge hosts with required permissions.
- Auth0 management and application credentials.
- Stripe keys/webhook signing secret.
- Meta/Telegram API credentials and webhook endpoints.
- Pose landmark inference runtime (MediaPipe microservice or equivalent).

## Success metrics

- >= 98% of accepted profile photos pass manual spot-check for true head-to-toe framing.
- >= 95% of rejected photos return correct actionable reason code.
- 100% channel inbound events carry trace IDs and auth-verified origin.
- Full end-to-end flow passes in CI for ChatGPT + mocked WhatsApp/Telegram and in staging for iMessage bridge.
- No P0 security findings in pre-launch penetration test.
