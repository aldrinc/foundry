#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <server-hostname> [support-email]" >&2
  exit 1
fi

HOST="$1"
SERVER_HOSTNAME="$2"
SUPPORT_EMAIL="${3:-support@example.com}"
AUTH_PROVIDER="${FOUNDRY_AUTH_PROVIDER:-local_password}"
BOOTSTRAP_ADMIN_EMAIL="${FOUNDRY_BOOTSTRAP_ADMIN_EMAIL:-platform-admin@foundry.local}"
BOOTSTRAP_ADMIN_PASSWORD="${FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD:-}"
CORE_URL="${FOUNDRY_CORE_URL:-${SERVER_HOSTNAME/server-dev./core-dev.}}"
CORE_BOOTSTRAP_SECRET="${FOUNDRY_CORE_BOOTSTRAP_SECRET:-}"
GITHUB_APP_NAME="${FOUNDRY_GITHUB_APP_NAME:-Foundry}"
GITHUB_API_URL="${FOUNDRY_GITHUB_API_URL:-https://api.github.com}"
GITHUB_APP_ID="${FOUNDRY_GITHUB_APP_ID:-}"
GITHUB_CLIENT_ID="${FOUNDRY_GITHUB_CLIENT_ID:-}"
GITHUB_WEBHOOK_SECRET="${FOUNDRY_GITHUB_WEBHOOK_SECRET:-}"
GITHUB_APP_PRIVATE_KEY_PATH="${FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH:-}"
CODER_URL="${FOUNDRY_CODER_URL:-${SERVER_HOSTNAME/server-dev./coder-dev.}}"
CODER_API_TOKEN="${FOUNDRY_CODER_API_TOKEN:-}"
WORKSPACE_BOOTSTRAP_SECRET="${FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/services/foundry-server/"
DEST="/opt/foundry/services/foundry-server"

rsync -az --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude '*.pyc' \
  -e "ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new" \
  "${SRC}" "root@${HOST}:${DEST}/"

if [[ -n "${GITHUB_APP_PRIVATE_KEY_PATH}" ]]; then
  ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" "mkdir -p /etc/foundry"
  rsync -az \
    -e "ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new" \
    "${GITHUB_APP_PRIVATE_KEY_PATH}" "root@${HOST}:/etc/foundry/github-app.private-key.pem"
fi

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "SERVER_HOSTNAME='${SERVER_HOSTNAME}' SUPPORT_EMAIL='${SUPPORT_EMAIL}' DEST='${DEST}' AUTH_PROVIDER='${AUTH_PROVIDER}' BOOTSTRAP_ADMIN_EMAIL='${BOOTSTRAP_ADMIN_EMAIL}' BOOTSTRAP_ADMIN_PASSWORD='${BOOTSTRAP_ADMIN_PASSWORD}' CORE_URL='${CORE_URL}' CORE_BOOTSTRAP_SECRET='${CORE_BOOTSTRAP_SECRET}' GITHUB_APP_NAME='${GITHUB_APP_NAME}' GITHUB_API_URL='${GITHUB_API_URL}' GITHUB_APP_ID='${GITHUB_APP_ID}' GITHUB_CLIENT_ID='${GITHUB_CLIENT_ID}' GITHUB_WEBHOOK_SECRET='${GITHUB_WEBHOOK_SECRET}' GITHUB_APP_PRIVATE_KEY_PATH='${GITHUB_APP_PRIVATE_KEY_PATH}' CODER_URL='${CODER_URL}' CODER_API_TOKEN='${CODER_API_TOKEN}' WORKSPACE_BOOTSTRAP_SECRET='${WORKSPACE_BOOTSTRAP_SECRET}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p /etc/foundry
mkdir -p /var/lib/foundry
chown foundrydev:foundrydev /var/lib/foundry

