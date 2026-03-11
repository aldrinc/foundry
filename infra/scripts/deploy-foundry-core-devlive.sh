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
  "DEST='${DEST}' OVERRIDES_DEST='${OVERRIDES_DEST}' CORE_PUBLIC_URL='${CORE_PUBLIC_URL}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p "${DEST}" "${OVERRIDES_DEST}"
rm -rf "${DEST}/.git"
git init -q "${DEST}"
chown -R 1000:1000 "${DEST}"
chown -R root:root "${OVERRIDES_DEST}"
chmod +x "${OVERRIDES_DEST}/dev-live-entrypoint.sh"

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
