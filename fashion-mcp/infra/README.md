# infra

Production IaC lives here.

- AWS (ECS Fargate + ALB + RDS + S3): `infra/aws` (see `infra/aws/README.md`)

Production should additionally include:
- Remote Terraform state (S3 + DynamoDB lock)
- TLS termination (ACM + HTTPS listener) + domain + DNS
- WAF / rate limiting (AWS WAF + ALB)
- Observability (metrics, dashboards, alerts)
