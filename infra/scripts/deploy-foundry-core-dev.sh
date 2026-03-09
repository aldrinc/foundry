#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <core-hostname>" >&2
  exit 1
fi

HOST="$1"
CORE_HOSTNAME="$2"
FOUNDRY_CLOUD_BOOTSTRAP_SECRET="${FOUNDRY_CLOUD_BOOTSTRAP_SECRET:-}"
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
  "CORE_HOSTNAME='${CORE_HOSTNAME}' DEST='${DEST}' FOUNDRY_CLOUD_BOOTSTRAP_SECRET='${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}' bash -s" <<'EOF'
set -euo pipefail

printf '%s\n' 'foundrydev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/foundrydev
chmod 440 /etc/sudoers.d/foundrydev
visudo -cf /etc/sudoers.d/foundrydev >/dev/null
chown -R foundrydev:foundrydev /opt/foundry/services/foundry-core /var/log/foundry
mkdir -p /etc/foundry

if [[ -z "${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}" ]]; then
  if [[ -f /etc/foundry/core-bootstrap.secret ]]; then
    FOUNDRY_CLOUD_BOOTSTRAP_SECRET="$(cat /etc/foundry/core-bootstrap.secret)"
  else
    FOUNDRY_CLOUD_BOOTSTRAP_SECRET="$(openssl rand -hex 32)"
    printf '%s\n' "${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}" > /etc/foundry/core-bootstrap.secret
    chmod 600 /etc/foundry/core-bootstrap.secret
  fi
fi

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

CORE_HOSTNAME="${CORE_HOSTNAME}" python3 - <<'PY'
import os
from pathlib import Path
import re

core_hostname = os.environ["CORE_HOSTNAME"]
root_block = f"""{core_hostname} {{
  encode zstd gzip
  reverse_proxy 127.0.0.1:9991
}}"""
wildcard_block = f"""*.{core_hostname} {{
  encode zstd gzip
  tls internal
  reverse_proxy 127.0.0.1:9991
}}"""

caddyfile = Path("/etc/caddy/Caddyfile")
content = caddyfile.read_text()
exact_pattern = re.compile(rf"(?ms)^{re.escape(core_hostname)} \{{\n.*?\n\}}\n?")
wildcard_pattern = re.compile(rf"(?ms)^\*\.{re.escape(core_hostname)} \{{\n.*?\n\}}\n?")
combined_pattern = re.compile(
    rf"(?ms)^{re.escape(core_hostname)}, \*\.{re.escape(core_hostname)} \{{\n.*?\n\}}\n?"
)

updated = exact_pattern.sub("", content)
updated = wildcard_pattern.sub("", updated)
updated = combined_pattern.sub("", updated)
updated = updated.rstrip() + "\n\n" + root_block + "\n\n" + wildcard_block + "\n"

if updated != content:
    caddyfile.write_text(updated)
PY
systemctl reload caddy

cat > /etc/foundry/foundry-core.env <<ENVFILE
EXTERNAL_HOST=${CORE_HOSTNAME}
FOUNDRY_CLOUD_BOOTSTRAP_SECRET=${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}
ENVFILE

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
EnvironmentFile=/etc/foundry/foundry-core.env
ExecStart=/bin/bash -lc 'source ${DEST}/.venv/bin/activate && ./tools/run-dev --behind-https-proxy --interface=""'
Restart=always
RestartSec=5
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNITFILE

systemctl daemon-reload
systemctl enable foundry-core-dev >/dev/null
if systemctl is-active --quiet foundry-core-dev; then
  systemctl restart foundry-core-dev
else
  systemctl start foundry-core-dev
fi
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:9991/health >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "foundry-core did not become healthy in time" >&2
exit 1
EOF
