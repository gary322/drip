# fashion-mcp (headless fashion + styling app for ChatGPT via MCP + Map widget)

This repository is a **production-oriented starter** for a headless styling product whose **only UX is via MCP tools + a Map-style widget** rendered in ChatGPT.

It includes:
- An **MCP server** (Node/TypeScript) using **Streamable HTTP** transport.
- A **Map widget** (single-file HTML) registered as an MCP **Apps resource** (`ui://widget/style-map.html`).
- OAuth scaffolding with typed runtime config, **protected resource metadata**, and 401 auth challenge behavior.
- A Postgres schema + seed data + production foundation entities (consents, photos, try-on jobs, audits).
- Example tools:
  - `profile.get`, `profile.upsertBudgetAndGoals`, `profile.upsertSizes`, `profile.ingestPhotos`, `profile.deletePhotos`, `profile.setAddress`
  - `catalog.search`, `catalog.getItem`
  - `styleMap.getViewportItems`, `styleMap.getClusters`, `styleMap.getItemNeighbors`
  - `feedback.rateItem`
  - `plan.generateCapsule`, `plan.generateOutfits`, `plan.swapItemInOutfit`
  - `tryon.renderItemOnUser`, `tryon.renderOutfitOnUser`, `tryon.getJobStatus`
  - `checkout.createApprovalLink`
  - `orders.getApprovalStatus`

> Note: This starter **does not** attempt to log into retailers using stored user credentials.
> In production, you should integrate via **official APIs / feeds / affiliate links**, and use
> an explicit user approval flow for checkout.

Try-on behavior:
- `tryon.render*` creates an async job.
- A background worker pulls queued jobs and renders try-on using:
  - `TRYON_PROVIDER=google_vertex`: Google Vertex AI Virtual Try-On API (**no local fallback**; failures fail the job)
  - `TRYON_PROVIDER=local`: simple local compositor (**dev only**, not real try-on)
- Output storage:
  - `ASSET_STORE_PROVIDER=local`: generated images are served from `/generated/<jobId>.<ext>` (`.jpg`/`.png`/`.webp`)
  - `ASSET_STORE_PROVIDER=s3`: generated images are written to S3 and returned as **presigned URLs**
- `profile.ingestPhotos` should include `photoUrls` if you want the worker to render images from user photos.
- `profile.ingestPhotos` enforces full head-to-toe photos by default.
- Photos are stored with validation state (`pending|approved|rejected`) and only approved primary photos can be used by try-on tools/workers.
- Upper-body/head-only photos are rejected with `full_body_photo_required`.
- Strict validator mode (`FULLBODY_VALIDATOR_MODE=strict`) calls a validator service endpoint (MediaPipe-based) before approving photos. This is recommended for production.

Checkout behavior:
- `checkout.createApprovalLink` always creates an explicit approval link.
- With `CHECKOUT_PROVIDER=deep_link`, it returns approval-only links.
- With `CHECKOUT_PROVIDER=stripe`, it also creates a Stripe Checkout session URL.
- Budget enforcement on checkout is controlled by `CHECKOUT_ENFORCE_BUDGET` and `allowOverBudget`.
- Stripe webhook endpoint: `POST /webhooks/stripe` (raw body + signature verified).

## Quickstart (local dev)

### 1) Start Postgres + Redis
```bash
docker compose up -d
```

### 2) Install dependencies
```bash
npm install
```

### 3) Run migrations + seed demo catalog
```bash
npm run db:migrate
npm run db:seed
```

### 4) Start the MCP server
```bash
npm run dev
```

Server:
- MCP endpoint: `http://localhost:8787/mcp`
- OAuth protected resource metadata: `http://localhost:8787/.well-known/oauth-protected-resource`
- Approval link UI (minimal web page): `http://localhost:8787/approve/<token>`
- Postgres (docker compose): `localhost:62111`

## Using with MCP Inspector
Use the MCP Inspector and point it at `http://localhost:8787/mcp`.
Then call `styleMap.getViewportItems` and you should see `structuredContent` payloads that the widget can render.

## Origin validation (required by MCP spec)
This server validates `Origin` on incoming requests (DNS rebinding protection).

- Production should include ChatGPT origins in `ALLOWED_ORIGINS` (default includes `https://chatgpt.com`).
- When running the Node e2e scripts against a deployed server, set:

```bash
MCP_ORIGIN='https://chatgpt.com'
```

## Auth modes
This starter supports two modes:

1) **DEV mode** (default): no real OAuth, but still enforces a Bearer token format.
   - Use header: `Authorization: Bearer dev_user_123`

2) **OAUTH mode** (production): verifies JWTs via JWKS and checks `aud`, `iss`, `exp`, and scopes.

