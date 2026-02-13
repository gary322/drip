#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${HERE}/.." && pwd)"
FASHION_MCP_ROOT="$(cd "${INFRA_DIR}/../.." && pwd)"
DRIP_ROOT="$(cd "${FASHION_MCP_ROOT}/.." && pwd)"

AWS_REGION="${AWS_REGION:-us-east-1}"
TF_ENVIRONMENT="${TF_ENVIRONMENT:-prod}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

GOOGLE_TXT_PATH="${GOOGLE_TXT_PATH:-${DRIP_ROOT}/google.txt}"
STRIPE_TXT_PATH="${STRIPE_TXT_PATH:-${DRIP_ROOT}/stripe.txt}"

function require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_cmd aws
require_cmd terraform
require_cmd docker
require_cmd python3

function tf_out_raw() {
  terraform -chdir="${INFRA_DIR}" output -raw "$1"
}

function tf_out_json() {
  terraform -chdir="${INFRA_DIR}" output -json "$1"
}

function extract_google_sa_json() {
  python3 - "$GOOGLE_TXT_PATH" <<'PY'
import json, sys

path = sys.argv[1]
text = open(path, "r", encoding="utf-8").read()

def extract_json_objects(s):
  # Scan for balanced JSON objects starting at each '{', respecting strings.
  i = 0
  n = len(s)
  while True:
    start = s.find("{", i)
    if start < 0:
      return
    depth = 0
    in_str = False
    esc = False
    for j in range(start, n):
      ch = s[j]
      if in_str:
        if esc:
          esc = False
        elif ch == "\\":
          esc = True
        elif ch == '"':
          in_str = False
      else:
        if ch == '"':
          in_str = True
        elif ch == "{":
          depth += 1
        elif ch == "}":
          depth -= 1
          if depth == 0:
            yield s[start:j+1]
            i = j + 1
            break
    else:
      return

for obj_str in extract_json_objects(text):
  try:
    obj = json.loads(obj_str)
  except Exception:
    continue
  if isinstance(obj, dict) and obj.get("type") == "service_account":
    sys.stdout.write(obj_str)
    sys.exit(0)

raise SystemExit("could_not_find_service_account_json_in_google_txt")
PY
}

function extract_stripe_secret_key() {
  python3 - "$STRIPE_TXT_PATH" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, "r", encoding="utf-8").read()
m = re.search(r"(sk_test_[0-9A-Za-z]+)", text)
if not m:
  raise SystemExit("could_not_find_sk_test_in_stripe_txt")
sys.stdout.write(m.group(1))
PY
}

function aws_put_secret_file() {
  local secret_id="$1"
  local file_path="$2"
  aws --region "${AWS_REGION}" secretsmanager put-secret-value \
    --secret-id "${secret_id}" \
    --secret-string "file://${file_path}" >/dev/null
}

function aws_put_secret_string() {
  local secret_id="$1"
  local secret_value="$2"
  aws --region "${AWS_REGION}" secretsmanager put-secret-value \
    --secret-id "${secret_id}" \
    --secret-string "${secret_value}" >/dev/null
}

function run_ecs_task() {
  local cluster="$1"
  local task_def_arn="$2"
  local subnets_csv="$3"
  local sg_id="$4"
  local command_json="$5"

  local task_arn
  task_arn="$(aws --region "${AWS_REGION}" ecs run-task \
    --cluster "${cluster}" \
    --launch-type FARGATE \
    --task-definition "${task_def_arn}" \
    --network-configuration "awsvpcConfiguration={subnets=[${subnets_csv}],securityGroups=[${sg_id}],assignPublicIp=ENABLED}" \
    --overrides "${command_json}" \
    --query 'tasks[0].taskArn' \
    --output text)"

  if [[ -z "${task_arn}" || "${task_arn}" == "None" ]]; then
    echo "failed to start task" >&2
    exit 1
  fi

  aws --region "${AWS_REGION}" ecs wait tasks-stopped --cluster "${cluster}" --tasks "${task_arn}"

  local exit_code
  exit_code="$(aws --region "${AWS_REGION}" ecs describe-tasks \
    --cluster "${cluster}" \
    --tasks "${task_arn}" \
    --query "tasks[0].containers[?name=='mcp-server'].exitCode | [0]" \
    --output text)"

  if [[ "${exit_code}" != "0" ]]; then
    local reason
    reason="$(aws --region "${AWS_REGION}" ecs describe-tasks \
      --cluster "${cluster}" \
      --tasks "${task_arn}" \
      --query "tasks[0].stoppedReason" \
      --output text)"
    echo "task failed (exit=${exit_code}): ${reason}" >&2
    exit 1
  fi
}

