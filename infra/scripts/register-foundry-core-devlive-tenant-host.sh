#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: register-foundry-core-devlive-tenant-host.sh <host> <tenant-hostname>

example:
  register-foundry-core-devlive-tenant-host.sh \
    5.161.60.86 \
    foundry-labs.zulip-dev-live.5.161.60.86.sslip.io
EOF
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

HOST="$1"
TENANT_HOSTNAME="$2"
SSH_OPTS=(-i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new)

ssh "${SSH_OPTS[@]}" "root@${HOST}" \
  "TENANT_HOSTNAME='${TENANT_HOSTNAME}' bash -s" <<'EOF'
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
import re
import os

tenant_hostname = os.environ["TENANT_HOSTNAME"]
caddyfile = Path("/etc/caddy/Caddyfile")
content = caddyfile.read_text(encoding="utf-8")
block = f"""{tenant_hostname} {{
  encode zstd gzip
  reverse_proxy 127.0.0.1:18084
}}"""
pattern = re.compile(rf"(?ms)^{re.escape(tenant_hostname)} \{{\n.*?\n\}}\n?")
updated = pattern.sub("", content).rstrip()
updated = f"{updated}\n\n{block}\n" if updated else f"{block}\n"
if updated != content:
    caddyfile.write_text(updated, encoding="utf-8")
PY

systemctl reload caddy
for attempt in $(seq 1 60); do
  if curl -fsS "https://${TENANT_HOSTNAME}/health" >/dev/null; then
    printf 'tenant_url=https://%s\n' "${TENANT_HOSTNAME}"
    exit 0
  fi
  sleep 2
done

echo "tenant host did not become reachable in time" >&2
exit 1
EOF
