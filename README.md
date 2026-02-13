# Drip

[![CI](https://github.com/gary322/drip/actions/workflows/ci.yml/badge.svg)](https://github.com/gary322/drip/actions/workflows/ci.yml)

Production-grade, headless **fashion + styling + virtual try-on** system designed to be used via:
- **ChatGPT** (Model Context Protocol / MCP tools + an in-chat “Style Map” widget)
- **iMessage/SMS** (via a macOS bridge)
- **WhatsApp** and **Telegram** (webhook + sender workers)

Core principles:
- **Server-side data**: user photos, profiles, budgets, and generated try-ons are stored on *your* infra (Postgres + object storage).
- **Explicit consent**: purchase is always gated by an **approval link**.
- **Real try-on only**: production is locked to **Google Vertex AI Virtual Try-On** (no “fake” local compositor fallback).
- **Full-body enforcement**: the system rejects non head-to-toe images (and can require feet + front-facing).

The main product lives in `fashion-mcp/`.

## What’s Implemented

**Styling + planning**
- Store a user budget/goals/sizes.
- Generate capsules/outfits within a budget.
- “Style Space” map widget rendered inside ChatGPT.

**Try-on**
- Async try-on jobs (`tryon.renderItemOnUser`, `tryon.renderOutfitOnUser`, `tryon.getJobStatus`).
- Production try-on uses **Google Vertex AI Virtual Try-On** (`TRYON_PROVIDER=google_vertex` + `TRYON_PROVIDER_STRICT=true`).
- Generated images are written to **S3** and returned as **presigned URLs**.

**Full-body validation**
- Photo ingestion rejects headshot / cropped photos (`full_body_photo_required`).
- Strict mode calls a MediaPipe-based validator service (Python sidecar) to enforce:
  - head-to-toe framing
  - minimum resolution / aspect ratio
  - feet visibility (optional)
  - front-facing likelihood

**Checkout**
- Budget enforcement at checkout (block over-budget unless explicitly allowed).
- Stripe checkout session creation when `CHECKOUT_PROVIDER=stripe`.
- Always returns an approval link (`/approve/:token`) for explicit consent.

**Auth**
- `AUTH_MODE=dev` for local/dev testing and scripted e2e runs.
- `AUTH_MODE=oauth` for production (JWT validation via JWKS; works with Auth0/Okta/Cognito). See `fashion-mcp/README.md`.

**Omnichannel**
- iMessage bridge app (runs on macOS) that relays inbound/outbound messages + attachments.
- WhatsApp/Telegram sender + webhook support is implemented but disabled by default in AWS deploy.

## Repo Layout

- `fashion-mcp/`: main monorepo (Node/TS MCP server + shared package + iMessage bridge + infra + tests)
  - `fashion-mcp/apps/mcp-server/`: MCP server + widget resources
  - `fashion-mcp/services/fullbody-validator/`: strict full-body validator (FastAPI + MediaPipe)
  - `fashion-mcp/apps/imsg-bridge/`: macOS iMessage/SMS bridge that talks to the backend over HTTPS
  - `fashion-mcp/infra/aws/`: Terraform + `deploy.sh` for AWS (ECS Fargate + ALB + RDS + S3)
- `sop.txt`: end-to-end system blueprint and workflows

## Documentation Index

- Product overview + local dev: `fashion-mcp/README.md`
- AWS deploy: `fashion-mcp/infra/aws/README.md`
- Tool contracts: `fashion-mcp/docs/tool-contracts.md`
- Production checklist: `fashion-mcp/docs/production-checklist.md`

## Local Development

See `fashion-mcp/README.md` for full details. Quick path:

```bash
cd fashion-mcp
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Server:
- `GET http://localhost:8787/healthz`
- `POST http://localhost:8787/mcp`

Run tests:

```bash
cd fashion-mcp
npm test
npm run test:integration
node scripts/e2e_fullbody_enforcement.mjs
node scripts/e2e_stripe_budget_checkout.mjs
```

## AWS Deployment (Recommended)

The AWS deploy is automated via Terraform + a deploy script:

- Infra: `fashion-mcp/infra/aws/`
- Deploy script: `fashion-mcp/infra/aws/scripts/deploy.sh`

From `fashion-mcp/infra/aws`:

```bash
./scripts/deploy.sh
```

Outputs:
- Base URL: ALB (HTTP by default)
- Health: `GET /healthz`
- MCP: `POST /mcp`

Notes:
- ECS tasks are configured for **ARM64** (matching images built on Apple Silicon).
- The default Terraform config is set to run ECS tasks in **public subnets with public IPs**
  to avoid NAT gateway + EIP quota requirements. For production hardening, enable NAT and
  move tasks to private subnets.
- Secrets must be stored in **AWS Secrets Manager** (deploy script writes them).

Details: `fashion-mcp/infra/aws/README.md`

## ChatGPT Usage (MCP)

This server validates `Origin` to prevent DNS rebinding. In production, allow:
- `https://chatgpt.com`
- `https://www.chatgpt.com`

For local scripts/tests, set:

```bash
MCP_ORIGIN='https://chatgpt.com'
```

## iMessage Bridge (macOS)

iMessage is not available on AWS. Run the bridge on macOS:
- `fashion-mcp/apps/imsg-bridge/README.md`
- Requires installing `imsg` on the Mac and granting permissions for Messages.app automation.

## Secrets / Safety

Do **not** commit secrets.
- `google.txt`, `stripe.txt`, and `.secrets/` are intended as local-only inputs.
- AWS deploy uses Secrets Manager and injects values into ECS at runtime.

## Status

AWS deployment has been exercised with:
- `/healthz` passing (DB up, strict full-body validator up, try-on provider `google_vertex`, checkout provider `stripe`)
- End-to-end try-on producing an S3 presigned image URL (Google Vertex VTO)
- Stripe budget enforcement producing blocked + allowed approval flows
