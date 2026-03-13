#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <host> [core-public-url] [foundry-server-url]" >&2
  echo "example: $0 5.161.60.86 https://zulip-dev-live.5.161.60.86.sslip.io http://178.156.253.167:18092" >&2
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
FOUNDRY_SERVER_URL="${3:-${FOUNDRY_DEV_SERVER_URL:-${FOUNDRY_SERVER_URL:-}}}"
FOUNDRY_CLOUD_BOOTSTRAP_SECRET="${FOUNDRY_CLOUD_BOOTSTRAP_SECRET:-}"
DEMO_REALM_SUBDOMAIN="${FOUNDRY_DEV_DEMO_REALM_SUBDOMAIN:-foundry-labs}"
DEMO_REALM_PASSWORD="${FOUNDRY_DEV_DEMO_PASSWORD:-FoundryDemo2026!}"
ORCHESTRATOR_URL="${FOUNDRY_DEV_ORCHESTRATOR_URL:-${FOUNDRY_CODER_ORCHESTRATOR_URL:-${MERIDIAN_CODER_ORCHESTRATOR_URL:-}}}"
ORCHESTRATOR_TOKEN="${FOUNDRY_DEV_ORCHESTRATOR_TOKEN:-${FOUNDRY_CODER_ORCHESTRATOR_TOKEN:-${MERIDIAN_CODER_ORCHESTRATOR_TOKEN:-${FOUNDRY_TOKEN:-}}}}"
ORCHESTRATOR_VERIFY_TLS="${FOUNDRY_DEV_ORCHESTRATOR_VERIFY_TLS:-${FOUNDRY_CODER_ORCHESTRATOR_VERIFY_TLS:-${MERIDIAN_CODER_ORCHESTRATOR_VERIFY_TLS:-${FOUNDRY_VERIFY_TLS:-}}}}"
if [[ -z "${ORCHESTRATOR_URL}" && -n "${FOUNDRY_SERVER_URL}" ]]; then
  ORCHESTRATOR_URL="${FOUNDRY_SERVER_URL%/}/api/v1/meridian"
fi
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
  "DEST='${DEST}' OVERRIDES_DEST='${OVERRIDES_DEST}' CORE_PUBLIC_URL='${CORE_PUBLIC_URL}' FOUNDRY_CLOUD_BOOTSTRAP_SECRET='${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}' FOUNDRY_SERVER_URL='${FOUNDRY_SERVER_URL}' DEMO_REALM_SUBDOMAIN='${DEMO_REALM_SUBDOMAIN}' DEMO_REALM_PASSWORD='${DEMO_REALM_PASSWORD}' ORCHESTRATOR_URL='${ORCHESTRATOR_URL}' ORCHESTRATOR_TOKEN='${ORCHESTRATOR_TOKEN}' ORCHESTRATOR_VERIFY_TLS='${ORCHESTRATOR_VERIFY_TLS}' bash -s" <<'EOF'
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

if [[ -z "${ORCHESTRATOR_TOKEN}" ]]; then
  ORCHESTRATOR_TOKEN="${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}"
fi

python3 - "${FOUNDRY_CLOUD_BOOTSTRAP_SECRET}" "${FOUNDRY_SERVER_URL}" "${ORCHESTRATOR_URL}" "${ORCHESTRATOR_TOKEN}" "${ORCHESTRATOR_VERIFY_TLS}" <<'PY'
from pathlib import Path
import sys

compose_path = Path("/opt/meridian/apps/zulip-dev/compose.override.yaml")
secret = sys.argv[1].strip() or Path("/etc/foundry/core-bootstrap.secret").read_text(encoding="utf-8").strip()
foundry_server_url = sys.argv[2].strip()
orchestrator_url = sys.argv[3].strip()
orchestrator_token = sys.argv[4].strip()
orchestrator_verify_tls = sys.argv[5].strip()

service_values = {
    "zulip": {},
    "zulip-dev-live": {
        "FOUNDRY_CLOUD_BOOTSTRAP_SECRET": secret,
    },
}
service_removals = {
    "zulip": set(),
    "zulip-dev-live": set(),
}


def assign_or_remove(service: str, key: str, value: str) -> None:
    if value:
        service_values[service][key] = value
        service_removals[service].discard(key)
    else:
        service_values[service].pop(key, None)
        service_removals[service].add(key)


assign_or_remove("zulip-dev-live", "FOUNDRY_SERVER_URL", foundry_server_url)
assign_or_remove("zulip-dev-live", "FOUNDRY_CODER_ORCHESTRATOR_URL", orchestrator_url)
assign_or_remove("zulip-dev-live", "FOUNDRY_CODER_ORCHESTRATOR_TOKEN", orchestrator_token)
assign_or_remove("zulip-dev-live", "FOUNDRY_CODER_ORCHESTRATOR_VERIFY_TLS", orchestrator_verify_tls)
assign_or_remove("zulip", "MERIDIAN_CODER_ORCHESTRATOR_URL", "")
assign_or_remove("zulip-dev-live", "MERIDIAN_CODER_ORCHESTRATOR_URL", "")
assign_or_remove("zulip-dev-live", "FOUNDRY_URL", "")
assign_or_remove("zulip", "MERIDIAN_CODER_ORCHESTRATOR_TOKEN", "")
assign_or_remove("zulip-dev-live", "MERIDIAN_CODER_ORCHESTRATOR_TOKEN", "")
assign_or_remove("zulip-dev-live", "FOUNDRY_TOKEN", "")
assign_or_remove("zulip", "MERIDIAN_CODER_ORCHESTRATOR_VERIFY_TLS", "")
assign_or_remove("zulip-dev-live", "MERIDIAN_CODER_ORCHESTRATOR_VERIFY_TLS", "")
assign_or_remove("zulip-dev-live", "FOUNDRY_VERIFY_TLS", "")

