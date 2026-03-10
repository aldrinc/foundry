#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <coder-hostname>" >&2
  exit 1
fi

HOST="$1"
CODER_HOSTNAME="$2"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/infra/apps/foundry-coder/"
DEST="/opt/foundry/apps/foundry-coder"

CODER_DB_PASSWORD="${FOUNDRY_CODER_DB_PASSWORD:-$(openssl rand -hex 24)}"
CODER_ADMIN_USERNAME="${FOUNDRY_CODER_ADMIN_USERNAME:-foundryadmin}"
CODER_ADMIN_EMAIL="${FOUNDRY_CODER_ADMIN_EMAIL:-support@example.com}"
CODER_ADMIN_FULL_NAME="${FOUNDRY_CODER_ADMIN_FULL_NAME:-Foundry Admin}"
CODER_ADMIN_PASSWORD="${FOUNDRY_CODER_ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"
CODER_UPSTREAM_REF="${FOUNDRY_CODER_UPSTREAM_REF:-v2.31.3}"
CODER_UPSTREAM_REPOSITORY="${FOUNDRY_CODER_UPSTREAM_REPOSITORY:-https://github.com/coder/coder.git}"
CODER_RUNTIME_IMAGE="${FOUNDRY_CODER_RUNTIME_IMAGE:-ghcr.io/coder/coder:v2.31.3}"
GO_VERSION="${FOUNDRY_CODER_GO_VERSION:-1.25.7}"
NODE_VERSION="${FOUNDRY_CODER_NODE_VERSION:-22.14.0}"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" "mkdir -p /opt/foundry/apps"

rsync -az --delete \
  --exclude '.env' \
  --exclude 'data' \
  -e "ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new" \
  "${SRC}" "root@${HOST}:${DEST}/"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "DEST='${DEST}' CODER_HOSTNAME='${CODER_HOSTNAME}' CODER_DB_PASSWORD='${CODER_DB_PASSWORD}' CODER_ADMIN_USERNAME='${CODER_ADMIN_USERNAME}' CODER_ADMIN_EMAIL='${CODER_ADMIN_EMAIL}' CODER_ADMIN_FULL_NAME='${CODER_ADMIN_FULL_NAME}' CODER_ADMIN_PASSWORD='${CODER_ADMIN_PASSWORD}' CODER_UPSTREAM_REF='${CODER_UPSTREAM_REF}' CODER_UPSTREAM_REPOSITORY='${CODER_UPSTREAM_REPOSITORY}' CODER_RUNTIME_IMAGE='${CODER_RUNTIME_IMAGE}' GO_VERSION='${GO_VERSION}' NODE_VERSION='${NODE_VERSION}' bash -s" <<'EOF'
set -euo pipefail

mkdir -p "${DEST}/data/postgres" "${DEST}/data/coder" /etc/foundry
chown -R foundrydev:foundrydev "${DEST}"
chown -R 70:70 "${DEST}/data/postgres"
chmod +x "${DEST}/build-foundry-coder-fork.sh"

if [[ -f "${DEST}/.env" ]]; then
  existing_db_password="$(sed -n 's/^CODER_DB_PASSWORD=//p' "${DEST}/.env" | tail -n 1)"
  if [[ -n "${existing_db_password}" ]]; then
    CODER_DB_PASSWORD="${existing_db_password}"
  fi
fi

if [[ -f /etc/foundry/coder-admin.password ]]; then
  existing_admin_password="$(tr -d '\n' </etc/foundry/coder-admin.password)"
  if [[ -n "${existing_admin_password}" ]]; then
    CODER_ADMIN_PASSWORD="${existing_admin_password}"
  fi
fi

cat > "${DEST}/.env" <<ENVFILE
CODER_DB_USER=coder
CODER_DB_PASSWORD=${CODER_DB_PASSWORD}
CODER_DB_NAME=coder
CODER_UPSTREAM_REF=${CODER_UPSTREAM_REF}
CODER_UPSTREAM_REPOSITORY=${CODER_UPSTREAM_REPOSITORY}
CODER_RUNTIME_IMAGE=${CODER_RUNTIME_IMAGE}
GO_VERSION=${GO_VERSION}
NODE_VERSION=${NODE_VERSION}
CODER_HTTP_ADDRESS=0.0.0.0:7080
CODER_ACCESS_URL=https://${CODER_HOSTNAME}
CODER_WILDCARD_ACCESS_URL=
CODER_DISABLE_PASSWORD_AUTH=false
CODER_TELEMETRY_ENABLE=false
CODER_PROVISIONER_DAEMONS=1
ENVFILE

if ! grep -Fq "${CODER_HOSTNAME}" /etc/caddy/Caddyfile; then
  cat >> /etc/caddy/Caddyfile <<CADDY

${CODER_HOSTNAME} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:17080
}
CADDY
fi

systemctl reload caddy

cd "${DEST}"
"${DEST}/build-foundry-coder-fork.sh" "${DEST}/coder"
docker compose build foundry-coder
docker compose up -d

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:17080 >/dev/null 2>&1 || curl -fsSI http://127.0.0.1:17080 >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

mkdir -p /etc/foundry/coder-cli

if [[ ! -f /etc/foundry/coder-admin.token ]]; then
  printf '%s\n' "${CODER_ADMIN_PASSWORD}" > /etc/foundry/coder-admin.password
  chmod 600 /etc/foundry/coder-admin.password

  if ! docker exec \
    -e HOME=/tmp/codercli \
    foundry-coder \
    /opt/coder tokens create -n foundry-dev-admin --lifetime 168h \
      > /etc/foundry/coder-admin.token 2>/dev/null; then
    docker exec \
      -e HOME=/tmp/codercli \
      foundry-coder \
      /opt/coder login http://127.0.0.1:7080 \
        --first-user-email "${CODER_ADMIN_EMAIL}" \
        --first-user-username "${CODER_ADMIN_USERNAME}" \
        --first-user-full-name "${CODER_ADMIN_FULL_NAME}" \
        --first-user-password "${CODER_ADMIN_PASSWORD}" \
        >/dev/null

    docker exec \
      -e HOME=/tmp/codercli \
      foundry-coder \
      /opt/coder tokens create -n foundry-dev-admin --lifetime 168h \
        > /etc/foundry/coder-admin.token
  fi

  chmod 600 /etc/foundry/coder-admin.token
fi
EOF

echo "coder_url=https://${CODER_HOSTNAME}"
