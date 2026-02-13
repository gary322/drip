output "name" {
  value = local.name
}

output "region" {
  value = var.region
}

output "public_base_url" {
  value = local.public_base_url
}

output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "ecs_tasks_security_group_id" {
  value = aws_security_group.ecs_tasks.id
}

output "ecs_api_task_definition_arn" {
  value = aws_ecs_task_definition.api.arn
}

output "ecs_worker_task_definition_arn" {
  value = aws_ecs_task_definition.worker.arn
}

output "asset_bucket" {
  value = aws_s3_bucket.assets.bucket
}

output "ecr_mcp_server_repo" {
  value = aws_ecr_repository.mcp_server.repository_url
}

output "ecr_fullbody_validator_repo" {
  value = aws_ecr_repository.fullbody_validator.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_api_service_name" {
  value = aws_ecs_service.api.name
}

output "ecs_worker_service_name" {
  value = aws_ecs_service.worker.name
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.address
}

output "rds_master_secret_arn" {
  value = try(aws_db_instance.postgres.master_user_secret[0].secret_arn, null)
}

output "secret_google_creds_json_arn" {
  value = aws_secretsmanager_secret.google_creds_json.arn
}

output "secret_stripe_secret_key_arn" {
  value = aws_secretsmanager_secret.stripe_secret_key.arn
}

output "secret_stripe_webhook_secret_arn" {
  value = aws_secretsmanager_secret.stripe_webhook_secret.arn
}
