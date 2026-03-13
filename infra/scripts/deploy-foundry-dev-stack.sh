#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: deploy-foundry-dev-stack.sh <zulip-devlive-host> <apps-host> [server-hostname] [support-email]

This deploys:
  1. Foundry Core source into the existing zulip-dev-live server
  2. A sidecar Foundry Server dev service on the apps host
  3. Optionally winds down the legacy zulip-dev service when
     FOUNDRY_WIND_DOWN_LEGACY_ZULIP=1
EOF
}

derive_core_url() {
  local host="$1"
  if [[ "${host}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'https://zulip-dev-live.%s.sslip.io\n' "${host}"
    return
  fi
  return 1
}

derive_server_hostname() {
  local host="$1"
  if [[ "${host}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'foundry-server-dev.%s.sslip.io\n' "${host}"
    return
  fi
  return 1
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

ZULIP_DEV_HOST="$1"
APPS_HOST="$2"
SERVER_HOSTNAME="${3:-}"
SUPPORT_EMAIL="${4:-support@example.com}"

if [[ -z "${SERVER_HOSTNAME}" ]]; then
  if ! SERVER_HOSTNAME="$(derive_server_hostname "${APPS_HOST}")"; then
    echo "server-hostname is required when apps-host is not an IPv4 address" >&2
    exit 1
  fi
fi

CORE_URL="${FOUNDRY_DEV_CORE_URL:-}"
if [[ -z "${CORE_URL}" ]]; then
  if ! CORE_URL="$(derive_core_url "${ZULIP_DEV_HOST}")"; then
    echo "Unable to derive core URL automatically; set FOUNDRY_DEV_CORE_URL" >&2
    exit 1
  fi
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_OPTS=(-i ~/.ssh/hetzner_prod -o StrictHostKeyChecking=accept-new)

SERVER_DEPLOY_LOG="$(mktemp)"
trap 'rm -f "${SERVER_DEPLOY_LOG}"' EXIT

"${ROOT}/scripts/deploy-foundry-server-sidecar-dev.sh" \
  "${APPS_HOST}" \
  "${SERVER_HOSTNAME}" \
  "${CORE_URL}" \
  "${SUPPORT_EMAIL}" | tee "${SERVER_DEPLOY_LOG}"

SERVER_URL="$(
  awk -F= '
    $1 == "server_url" {
      value = substr($0, index($0, "=") + 1)
    }
    END {
      if (value != "") {
        print value
      }
    }
  ' "${SERVER_DEPLOY_LOG}"
)"

CORE_SERVER_URL="${FOUNDRY_DEV_CORE_SERVER_URL:-${SERVER_URL}}"
if [[ -z "${CORE_SERVER_URL}" ]]; then
  echo "Unable to determine Foundry server URL for Foundry Core. Set FOUNDRY_DEV_CORE_SERVER_URL." >&2
  exit 1
fi

ORCHESTRATOR_URL="${FOUNDRY_DEV_ORCHESTRATOR_URL:-${FOUNDRY_CODER_ORCHESTRATOR_URL:-${MERIDIAN_CODER_ORCHESTRATOR_URL:-}}}"
if [[ -z "${ORCHESTRATOR_URL}" && -n "${SERVER_URL}" ]]; then
  ORCHESTRATOR_URL="${SERVER_URL%/}/api/v1/meridian"
fi
if [[ -z "${ORCHESTRATOR_URL}" ]]; then
  echo "Unable to determine orchestrator URL for Foundry Core. Set FOUNDRY_DEV_ORCHESTRATOR_URL or ensure Foundry Server deploy returns server_url." >&2
  exit 1
fi

FOUNDRY_DEV_ORCHESTRATOR_URL="${ORCHESTRATOR_URL}" \
  "${ROOT}/scripts/deploy-foundry-core-devlive.sh" "${ZULIP_DEV_HOST}" "${CORE_URL}" "${CORE_SERVER_URL}"

ssh "${SSH_OPTS[@]}" "root@${APPS_HOST}" \
  "sudo -u foundrydev bash -lc 'cd /opt/foundry/services/foundry-server-dev && set -a && source /etc/foundry/foundry-server-dev.env && set +a && .venv/bin/python scripts/seed_demo_company.py'"

if [[ "${FOUNDRY_WIND_DOWN_LEGACY_ZULIP:-0}" == "1" ]]; then
  "${ROOT}/scripts/wind-down-legacy-zulip-dev.sh" "${ZULIP_DEV_HOST}"
fi

printf 'core_url=%s\n' "${CORE_URL}"
printf 'server_url=%s\n' "${SERVER_URL:-https://${SERVER_HOSTNAME}}"
printf 'core_server_url=%s\n' "${CORE_SERVER_URL}"
printf 'orchestrator_url=%s\n' "${ORCHESTRATOR_URL}"