echo "[1/6] Terraform init/apply (services scaled to 0)…"
terraform -chdir="${INFRA_DIR}" init -upgrade >/dev/null
terraform -chdir="${INFRA_DIR}" apply -auto-approve \
  -var "region=${AWS_REGION}" \
  -var "environment=${TF_ENVIRONMENT}" \
  -var "image_tag=${IMAGE_TAG}" \
  -var "api_desired_count=0" \
  -var "worker_desired_count=0"

NAME="$(tf_out_raw name)"
PUBLIC_BASE_URL="$(tf_out_raw public_base_url)"
ECR_MCP="$(tf_out_raw ecr_mcp_server_repo)"
ECR_FBV="$(tf_out_raw ecr_fullbody_validator_repo)"

GOOGLE_SECRET_ARN="$(tf_out_raw secret_google_creds_json_arn)"
STRIPE_SECRET_ARN="$(tf_out_raw secret_stripe_secret_key_arn)"
STRIPE_WEBHOOK_SECRET_ARN="$(tf_out_raw secret_stripe_webhook_secret_arn)"

CLUSTER="$(tf_out_raw ecs_cluster_name)"
TASK_DEF_API="$(tf_out_raw ecs_api_task_definition_arn)"

SUBNETS_CSV="$(tf_out_json public_subnet_ids | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)))')"
TASK_SG="$(tf_out_raw ecs_tasks_security_group_id)"

echo "[2/6] Build + push images to ECR (${IMAGE_TAG})…"
REGISTRY="${ECR_MCP%%/*}"
aws --region "${AWS_REGION}" ecr get-login-password | docker login --username AWS --password-stdin "${REGISTRY}" >/dev/null

docker build -f "${FASHION_MCP_ROOT}/apps/mcp-server/Dockerfile" -t "${ECR_MCP}:${IMAGE_TAG}" "${FASHION_MCP_ROOT}"
docker push "${ECR_MCP}:${IMAGE_TAG}" >/dev/null

docker build -f "${FASHION_MCP_ROOT}/services/fullbody-validator/Dockerfile" -t "${ECR_FBV}:${IMAGE_TAG}" "${FASHION_MCP_ROOT}/services/fullbody-validator"
docker push "${ECR_FBV}:${IMAGE_TAG}" >/dev/null

echo "[3/6] Populate Secrets Manager…"
tmp_google="$(mktemp)"
tmp_google_json=""
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]]; then
  tmp_google_json="${GOOGLE_APPLICATION_CREDENTIALS_JSON}"
else
  tmp_google_json="$(extract_google_sa_json)"
fi
printf "%s" "${tmp_google_json}" > "${tmp_google}"
aws_put_secret_file "${GOOGLE_SECRET_ARN}" "${tmp_google}"
rm -f "${tmp_google}"

stripe_key="${STRIPE_SECRET_KEY:-}"
if [[ -z "${stripe_key}" ]]; then
  stripe_key="$(extract_stripe_secret_key)"
fi
aws_put_secret_string "${STRIPE_SECRET_ARN}" "${stripe_key}"

# Webhook secret is only required when you actually want to process Stripe webhooks.
# We still set a placeholder so ECS secret injection does not fail.
aws_put_secret_string "${STRIPE_WEBHOOK_SECRET_ARN}" "${STRIPE_WEBHOOK_SECRET:-whsec_placeholder_change_me}"

echo "[4/6] Run DB migrations + seed (one-off ECS tasks)…"
run_ecs_task "${CLUSTER}" "${TASK_DEF_API}" "${SUBNETS_CSV}" "${TASK_SG}" \
  '{"containerOverrides":[{"name":"mcp-server","command":["node","dist/db/migrate.js"]}]}'

run_ecs_task "${CLUSTER}" "${TASK_DEF_API}" "${SUBNETS_CSV}" "${TASK_SG}" \
  '{"containerOverrides":[{"name":"mcp-server","command":["node","dist/db/seed.js"]}]}'

echo "[5/6] Scale services up…"
terraform -chdir="${INFRA_DIR}" apply -auto-approve \
  -var "region=${AWS_REGION}" \
  -var "environment=${TF_ENVIRONMENT}" \
  -var "image_tag=${IMAGE_TAG}" \
  -var "api_desired_count=1" \
  -var "worker_desired_count=1"

echo "[6/6] Deployed."
echo "Base URL: ${PUBLIC_BASE_URL}"
echo "Health:   ${PUBLIC_BASE_URL}/healthz"
echo "MCP:      ${PUBLIC_BASE_URL}/mcp"
echo
echo "Next: run e2e against the deployment:"
echo "  MCP_URL='${PUBLIC_BASE_URL}/mcp' MCP_TOKEN=dev_e2e_user USER_PHOTO_URL='s3://<bucket>/<key>' node ../../scripts/e2e_internet_budget_tryon.mjs"
