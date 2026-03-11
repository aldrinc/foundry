#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: deploy-foundry-server-sidecar-dev.sh <host> [server-hostname] [core-public-url] [support-email]

examples:
  deploy-foundry-server-sidecar-dev.sh 178.156.253.167
  deploy-foundry-server-sidecar-dev.sh 178.156.253.167 foundry-server-dev.178.156.253.167.sslip.io https://zulip-dev-live.5.161.60.86.sslip.io
EOF
}

derive_sslip_hostname() {
  local prefix="$1"
  local host="$2"
  if [[ "${host}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s.%s.sslip.io\n' "${prefix}" "${host}"
    return
  fi
  return 1
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

HOST="$1"
SERVER_HOSTNAME="${2:-}"
CORE_PUBLIC_URL="${3:-${FOUNDRY_DEV_CORE_URL:-}}"
SUPPORT_EMAIL="${4:-support@example.com}"

if [[ -z "${SERVER_HOSTNAME}" ]]; then
  if ! SERVER_HOSTNAME="$(derive_sslip_hostname "foundry-server-dev" "${HOST}")"; then
    echo "server-hostname is required when host is not an IPv4 address" >&2
    exit 1
  fi
fi

if [[ -z "${CORE_PUBLIC_URL}" ]]; then
  echo "core-public-url is required (set the third argument or FOUNDRY_DEV_CORE_URL)" >&2
  exit 1
fi

PORT="${FOUNDRY_DEV_PORT:-18092}"
AUTH_PROVIDER="${FOUNDRY_DEV_AUTH_PROVIDER:-local_password}"
BOOTSTRAP_ADMIN_EMAIL="${FOUNDRY_DEV_BOOTSTRAP_ADMIN_EMAIL:-platform-admin@foundry.local}"
BOOTSTRAP_ADMIN_PASSWORD="${FOUNDRY_DEV_BOOTSTRAP_ADMIN_PASSWORD:-}"
CORE_BOOTSTRAP_SECRET="${FOUNDRY_DEV_CORE_BOOTSTRAP_SECRET:-}"
CORE_REALM_KEY_OVERRIDE="${FOUNDRY_DEV_CORE_REALM_KEY_OVERRIDE:-}"
ANTHROPIC_API_KEY="${FOUNDRY_DEV_ANTHROPIC_API_KEY:-${ANTHROPIC_API_KEY:-}}"
ANTHROPIC_API_BASE_URL="${FOUNDRY_DEV_ANTHROPIC_API_BASE_URL:-}"
ANTHROPIC_MODEL="${FOUNDRY_DEV_ANTHROPIC_MODEL:-}"
GITHUB_APP_NAME="${FOUNDRY_DEV_GITHUB_APP_NAME:-Foundry}"
GITHUB_API_URL="${FOUNDRY_DEV_GITHUB_API_URL:-https://api.github.com}"
GITHUB_APP_ID="${FOUNDRY_DEV_GITHUB_APP_ID:-}"
GITHUB_CLIENT_ID="${FOUNDRY_DEV_GITHUB_CLIENT_ID:-}"
GITHUB_WEBHOOK_SECRET="${FOUNDRY_DEV_GITHUB_WEBHOOK_SECRET:-}"
GITHUB_APP_PRIVATE_KEY_PATH="${FOUNDRY_DEV_GITHUB_APP_PRIVATE_KEY_PATH:-}"
CODER_URL="${FOUNDRY_DEV_CODER_URL:-}"
CODER_API_TOKEN="${FOUNDRY_DEV_CODER_API_TOKEN:-}"
CODER_CONTAINER_NAME="${FOUNDRY_DEV_CODER_CONTAINER_NAME:-foundry-coder}"
CODER_TEMPLATE_NAME="${FOUNDRY_DEV_CODER_TEMPLATE_NAME:-foundry-hetzner-workspace}"
CODER_TEMPLATE_SOURCE_DIR="${FOUNDRY_DEV_CODER_TEMPLATE_SOURCE_DIR:-/opt/foundry/coder-templates/foundry-hetzner-workspace}"
CODER_INTERNAL_URL="${FOUNDRY_DEV_CODER_INTERNAL_URL:-http://127.0.0.1:7080}"
HCLOUD_TOKEN="${FOUNDRY_DEV_HCLOUD_TOKEN:-}"
WORKSPACE_PRIVATE_NETWORK_ID="${FOUNDRY_DEV_WORKSPACE_PRIVATE_NETWORK_ID:-}"
WORKSPACE_FIREWALL_IDS="${FOUNDRY_DEV_WORKSPACE_FIREWALL_IDS:-}"
WORKSPACE_SSH_KEY_IDS="${FOUNDRY_DEV_WORKSPACE_SSH_KEY_IDS:-}"
WORKSPACE_BOOTSTRAP_SECRET="${FOUNDRY_DEV_WORKSPACE_BOOTSTRAP_SECRET:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/services/foundry-server/"
DEST="/opt/foundry/services/foundry-server-dev"
ENV_FILE="/etc/foundry/foundry-server-dev.env"
SERVICE_NAME="foundry-server-dev"
DB_PATH="/var/lib/foundry/foundry-server-dev.db"
ADMIN_PASSWORD_PATH="/etc/foundry/cloud-admin-dev.password"
SSH_OPTS=(-i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new)

rsync -az --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude '*.pyc' \
  -e "ssh ${SSH_OPTS[*]}" \
  "${SRC}" "root@${HOST}:${DEST}/"

if [[ -n "${GITHUB_APP_PRIVATE_KEY_PATH}" ]]; then
  ssh "${SSH_OPTS[@]}" "root@${HOST}" "mkdir -p /etc/foundry"
  rsync -az \
    -e "ssh ${SSH_OPTS[*]}" \
    "${GITHUB_APP_PRIVATE_KEY_PATH}" "root@${HOST}:/etc/foundry/github-app.private-key.pem"
fi

ssh "${SSH_OPTS[@]}" "root@${HOST}" \
  "SERVER_HOSTNAME='${SERVER_HOSTNAME}' CORE_PUBLIC_URL='${CORE_PUBLIC_URL}' SUPPORT_EMAIL='${SUPPORT_EMAIL}' DEST='${DEST}' ENV_FILE='${ENV_FILE}' SERVICE_NAME='${SERVICE_NAME}' PORT='${PORT}' DB_PATH='${DB_PATH}' ADMIN_PASSWORD_PATH='${ADMIN_PASSWORD_PATH}' AUTH_PROVIDER='${AUTH_PROVIDER}' BOOTSTRAP_ADMIN_EMAIL='${BOOTSTRAP_ADMIN_EMAIL}' BOOTSTRAP_ADMIN_PASSWORD='${BOOTSTRAP_ADMIN_PASSWORD}' CORE_BOOTSTRAP_SECRET='${CORE_BOOTSTRAP_SECRET}' CORE_REALM_KEY_OVERRIDE='${CORE_REALM_KEY_OVERRIDE}' ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}' ANTHROPIC_API_BASE_URL='${ANTHROPIC_API_BASE_URL}' ANTHROPIC_MODEL='${ANTHROPIC_MODEL}' GITHUB_APP_NAME='${GITHUB_APP_NAME}' GITHUB_API_URL='${GITHUB_API_URL}' GITHUB_APP_ID='${GITHUB_APP_ID}' GITHUB_CLIENT_ID='${GITHUB_CLIENT_ID}' GITHUB_WEBHOOK_SECRET='${GITHUB_WEBHOOK_SECRET}' GITHUB_APP_PRIVATE_KEY_PATH='${GITHUB_APP_PRIVATE_KEY_PATH}' CODER_URL='${CODER_URL}' CODER_API_TOKEN='${CODER_API_TOKEN}' CODER_CONTAINER_NAME='${CODER_CONTAINER_NAME}' CODER_TEMPLATE_NAME='${CODER_TEMPLATE_NAME}' CODER_TEMPLATE_SOURCE_DIR='${CODER_TEMPLATE_SOURCE_DIR}' CODER_INTERNAL_URL='${CODER_INTERNAL_URL}' HCLOUD_TOKEN='${HCLOUD_TOKEN}' WORKSPACE_PRIVATE_NETWORK_ID='${WORKSPACE_PRIVATE_NETWORK_ID}' WORKSPACE_FIREWALL_IDS='${WORKSPACE_FIREWALL_IDS}' WORKSPACE_SSH_KEY_IDS='${WORKSPACE_SSH_KEY_IDS}' WORKSPACE_BOOTSTRAP_SECRET='${WORKSPACE_BOOTSTRAP_SECRET}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p /etc/foundry /var/lib/foundry "${DEST}"

if ! id foundrydev >/dev/null 2>&1; then
  echo "foundrydev user is required on the target host" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local env_file="$2"
  python3 - "$key" "$env_file" <<'PY'
from pathlib import Path
import sys

key = sys.argv[1]
env_file = Path(sys.argv[2])
if not env_file.is_file():
    raise SystemExit(0)

for line in env_file.read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    current_key, value = line.split("=", 1)
    if current_key == key:
        print(value)
        raise SystemExit(0)
PY
}

fill_from_env_file() {
  local target_var="$1"
  local key="$2"
  local env_file="$3"
  local current_value="${!target_var}"
  if [[ -n "${current_value}" ]]; then
    return
  fi
  local next_value
  next_value="$(read_env_value "${key}" "${env_file}")"
  if [[ -n "${next_value}" ]]; then
    printf -v "${target_var}" '%s' "${next_value}"
  fi
}

for source_env in "${ENV_FILE}" /etc/foundry/foundry-server.env; do
  fill_from_env_file AUTH_PROVIDER FOUNDRY_AUTH_PROVIDER "${source_env}"
  fill_from_env_file BOOTSTRAP_ADMIN_EMAIL FOUNDRY_BOOTSTRAP_ADMIN_EMAIL "${source_env}"
  fill_from_env_file BOOTSTRAP_ADMIN_PASSWORD FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD "${source_env}"
  fill_from_env_file CORE_BOOTSTRAP_SECRET FOUNDRY_CORE_BOOTSTRAP_SECRET "${source_env}"
  fill_from_env_file CORE_REALM_KEY_OVERRIDE FOUNDRY_CORE_REALM_KEY_OVERRIDE "${source_env}"
  fill_from_env_file ANTHROPIC_API_KEY FOUNDRY_ANTHROPIC_API_KEY "${source_env}"
  fill_from_env_file ANTHROPIC_API_BASE_URL FOUNDRY_ANTHROPIC_API_BASE_URL "${source_env}"
  fill_from_env_file ANTHROPIC_MODEL FOUNDRY_ANTHROPIC_MODEL "${source_env}"
  fill_from_env_file GITHUB_APP_NAME FOUNDRY_GITHUB_APP_NAME "${source_env}"
  fill_from_env_file GITHUB_API_URL FOUNDRY_GITHUB_API_URL "${source_env}"
  fill_from_env_file GITHUB_APP_ID FOUNDRY_GITHUB_APP_ID "${source_env}"
  fill_from_env_file GITHUB_CLIENT_ID FOUNDRY_GITHUB_CLIENT_ID "${source_env}"
  fill_from_env_file GITHUB_WEBHOOK_SECRET FOUNDRY_GITHUB_WEBHOOK_SECRET "${source_env}"
  fill_from_env_file CODER_URL FOUNDRY_CODER_URL "${source_env}"
  fill_from_env_file CODER_API_TOKEN FOUNDRY_CODER_API_TOKEN "${source_env}"
  fill_from_env_file CODER_CONTAINER_NAME FOUNDRY_CODER_CONTAINER_NAME "${source_env}"
  fill_from_env_file CODER_TEMPLATE_NAME FOUNDRY_CODER_TEMPLATE_NAME "${source_env}"
  fill_from_env_file CODER_TEMPLATE_SOURCE_DIR FOUNDRY_CODER_TEMPLATE_SOURCE_DIR "${source_env}"
  fill_from_env_file CODER_INTERNAL_URL FOUNDRY_CODER_INTERNAL_URL "${source_env}"
  fill_from_env_file HCLOUD_TOKEN FOUNDRY_HCLOUD_TOKEN "${source_env}"
  fill_from_env_file WORKSPACE_PRIVATE_NETWORK_ID FOUNDRY_WORKSPACE_PRIVATE_NETWORK_ID "${source_env}"
  fill_from_env_file WORKSPACE_FIREWALL_IDS FOUNDRY_WORKSPACE_FIREWALL_IDS "${source_env}"
  fill_from_env_file WORKSPACE_SSH_KEY_IDS FOUNDRY_WORKSPACE_SSH_KEY_IDS "${source_env}"
  fill_from_env_file WORKSPACE_BOOTSTRAP_SECRET FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET "${source_env}"
done

if [[ -z "${BOOTSTRAP_ADMIN_PASSWORD}" ]]; then
  if [[ -f "${ADMIN_PASSWORD_PATH}" ]]; then
    BOOTSTRAP_ADMIN_PASSWORD="$(cat "${ADMIN_PASSWORD_PATH}")"
  else
    BOOTSTRAP_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
    printf '%s\n' "${BOOTSTRAP_ADMIN_PASSWORD}" > "${ADMIN_PASSWORD_PATH}"
    chmod 600 "${ADMIN_PASSWORD_PATH}"
  fi
fi

if [[ -z "${CORE_BOOTSTRAP_SECRET}" && -f /etc/foundry/core-bootstrap.secret ]]; then
  CORE_BOOTSTRAP_SECRET="$(cat /etc/foundry/core-bootstrap.secret)"
fi

if [[ -z "${CODER_API_TOKEN}" && -f /etc/foundry/coder-admin.token ]]; then
  CODER_API_TOKEN="$(cat /etc/foundry/coder-admin.token)"
fi

chown -R foundrydev:foundrydev "${DEST}" /var/lib/foundry

python3 - "${SERVER_HOSTNAME}" "${PORT}" <<'PY'
from pathlib import Path
import re
import sys

hostname = sys.argv[1]
port = sys.argv[2]
caddyfile = Path("/etc/caddy/Caddyfile")
existing = caddyfile.read_text(encoding="utf-8") if caddyfile.exists() else ""
block = f"""{hostname} {{
  encode zstd gzip
  reverse_proxy 127.0.0.1:{port}
}}"""
pattern = re.compile(rf"(?ms)^{re.escape(hostname)} \{{\n.*?\n\}}\n?")
updated = pattern.sub("", existing).rstrip()
updated = f"{updated}\n\n{block}\n" if updated else f"{block}\n"
if updated != existing:
    caddyfile.parent.mkdir(parents=True, exist_ok=True)
    caddyfile.write_text(updated, encoding="utf-8")
PY

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^caddy\.service'; then
  systemctl reload caddy
fi

cat > "${ENV_FILE}" <<ENVFILE
FOUNDRY_ENVIRONMENT=staging
FOUNDRY_HOST=127.0.0.1
FOUNDRY_PORT=${PORT}
FOUNDRY_PUBLIC_BASE_URL=https://${SERVER_HOSTNAME}
FOUNDRY_API_BASE_URL=https://${SERVER_HOSTNAME}
FOUNDRY_SUPPORT_EMAIL=${SUPPORT_EMAIL}
FOUNDRY_DATABASE_PATH=${DB_PATH}
FOUNDRY_AUTH_PROVIDER=${AUTH_PROVIDER}
FOUNDRY_BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL}
FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_ADMIN_PASSWORD}
FOUNDRY_CORE_URL=${CORE_PUBLIC_URL}
FOUNDRY_CORE_BOOTSTRAP_SECRET=${CORE_BOOTSTRAP_SECRET}
FOUNDRY_GITHUB_APP_NAME=${GITHUB_APP_NAME}
FOUNDRY_GITHUB_API_URL=${GITHUB_API_URL}
FOUNDRY_GITHUB_APP_ID=${GITHUB_APP_ID}
FOUNDRY_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
FOUNDRY_GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
FOUNDRY_CODER_URL=${CODER_URL}
FOUNDRY_CODER_API_TOKEN=${CODER_API_TOKEN}
FOUNDRY_CODER_CONTAINER_NAME=${CODER_CONTAINER_NAME}
FOUNDRY_CODER_TEMPLATE_NAME=${CODER_TEMPLATE_NAME}
FOUNDRY_CODER_TEMPLATE_SOURCE_DIR=${CODER_TEMPLATE_SOURCE_DIR}
FOUNDRY_CODER_INTERNAL_URL=${CODER_INTERNAL_URL}
FOUNDRY_CODER_PROVISIONER_KEY_DIR=/var/lib/foundry/coder-provisioner-keys
FOUNDRY_CODER_PROVISIONER_CACHE_DIR=/var/lib/foundry/coder-provisioner-cache
FOUNDRY_HCLOUD_TOKEN=${HCLOUD_TOKEN}
FOUNDRY_WORKSPACE_PRIVATE_NETWORK_ID=${WORKSPACE_PRIVATE_NETWORK_ID}
FOUNDRY_WORKSPACE_FIREWALL_IDS=${WORKSPACE_FIREWALL_IDS}
FOUNDRY_WORKSPACE_SSH_KEY_IDS=${WORKSPACE_SSH_KEY_IDS}
FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET=${WORKSPACE_BOOTSTRAP_SECRET}
ENVFILE

