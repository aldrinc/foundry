#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <host> <workspace-name> [coder-org]" >&2
  exit 1
fi

HOST="$1"
WORKSPACE_NAME="$2"
CODER_ORG="${3:-coder}"
REPO_ID="${FOUNDRY_REPO_ID:-example-org/foundry}"
REPO_URL="${FOUNDRY_REPO_URL:-https://github.com/example-org/foundry.git}"

ssh -i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new "root@${HOST}" \
  "WORKSPACE_NAME='${WORKSPACE_NAME}' CODER_ORG='${CODER_ORG}' REPO_ID='${REPO_ID}' REPO_URL='${REPO_URL}' bash -s" <<'EOF'
set -euo pipefail

token="$(cat /etc/foundry/coder-admin.token)"

docker exec \
  -e HOME=/tmp/codercli \
  -e CODER_API_TOKEN="${token}" \
  foundry-coder \
  sh -lc '
    mkdir -p "$HOME"
    /opt/coder login http://127.0.0.1:7080 --token "$CODER_API_TOKEN" --use-token-as-session >/dev/null
    /opt/coder delete "'"${WORKSPACE_NAME}"'" --org "'"${CODER_ORG}"'" --yes >/dev/null 2>&1 || true
    /opt/coder create "'"${WORKSPACE_NAME}"'" \
      --org "'"${CODER_ORG}"'" \
      --template foundry-hetzner-workspace \
      --parameter repo_id="'"${REPO_ID}"'" \
      --parameter repo_url="'"${REPO_URL}"'" \
      --yes
  '
EOF