read_env_value() {
  local key="$1"
  local env_file="/etc/foundry/foundry-server.env"
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

if [[ -f /etc/foundry/foundry-server.env ]]; then
  [[ -n "${AUTH_PROVIDER}" ]] || AUTH_PROVIDER="$(read_env_value FOUNDRY_AUTH_PROVIDER)"
  [[ -n "${BOOTSTRAP_ADMIN_EMAIL}" ]] || BOOTSTRAP_ADMIN_EMAIL="$(read_env_value FOUNDRY_BOOTSTRAP_ADMIN_EMAIL)"
  [[ -n "${BOOTSTRAP_ADMIN_PASSWORD}" ]] || BOOTSTRAP_ADMIN_PASSWORD="$(read_env_value FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD)"
  [[ -n "${CORE_URL}" ]] || CORE_URL="$(read_env_value FOUNDRY_CORE_URL)"
  [[ -n "${CORE_BOOTSTRAP_SECRET}" ]] || CORE_BOOTSTRAP_SECRET="$(read_env_value FOUNDRY_CORE_BOOTSTRAP_SECRET)"
  [[ -n "${GITHUB_APP_NAME}" ]] || GITHUB_APP_NAME="$(read_env_value FOUNDRY_GITHUB_APP_NAME)"
  [[ -n "${GITHUB_API_URL}" ]] || GITHUB_API_URL="$(read_env_value FOUNDRY_GITHUB_API_URL)"
  [[ -n "${GITHUB_APP_ID}" ]] || GITHUB_APP_ID="$(read_env_value FOUNDRY_GITHUB_APP_ID)"
  [[ -n "${GITHUB_CLIENT_ID}" ]] || GITHUB_CLIENT_ID="$(read_env_value FOUNDRY_GITHUB_CLIENT_ID)"
  [[ -n "${GITHUB_WEBHOOK_SECRET}" ]] || GITHUB_WEBHOOK_SECRET="$(read_env_value FOUNDRY_GITHUB_WEBHOOK_SECRET)"
  [[ -n "${GITHUB_APP_PRIVATE_KEY_PATH}" ]] || GITHUB_APP_PRIVATE_KEY_PATH="$(read_env_value FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH)"
  [[ -n "${CODER_URL}" ]] || CODER_URL="$(read_env_value FOUNDRY_CODER_URL)"
  [[ -n "${CODER_API_TOKEN}" ]] || CODER_API_TOKEN="$(read_env_value FOUNDRY_CODER_API_TOKEN)"
  [[ -n "${WORKSPACE_BOOTSTRAP_SECRET}" ]] || WORKSPACE_BOOTSTRAP_SECRET="$(read_env_value FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET)"
fi

if [[ -z "${BOOTSTRAP_ADMIN_PASSWORD}" ]]; then
  if [[ -f /etc/foundry/cloud-admin.password ]]; then
    BOOTSTRAP_ADMIN_PASSWORD="$(cat /etc/foundry/cloud-admin.password)"
  else
    BOOTSTRAP_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
    printf '%s\n' "${BOOTSTRAP_ADMIN_PASSWORD}" > /etc/foundry/cloud-admin.password
    chmod 600 /etc/foundry/cloud-admin.password
  fi
fi

if [[ -z "${CODER_API_TOKEN}" && -f /etc/foundry/coder-admin.token ]]; then
  CODER_API_TOKEN="$(cat /etc/foundry/coder-admin.token)"
fi

if [[ -z "${CORE_BOOTSTRAP_SECRET}" && -f /etc/foundry/core-bootstrap.secret ]]; then
  CORE_BOOTSTRAP_SECRET="$(cat /etc/foundry/core-bootstrap.secret)"
fi

coder_env_url="${CODER_URL}"
if [[ "${coder_env_url}" != http://* && "${coder_env_url}" != https://* ]]; then
  coder_env_url="https://${coder_env_url}"
fi

core_env_url="${CORE_URL}"
if [[ "${core_env_url}" != http://* && "${core_env_url}" != https://* ]]; then
  core_env_url="https://${core_env_url}"
fi

cat > /etc/foundry/foundry-server.env <<ENVFILE
FOUNDRY_ENVIRONMENT=staging
FOUNDRY_HOST=127.0.0.1
FOUNDRY_PORT=8090
FOUNDRY_PUBLIC_BASE_URL=https://${SERVER_HOSTNAME}
FOUNDRY_API_BASE_URL=https://${SERVER_HOSTNAME}
FOUNDRY_SUPPORT_EMAIL=${SUPPORT_EMAIL}
FOUNDRY_DATABASE_PATH=/var/lib/foundry/foundry-server.db
FOUNDRY_AUTH_PROVIDER=${AUTH_PROVIDER}
FOUNDRY_BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL}
FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_ADMIN_PASSWORD}
FOUNDRY_CORE_URL=${core_env_url}
FOUNDRY_CORE_BOOTSTRAP_SECRET=${CORE_BOOTSTRAP_SECRET}
FOUNDRY_GITHUB_APP_NAME=${GITHUB_APP_NAME}
FOUNDRY_GITHUB_API_URL=${GITHUB_API_URL}
FOUNDRY_GITHUB_APP_ID=${GITHUB_APP_ID}
FOUNDRY_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
FOUNDRY_GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
FOUNDRY_CODER_URL=${coder_env_url}
FOUNDRY_CODER_API_TOKEN=${CODER_API_TOKEN}
FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET=${WORKSPACE_BOOTSTRAP_SECRET}
ENVFILE

if [[ -n "${GITHUB_APP_PRIVATE_KEY_PATH}" ]]; then
  echo "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH=/etc/foundry/github-app.private-key.pem" >> /etc/foundry/foundry-server.env
  chown root:foundrydev /etc/foundry/github-app.private-key.pem
  chmod 640 /etc/foundry/github-app.private-key.pem
fi

cat > /etc/systemd/system/foundry-server.service <<UNITFILE
[Unit]
Description=Foundry Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=foundrydev
Group=foundrydev
WorkingDirectory=${DEST}
EnvironmentFile=/etc/foundry/foundry-server.env
ExecStart=${DEST}/.venv/bin/uvicorn foundry_server.app:app --app-dir ${DEST}/src --host 127.0.0.1 --port 8090
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITFILE

python3 -m venv "${DEST}/.venv"
"${DEST}/.venv/bin/pip" install --upgrade pip >/dev/null
"${DEST}/.venv/bin/pip" install -e "${DEST}" >/dev/null
chown -R foundrydev:foundrydev "${DEST}"
systemctl daemon-reload
systemctl enable --now foundry-server
systemctl restart foundry-server
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8090/health >/dev/null; then
    exit 0
  fi
  sleep 1
done

echo "foundry-server did not become healthy in time" >&2
exit 1
EOF
