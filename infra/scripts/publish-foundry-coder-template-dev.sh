#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <coder-url>" >&2
  exit 1
fi

HOST="$1"
CODER_URL="$2"

if [[ -z "${FOUNDRY_HCLOUD_TOKEN:-}" ]]; then
  echo "FOUNDRY_HCLOUD_TOKEN is required" >&2
  exit 1
fi

if [[ -z "${FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET:-}" ]]; then
  echo "FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET is required" >&2
  exit 1
fi

WORKSPACE_PRIVATE_NETWORK_ID="${FOUNDRY_WORKSPACE_PRIVATE_NETWORK_ID:-12013155}"
WORKSPACE_FIREWALL_IDS="${FOUNDRY_WORKSPACE_FIREWALL_IDS:-[10664425]}"
WORKSPACE_SSH_KEY_IDS="${FOUNDRY_WORKSPACE_SSH_KEY_IDS:-[108762074]}"
FOUNDRY_SERVER_URL="${FOUNDRY_SERVER_URL:-https://server-dev.5.161.83.195.sslip.io}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE_SRC="${ROOT}/infra/coder-templates/foundry-hetzner-workspace/"
REMOTE_TEMPLATE_DIR="/opt/foundry/coder-templates/foundry-hetzner-workspace"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" "mkdir -p /opt/foundry/coder-templates"

rsync -az --delete \
  --exclude '.terraform' \
  --exclude '.terraform.lock.hcl' \
  -e "ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new" \
  "${TEMPLATE_SRC}" "root@${HOST}:${REMOTE_TEMPLATE_DIR}/"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "CODER_URL='${CODER_URL}' REMOTE_TEMPLATE_DIR='${REMOTE_TEMPLATE_DIR}' FOUNDRY_HCLOUD_TOKEN='${FOUNDRY_HCLOUD_TOKEN}' FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET='${FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET}' WORKSPACE_PRIVATE_NETWORK_ID='${WORKSPACE_PRIVATE_NETWORK_ID}' WORKSPACE_FIREWALL_IDS='${WORKSPACE_FIREWALL_IDS}' WORKSPACE_SSH_KEY_IDS='${WORKSPACE_SSH_KEY_IDS}' FOUNDRY_SERVER_URL='${FOUNDRY_SERVER_URL}' bash -s" <<'EOF'
set -euo pipefail

token="$(cat /etc/foundry/coder-admin.token)"

docker exec -u 0 foundry-coder rm -rf /tmp/foundry-hetzner-workspace || true
docker cp "${REMOTE_TEMPLATE_DIR}" foundry-coder:/tmp/foundry-hetzner-workspace

docker exec \
  -e HOME=/tmp/codercli \
  -e CODER_API_TOKEN="${token}" \
  foundry-coder \
  sh -lc '
    mkdir -p "$HOME"
    /opt/coder login http://127.0.0.1:7080 --token "$CODER_API_TOKEN" --use-token-as-session >/dev/null
    /opt/coder templates push foundry-hetzner-workspace \
      --directory /tmp/foundry-hetzner-workspace \
      --ignore-lockfile \
      --yes \
      --message "Publish Foundry-owned Coder template" \
      --variable "hcloud_token='"${FOUNDRY_HCLOUD_TOKEN}"'" \
      --variable "ssh_key_ids='"${WORKSPACE_SSH_KEY_IDS}"'" \
      --variable "private_network_id='"${WORKSPACE_PRIVATE_NETWORK_ID}"'" \
      --variable "firewall_ids='"${WORKSPACE_FIREWALL_IDS}"'" \
      --variable "foundry_server_url='"${FOUNDRY_SERVER_URL}"'" \
      --variable "workspace_bootstrap_secret='"${FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET}"'"
  '
EOF
