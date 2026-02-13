resource "random_id" "suffix" {
  byte_length = 4
}

locals {
  name = "${var.name_prefix}-${var.environment}"

  tags = merge(
    {
      app = var.name_prefix
      env = var.environment
    },
    var.tags
  )

  asset_bucket_name = "${local.name}-assets-${random_id.suffix.hex}"

  app_scheme      = var.enable_https ? "https" : "http"
  public_base_url = var.public_base_url_override != "" ? var.public_base_url_override : "${local.app_scheme}://${aws_lb.app.dns_name}"
}