content = compose_path.read_text(encoding="utf-8")
lines = content.splitlines()
updated = []
current_service = None
in_environment = False
inserted = {service: set() for service in service_values}


def insert_missing(service_name: str | None) -> None:
    if service_name is None:
        return
    for key, value in service_values.get(service_name, {}).items():
        if key not in inserted[service_name]:
            updated.append(f'      {key}: "{value}"')
            inserted[service_name].add(key)

for line in lines:
    stripped = line.strip()
    if current_service and line.startswith("  ") and not line.startswith("    "):
        if in_environment:
            insert_missing(current_service)
        current_service = None
        in_environment = False
    if line.startswith("  ") and line.endswith(":"):
        service_name = stripped[:-1]
        if service_name in service_values:
            current_service = service_name
            in_environment = False
    if current_service and stripped == "environment:":
        in_environment = True
    elif in_environment and line.startswith("    ") and not line.startswith("      "):
        insert_missing(current_service)
        in_environment = False
    if current_service and in_environment and ":" in stripped:
        key = stripped.split(":", 1)[0]
        values = service_values[current_service]
        removals = service_removals[current_service]
        if key in values:
            if key not in inserted[current_service]:
                updated.append(f'      {key}: "{values[key]}"')
                inserted[current_service].add(key)
            continue
        if key in removals:
            continue
    updated.append(line)

if in_environment:
    insert_missing(current_service)

missing = {
    service: [key for key in values if key not in inserted[service]]
    for service, values in service_values.items()
    if values
}
missing = {service: values for service, values in missing.items() if values}
if missing:
    formatted = ", ".join(
        f"{service}: {', '.join(values)}"
        for service, values in missing.items()
    )
    raise SystemExit(f"Failed to inject {formatted} into compose.override.yaml")

next_content = "\n".join(updated) + "\n"
if next_content != content:
    compose_path.write_text(next_content, encoding="utf-8")
PY

cd /opt/meridian/apps/zulip-dev
docker compose --profile dev-live up -d --force-recreate zulip-dev-live

for attempt in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:18084/health >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:18084/health >/dev/null; then
  echo "zulip-dev-live did not become healthy in time" >&2
  exit 1
fi

TENANT_HOSTNAME="$(
  python3 - "${CORE_PUBLIC_URL}" "${DEMO_REALM_SUBDOMAIN}" <<'PY'
from urllib.parse import urlparse
import sys

core_public_url = sys.argv[1].strip()
realm_subdomain = sys.argv[2].strip()
host = urlparse(core_public_url).hostname or ""
if host and realm_subdomain:
    print(f"{realm_subdomain}.{host}")
PY
)"

if [[ -n "${TENANT_HOSTNAME}" ]]; then
  python3 - "${TENANT_HOSTNAME}" <<'PY'
from pathlib import Path
import re
import sys

tenant_hostname = sys.argv[1].strip()
caddyfile = Path("/etc/caddy/Caddyfile")
content = caddyfile.read_text(encoding="utf-8") if caddyfile.exists() else ""
block = f"""{tenant_hostname} {{
  encode zstd gzip
  reverse_proxy 127.0.0.1:18084
}}"""
pattern = re.compile(rf"(?ms)^{re.escape(tenant_hostname)} \{{\n.*?\n\}}\n?")
updated = pattern.sub("", content).rstrip()
updated = f"{updated}\n\n{block}\n" if updated else f"{block}\n"
if updated != content:
    caddyfile.parent.mkdir(parents=True, exist_ok=True)
    caddyfile.write_text(updated, encoding="utf-8")
PY
  systemctl reload caddy
fi

docker compose exec -T zulip-dev-live sh -lc \
  "su zulip -c 'cd /home/zulip/zulip && FOUNDRY_DEMO_REALM_SUBDOMAIN=\"${DEMO_REALM_SUBDOMAIN}\" FOUNDRY_DEMO_PASSWORD=\"${DEMO_REALM_PASSWORD}\" python3 manage.py shell < tools/seed_demo_company.py'"

if [[ -n "${TENANT_HOSTNAME}" ]]; then
  for attempt in $(seq 1 60); do
    if curl -fsS "https://${TENANT_HOSTNAME}/api/v1/server_settings" >/dev/null; then
      printf 'tenant_url=https://%s\n' "${TENANT_HOSTNAME}"
      printf 'core_url=%s\n' "${CORE_PUBLIC_URL}"
      exit 0
    fi
    sleep 2
  done

  echo "tenant host did not become ready in time" >&2
  exit 1
fi

printf 'core_url=%s\n' "${CORE_PUBLIC_URL}"
EOF

echo "core_url=${CORE_PUBLIC_URL}"
