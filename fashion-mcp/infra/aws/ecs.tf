resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
}

resource "aws_lb" "app" {
  name               = "${local.name}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-tg"
  port        = 8787
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/healthz"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.enable_https ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = var.enable_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "forward" {
      for_each = var.enable_https ? [] : [1]
      content {
        target_group {
          arn = aws_lb_target_group.api.arn
        }
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

locals {
  base_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "8787" },
    { name = "PUBLIC_BASE_URL", value = local.public_base_url },
    { name = "ALLOWED_ORIGINS", value = var.allowed_origins },
    { name = "AUTH_MODE", value = var.auth_mode },

    # DB (derived at runtime from secret)
    { name = "DATABASE_SECRET_ARN", value = try(aws_db_instance.postgres.master_user_secret[0].secret_arn, "") },
    # RDS-managed secrets often include only username/password; pass connection target explicitly.
    { name = "DATABASE_HOST", value = aws_db_instance.postgres.address },
    { name = "DATABASE_PORT", value = tostring(aws_db_instance.postgres.port) },
    { name = "DATABASE_NAME", value = var.db_name },
    { name = "DATABASE_SSL", value = "true" },

    # Full-body enforcement
    { name = "TRYON_REQUIRE_FULL_BODY_PHOTOS", value = "true" },
    { name = "FULLBODY_VALIDATOR_MODE", value = "strict" },
    { name = "FULLBODY_VALIDATOR_URL", value = "http://127.0.0.1:8090/validate" },
    { name = "FULLBODY_REQUIRE_FEET_VISIBLE", value = "true" },

    # Try-on provider (no local compositor in production)
    { name = "TRYON_PROVIDER", value = "google_vertex" },
    { name = "TRYON_PROVIDER_STRICT", value = "true" },
    { name = "GOOGLE_CLOUD_PROJECT", value = var.google_cloud_project },
    { name = "GOOGLE_CLOUD_LOCATION", value = var.google_cloud_location },

    # Media storage (S3 only in production)
    { name = "ASSET_STORE_PROVIDER", value = "s3" },
    { name = "ASSET_S3_BUCKET", value = aws_s3_bucket.assets.bucket },

    # Checkout
    { name = "CHECKOUT_PROVIDER", value = var.checkout_provider },
    { name = "CHECKOUT_ENFORCE_BUDGET", value = "true" },

    # Channels disabled by default (enable later by setting *_ENABLED + required secrets)
    { name = "WHATSAPP_ENABLED", value = "false" },
    { name = "TELEGRAM_ENABLED", value = "false" },
    { name = "IMESSAGE_BRIDGE_ENABLED", value = "false" },
  ]

  base_secrets = [
    { name = "GOOGLE_APPLICATION_CREDENTIALS_JSON", valueFrom = aws_secretsmanager_secret.google_creds_json.arn },
    { name = "STRIPE_SECRET_KEY", valueFrom = aws_secretsmanager_secret.stripe_secret_key.arn },
    { name = "STRIPE_WEBHOOK_SECRET", valueFrom = aws_secretsmanager_secret.stripe_webhook_secret.arn },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_task_cpu)
  memory                   = tostring(var.ecs_task_memory)

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "fullbody-validator"
      image     = "${aws_ecr_repository.fullbody_validator.repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 8090, hostPort = 8090, protocol = "tcp" }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=2).read()\""]
        interval    = 10
        timeout     = 5
        retries     = 10
        startPeriod = 15
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "fullbody"
        }
      }
    },
    {
      name      = "mcp-server"
      image     = "${aws_ecr_repository.mcp_server.repository_url}:${var.image_tag}"
      essential = true
      dependsOn = [{ containerName = "fullbody-validator", condition = "HEALTHY" }]
      portMappings = [
        { containerPort = 8787, hostPort = 8787, protocol = "tcp" }
      ]
      environment = concat(local.base_env, [
        { name = "TRYON_WORKER_ENABLED", value = "false" }
      ])
      secrets = local.base_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_task_cpu)
  memory                   = tostring(var.ecs_task_memory)

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "fullbody-validator"
      image     = "${aws_ecr_repository.fullbody_validator.repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 8090, hostPort = 8090, protocol = "tcp" }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=2).read()\""]
        interval    = 10
        timeout     = 5
        retries     = 10
        startPeriod = 15
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "fullbody"
        }
      }
    },
    {
      name      = "mcp-server"
      image     = "${aws_ecr_repository.mcp_server.repository_url}:${var.image_tag}"
      essential = true
      dependsOn = [{ containerName = "fullbody-validator", condition = "HEALTHY" }]
      portMappings = [
        { containerPort = 8787, hostPort = 8787, protocol = "tcp" }
      ]
      environment = concat(local.base_env, [
        { name = "TRYON_WORKER_ENABLED", value = "true" }
      ])
      secrets = local.base_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count

  launch_type = "FARGATE"

  network_configuration {
    subnets          = var.ecs_use_public_subnets ? aws_subnet.public[*].id : aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = var.ecs_use_public_subnets
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "mcp-server"
    container_port   = 8787
  }

  health_check_grace_period_seconds = 90

  enable_execute_command = true

  depends_on = [aws_lb_listener.http, aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count

  launch_type = "FARGATE"

  network_configuration {
    subnets          = var.ecs_use_public_subnets ? aws_subnet.public[*].id : aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = var.ecs_use_public_subnets
  }

  enable_execute_command = true
}