if [[ -n "${CORE_REALM_KEY_OVERRIDE}" ]]; then
  echo "FOUNDRY_CORE_REALM_KEY_OVERRIDE=${CORE_REALM_KEY_OVERRIDE}" >> "${ENV_FILE}"
fi

if [[ -n "${ANTHROPIC_API_KEY}" ]]; then
  echo "FOUNDRY_ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" >> "${ENV_FILE}"
fi

if [[ -n "${ANTHROPIC_API_BASE_URL}" ]]; then
  echo "FOUNDRY_ANTHROPIC_API_BASE_URL=${ANTHROPIC_API_BASE_URL}" >> "${ENV_FILE}"
fi

if [[ -n "${ANTHROPIC_MODEL}" ]]; then
  echo "FOUNDRY_ANTHROPIC_MODEL=${ANTHROPIC_MODEL}" >> "${ENV_FILE}"
fi

if [[ -n "${GITHUB_APP_PRIVATE_KEY_PATH}" ]]; then
  echo "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH=/etc/foundry/github-app.private-key.pem" >> "${ENV_FILE}"
  chown root:foundrydev /etc/foundry/github-app.private-key.pem
  chmod 640 /etc/foundry/github-app.private-key.pem
fi

python3 -m venv "${DEST}/.venv"
"${DEST}/.venv/bin/pip" install --upgrade pip >/dev/null
"${DEST}/.venv/bin/pip" install -e "${DEST}" >/dev/null
chown -R foundrydev:foundrydev "${DEST}"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNITFILE
[Unit]
Description=Foundry Server Dev
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=foundrydev
Group=foundrydev
WorkingDirectory=${DEST}
EnvironmentFile=${ENV_FILE}
ExecStart=${DEST}/.venv/bin/uvicorn foundry_server.app:app --app-dir ${DEST}/src --host 127.0.0.1 --port ${PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITFILE

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"

for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    exit 0
  fi
  sleep 1
done

echo "${SERVICE_NAME} did not become healthy in time" >&2
exit 1
EOF

echo "server_url=https://${SERVER_HOSTNAME}"
