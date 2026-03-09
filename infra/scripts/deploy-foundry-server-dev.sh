#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <server-hostname> [support-email]" >&2
  exit 1
fi

HOST="$1"
SERVER_HOSTNAME="$2"
SUPPORT_EMAIL="${3:-support@example.com}"
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

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "SERVER_HOSTNAME='${SERVER_HOSTNAME}' SUPPORT_EMAIL='${SUPPORT_EMAIL}' DEST='${DEST}' bash -s" <<'EOF'
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
ENVFILE

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
curl -fsS http://127.0.0.1:8090/health
EOF
