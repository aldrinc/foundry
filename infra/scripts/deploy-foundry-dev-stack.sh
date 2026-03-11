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

"${ROOT}/scripts/deploy-foundry-core-devlive.sh" "${ZULIP_DEV_HOST}" "${CORE_URL}"
"${ROOT}/scripts/deploy-foundry-server-sidecar-dev.sh" "${APPS_HOST}" "${SERVER_HOSTNAME}" "${CORE_URL}" "${SUPPORT_EMAIL}"

if [[ "${FOUNDRY_WIND_DOWN_LEGACY_ZULIP:-0}" == "1" ]]; then
  "${ROOT}/scripts/wind-down-legacy-zulip-dev.sh" "${ZULIP_DEV_HOST}"
fi

printf 'core_url=%s\n' "${CORE_URL}"
printf 'server_url=https://%s\n' "${SERVER_HOSTNAME}"
