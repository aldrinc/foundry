#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <host> [core-public-url]" >&2
  echo "example: $0 5.161.60.86 https://zulip-dev-live.5.161.60.86.sslip.io" >&2
}

derive_core_url() {
  local host="$1"
  if [[ "${host}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'https://zulip-dev-live.%s.sslip.io\n' "${host}"
    return
  fi
  return 1
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

HOST="$1"
CORE_PUBLIC_URL="${2:-}"
FOUNDRY_CLOUD_BOOTSTRAP_SECRET="${FOUNDRY_CLOUD_BOOTSTRAP_SECRET:-}"
if [[ -z "${CORE_PUBLIC_URL}" ]]; then
  if ! CORE_PUBLIC_URL="$(derive_core_url "${HOST}")"; then
    echo "core-public-url is required when host is not an IPv4 address" >&2
    exit 1
  fi
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/services/foundry-core/app/"
OVERRIDES_SRC="${ROOT}/infra/dev/zulip-dev-live-overrides/"
DEST="/opt/meridian/apps/zulip-dev/dev_source_foundry"
OVERRIDES_DEST="/opt/meridian/apps/zulip-dev/custom_zulip_files_foundry"
SSH_OPTS=(-i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new)

rsync -az --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'node_modules' \
  -e "ssh ${SSH_OPTS[*]}" \
  "${SRC}" "root@${HOST}:${DEST}/"

rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  "${OVERRIDES_SRC}" "root@${HOST}:${OVERRIDES_DEST}/"

ssh "${SSH_OPTS[@]}" "root@${HOST}" \
  "DEST='${DEST}' OVERRIDES_DEST='${OVERRIDES_DEST}' CORE_PUBLIC_URL='${CORE_PUBLIC_URL}' FOUNDRY_CLOUD_BOOTSTRAP_SECRET='${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p "${DEST}" "${OVERRIDES_DEST}"
rm -rf "${DEST}/.git"
git init -q "${DEST}"
chown -R 1000:1000 "${DEST}"
chown -R root:root "${OVERRIDES_DEST}"
chmod +x "${OVERRIDES_DEST}/dev-live-entrypoint.sh"
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

python3 - <<'PY'
from pathlib import Path

compose_path = Path("/opt/meridian/apps/zulip-dev/compose.override.yaml")
secret = Path("/etc/foundry/core-bootstrap.secret").read_text(encoding="utf-8").strip()
needle = '      FOUNDRY_CLOUD_BOOTSTRAP_SECRET: "'

content = compose_path.read_text(encoding="utf-8")
lines = content.splitlines()
updated = []
in_dev_live = False
in_environment = False
inserted = False

for line in lines:
    stripped = line.strip()
    if line.startswith("  zulip-dev-live:"):
        in_dev_live = True
        in_environment = False
    elif in_dev_live and line.startswith("  ") and not line.startswith("    "):
        if in_environment and not inserted:
            updated.append(f'      FOUNDRY_CLOUD_BOOTSTRAP_SECRET: "{secret}"')
            inserted = True
        in_dev_live = False
        in_environment = False
    if in_dev_live and stripped == "environment:":
        in_environment = True
    elif in_environment and line.startswith("    ") and not line.startswith("      "):
        if not inserted:
            updated.append(f'      FOUNDRY_CLOUD_BOOTSTRAP_SECRET: "{secret}"')
            inserted = True
        in_environment = False
    if in_dev_live and in_environment and stripped.startswith("FOUNDRY_CLOUD_BOOTSTRAP_SECRET:"):
        if not inserted:
            updated.append(f'      FOUNDRY_CLOUD_BOOTSTRAP_SECRET: "{secret}"')
            inserted = True
        continue
    updated.append(line)

if in_environment and not inserted:
    updated.append(f'      FOUNDRY_CLOUD_BOOTSTRAP_SECRET: "{secret}"')
    inserted = True

if not inserted:
    raise SystemExit("Failed to inject FOUNDRY_CLOUD_BOOTSTRAP_SECRET into compose.override.yaml")

next_content = "\n".join(updated) + "\n"
if next_content != content:
    compose_path.write_text(next_content, encoding="utf-8")
PY

cd /opt/meridian/apps/zulip-dev
docker compose --profile dev-live up -d --force-recreate zulip-dev-live

for attempt in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:18084/health >/dev/null; then
    printf 'core_url=%s\n' "${CORE_PUBLIC_URL}"
    exit 0
  fi
  sleep 2
done

echo "zulip-dev-live did not become healthy in time" >&2
exit 1
EOF

echo "core_url=${CORE_PUBLIC_URL}"