Set in `apps/mcp-server/.env`:
- `AUTH_MODE=dev|oauth`
- `JWKS_URL=...` (oauth mode)
- `JWT_ISSUER=...`
- `JWT_AUDIENCE=https://api.yourdomain.com`
- `AUTHORIZATION_SERVERS=https://auth.yourcompany.com`
- `APPROVAL_TTL_MINUTES=60`
- `MCP_RATE_LIMIT_WINDOW_MS=60000`
- `MCP_RATE_LIMIT_MAX=120`
- `APPROVAL_RATE_LIMIT_WINDOW_MS=60000`
- `APPROVAL_RATE_LIMIT_MAX=30`
- `DATABASE_URL=postgres://...` (recommended for local dev)
- `DATABASE_SECRET_ARN=...` + `DATABASE_HOST=...` + `DATABASE_PORT=...` + `DATABASE_NAME=...` (recommended for AWS; server derives `DATABASE_URL` at boot)
- `TRYON_PROVIDER=local|google_vertex`
- `TRYON_REQUIRE_FULL_BODY_PHOTOS=true|false` (default true)
- `TRYON_MIN_FULL_BODY_WIDTH_PX=512`
- `TRYON_MIN_FULL_BODY_HEIGHT_PX=900`
- `TRYON_MIN_FULL_BODY_ASPECT_RATIO=1.3`
- `FULLBODY_VALIDATOR_MODE=heuristic|strict`
- `FULLBODY_VALIDATOR_URL=http://127.0.0.1:8090/validate`
- `FULLBODY_VALIDATOR_TIMEOUT_MS=20000`
- `FULLBODY_REQUIRE_FEET_VISIBLE=true|false`
- `GOOGLE_CLOUD_PROJECT=...` (required when `TRYON_PROVIDER=google_vertex`)
- `GOOGLE_CLOUD_LOCATION=us-central1`
- `GOOGLE_VERTEX_VTO_MODEL=virtual-try-on-001`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON=...` (service account JSON string; alternative to `GOOGLE_APPLICATION_CREDENTIALS` file path)
- `CHECKOUT_PROVIDER=deep_link|stripe`
- `CHECKOUT_ENFORCE_BUDGET=true|false`
- `STRIPE_SECRET_KEY=...` (required when `CHECKOUT_PROVIDER=stripe`)
- `STRIPE_WEBHOOK_SECRET=...` (required to process Stripe webhooks)
- `STRIPE_SUCCESS_URL=...` (optional absolute URL)
- `STRIPE_CANCEL_URL=...` (optional absolute URL)
- `ASSET_STORE_PROVIDER=local|s3`
- `ASSET_S3_BUCKET=...` (required when `ASSET_STORE_PROVIDER=s3`)
- `ASSET_S3_MEDIA_PREFIX=media`
- `ASSET_S3_GENERATED_PREFIX=generated`
- `ASSET_S3_PRESIGN_TTL_SECONDS=3600`

### Google Virtual Try-On setup
1) Enable Vertex AI API in your GCP project.
2) Set `TRYON_PROVIDER=google_vertex`.
3) Set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`.
4) Provide server credentials via workload identity or `GOOGLE_APPLICATION_CREDENTIALS` (or `GOOGLE_APPLICATION_CREDENTIALS_JSON`).
5) (Optional) set `GOOGLE_OAUTH_ACCESS_TOKEN` for temporary local testing.

### Strict full-body validator service
When `FULLBODY_VALIDATOR_MODE=strict`, the MCP server calls `FULLBODY_VALIDATOR_URL` before approving photos for try-on.

Local service (recommended via Docker):
```bash
cd services/fullbody-validator
docker build -t fullbody-validator:latest .
docker run --rm -p 8090:8090 fullbody-validator:latest
```

## Directory layout
- `apps/mcp-server`: the MCP server and widget resource
- `packages/shared`: shared types + schemas
- `specs/production-grade-system`: Smart-Ralph spec and execution progress
- `infra/aws`: AWS Terraform + deploy script (ECS Fargate + ALB + RDS + S3)

## Testing
```bash
npm run test
npm run test:integration
node scripts/e2e_fullbody_enforcement.mjs
```

## Container build
Build image from repo root:
```bash
docker build -f apps/mcp-server/Dockerfile -t fashion-mcp:latest .
```

## CI
- GitHub Actions workflow: `.github/workflows/ci.yml`
- Pipeline runs migrate, seed, build, unit tests, and integration tests.

## Next steps
- Replace the seed catalog with real ingestion (partner feeds)
- Implement embeddings + personalization
- Replace demo try-on completion with worker queue + GPU pipeline
- Harden approval page with re-authentication and CSRF/session controls
