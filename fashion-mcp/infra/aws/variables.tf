variable "region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "us-east-1"
}

variable "name_prefix" {
  type        = string
  description = "Base name prefix for resources."
  default     = "drip"
}

variable "environment" {
  type        = string
  description = "Environment name (e.g., dev/staging/prod)."
  default     = "prod"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags applied to all resources."
  default     = {}
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR."
  default     = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Two public subnet CIDRs."
  default     = ["10.40.0.0/24", "10.40.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Two private subnet CIDRs."
  default     = ["10.40.10.0/24", "10.40.11.0/24"]
}

variable "enable_nat_gateway" {
  type        = bool
  description = "If true, create a NAT gateway for private-subnet egress (requires an available EIP quota)."
  default     = false
}

variable "ecs_use_public_subnets" {
  type        = bool
  description = "If true, run ECS tasks in public subnets with public IPs (no NAT required)."
  default     = true
}

variable "enable_https" {
  type        = bool
  description = "If true, create an HTTPS listener on the ALB."
  default     = false
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN to use when enable_https=true."
  default     = ""
}

variable "public_base_url_override" {
  type        = string
  description = "If set, use this as PUBLIC_BASE_URL instead of the ALB DNS name."
  default     = ""
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type        = number
  description = "RDS storage in GB."
  default     = 20
}

variable "db_multi_az" {
  type        = bool
  description = "Whether to enable Multi-AZ for RDS."
  default     = false
}

variable "db_name" {
  type        = string
  description = "Database name."
  default     = "fashion"
}

variable "db_username" {
  type        = string
  description = "Master username (password is managed by RDS/Secrets Manager)."
  default     = "fashion"
}

variable "ecs_task_cpu" {
  type        = number
  description = "Fargate task CPU units."
  default     = 512
}

variable "ecs_task_memory" {
  type        = number
  description = "Fargate task memory (MiB)."
  default     = 2048
}

variable "api_desired_count" {
  type        = number
  description = "Desired count for the public API service. Default 0 so you can set secrets before starting tasks."
  default     = 0
}

variable "worker_desired_count" {
  type        = number
  description = "Desired count for the background worker service. Default 0 so you can set secrets before starting tasks."
  default     = 0
}

variable "image_tag" {
  type        = string
  description = "Docker image tag to deploy (pushed to ECR by the deploy script)."
  default     = "latest"
}

variable "auth_mode" {
  type        = string
  description = "AUTH_MODE for the server (dev|oauth)."
  default     = "dev"
}

variable "allowed_origins" {
  type        = string
  description = "Comma-separated allowed Origin values (MCP origin guard)."
  default     = "https://chatgpt.com,https://www.chatgpt.com"
}

variable "checkout_provider" {
  type        = string
  description = "CHECKOUT_PROVIDER for the server (deep_link|stripe)."
  default     = "stripe"
}

variable "google_cloud_project" {
  type        = string
  description = "GCP project ID for Vertex Virtual Try-On."
  default     = "bazaar-487219"
}

variable "google_cloud_location" {
  type        = string
  description = "GCP region for Vertex Virtual Try-On."
  default     = "us-central1"
}
