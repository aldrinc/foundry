#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <host>" >&2
  exit 1
fi

HOST="$1"
SSH_OPTS=(-i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new)

ssh "${SSH_OPTS[@]}" "root@${HOST}" 'bash -s' <<'EOF'
set -euo pipefail

cd /opt/meridian/apps/zulip-dev

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18084/health >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "zulip-dev-live is not healthy; refusing to stop legacy zulip service" >&2
    exit 1
  fi
  sleep 2
done

if docker compose ps --status running zulip | grep -q zulip; then
  docker compose stop zulip
fi

docker compose rm -f zulip >/dev/null 2>&1 || true

printf 'legacy_service=stopped\n'
printf 'restore_command=cd /opt/meridian/apps/zulip-dev && docker compose up -d zulip\n'
EOF
