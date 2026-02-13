# AWS Deployment (ECS Fargate + ALB + RDS + S3)

This folder contains Terraform + scripts to deploy the `fashion-mcp` stack to AWS.

## What You Get

- VPC (public + private subnets)
  - Default: ECS tasks run in **public subnets with public IPs** (`ecs_use_public_subnets=true`) to avoid NAT gateway + EIP quota requirements.
  - Optional: enable NAT + run ECS in private subnets (`enable_nat_gateway=true`, `ecs_use_public_subnets=false`).
- Application Load Balancer (HTTP; optional HTTPS with ACM cert)
- ECS Fargate:
  - `api` service (public) with try-on worker disabled
  - `worker` service that processes try-on jobs
  - `fullbody-validator` runs as a sidecar container in each task
- RDS Postgres 16 (password managed by RDS + stored in Secrets Manager)
- S3 bucket for inbound media + generated try-on outputs (served via presigned URLs)
- Secrets Manager placeholders for:
  - Google service account JSON (`GOOGLE_APPLICATION_CREDENTIALS_JSON`)
  - Stripe secret key (`STRIPE_SECRET_KEY`)
  - Stripe webhook secret (`STRIPE_WEBHOOK_SECRET`)

## Prereqs

- AWS credentials configured locally (`aws sts get-caller-identity` succeeds)
- `terraform`, `docker`, `aws` CLI installed
- You must **not** commit secrets. This repo already contains local `google.txt` and `stripe.txt`; they are treated as local-only inputs.

## Deploy (Recommended)

From `fashion-mcp/infra/aws`:

```bash
./scripts/deploy.sh
```

What the script does:
1. `terraform apply` with services scaled to `0` (so tasks won't start until secrets are present)
2. Builds + pushes Docker images to ECR
3. Writes required secrets to Secrets Manager (defaults to extracting from `../../google.txt` and `../../stripe.txt`)
4. Runs DB migrations + seed via one-off ECS tasks
5. Scales services up to `1`

## Verify

After deploy, the script prints the ALB base URL. You can verify:

```bash
curl -fsS http://<alb-dns>/healthz
curl -fsS http://<alb-dns>/
```

Run end-to-end checks from `fashion-mcp/`:

```bash
cd ../../
MCP_URL="http://<alb-dns>/mcp" MCP_ORIGIN="https://chatgpt.com" MCP_TOKEN="dev_e2e_user" \
  node scripts/e2e_fullbody_enforcement.mjs

MCP_URL="http://<alb-dns>/mcp" MCP_ORIGIN="https://chatgpt.com" MCP_TOKEN="dev_e2e_user" \
  node scripts/e2e_internet_budget_tryon.mjs

MCP_URL="http://<alb-dns>/mcp" MCP_ORIGIN="https://chatgpt.com" MCP_TOKEN="dev_e2e_user" \
  node scripts/e2e_stripe_budget_checkout.mjs
```

### Inputs / Overrides

You can override defaults via env vars:

- `AWS_REGION` (default `us-east-1`)
- `TF_ENVIRONMENT` (default `prod`)
- `IMAGE_TAG` (default `latest`)
- `GOOGLE_TXT_PATH` (default `<repo-root>/google.txt`)
- `STRIPE_TXT_PATH` (default `<repo-root>/stripe.txt`)
- `STRIPE_SECRET_KEY` (if set, used instead of parsing `stripe.txt`)
- `STRIPE_WEBHOOK_SECRET` (optional; if unset, a placeholder is stored)

### Network Mode Notes

If you enable `enable_nat_gateway=true`, Terraform will attempt to allocate an Elastic IP for the NAT gateway.
If your AWS account has a low EIP quota, the default “public subnets” mode is a safer starting point.

## Enable HTTPS (Production)

WhatsApp/Telegram webhooks and ChatGPT MCP are best served over HTTPS.

1. Provision an ACM certificate in the same region.
2. Re-apply Terraform with:

```bash
terraform apply -var enable_https=true -var acm_certificate_arn=arn:aws:acm:...
```

If you have a custom domain, set `public_base_url_override` to your domain URL so approval links match it:

```bash
terraform apply -var public_base_url_override=https://api.yourdomain.com
```

## Troubleshooting

- Check ALB health: `curl http://<alb-dns>/healthz`
- Check ECS logs in CloudWatch: log group `/ecs/<name>`
- Ensure Google Vertex has been enabled and the service account has permission to call it.
