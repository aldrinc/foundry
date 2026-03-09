#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <server-hostname> [support-email]" >&2
  exit 1
fi

HOST="$1"
SERVER_HOSTNAME="$2"
SUPPORT_EMAIL="${3:-support@example.com}"
GITHUB_APP_NAME="${FOUNDRY_GITHUB_APP_NAME:-Foundry}"
GITHUB_API_URL="${FOUNDRY_GITHUB_API_URL:-https://api.github.com}"
GITHUB_APP_ID="${FOUNDRY_GITHUB_APP_ID:-}"
GITHUB_CLIENT_ID="${FOUNDRY_GITHUB_CLIENT_ID:-}"
GITHUB_WEBHOOK_SECRET="${FOUNDRY_GITHUB_WEBHOOK_SECRET:-}"
GITHUB_APP_PRIVATE_KEY_PATH="${FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH:-}"
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
  "SERVER_HOSTNAME='${SERVER_HOSTNAME}' SUPPORT_EMAIL='${SUPPORT_EMAIL}' DEST='${DEST}' GITHUB_APP_NAME='${GITHUB_APP_NAME}' GITHUB_API_URL='${GITHUB_API_URL}' GITHUB_APP_ID='${GITHUB_APP_ID}' GITHUB_CLIENT_ID='${GITHUB_CLIENT_ID}' GITHUB_WEBHOOK_SECRET='${GITHUB_WEBHOOK_SECRET}' GITHUB_APP_PRIVATE_KEY_PATH='${GITHUB_APP_PRIVATE_KEY_PATH}' WORKSPACE_BOOTSTRAP_SECRET='${WORKSPACE_BOOTSTRAP_SECRET}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p /etc/foundry
cat > /etc/foundry/foundry-server.env <<ENVFILE
FOUNDRY_ENVIRONMENT=staging
FOUNDRY_HOST=127.0.0.1
FOUNDRY_PORT=8090
FOUNDRY_PUBLIC_BASE_URL=https://${SERVER_HOSTNAME}
FOUNDRY_API_BASE_URL=https://${SERVER_HOSTNAME}
FOUNDRY_SUPPORT_EMAIL=${SUPPORT_EMAIL}
FOUNDRY_AUTH_PROVIDER=oidc
FOUNDRY_GITHUB_APP_NAME=${GITHUB_APP_NAME}
FOUNDRY_GITHUB_API_URL=${GITHUB_API_URL}
FOUNDRY_GITHUB_APP_ID=${GITHUB_APP_ID}
FOUNDRY_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
FOUNDRY_GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
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
for attempt in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:8090/health >/dev/null; then
    exit 0
  fi
  sleep 1
done

echo "foundry-server did not become healthy in time" >&2
exit 1
EOF
