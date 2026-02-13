resource "aws_secretsmanager_secret" "google_creds_json" {
  name = "${local.name}/google_application_credentials_json"
}

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name = "${local.name}/stripe_secret_key"
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name = "${local.name}/stripe_webhook_secret"
}

