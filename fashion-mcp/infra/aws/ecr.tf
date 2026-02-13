resource "aws_ecr_repository" "mcp_server" {
  name                 = "${local.name}-mcp-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "fullbody_validator" {
  name                 = "${local.name}-fullbody-validator"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

