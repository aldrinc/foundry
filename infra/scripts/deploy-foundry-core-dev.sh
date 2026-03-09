#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <core-hostname>" >&2
  exit 1
fi

HOST="$1"
CORE_HOSTNAME="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/services/foundry-core/app/"
DEST="/opt/foundry/services/foundry-core/app"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "mkdir -p ${DEST} /var/log/foundry && chown -R foundrydev:foundrydev /opt/foundry/services/foundry-core /var/log/foundry"

rsync -az --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'node_modules' \
  -e "ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new" \
  "${SRC}" "root@${HOST}:${DEST}/"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "CORE_HOSTNAME='${CORE_HOSTNAME}' DEST='${DEST}' bash -s" <<'EOF'
set -euo pipefail

printf '%s\n' 'foundrydev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/foundrydev
chmod 440 /etc/sudoers.d/foundrydev
visudo -cf /etc/sudoers.d/foundrydev >/dev/null
chown -R foundrydev:foundrydev /opt/foundry/services/foundry-core /var/log/foundry

sudo -u foundrydev -H bash -lc "
  cd '${DEST}'
  if [[ ! -d .git ]]; then
    git init -b main
    git config user.name 'Foundry Dev'
    git config user.email 'support@example.com'
    git add -A
    git commit -m 'Import Foundry core snapshot'
  fi
  if [[ -d .venv && ! -x .venv/bin/python ]]; then
    rm -rf .venv
  fi
"

sudo -u foundrydev -H bash -lc "cd '${DEST}' && ./tools/provision </dev/null"

cat > /etc/systemd/system/foundry-core-dev.service <<UNITFILE
[Unit]
Description=Foundry Core Dev Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=foundrydev
Group=foundrydev
WorkingDirectory=${DEST}
Environment=EXTERNAL_HOST=${CORE_HOSTNAME}
ExecStart=/bin/bash -lc 'source ${DEST}/.venv/bin/activate && ./tools/run-dev --behind-https-proxy --interface=""'
Restart=always
RestartSec=5
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNITFILE

systemctl daemon-reload
systemctl enable --now foundry-core-dev
sleep 10
curl -fsS http://127.0.0.1:9991/ >/dev/null
EOF
