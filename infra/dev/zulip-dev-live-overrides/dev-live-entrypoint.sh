#!/usr/bin/env bash
set -euo pipefail

SEED_SOURCE_DIR="/opt/dev-live/source"
REPO_ROOT="/home/zulip/zulip"
OVERRIDES_DIR="${DEV_LIVE_OVERRIDES_DIR:-/overrides}"
RUN_DEV_INTERFACE="${DEV_LIVE_INTERFACE:-}"
RUN_DEV_EXTRA_ARGS="${DEV_LIVE_RUN_DEV_ARGS:---no-clear-memcached --streamlined}"

log() {
  printf '[dev-live] %s\n' "$*"
}

start_service() {
  local service_name="$1"
  local process_match="$2"
  local fallback_cmd="${3:-}"

  if pgrep -f "${process_match}" >/dev/null 2>&1; then
    return
  fi

  if command -v service >/dev/null 2>&1; then
    service "$service_name" start >/dev/null 2>&1 || true
  fi

  if [ -x "/etc/init.d/${service_name}" ] && ! pgrep -f "${process_match}" >/dev/null 2>&1; then
    "/etc/init.d/${service_name}" start >/dev/null 2>&1 || true
  fi

  if ! pgrep -f "${process_match}" >/dev/null 2>&1 && [ -n "${fallback_cmd}" ]; then
    bash -lc "${fallback_cmd}" >/dev/null 2>&1 || true
  fi
}

seed_source_if_needed() {
  if [ -x "${REPO_ROOT}/tools/run-dev" ] && [ -d "${REPO_ROOT}/web/src" ]; then
    return
  fi

  log "Seeding source checkout into bind-mounted repo path."
  mkdir -p "${REPO_ROOT}"
  cp -a "${SEED_SOURCE_DIR}/." "${REPO_ROOT}/"
  chown -R zulip:zulip "${REPO_ROOT}"
}

apply_override_files() {
  if [ ! -d "${OVERRIDES_DIR}" ]; then
    return
  fi

  while IFS= read -r -d '' override_path; do
    local_rel="${override_path#"${OVERRIDES_DIR}/"}"
    target_path="${REPO_ROOT}/${local_rel}"
    mkdir -p "$(dirname "${target_path}")"
    cp -f "${override_path}" "${target_path}"
  done < <(find "${OVERRIDES_DIR}" -type f -print0)
}

run_as_zulip() {
  su -s /bin/bash -c "$1" zulip
}

ensure_git_safe_directory() {
  run_as_zulip "git config --global --add safe.directory '${REPO_ROOT}'"
}

ensure_repo_permissions() {
  mkdir -p "${REPO_ROOT}/var/log"
  chown -R zulip:zulip "${REPO_ROOT}"
}

generated_assets_present() {
  local required_paths=(
    ".venv/bin/python3"
    "web/generated/pygments_data.json"
    "web/generated/supported_browser_regex.ts"
    "web/generated/timezones.json"
    "static/generated/emoji/emoji_codes.json"
    "var/log"
  )

  local relative_path
  for relative_path in "${required_paths[@]}"; do
    if [ ! -e "${REPO_ROOT}/${relative_path}" ]; then
      return 1
    fi
  done

  return 0
}

start_runtime_dependencies() {
  start_service postgresql "postgres" "pg_ctlcluster 16 main start"
  start_service redis-server "redis-server" "redis-server --daemonize yes --bind 127.0.0.1 --port 6379"
  start_service memcached "memcached" "memcached -u root -d -p 11211"
  start_service rabbitmq-server "beam.smp.*rabbitmq|rabbitmq_server" "rabbitmq-server -detached"
}

ensure_provisioned() {
  local sentinel="${REPO_ROOT}/.dev-live-provisioned"
  ensure_repo_permissions
  if [ -f "${sentinel}" ] && generated_assets_present; then
    return
  fi

  log "Starting runtime dependencies before first full provision."
  start_runtime_dependencies

  log "Running one-time full tools/provision for dev-live workspace."
  run_as_zulip "cd '${REPO_ROOT}' && CI=true SKIP_VENV_SHELL_WARNING=1 ./tools/provision"
  run_as_zulip "touch '${sentinel}'"
}

seed_source_if_needed
apply_override_files
ensure_repo_permissions
ensure_git_safe_directory

log "Starting local service dependencies for run-dev."
ensure_provisioned
start_runtime_dependencies

if [ -z "${EXTERNAL_HOST:-}" ] && [ -n "${SETTING_EXTERNAL_HOST:-}" ]; then
  export EXTERNAL_HOST="${SETTING_EXTERNAL_HOST}"
fi

if [ -n "${EXTERNAL_HOST:-}" ] && [ -z "${BEHIND_HTTPS_PROXY:-}" ]; then
  export BEHIND_HTTPS_PROXY="1"
fi

log "Launching Zulip run-dev (EXTERNAL_HOST=${EXTERNAL_HOST:-unset}, BEHIND_HTTPS_PROXY=${BEHIND_HTTPS_PROXY:-unset})."
exec sudo -E -H -u zulip bash -lc "cd '${REPO_ROOT}' && source .venv/bin/activate && ./tools/run-dev --interface='${RUN_DEV_INTERFACE}' ${RUN_DEV_EXTRA_ARGS}"
