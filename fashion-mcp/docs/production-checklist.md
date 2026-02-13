# Production checklist (non-negotiables)

## Auth & security
- OAuth 2.1 with PKCE + dynamic client registration as required by ChatGPT Apps SDK auth flow.
- Validate Origin header for Streamable HTTP transport (DNS rebinding protection).
- Verify access tokens: signature, issuer, audience, expiry, scopes.
- Enforce least-privilege scopes per tool.
- Audit log all sensitive operations:
  - photo ingestion
  - try-on generation
  - checkout approval creation and decision
  - order placement

## Privacy
- Explicit user consent for:
  - storing photos
  - generating try-on images
  - using address and payment
- Data retention policies:
  - allow deletion of photos/try-on outputs
- Encryption at rest for PII and photos.

## Commerce
- Prefer official APIs/feeds and deep links.
- Do not store retailer passwords.
- Require explicit approval before any purchase action.

## Reliability
- Rate limiting per user/client
- Backpressure for try-on jobs
- Caching for viewport queries
