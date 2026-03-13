#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import ssl
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlencode, urlparse, urlunparse
from zoneinfo import ZoneInfo

import requests
import websockets
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from orchestrator_policy import load_orchestrator_policy
from pydantic import BaseModel, Field, ValidationError

from coder_api import CoderClient
from control_commands import parse_task_command
from executor import (
    TaskCoordinator,
    augment_instruction_with_task_contract,
    provider_backend_profile,
    task_requires_executable_backend,
)
from supervisor_runtime import (
    build_memory_prompt_context,
    build_topic_runtime_state,
    build_uploads_prompt_context,
    checkpoint_to_dict,
    get_runtime_paths,
    list_checkpoints,
    list_uploaded_files,
    load_memory_state,
    materialize_uploaded_files,
    session_runtime_to_dict,
    topic_runtime_to_dict,
    update_memory_state,
    write_checkpoint,
)
from store import (
    PlanRevisionRecord,
    SupervisorSessionRecord,
    TASK_STATUSES,
    TERMINAL_TASK_STATUSES,
    TaskRecord,
    TaskStore,
    WorkerSessionRecord,
    derive_task_title,
    derive_topic_scope_id,
    integration_credential_to_dict,
    integration_policy_to_dict,
    normalize_integration_id,
    normalize_provider_id,
    normalize_topic_scope_id,
    plan_revision_to_dict,
    provider_credential_to_dict,
    supervisor_event_to_dict,
    supervisor_session_to_dict,
    task_to_dict,
    worker_session_to_dict,
    workspace_to_dict,
)
from zulip_notifier import ZulipNotifier


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "y"}


LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
RUN_STORE_PATH = os.getenv("RUN_STORE_PATH", "./data/coder-orchestrator.db")
ORCHESTRATOR_API_TOKEN = os.getenv("ORCHESTRATOR_API_TOKEN", "").strip()

CODER_BASE_URL = os.getenv("CODER_BASE_URL", "").strip()
CODER_API_TOKEN = os.getenv("CODER_API_TOKEN", "").strip()
CODER_VERIFY_TLS = env_bool("VERIFY_TLS", True)
CODER_REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "25"))

CODER_TEMPLATE_ID = os.getenv("CODER_TEMPLATE_ID", "").strip()
CODER_TEMPLATE_VERSION_ID = os.getenv("CODER_TEMPLATE_VERSION_ID", "").strip()
WORKSPACE_SCOPE = os.getenv("WORKSPACE_SCOPE", "repo").strip().lower()
REPO_WORKSPACE_OWNER = os.getenv("REPO_WORKSPACE_OWNER", "").strip()
TASK_CONTAINER_RUNTIME = os.getenv("TASK_CONTAINER_RUNTIME", "task-sandbox").strip()

WORKER_ID = os.getenv("WORKER_ID", "coder-orchestrator")
MAX_PARALLEL_TASKS = int(os.getenv("MAX_PARALLEL_TASKS", "10"))
WORKSPACE_CONCURRENCY_LIMIT = int(os.getenv("WORKSPACE_CONCURRENCY_LIMIT", "5"))
KEEPALIVE_WINDOW_HOURS = int(os.getenv("KEEPALIVE_WINDOW_HOURS", "6"))
KEEPALIVE_INTERVAL_SECONDS = int(os.getenv("KEEPALIVE_INTERVAL_SECONDS", "120"))
PORT_POLICY_INTERVAL_SECONDS = int(os.getenv("PORT_POLICY_INTERVAL_SECONDS", "60"))
DISPATCH_INTERVAL_SECONDS = float(os.getenv("DISPATCH_INTERVAL_SECONDS", "1.0"))

EXECUTION_BACKEND = os.getenv("EXECUTION_BACKEND", "stub").strip().lower()
LOCAL_WORK_ROOT = os.getenv("LOCAL_WORK_ROOT", "./data/local-work")
if not LOCAL_WORK_ROOT:
    LOCAL_WORK_ROOT = "./data/local-work"
CODER_OWNER_OVERRIDE = os.getenv("CODER_OWNER_OVERRIDE", "").strip()
CODER_OWNER_MAP_JSON = os.getenv("CODER_OWNER_MAP_JSON", "").strip()

DEFAULT_PROVIDER = normalize_provider_id(os.getenv("DEFAULT_PROVIDER", "codex"))
DEFAULT_REPO_ID = os.getenv("MERIDIAN_DEFAULT_REPO_ID", "").strip()
DEFAULT_GIT_BASE_URL = os.getenv("MERIDIAN_GIT_BASE_URL", "").strip().rstrip("/")
REPO_DISCOVERY_REQUEST_TIMEOUT_SECONDS = max(
    2.0,
    float(os.getenv("REPO_DISCOVERY_REQUEST_TIMEOUT_SECONDS", "8")),
)
REPO_DISCOVERY_MAX_QUERIES = max(1, int(os.getenv("REPO_DISCOVERY_MAX_QUERIES", "12")))
REPO_DISCOVERY_MAX_RESULTS = max(1, int(os.getenv("REPO_DISCOVERY_MAX_RESULTS", "8")))
REPO_DISCOVERY_MIN_SCORE = max(1, int(os.getenv("REPO_DISCOVERY_MIN_SCORE", "40")))
ALLOWED_PROVIDERS = {
    normalize_provider_id(item.strip().lower())
    for item in os.getenv(
        "ALLOWED_PROVIDERS", "opencode,codex,claude_code"
    ).split(",")
    if item.strip()
}
if not ALLOWED_PROVIDERS:
    ALLOWED_PROVIDERS = {"opencode", "codex", "claude_code"}
SUPERVISOR_DEFAULT_WORKER_PROVIDER = normalize_provider_id(
    os.getenv("SUPERVISOR_DEFAULT_WORKER_PROVIDER", DEFAULT_PROVIDER)
)
if SUPERVISOR_DEFAULT_WORKER_PROVIDER not in ALLOWED_PROVIDERS:
    SUPERVISOR_DEFAULT_WORKER_PROVIDER = DEFAULT_PROVIDER

EVENT_STREAM_POLL_SECONDS = float(os.getenv("EVENT_STREAM_POLL_SECONDS", "0.8"))
EVENT_STREAM_HEARTBEAT_SECONDS = float(os.getenv("EVENT_STREAM_HEARTBEAT_SECONDS", "15"))
PRESTART_ENABLED = env_bool("PRESTART_ENABLED", False)
PRESTART_LOCAL_TIME = os.getenv("PRESTART_LOCAL_TIME", "08:30").strip()
PRESTART_DAYS = os.getenv("PRESTART_DAYS", "MON,TUE,WED,THU,FRI").strip()
PRESTART_TIMEZONE = os.getenv("PRESTART_TIMEZONE", "America/New_York").strip()
PRESTART_ITEMS_JSON = os.getenv("PRESTART_ITEMS_JSON", "[]").strip()
PRESTART_POLL_SECONDS = int(os.getenv("PRESTART_POLL_SECONDS", "30"))
PRESTART_MAX_PARALLEL = int(os.getenv("PRESTART_MAX_PARALLEL", "10"))
SUPERVISOR_DIR = Path(os.getenv("SUPERVISOR_DIR", "./supervisor")).resolve()
SUPERVISOR_MEMORY_PATH = SUPERVISOR_DIR / "memory.md"
SUPERVISOR_SOUL_PATH = SUPERVISOR_DIR / "soul.md"
SUPERVISOR_ENGINE = os.getenv("SUPERVISOR_ENGINE", "moltis").strip().lower() or "moltis"
ORCHESTRATOR_POLICY_PATH = os.getenv("ORCHESTRATOR_POLICY_PATH", "").strip()

MOLTIS_BASE_URL = os.getenv("MOLTIS_BASE_URL", "").strip().rstrip("/")
MOLTIS_API_KEY = os.getenv("MOLTIS_API_KEY", "").strip()
MOLTIS_MODEL = (
    os.getenv("MOLTIS_MODEL", "").strip()
    or os.getenv("SUPERVISOR_MODEL", "openai::gpt-5.2").strip()
    or "openai::gpt-5.2"
)
MOLTIS_TIMEOUT_SECONDS = float(os.getenv("MOLTIS_TIMEOUT_SECONDS", "45"))
MOLTIS_RUN_TIMEOUT_SECONDS = float(os.getenv("MOLTIS_RUN_TIMEOUT_SECONDS", "120"))
MOLTIS_RUN_POLL_SECONDS = float(os.getenv("MOLTIS_RUN_POLL_SECONDS", "0.8"))
MOLTIS_VERIFY_TLS = env_bool("MOLTIS_VERIFY_TLS", False)
MOLTIS_FALLBACK_MODEL = os.getenv("MOLTIS_FALLBACK_MODEL", "openai::gpt-5.2").strip()
OPENCODE_API_KEY_PRESENT = bool(
    os.getenv("OPENCODE_API_KEY", "").strip() or os.getenv("FIREWORKS_API_KEY", "").strip()
)
MOLTIS_ENABLED = env_bool("MOLTIS_ENABLED", bool(MOLTIS_BASE_URL))


logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")

store = TaskStore(RUN_STORE_PATH)
notifier = ZulipNotifier()
orchestrator_policy = load_orchestrator_policy(ORCHESTRATOR_POLICY_PATH or None)
store.set_lifecycle_policy(orchestrator_policy.lifecycle)

coder: Optional[CoderClient] = None
if CODER_BASE_URL and CODER_API_TOKEN:
    coder = CoderClient(
        base_url=CODER_BASE_URL,
        api_token=CODER_API_TOKEN,
        verify_tls=CODER_VERIFY_TLS,
        timeout_seconds=CODER_REQUEST_TIMEOUT_SECONDS,
    )
else:
    logging.warning(
        "Coder API is disabled because CODER_BASE_URL or CODER_API_TOKEN is missing"
    )

provider_commands = {
    "opencode": os.getenv(
        "OPENCODE_COMMAND",
        "echo '[opencode] ${instruction}'",
    ),
    "codex": os.getenv(
        "CODEX_COMMAND",
        "codex exec --dangerously-bypass-approvals-and-sandbox ${quoted_instruction}",
    ),
    "claude_code": os.getenv(
        "CLAUDE_CODE_COMMAND",
        os.getenv(
            "CLOUD_CODE_COMMAND",
            "claude -p --dangerously-skip-permissions ${quoted_instruction}",
        ),
    ),
    "default": os.getenv("DEFAULT_PROVIDER_COMMAND", "echo '${instruction}'"),
}

provider_commands["cloud_code"] = provider_commands["claude_code"]

# allow both ${instruction} and {instruction} placeholder styles
for key, template in list(provider_commands.items()):
    provider_commands[key] = (
        template.replace("${instruction}", "{instruction}")
        .replace("${quoted_instruction}", "{quoted_instruction}")
        .replace("${task_id}", "{task_id}")
        .replace("${repo_id}", "{repo_id}")
        .replace("${repo_url}", "{repo_url}")
        .replace("${branch_name}", "{branch_name}")
        .replace("${worktree_path}", "{worktree_path}")
        .replace("${user_id}", "{user_id}")
    )

coordinator = TaskCoordinator(
    store=store,
    coder=coder,
    notifier=notifier,
    worker_id=WORKER_ID,
    template_id=CODER_TEMPLATE_ID,
    template_version_id=CODER_TEMPLATE_VERSION_ID,
    max_parallel_tasks=MAX_PARALLEL_TASKS,
    per_workspace_concurrency=WORKSPACE_CONCURRENCY_LIMIT,
    keepalive_window_hours=KEEPALIVE_WINDOW_HOURS,
    keepalive_interval_seconds=KEEPALIVE_INTERVAL_SECONDS,
    port_policy_interval_seconds=PORT_POLICY_INTERVAL_SECONDS,
    dispatch_interval_seconds=DISPATCH_INTERVAL_SECONDS,
    execution_backend=EXECUTION_BACKEND,
    provider_commands=provider_commands,
    local_work_root=LOCAL_WORK_ROOT,
    owner_override=CODER_OWNER_OVERRIDE,
    owner_map_json=CODER_OWNER_MAP_JSON,
    workspace_scope=WORKSPACE_SCOPE,
    repo_workspace_owner=REPO_WORKSPACE_OWNER,
    task_container_runtime=TASK_CONTAINER_RUNTIME,
    orchestrator_policy=orchestrator_policy,
)

app = FastAPI(title="Meridian Coder Orchestrator", version="0.3.0")


def _normalize_provider(value: str) -> str:
    return normalize_provider_id(value)


def _provider_env_prefixes(provider: str) -> List[str]:
    normalized = normalize_provider_id(provider)
    mapping = {
        "codex": ["CODEX"],
        "claude_code": ["CLAUDE_CODE", "CLOUD_CODE"],
        "opencode": ["OPENCODE"],
    }
    return list(mapping.get(normalized, [normalized.upper()] if normalized else []))


def _provider_env_value(provider: str, suffix: str) -> str:
    for prefix in _provider_env_prefixes(provider):
        value = os.getenv(f"{prefix}_{suffix}", "").strip()
        if value:
            return value
    return ""


def _provider_catalog_entry(provider: str) -> Dict[str, Any]:
    defaults: Dict[str, Dict[str, Any]] = {
        "codex": {
            "display_name": "Codex",
            "auth_modes": ["api_key", "oauth"],
            "default_model": os.getenv("CODEX_MODEL", "gpt-5.2-2025-12-11").strip(),
            "notes": "Supports OpenAI API key or OAuth tokens.",
        },
        "claude_code": {
            "display_name": "Claude Code",
            "auth_modes": ["api_key", "oauth"],
            "default_model": (
                os.getenv("CLAUDE_CODE_MODEL", "").strip()
                or os.getenv("CLOUD_CODE_MODEL", "claude-sonnet-4").strip()
            ),
            "notes": "Claude Code provider; supports API key and OAuth token storage.",
        },
        "opencode": {
            "display_name": "OpenCode",
            "auth_modes": ["api_key"],
            "default_model": os.getenv("OPENCODE_MODEL", "fireworks/kimi-k2p5").strip(),
            "notes": "Configured for an OpenAI-compatible OpenCode endpoint/model.",
        },
    }
    return dict(defaults.get(provider, {"display_name": provider, "auth_modes": ["api_key"]}))


def _provider_env_prefix(provider: str) -> str:
    prefixes = _provider_env_prefixes(provider)
    return prefixes[0] if prefixes else provider.upper()


def _provider_oauth_defaults(provider: str) -> Dict[str, Any]:
    provider_id = normalize_provider_id(provider)
    if provider_id == "codex":
        return {
            "provider": "codex",
            "authorize_url": "https://auth.openai.com/oauth/authorize",
            "token_url": "https://auth.openai.com/oauth/token",
            "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
            "client_secret": "",
            "redirect_uri": "",
            "scopes": ["openid", "profile", "email", "offline_access"],
            "extra_authorize_params": {
                "id_token_add_organizations": "true",
                "codex_cli_simplified_flow": "true",
            },
            # OpenAI's built-in Codex OAuth client is intended for the local Codex
            # login flow; Foundry must not treat those defaults as a configured
            # server-side web OAuth integration.
            "configured_by_default": False,
        }
    return {
        "provider": provider_id,
        "authorize_url": "",
        "token_url": "",
        "client_id": "",
        "client_secret": "",
        "redirect_uri": "",
        "scopes": [],
        "extra_authorize_params": {},
        "configured_by_default": False,
    }


def _provider_oauth_config(provider: str) -> Dict[str, Any]:
    provider_id = normalize_provider_id(provider)
    defaults = _provider_oauth_defaults(provider_id)
    authorize_url = _provider_env_value(provider_id, "OAUTH_AUTHORIZE_URL")
    token_url = _provider_env_value(provider_id, "OAUTH_TOKEN_URL")
    client_id = _provider_env_value(provider_id, "OAUTH_CLIENT_ID")
    client_secret = _provider_env_value(provider_id, "OAUTH_CLIENT_SECRET")
    redirect_uri = _provider_env_value(provider_id, "OAUTH_REDIRECT_URI")
    scopes_raw = _provider_env_value(provider_id, "OAUTH_SCOPES")
    scopes = [
        item.strip()
        for item in scopes_raw.split(",")
        if item.strip()
    ]
    env_configured = bool(authorize_url and token_url and client_id)
    config = {
        "provider": provider_id,
        "authorize_url": authorize_url or str(defaults.get("authorize_url") or "").strip(),
        "token_url": token_url or str(defaults.get("token_url") or "").strip(),
        "client_id": client_id or str(defaults.get("client_id") or "").strip(),
        "client_secret": client_secret or str(defaults.get("client_secret") or "").strip(),
        "redirect_uri": redirect_uri or str(defaults.get("redirect_uri") or "").strip(),
        "scopes": scopes or [str(item).strip() for item in (defaults.get("scopes") or []) if str(item).strip()],
        "extra_authorize_params": dict(defaults.get("extra_authorize_params") or {}),
    }
    config["configured"] = bool(env_configured or defaults.get("configured_by_default"))
    config["configured_source"] = "env" if env_configured else (
        "default" if bool(defaults.get("configured_by_default")) else ""
    )
    return config


def _pkce_code_verifier() -> str:
    return secrets.token_urlsafe(64).replace("=", "")


def _pkce_code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")


def _jwt_claims(token: str) -> Dict[str, Any]:
    parts = [part.strip() for part in str(token or "").split(".")]
    if len(parts) < 2 or not parts[1]:
        return {}
    payload = parts[1]
    payload += "=" * ((4 - len(payload) % 4) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        parsed = json.loads(decoded.decode("utf-8"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _extract_codex_account_id_from_claims(claims: Dict[str, Any]) -> str:
    direct = str(claims.get("chatgpt_account_id") or "").strip()
    if direct:
        return direct
    nested = claims.get("https://api.openai.com/auth")
    if isinstance(nested, dict):
        nested_id = str(nested.get("chatgpt_account_id") or "").strip()
        if nested_id:
            return nested_id
    organizations = claims.get("organizations")
    if isinstance(organizations, list):
        for item in organizations:
            if not isinstance(item, dict):
                continue
            org_id = str(item.get("id") or "").strip()
            if org_id:
                return org_id
    return ""


def _resolve_codex_account_id(token_data: Dict[str, Any]) -> str:
    explicit = str(token_data.get("account_id") or "").strip()
    if explicit:
        return explicit
    for key in ("id_token", "access_token"):
        token = str(token_data.get(key) or "").strip()
        if not token:
            continue
        account_id = _extract_codex_account_id_from_claims(_jwt_claims(token))
        if account_id:
            return account_id
    return ""


def _provider_catalog() -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for provider in sorted(ALLOWED_PROVIDERS):
        entry = _provider_catalog_entry(provider)
        entry["provider"] = provider
        oauth = _provider_oauth_config(provider)
        entry["oauth_configured"] = bool(oauth.get("configured"))
        entries.append(entry)
    return entries


def _provider_supported_auth_modes(provider: str) -> List[str]:
    entry = _provider_catalog_entry(provider)
    auth_modes = [
        str(mode).strip()
        for mode in (entry.get("auth_modes") or ["api_key"])
        if str(mode).strip()
    ]
    return auth_modes or ["api_key"]


INTEGRATION_CATALOG_OVERRIDE_JSON = os.getenv("INTEGRATION_CATALOG_JSON", "").strip()


def _integration_catalog_defaults() -> Dict[str, Dict[str, Any]]:
    return {
        "github": {
            "display_name": "GitHub",
            "auth_modes": ["api_key", "oauth"],
            "notes": "Repository metadata and write operations (branches/PRs/issues), plus CI context.",
            "tools": [
                "github_repo_read",
                "github_repo_write",
                "github_branch_write",
                "github_issue_read",
                "github_issue_write",
                "github_pr_read",
                "github_pr_write",
            ],
            "base_url": "https://github.com",
        },
        "forgejo": {
            "display_name": "Forgejo",
            "auth_modes": ["api_key", "oauth"],
            "notes": "Self-hosted git metadata and write operations (branches/PRs/issues/repos).",
            "tools": [
                "forgejo_repo_read",
                "forgejo_repo_create",
                "forgejo_repo_write",
                "forgejo_branch_write",
                "forgejo_issue_read",
                "forgejo_issue_write",
                "forgejo_pr_read",
                "forgejo_pr_write",
            ],
            "base_url": (
                os.getenv("FORGEJO_BASE_URL", "").strip()
                or os.getenv("FORGEJO_URL", "").strip()
                or "https://git.meridian.cv"
            ),
        },
        "calcom": {
            "display_name": "Cal.com",
            "auth_modes": ["api_key"],
            "notes": "Scheduling and booking operations from supervisor chat.",
            "tools": ["calcom_event_read", "calcom_event_write"],
            "base_url": os.getenv("CALCOM_BASE_URL", "").strip(),
        },
    }


def _integration_env_prefix(integration: str) -> str:
    mapping = {
        "github": "GITHUB",
        "forgejo": "FORGEJO",
        "calcom": "CALCOM",
    }
    return mapping.get(integration, integration.upper())


def _extract_token_from_secret(secret: Dict[str, Any]) -> str:
    if not isinstance(secret, dict):
        return ""
    for key in ("access_token", "api_key", "token"):
        token = str(secret.get(key) or "").strip()
        if token:
            return token
    return ""


def _integration_env_token(integration: str) -> tuple[str, str]:
    prefix = _integration_env_prefix(integration)
    for key in (f"{prefix}_API_KEY", f"{prefix}_TOKEN", f"{prefix}_ACCESS_TOKEN"):
        value = os.getenv(key, "").strip()
        if value:
            return value, key
    return "", ""


def _resolve_integration_token_for_user(
    *,
    user_id: str,
    integration: str,
    credential: Optional[Any] = None,
) -> tuple[str, str]:
    item = credential
    if item is None:
        item = store.get_integration_credential(
            user_id=(user_id or "").strip().lower(),
            integration=normalize_integration_id(integration),
            include_revoked=False,
        )
    if item is not None:
        token = _extract_token_from_secret(item.secret if isinstance(item.secret, dict) else {})
        if token:
            return token, f"user:{item.auth_mode or 'api_key'}"
    token, env_name = _integration_env_token(integration)
    if token:
        return token, f"env:{env_name}"
    return "", ""


def _integration_oauth_config(integration: str) -> Dict[str, Any]:
    prefix = _integration_env_prefix(integration)
    authorize_url = os.getenv(f"{prefix}_OAUTH_AUTHORIZE_URL", "").strip()
    token_url = os.getenv(f"{prefix}_OAUTH_TOKEN_URL", "").strip()
    client_id = os.getenv(f"{prefix}_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv(f"{prefix}_OAUTH_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv(f"{prefix}_OAUTH_REDIRECT_URI", "").strip()
    scopes = [
        item.strip()
        for item in os.getenv(f"{prefix}_OAUTH_SCOPES", "").split(",")
        if item.strip()
    ]
    return {
        "integration": integration,
        "authorize_url": authorize_url,
        "token_url": token_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "scopes": scopes,
        "configured": bool(authorize_url and token_url and client_id and redirect_uri),
    }


def _safe_json_loads(raw: str, fallback: Any) -> Any:
    text = (raw or "").strip()
    if not text:
        return fallback
    try:
        return json.loads(text)
    except Exception:
        return fallback


def _integration_catalog() -> List[Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {
        integration: dict(value)
        for integration, value in _integration_catalog_defaults().items()
    }
    override_payload = _safe_json_loads(INTEGRATION_CATALOG_OVERRIDE_JSON, [])
    if isinstance(override_payload, dict):
        override_items = [override_payload]
    elif isinstance(override_payload, list):
        override_items = [item for item in override_payload if isinstance(item, dict)]
    else:
        override_items = []

    for item in override_items:
        integration = normalize_integration_id(str(item.get("integration") or item.get("id") or "").strip())
        if not integration:
            continue
        current = dict(by_id.get(integration, {}))
        for key in ("display_name", "notes", "base_url"):
            value = str(item.get(key) or "").strip()
            if value:
                current[key] = value
        auth_modes = item.get("auth_modes")
        if isinstance(auth_modes, list):
            modes = [str(mode).strip().lower() for mode in auth_modes if str(mode).strip()]
            if modes:
                current["auth_modes"] = sorted(set(modes))
        tools = item.get("tools")
        if isinstance(tools, list):
            normalized_tools = [str(tool).strip() for tool in tools if str(tool).strip()]
            if normalized_tools:
                current["tools"] = normalized_tools
        enabled = item.get("enabled")
        if isinstance(enabled, bool):
            current["enabled"] = enabled
        by_id[integration] = current

    entries: List[Dict[str, Any]] = []
    for integration in sorted(by_id):
        entry = dict(by_id[integration])
        entry["integration"] = integration
        entry["display_name"] = str(entry.get("display_name") or integration)
        auth_modes = [
            str(mode).strip().lower()
            for mode in (entry.get("auth_modes") or ["api_key"])
            if str(mode).strip()
        ]
        entry["auth_modes"] = sorted(set(auth_modes))
        entry["tools"] = [
            str(tool).strip()
            for tool in (entry.get("tools") or [])
            if str(tool).strip()
        ]
        oauth = _integration_oauth_config(integration)
        entry["oauth_configured"] = bool(oauth.get("configured"))
        if "enabled" not in entry:
            entry["enabled"] = True
        entries.append(entry)
    return entries


REPO_DISCOVERY_STOPWORDS = {
    "a",
    "an",
    "and",
    "app",
    "application",
    "build",
    "code",
    "for",
    "from",
    "help",
    "implement",
    "implementation",
    "in",
    "into",
    "need",
    "off",
    "of",
    "on",
    "out",
    "plan",
    "port",
    "prepare",
    "refactor",
    "review",
    "spec",
    "task",
    "the",
    "this",
    "to",
    "we",
    "work",
}


def _repo_search_api_base_url(integration: str, entry: Optional[Dict[str, Any]] = None) -> str:
    integration_id = normalize_integration_id(integration)
    catalog_entry = entry if isinstance(entry, dict) else None
    if catalog_entry is None:
        catalog_entry = next(
            (
                item
                for item in _integration_catalog()
                if normalize_integration_id(str(item.get("integration") or "")) == integration_id
            ),
            None,
        )
    base_url = str((catalog_entry or {}).get("base_url") or "").strip().rstrip("/")
    if integration_id == "forgejo":
        explicit = (
            os.getenv("FORGEJO_API_BASE_URL", "").strip()
            or (f"{base_url}/api/v1" if base_url else "")
        )
        return explicit.rstrip("/")
    if integration_id == "github":
        return (os.getenv("GITHUB_API_BASE_URL", "").strip() or "https://api.github.com").rstrip("/")
    return ""


def _search_repositories_via_integration(
    *,
    user_id: str,
    integration: str,
    query: str,
    limit: int = 5,
    credential: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    needle = str(query or "").strip()
    if not needle:
        return []
    integration_id = normalize_integration_id(integration)
    entry = next(
        (
            item
            for item in _integration_catalog()
            if normalize_integration_id(str(item.get("integration") or "")) == integration_id
        ),
        None,
    )
    api_base = _repo_search_api_base_url(integration_id, entry)
    if not api_base:
        return []
    token, _source = _resolve_integration_token_for_user(
        user_id=user_id,
        integration=integration_id,
        credential=credential,
    )
    headers: Dict[str, str] = {"Accept": "application/json"}
    if token:
        if integration_id == "forgejo":
            headers["Authorization"] = f"token {token}"
        elif integration_id == "github":
            headers["Authorization"] = f"Bearer {token}"
    params: Dict[str, Any]
    url: str
    if integration_id == "forgejo":
        url = f"{api_base}/repos/search"
        params = {"q": needle, "limit": str(max(1, min(limit, REPO_DISCOVERY_MAX_RESULTS)))}
    elif integration_id == "github":
        url = f"{api_base}/search/repositories"
        params = {"q": needle, "per_page": str(max(1, min(limit, REPO_DISCOVERY_MAX_RESULTS)))}
    else:
        return []
    try:
        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=REPO_DISCOVERY_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []
    if integration_id == "forgejo":
        items = payload.get("data") if isinstance(payload, dict) else []
    else:
        items = payload.get("items") if isinstance(payload, dict) else []
    if not isinstance(items, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in items[: max(1, min(limit, REPO_DISCOVERY_MAX_RESULTS))]:
        if not isinstance(item, dict):
            continue
        full_name = str(item.get("full_name") or "").strip()
        clone_url = str(item.get("clone_url") or "").strip()
        html_url = str(item.get("html_url") or item.get("web_url") or "").strip()
        if not full_name:
            continue
        out.append(
            {
                "repo_id": full_name,
                "repo_url": clone_url or html_url,
                "web_url": html_url,
                "name": str(item.get("name") or "").strip(),
                "owner": (
                    str(((item.get("owner") or {}).get("login")) or "").strip()
                    if isinstance(item.get("owner"), dict)
                    else ""
                ),
                "provider": integration_id,
                "default_branch": str(item.get("default_branch") or "").strip(),
                "language": str(item.get("language") or "").strip(),
                "private": bool(item.get("private")),
            }
        )
    return out


def _repo_discovery_text_parts(
    topic_ref: Optional[Dict[str, Any]],
    transcript: Optional[List[Dict[str, Any]]],
) -> List[str]:
    ref = topic_ref if isinstance(topic_ref, dict) else {}
    parts: List[str] = []
    for value in (ref.get("stream_name"), ref.get("topic")):
        text = str(value or "").strip()
        if text:
            parts.append(text)
    for item in transcript or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("content") or "").strip()
        if text:
            parts.append(text[:500])
    return parts


def _repo_discovery_queries(
    topic_ref: Optional[Dict[str, Any]],
    transcript: Optional[List[Dict[str, Any]]],
) -> List[str]:
    queries: List[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        query = str(value or "").strip().lower().strip("-")
        if not query or query in seen:
            return
        seen.add(query)
        queries.append(query)

    for text in _repo_discovery_text_parts(topic_ref, transcript):
        lowered = text.lower()
        for token in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)+", lowered):
            add(token)

        tokens = [
            token
            for token in re.findall(r"[a-z0-9]+", lowered)
            if len(token) >= 3 and token not in REPO_DISCOVERY_STOPWORDS
        ]
        for size in (3, 2):
            for index in range(0, max(0, len(tokens) - size + 1)):
                add("-".join(tokens[index : index + size]))
        for token in tokens:
            add(token)

    return queries[:REPO_DISCOVERY_MAX_QUERIES]


def _score_repo_candidate(query: str, candidate: Dict[str, Any]) -> int:
    query_value = str(query or "").strip().lower()
    repo_id = str(candidate.get("repo_id") or "").strip().lower()
    name = str(candidate.get("name") or "").strip().lower()
    if not query_value or not repo_id:
        return 0
    terms = [item for item in re.findall(r"[a-z0-9]+", query_value) if item]
    score = 0
    if repo_id == query_value or repo_id.endswith(f"/{query_value}") or name == query_value:
        score += 120
    if query_value in repo_id or query_value in name:
        score += 40
    if terms and all(term in repo_id or term in name for term in terms):
        score += 10 * len(terms)
    if terms and all(term in name for term in terms):
        score += 10 * len(terms)
    return score


def _discover_repo_binding_from_topic(
    *,
    scope: str,
    user_id: str,
    topic_ref: Optional[Dict[str, Any]],
    transcript: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    queries = _repo_discovery_queries(topic_ref, transcript)
    if not queries:
        return {"id": "", "url": "", "source": "unresolved", "confidence": "low", "metadata": {}}

    credentials = {
        item.integration: item
        for item in store.list_integration_credentials(user_id=user_id, include_revoked=False)
        if item.status == "active"
    }
    candidates: Dict[str, Dict[str, Any]] = {}
    for integration_id in ("forgejo", "github"):
        results_seen = False
        for query in queries:
            results = _search_repositories_via_integration(
                user_id=user_id,
                integration=integration_id,
                query=query,
                limit=REPO_DISCOVERY_MAX_RESULTS,
                credential=credentials.get(integration_id),
            )
            if not results:
                continue
            results_seen = True
            for item in results:
                repo_id = str(item.get("repo_id") or "").strip()
                if not repo_id:
                    continue
                score = _score_repo_candidate(query, item)
                current = candidates.get(repo_id)
                if current is None or score > int(current.get("score") or 0):
                    candidates[repo_id] = {
                        "repo_id": repo_id,
                        "repo_url": str(item.get("repo_url") or "").strip() or _default_repo_url_for(repo_id) or "",
                        "source": "topic_discovery",
                        "confidence": "medium",
                        "score": score,
                        "matched_query": query,
                        "provider": str(item.get("provider") or integration_id),
                    }
        if results_seen:
            break

    ranked = sorted(
        candidates.values(),
        key=lambda item: (int(item.get("score") or 0), str(item.get("repo_id") or "")),
        reverse=True,
    )
    if not ranked:
        return {
            "id": "",
            "url": "",
            "source": "unresolved",
            "confidence": "low",
            "metadata": {"queries": queries},
        }

    best = ranked[0]
    next_best = ranked[1] if len(ranked) > 1 else None
    best_score = int(best.get("score") or 0)
    next_score = int(next_best.get("score") or 0) if next_best else 0
    if best_score < REPO_DISCOVERY_MIN_SCORE:
        return {
            "id": "",
            "url": "",
            "source": "unresolved",
            "confidence": "low",
            "metadata": {"queries": queries, "candidate_repo_ids": [item["repo_id"] for item in ranked[:5]]},
        }

    confidence = "high" if best_score >= 100 or best_score >= next_score + 30 else "medium"
    return {
        "id": str(best.get("repo_id") or "").strip(),
        "url": str(best.get("repo_url") or "").strip(),
        "source": "topic_discovery",
        "confidence": confidence,
        "metadata": {
            "scope": scope,
            "queries": queries,
            "matched_query": str(best.get("matched_query") or "").strip(),
            "provider": str(best.get("provider") or "").strip(),
            "score": best_score,
            "candidate_repo_ids": [str(item.get("repo_id") or "").strip() for item in ranked[:5]],
        },
    }


def _default_integration_policy() -> Dict[str, Any]:
    return {
        "auto_topic_transcript": True,
        "auto_repo_context": True,
        "allow_external_integrations": True,
        "enabled_integrations": [],
    }


def _normalize_integration_policy(policy: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(policy or {})
    defaults = _default_integration_policy()
    supported = {
        str(item.get("integration") or "")
        for item in _integration_catalog()
        if bool(item.get("enabled", True))
    }
    for key in ("auto_topic_transcript", "auto_repo_context", "allow_external_integrations"):
        value = normalized.get(key)
        if isinstance(value, bool):
            continue
        if value is None:
            normalized[key] = defaults[key]
        else:
            normalized[key] = str(value).strip().lower() in {"1", "true", "yes", "on", "y"}
    enabled = normalized.get("enabled_integrations")
    if not isinstance(enabled, list):
        enabled = []
    normalized["enabled_integrations"] = sorted(
        set(
            normalize_integration_id(str(item).strip())
            for item in enabled
            if str(item).strip()
        )
    )
    if supported:
        normalized["enabled_integrations"] = [
            item for item in normalized["enabled_integrations"] if item in supported
        ]
    return normalized


def _effective_integration_policy(user_id: str) -> Dict[str, Any]:
    defaults = _default_integration_policy()
    record = store.get_integration_policy(user_id=user_id)
    if record is None:
        return defaults
    merged = dict(defaults)
    merged.update(record.policy if isinstance(record.policy, dict) else {})
    return _normalize_integration_policy(merged)


def _expected_mcp_keywords_for_integration(integration: str) -> List[str]:
    key = normalize_integration_id(integration)
    mapping: Dict[str, List[str]] = {
        "github": ["github"],
        "forgejo": ["forgejo", "gitea"],
        "calcom": ["calcom"],
    }
    return list(mapping.get(key, [key] if key else []))


def _legacy_integration_mcp_coverage(
    *,
    connected_integrations: List[Dict[str, Any]],
    mcp_tools_inventory: Dict[str, Any],
) -> Dict[str, Any]:
    servers = (
        mcp_tools_inventory.get("servers")
        if isinstance(mcp_tools_inventory.get("servers"), list)
        else []
    )
    all_tool_names = [
        str(tool).strip()
        for server in servers
        if isinstance(server, dict)
        for tool in (server.get("tools") or [])
        if str(tool).strip()
    ]
    lowered_tools = [name.lower() for name in all_tool_names]
    rows: List[Dict[str, Any]] = []
    missing: List[str] = []
    for item in connected_integrations:
        if not isinstance(item, dict):
            continue
        integration = str(item.get("integration") or "").strip()
        if not integration:
            continue
        credential_source = str(item.get("credential_source") or "").strip()
        if not credential_source:
            continue
        expected_keywords = _expected_mcp_keywords_for_integration(integration)
        if not expected_keywords:
            continue
        matched = False
        for tool_name in lowered_tools:
            if any(keyword in tool_name for keyword in expected_keywords):
                matched = True
                break
        rows.append(
            {
                "integration": integration,
                "credential_source": credential_source,
                "expected_keywords": expected_keywords,
                "covered_by_mcp": matched,
            }
        )
        if not matched:
            missing.append(integration)
    return {
        "checked": len(rows),
        "missing": sorted(set(missing)),
        "rows": rows,
    }


def _worker_backend_catalog() -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    backend = EXECUTION_BACKEND
    catalog_by_provider = {
        str(item.get("provider") or "").strip(): item
        for item in _provider_catalog()
        if isinstance(item, dict) and str(item.get("provider") or "").strip()
    }
    for provider in sorted(ALLOWED_PROVIDERS):
        profile = provider_backend_profile(
            provider=provider,
            execution_backend=coordinator.execution_backend,
            provider_commands=provider_commands,
            codex_api_enabled=coordinator.codex_api_enabled,
            opencode_api_enabled=coordinator.opencode_api_enabled,
        )
        catalog = catalog_by_provider.get(provider) or {}
        auth_modes = [
            str(item).strip()
            for item in (catalog.get("auth_modes") or [])
            if str(item).strip()
        ]
        display_name = str(catalog.get("display_name") or provider).strip() or provider
        runtime_modes = [
            str(value).strip()
            for value in (profile.get("runtime_modes") or [])
            if str(value).strip()
        ]
        available = bool(runtime_modes)
        entries.append(
            {
                "id": provider,
                "display_name": display_name,
                "provider": provider,
                "execution_backend": backend,
                "runtime_modes": runtime_modes,
                "command_template": str(profile.get("command_template") or ""),
                "command_stub": bool(profile.get("command_stub")),
                "default_mode": str(profile.get("default_mode") or ""),
                "supports_execution": bool(profile.get("supports_execution")),
                "api_text_available": bool(profile.get("api_text_available")),
                "auth_modes": auth_modes,
                "oauth_configured": bool(catalog.get("oauth_configured")),
                "available": available,
            }
        )
    return entries


def _worker_backend_profiles() -> Dict[str, Dict[str, Any]]:
    return {
        provider: provider_backend_profile(
            provider=provider,
            execution_backend=coordinator.execution_backend,
            provider_commands=provider_commands,
            codex_api_enabled=coordinator.codex_api_enabled,
            opencode_api_enabled=coordinator.opencode_api_enabled,
        )
        for provider in sorted(ALLOWED_PROVIDERS)
    }


def _worker_backend_capability_summary() -> List[Dict[str, Any]]:
    summary: List[Dict[str, Any]] = []
    for provider, profile in _worker_backend_profiles().items():
        if bool(profile.get("supports_execution")):
            state = "command-executable"
        elif bool(profile.get("api_text_available")):
            state = "api-text-only"
        elif bool(profile.get("command_stub")):
            state = "stub-command"
        else:
            state = "unavailable"
        summary.append(
            {
                "provider": provider,
                "state": state,
                "default_mode": str(profile.get("default_mode") or ""),
                "supports_execution": bool(profile.get("supports_execution")),
                "api_text_available": bool(profile.get("api_text_available")),
            }
        )
    return summary


def _merge_unique_text(items: List[Any]) -> List[str]:
    seen: set[str] = set()
    merged: List[str] = []
    for item in items:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append(text)
    return merged


def _option_truthy(options: Optional[Dict[str, Any]], key: str) -> bool:
    if not isinstance(options, dict):
        return False
    return str(options.get(key) or "").strip().lower() in {"1", "true", "yes", "on"}


_USER_TESTABLE_HINT_RE = re.compile(
    r"\b("
    r"ui|ux|frontend|sidebar|button|dialog|modal|page|screen|view|layout|component|"
    r"desktop app|web app|browser|manual test|user test|human test|preview|dev url|"
    r"staging|launch|run the app|open the app"
    r")\b",
    re.IGNORECASE,
)
_PREVIEW_OR_DEPLOY_HINT_RE = re.compile(
    r"\b("
    r"preview|dev url|staging|deploy|deployment|spin up|launch|run the app|"
    r"make available for testing|test in the ui"
    r")\b",
    re.IGNORECASE,
)
_PR_REQUIRED_HINT_RE = re.compile(
    r"\b(?:open|create|submit|include|report)\b.{0,40}\b(?:pull request|pr)\b",
    re.IGNORECASE,
)
_BRANCH_ONLY_HINT_RE = re.compile(
    r"\b(?:branch only|without (?:a )?pr|without pull request|no pr|no pull request)\b",
    re.IGNORECASE,
)
_CI_HINT_RE = re.compile(
    r"\b(?:ci|checks|pipeline|buildkite|github actions|gitlab ci|status checks)\b",
    re.IGNORECASE,
)
_TRACEABILITY_HINT_RE = re.compile(
    r"\b("
    r"acceptance criteria|traceability|map(?:ping)? to the request|prove it works|"
    r"verification summary|manual validation"
    r")\b",
    re.IGNORECASE,
)
_ANALYSIS_TASK_HINT_RE = re.compile(
    r"\b("
    r"search|inspect|explore|audit|analy[sz]e|review|map|identify|locate|find|read|"
    r"document|design|propose|assess|inventory|discover|recon(?:naissance)?|"
    r"synthesi[sz]e|draft|checklist|requirements?|blocker(?:s| register)?|"
    r"risk register|sitemap|journey|architecture|questions?"
    r")\b",
    re.IGNORECASE,
)
_READ_ONLY_PLAN_STEP_HINT_RE = re.compile(
    r"\b("
    r"repo-less|read-only|no code changes|no deployment|recon(?:naissance)?|"
    r"plan revision|execution plan|verification (?:and evidence )?checklist|"
    r"blocker register|risk register|sitemap|user journe(?:y|ys)|content inventory|"
    r"architecture options?|data strategy|acceptance criteria"
    r")\b",
    re.IGNORECASE,
)
_DOCUMENT_DELIVERABLE_HINT_RE = re.compile(
    r"\b(?:output|deliver(?:able)?|deliver as|produce as)\b.{0,80}\b(?:"
    r"[a-z0-9_.-]+\.md|markdown|checklist|report|summary|inventory|register"
    r")\b",
    re.IGNORECASE,
)
_IMPLEMENTATION_TASK_HINT_RE = re.compile(
    r"\b("
    r"implement|apply|change|modify|update|fix|patch|refactor|edit|rewrite|"
    r"make the code changes|make code changes"
    r")\b",
    re.IGNORECASE,
)
_DEPLOYMENT_TASK_HINT_RE = re.compile(
    r"\b("
    r"preview|dev url|preview url|deploy|deployment|publish|artifact link|"
    r"make available for testing|run the app|launch the app|start the app"
    r")\b",
    re.IGNORECASE,
)
_PACKAGING_TASK_HINT_RE = re.compile(
    r"\b("
    r"open (?:a )?pr|open (?:a )?pull request|create (?:a )?pr|create (?:a )?pull request|"
    r"submit (?:a )?pr|submit (?:a )?pull request|package (?:the )?pr|prepare (?:the )?pr"
    r")\b",
    re.IGNORECASE,
)
_APPROVAL_STEP_HINT_RE = re.compile(
    r"\b("
    r"approval gate|human approval required|reply with ['\"]?approved['\"]?|"
    r"awaiting human approval|seek implicit approval"
    r")\b",
    re.IGNORECASE,
)


def _derive_delivery_expectations(*texts: Any) -> Dict[str, bool]:
    merged = " ".join(" ".join(str(value or "").split()).strip() for value in texts if str(value or "").strip())
    if not merged:
        return {}
    implementation_requested = bool(_IMPLEMENTATION_TASK_HINT_RE.search(merged))
    user_testable = bool(_USER_TESTABLE_HINT_RE.search(merged))
    preview_or_deploy_requested = bool(_PREVIEW_OR_DEPLOY_HINT_RE.search(merged))
    branch_only = bool(_BRANCH_ONLY_HINT_RE.search(merged))
    require_pull_request = bool(_PR_REQUIRED_HINT_RE.search(merged))
    require_ci = bool(_CI_HINT_RE.search(merged))
    requires_runtime_evidence = user_testable or preview_or_deploy_requested
    requires_deployment_evidence = preview_or_deploy_requested or requires_runtime_evidence
    if implementation_requested and user_testable and not branch_only:
        require_pull_request = True
        require_ci = True
    prefer_pull_request = bool(implementation_requested and not branch_only)
    if require_pull_request:
        prefer_pull_request = True
    requires_traceability = bool(_TRACEABILITY_HINT_RE.search(merged)) or requires_runtime_evidence
    expectations = {
        "requires_runtime_evidence": requires_runtime_evidence,
        "requires_deployment_evidence": requires_deployment_evidence,
        "prefer_pull_request": prefer_pull_request,
        "require_pull_request": require_pull_request,
        "requires_ci_evidence": require_ci,
        "requires_traceability": requires_traceability,
    }
    return {key: value for key, value in expectations.items() if value}


def _task_delivery_phase(
    *,
    assigned_role: str,
    instruction: str,
    options: Optional[Dict[str, Any]] = None,
) -> str:
    role = str(assigned_role or "").strip().lower()
    option_map = options if isinstance(options, dict) else {}
    task_title = str(option_map.get("task_title") or "").strip()
    text = " ".join(value for value in [task_title, instruction] if str(value or "").strip())
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return "implementation" if role == "writer" else ("verification" if role == "verify" else "analysis")
    if task_title.strip().lower().startswith("approval"):
        return "approval"
    if _APPROVAL_STEP_HINT_RE.search(normalized):
        return "approval"
    read_only_planning_task = bool(
        _READ_ONLY_PLAN_STEP_HINT_RE.search(normalized)
        and (
            _DOCUMENT_DELIVERABLE_HINT_RE.search(normalized)
            or ".md" in normalized.lower()
            or "plan revision" in normalized.lower()
            or "checklist" in normalized.lower()
            or "reconnaissance" in normalized.lower()
        )
    )
    if read_only_planning_task and not _IMPLEMENTATION_TASK_HINT_RE.search(normalized):
        return "analysis"
    if role in {"verify", "review", "reviewer"}:
        return "verification"
    if role == "read_only" and not _PACKAGING_TASK_HINT_RE.search(normalized) and not _DEPLOYMENT_TASK_HINT_RE.search(normalized):
        return "analysis"
    if _PACKAGING_TASK_HINT_RE.search(normalized):
        return "packaging"
    if _DEPLOYMENT_TASK_HINT_RE.search(normalized):
        return "deployment"
    if "do not implement" in normalized.lower():
        return "analysis"
    if _ANALYSIS_TASK_HINT_RE.search(normalized) and not _IMPLEMENTATION_TASK_HINT_RE.search(normalized):
        return "analysis"
    return "implementation"


def _clear_task_delivery_flags(options: Dict[str, Any]) -> None:
    for key in (
        "requires_repo_output",
        "requires_verification",
        "requires_runtime_evidence",
        "requires_deployment_evidence",
        "preview_required",
        "require_preview",
        "prefer_pull_request",
        "require_pull_request",
        "requires_ci_evidence",
        "requires_traceability",
    ):
        options.pop(key, None)


def _clear_task_execution_flags(options: Dict[str, Any]) -> None:
    for key in (
        "required_backend_capability",
        "requires_executable_backend",
        "worker_execution_mode",
    ):
        options.pop(key, None)


def _apply_task_contract(
    *,
    instruction: str,
    assigned_role: str,
    options: Dict[str, Any],
) -> Dict[str, Any]:
    clean_options = dict(options if isinstance(options, dict) else {})
    role = str(assigned_role or clean_options.get("assigned_role") or "").strip().lower()
    requested_execution_mode = str(clean_options.get("worker_execution_mode") or "").strip().lower()
    explicit_executable_request = requested_execution_mode == "command" or (
        str(clean_options.get("required_backend_capability") or "").strip().lower() == "executable"
    ) or _option_truthy(clean_options, "requires_executable_backend")
    raw_file_claims = clean_options.get("file_claims")
    raw_area_claims = clean_options.get("area_claims")
    has_scoped_claims = bool(
        (isinstance(raw_file_claims, list) and any(str(item).strip() for item in raw_file_claims))
        or (isinstance(raw_area_claims, list) and any(str(item).strip() for item in raw_area_claims))
    )

    existing_contract = (
        dict(clean_options.get("task_contract"))
        if isinstance(clean_options.get("task_contract"), dict)
        else {}
    )
    required_artifacts = _merge_unique_text(
        list(existing_contract.get("required_artifacts") or [])
        if isinstance(existing_contract.get("required_artifacts"), list)
        else []
    )
    done_when = _merge_unique_text(
        list(existing_contract.get("done_when") or [])
        if isinstance(existing_contract.get("done_when"), list)
        else []
    )
    evidence_classes = _merge_unique_text(
        list(existing_contract.get("evidence_classes") or [])
        if isinstance(existing_contract.get("evidence_classes"), list)
        else []
    )
    preferred_artifacts = _merge_unique_text(
        list(existing_contract.get("preferred_artifacts") or [])
        if isinstance(existing_contract.get("preferred_artifacts"), list)
        else []
    )
    delivery_expectations = (
        dict(clean_options.get("delivery_expectations"))
        if isinstance(clean_options.get("delivery_expectations"), dict)
        else {}
    )
    for key, value in _derive_delivery_expectations(instruction).items():
        if value and key not in delivery_expectations:
            delivery_expectations[key] = True

    def _expectation_enabled(key: str) -> bool:
        if _option_truthy(clean_options, key):
            return True
        if str(existing_contract.get(key) or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        return bool(delivery_expectations.get(key))

    requires_runtime_evidence = _expectation_enabled("requires_runtime_evidence")
    requires_deployment_evidence = _expectation_enabled("requires_deployment_evidence")
    prefer_pull_request = _expectation_enabled("prefer_pull_request")
    require_pull_request = _expectation_enabled("require_pull_request")
    requires_ci_evidence = _expectation_enabled("requires_ci_evidence")
    requires_traceability = _expectation_enabled("requires_traceability")
    delivery_phase = _task_delivery_phase(
        assigned_role=assigned_role,
        instruction=instruction,
        options=clean_options,
    )
    if delivery_phase in {"analysis", "approval", "verification"} and not has_scoped_claims:
        contract_requires_repo_output = str(existing_contract.get("requires_repo_output") or "").strip().lower()
        if not _option_truthy(clean_options, "requires_repo_output") and contract_requires_repo_output not in {
            "1",
            "true",
            "yes",
            "on",
        }:
            explicit_executable_request = False

    _clear_task_delivery_flags(clean_options)
    _clear_task_execution_flags(clean_options)

    if delivery_phase == "verification":
        required_artifacts = _merge_unique_text(required_artifacts + ["verification_results"])
        done_when = _merge_unique_text(
            done_when + ["verification evidence is reported back to the supervisor"]
        )
        if requires_ci_evidence:
            required_artifacts = _merge_unique_text(required_artifacts + ["ci_status"])
            evidence_classes = _merge_unique_text(evidence_classes + ["ci"])
            done_when = _merge_unique_text(
                done_when + ["CI or status-check evidence is reported when available"]
            )
        if requires_traceability:
            required_artifacts = _merge_unique_text(required_artifacts + ["traceability_summary"])
            evidence_classes = _merge_unique_text(evidence_classes + ["traceability"])
            done_when = _merge_unique_text(
                done_when + ["verification results are mapped back to the request or acceptance criteria"]
            )
        existing_contract.update(
            {
                "delivery_type": "verification",
                "requires_verification": True,
                "requires_repo_output": False,
                "requires_runtime_evidence": False,
                "requires_deployment_evidence": False,
                "prefer_pull_request": False,
                "require_pull_request": False,
                "requires_ci_evidence": requires_ci_evidence,
                "requires_traceability": requires_traceability,
                "required_artifacts": required_artifacts,
                "preferred_artifacts": preferred_artifacts,
                "evidence_classes": _merge_unique_text(evidence_classes + ["validation"]),
                "done_when": done_when,
            }
        )
        clean_options["requires_verification"] = True
        if requires_ci_evidence:
            clean_options["requires_ci_evidence"] = True
        if requires_traceability:
            clean_options["requires_traceability"] = True
    elif delivery_phase in {"analysis", "approval"}:
        if requires_traceability:
            required_artifacts = _merge_unique_text(required_artifacts + ["traceability_summary"])
            evidence_classes = _merge_unique_text(evidence_classes + ["traceability"])
            done_when = _merge_unique_text(
                done_when + ["the reported findings are mapped back to the request or acceptance criteria"]
            )
        existing_contract.update(
            {
                "delivery_type": delivery_phase,
                "requires_repo_output": False,
                "requires_verification": False,
                "requires_runtime_evidence": False,
                "requires_deployment_evidence": False,
                "prefer_pull_request": False,
                "require_pull_request": False,
                "requires_ci_evidence": False,
                "requires_traceability": requires_traceability,
                "required_artifacts": required_artifacts,
                "preferred_artifacts": preferred_artifacts,
                "evidence_classes": evidence_classes,
                "done_when": done_when,
            }
        )
        if requires_traceability:
            clean_options["requires_traceability"] = True
    else:
        repo_output_required = delivery_phase in {"implementation", "deployment", "packaging"}
        verification_required = delivery_phase in {"implementation", "deployment", "packaging"}
        if repo_output_required:
            required_artifacts = _merge_unique_text(required_artifacts + ["branch_or_pr"])
            done_when = _merge_unique_text(
                done_when + ["a pushed branch or PR URL is available before completion"]
            )
            evidence_classes = _merge_unique_text(evidence_classes + ["scm"])
        if verification_required:
            required_artifacts = _merge_unique_text(required_artifacts + ["verification_results"])
            done_when = _merge_unique_text(
                done_when + ["verification evidence is captured from commands or CI"]
            )
            evidence_classes = _merge_unique_text(evidence_classes + ["validation"])
        if delivery_phase == "implementation":
            required_artifacts = _merge_unique_text(required_artifacts + ["code_changes"])
            done_when = _merge_unique_text(
                done_when + ["repository changes are made in the bound repo"]
            )
            evidence_classes = _merge_unique_text(evidence_classes + ["code"])
        if requires_runtime_evidence and delivery_phase in {"implementation", "deployment"}:
            required_artifacts = _merge_unique_text(required_artifacts + ["runtime_evidence"])
            evidence_classes = _merge_unique_text(evidence_classes + ["runtime"])
            done_when = _merge_unique_text(
                done_when + ["runtime behavior is exercised and captured for the changed workflow"]
            )
        if requires_deployment_evidence and delivery_phase == "deployment":
            required_artifacts = _merge_unique_text(required_artifacts + ["preview_url"])
            evidence_classes = _merge_unique_text(evidence_classes + ["deployment"])
            done_when = _merge_unique_text(
                done_when + ["a dev or preview URL is available for human validation"]
            )
        elif requires_deployment_evidence and delivery_phase == "implementation":
            preferred_artifacts = _merge_unique_text(preferred_artifacts + ["preview_url"])
        if require_pull_request and delivery_phase in {"packaging", "deployment", "implementation"}:
            required_artifacts = _merge_unique_text(required_artifacts + ["pull_request_url"])
            evidence_classes = _merge_unique_text(evidence_classes + ["scm"])
            done_when = _merge_unique_text(
                done_when + ["a pull request is opened from the pushed branch and its URL is reported"]
            )
        elif prefer_pull_request and delivery_phase in {"packaging", "deployment", "implementation"}:
            preferred_artifacts = _merge_unique_text(preferred_artifacts + ["pull_request_url"])
            evidence_classes = _merge_unique_text(evidence_classes + ["scm"])
        if requires_ci_evidence and delivery_phase in {"packaging", "deployment", "verification"}:
            required_artifacts = _merge_unique_text(required_artifacts + ["ci_status"])
            evidence_classes = _merge_unique_text(evidence_classes + ["ci"])
            done_when = _merge_unique_text(done_when + ["CI or status-check evidence is reported when available"])
        elif requires_ci_evidence and delivery_phase == "implementation":
            preferred_artifacts = _merge_unique_text(preferred_artifacts + ["ci_status"])
        if requires_traceability:
            required_artifacts = _merge_unique_text(required_artifacts + ["traceability_summary"])
            evidence_classes = _merge_unique_text(evidence_classes + ["traceability"])
            done_when = _merge_unique_text(
                done_when + ["delivered artifacts are mapped back to the request or acceptance criteria"]
            )
        existing_contract.update(
            {
                "delivery_type": delivery_phase,
                "requires_repo_output": repo_output_required,
                "requires_verification": verification_required,
                "requires_runtime_evidence": requires_runtime_evidence and delivery_phase in {"implementation", "deployment"},
                "requires_deployment_evidence": requires_deployment_evidence and delivery_phase == "deployment",
                "prefer_pull_request": prefer_pull_request and delivery_phase in {"packaging", "deployment", "implementation"},
                "require_pull_request": require_pull_request and delivery_phase in {"packaging", "deployment", "implementation"},
                "requires_ci_evidence": requires_ci_evidence and delivery_phase in {"packaging", "deployment"},
                "requires_traceability": requires_traceability,
                "required_artifacts": required_artifacts,
                "preferred_artifacts": preferred_artifacts,
                "evidence_classes": evidence_classes,
                "done_when": done_when,
            }
        )
        if repo_output_required:
            clean_options["requires_repo_output"] = True
        if verification_required:
            clean_options["requires_verification"] = True
        if requires_runtime_evidence and delivery_phase in {"implementation", "deployment"}:
            clean_options["requires_runtime_evidence"] = True
        if requires_deployment_evidence and delivery_phase == "deployment":
            clean_options["requires_deployment_evidence"] = True
            clean_options["preview_required"] = True
            clean_options["require_preview"] = True
        if prefer_pull_request and delivery_phase in {"packaging", "deployment", "implementation"}:
            clean_options["prefer_pull_request"] = True
        if require_pull_request and delivery_phase in {"packaging", "deployment", "implementation"}:
            clean_options["require_pull_request"] = True
        if requires_ci_evidence and delivery_phase in {"packaging", "deployment"}:
            clean_options["requires_ci_evidence"] = True
        if requires_traceability:
            clean_options["requires_traceability"] = True

    requires_execution = (
        explicit_executable_request
        or has_scoped_claims
        or delivery_phase in {"implementation", "deployment", "packaging"}
    )
    if requires_execution:
        clean_options["required_backend_capability"] = "executable"
        clean_options["requires_executable_backend"] = True
        clean_options["worker_execution_mode"] = "command"
    elif requested_execution_mode == "api_text":
        clean_options["worker_execution_mode"] = "api_text"

    if delivery_expectations:
        clean_options["delivery_expectations"] = delivery_expectations
    if existing_contract:
        clean_options["task_contract"] = existing_contract
    return clean_options


def _select_worker_backend_for_task(
    *,
    provider_hint: Optional[str],
    instruction: str,
    assigned_role: str,
    options: Dict[str, Any],
    allow_provider_fallback: bool = True,
) -> tuple[Optional[str], Dict[str, Any], Optional[Dict[str, Any]]]:
    clean_options = _apply_task_contract(
        instruction=instruction,
        assigned_role=assigned_role,
        options=options,
    )
    requires_execution = task_requires_executable_backend(
        instruction=instruction,
        assigned_role=assigned_role,
        options=clean_options,
    )
    profiles = _worker_backend_profiles()
    provider_candidates: List[str] = []
    hinted = normalize_provider_id(provider_hint or "")
    if hinted and hinted in ALLOWED_PROVIDERS:
        provider_candidates.append(hinted)
    if allow_provider_fallback or not provider_candidates:
        for candidate in [
            SUPERVISOR_DEFAULT_WORKER_PROVIDER,
            DEFAULT_PROVIDER,
            "codex",
            "claude_code",
            "opencode",
        ]:
            normalized = normalize_provider_id(candidate)
            if normalized in ALLOWED_PROVIDERS and normalized not in provider_candidates:
                provider_candidates.append(normalized)

    ordered_candidates = list(provider_candidates)
    if not requires_execution:
        api_text_candidates = [
            provider
            for provider in provider_candidates
            if str((profiles.get(provider) or {}).get("default_mode") or "").strip().lower() == "api_text"
        ]
        ordered_candidates = api_text_candidates + [
            provider for provider in provider_candidates if provider not in api_text_candidates
        ]

    for provider in ordered_candidates:
        profile = profiles.get(provider) or {}
        if requires_execution and not bool(profile.get("supports_execution")):
            continue
        runtime_modes = [
            str(value).strip()
            for value in (profile.get("runtime_modes") or [])
            if str(value).strip()
        ]
        if not runtime_modes:
            continue
        selected_options = dict(clean_options)
        if requires_execution:
            selected_options["required_backend_capability"] = "executable"
            selected_options["requires_executable_backend"] = True
            selected_options["worker_execution_mode"] = "command"
        else:
            default_mode = str(profile.get("default_mode") or "").strip().lower()
            if default_mode in {"command", "api_text"}:
                selected_options["worker_execution_mode"] = default_mode
        return provider, selected_options, None

    failure = {
        "reason": "no_executable_worker_backend" if requires_execution else "no_worker_backend_available",
        "required_capability": "executable" if requires_execution else "any",
        "requested_provider": hinted or "",
        "backend_capabilities": _worker_backend_capability_summary(),
    }
    return None, clean_options, failure


def _topic_task_counts(scope: str, session_id: Optional[str] = None) -> Dict[str, int]:
    tasks, _active_plan_id, _all_tasks = _list_topic_tasks_for_view(
        scope,
        limit=200,
        statuses=None,
        plan_scope="active_preferred",
        session_id=session_id,
    )
    counts = {
        "total": len(tasks),
        "open": 0,
        "running": 0,
        "queued": 0,
        "blocked": 0,
        "done": 0,
        "failed": 0,
    }
    blocked_states = {"blocked_approval", "blocked_dependency", "blocked_information", "stalled"}
    for task in tasks:
        status = str(task.status or "").strip().lower()
        if status not in TERMINAL_TASK_STATUSES:
            counts["open"] += 1
        if status == "running":
            counts["running"] += 1
        elif status == "queued":
            counts["queued"] += 1
        elif status in blocked_states:
            counts["blocked"] += 1
        elif status == "done":
            counts["done"] += 1
        elif status == "failed":
            counts["failed"] += 1
    return counts


def _active_plan_revision_id_for_scope(scope: str, session_id: Optional[str] = None) -> str:
    active_plan = store.get_active_plan_revision(scope, session_id=session_id)
    if active_plan is None:
        return ""
    return str(active_plan.plan_revision_id or "").strip()


def _list_topic_tasks_for_view(
    scope: str,
    *,
    limit: int,
    statuses: Optional[List[str]],
    plan_scope: str = "active_preferred",
    session_id: Optional[str] = None,
) -> tuple[List[TaskRecord], str, List[TaskRecord]]:
    normalized_scope = normalize_topic_scope_id(scope)
    if not normalized_scope:
        return [], "", []
    normalized_plan_scope = str(plan_scope or "active_preferred").strip().lower()
    active_plan_id = _active_plan_revision_id_for_scope(normalized_scope, session_id=session_id)
    use_active_plan = normalized_plan_scope != "all" and bool(active_plan_id)
    fetch_limit = max(1, min(max(int(limit or 0), 1) * 4, 500))
    all_tasks = store.list_tasks_for_topic(normalized_scope, limit=fetch_limit, statuses=statuses)
    if use_active_plan:
        filtered = [
            task for task in all_tasks if str(getattr(task, "plan_revision_id", "") or "").strip() == active_plan_id
        ]
        return filtered[: max(1, min(int(limit or 0), 500))], active_plan_id, all_tasks
    return all_tasks[: max(1, min(int(limit or 0), 500))], active_plan_id, all_tasks


def _task_artifact_rows(
    task: TaskRecord,
    worker_session: Optional[WorkerSessionRecord],
) -> List[Dict[str, Any]]:
    artifacts: List[Dict[str, Any]] = []
    branch_name = str(task.branch_name or getattr(worker_session, "branch_name", "") or "").strip()
    if branch_name:
        artifacts.append({"kind": "branch", "label": branch_name, "value": branch_name})
    pr_url = str(getattr(worker_session, "pr_url", "") or "").strip()
    if pr_url:
        artifacts.append({"kind": "pull_request", "label": "Pull request", "url": pr_url, "value": pr_url})
    preview_url = str(task.preview_url or "").strip()
    if preview_url:
        artifacts.append({"kind": "preview", "label": "Preview", "url": preview_url, "value": preview_url})
    ci_status = str(getattr(worker_session, "ci_status", "") or "").strip()
    if ci_status:
        artifacts.append({"kind": "ci_status", "label": "CI", "value": ci_status})
    review_status = str(getattr(worker_session, "review_status", "") or "").strip()
    if review_status:
        artifacts.append({"kind": "review_status", "label": "Review", "value": review_status})
    mergeability = str(getattr(worker_session, "mergeability", "") or "").strip()
    if mergeability:
        artifacts.append({"kind": "mergeability", "label": "Mergeability", "value": mergeability})
    return artifacts


def _task_blockers(
    task: TaskRecord,
    worker_session: Optional[WorkerSessionRecord],
) -> List[str]:
    blockers: List[str] = []
    task_status = str(task.status or "").strip().lower()
    worker_status = str(getattr(worker_session, "status", "") or "").strip().lower()
    if task.clarification_requested:
        blockers.append("clarification_required")
    if task_status in {"blocked_approval", "blocked_dependency", "blocked_information", "stalled", "at_risk"}:
        blockers.append(task_status)
    if worker_status in {"blocked", "waiting_input", "needs_input", "stuck", "errored"}:
        blockers.append(worker_status)
    blocked_reason = str(task.blocked_reason or "").strip()
    if blocked_reason:
        blockers.append(blocked_reason)
    return _merge_unique_text(blockers)


def _task_summary_rows(
    tasks: Sequence[TaskRecord],
    worker_sessions_by_task: Dict[str, WorkerSessionRecord],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for task in tasks:
        worker_session = worker_sessions_by_task.get(task.task_id)
        branch_name = str(task.branch_name or getattr(worker_session, "branch_name", "") or "").strip() or None
        rows.append(
            {
                "task_id": task.task_id,
                "title": derive_task_title(task.instruction, task.options),
                "assigned_role": task.assigned_role,
                "status": _supervisor_task_display_status(task, worker_session),
                "worker_status": str(getattr(worker_session, "status", "") or "").strip().lower() or None,
                "activity": _supervisor_task_activity(task, worker_session),
                "plan_revision_id": task.plan_revision_id,
                "provider": task.provider,
                "branch_name": branch_name,
                "pull_request_url": str(getattr(worker_session, "pr_url", "") or "").strip() or None,
                "preview_url": str(task.preview_url or "").strip() or None,
                "result_text": str(task.result_text or "").strip() or None,
                "error_text": str(task.error_text or "").strip() or None,
                "clarification_requested": bool(task.clarification_requested),
                "approved": bool(task.approved),
                "artifacts": _task_artifact_rows(task, worker_session),
                "blockers": _task_blockers(task, worker_session),
                "last_updated": str(
                    getattr(worker_session, "updated_at", "") or task.updated_at or task.created_at or ""
                ).strip()
                or None,
            }
        )
    return rows


def _supervisor_task_summary(
    topic_scope_id: str,
    session_id: Optional[str] = None,
    session_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    active_plan = store.get_active_plan_revision(topic_scope_id, session_id=session_id)
    active_plan_id = str(getattr(active_plan, "plan_revision_id", "") or "").strip()
    latest_revisions = store.list_plan_revisions(topic_scope_id=topic_scope_id, session_id=session_id, limit=1)
    latest_plan = latest_revisions[0] if latest_revisions else None
    visible_tasks, _filtered_plan_id, all_tasks = _list_topic_tasks_for_view(
        topic_scope_id,
        limit=200,
        statuses=None,
        plan_scope="active_preferred",
        session_id=session_id,
    )
    worker_sessions = store.list_worker_sessions_for_topic(
        topic_scope_id,
        limit=min(2000, max(200, len(all_tasks) * 2)),
    )
    worker_sessions_by_task = {item.task_id: item for item in worker_sessions}
    visible_counts: Dict[str, int] = {}
    for task in visible_tasks:
        visible_counts[task.status] = visible_counts.get(task.status, 0) + 1
    all_counts: Dict[str, int] = {}
    for task in all_tasks:
        all_counts[task.status] = all_counts.get(task.status, 0) + 1
    completion_state = _plan_completion_assessment_state(
        session_metadata if isinstance(session_metadata, dict) else {},
        active_plan_id or "",
    )
    runtime_state = _derive_supervisor_runtime_state(
        topic_scope_id,
        session_metadata=session_metadata,
        active_plan=active_plan,
        latest_plan=latest_plan,
        tasks=visible_tasks,
        worker_sessions_by_task=worker_sessions_by_task,
        completion_state=completion_state,
    )
    return {
        "active_plan_revision_id": active_plan_id or None,
        "filtered_plan_revision_id": active_plan_id or None,
        "task_count": len(visible_tasks),
        "counts": visible_counts,
        "all_task_count": len(all_tasks),
        "all_counts": all_counts,
        "completion_follow_up_required": bool(completion_state.get("follow_up_required")),
        "completion_missing_evidence": [
            str(item).strip()
            for item in (completion_state.get("missing_evidence") or [])
            if str(item).strip()
        ],
        "phase": str(runtime_state.get("phase") or "").strip() or None,
        "runtime_state": runtime_state,
        "tasks": _task_summary_rows(visible_tasks, worker_sessions_by_task),
    }


def _plan_revision_has_existing_tasks(topic_scope_id: str, plan_revision_id: str) -> bool:
    scope = normalize_topic_scope_id(topic_scope_id)
    target_plan_id = str(plan_revision_id or "").strip()
    if not scope or not target_plan_id:
        return False
    for task in store.list_tasks_for_topic(scope, limit=200):
        if str(getattr(task, "plan_revision_id", "") or "").strip() == target_plan_id:
            return True
    return False


def _topic_repo_attachment_candidates(
    scope: str,
    *,
    repo_id: str,
    repo_url: Optional[str],
) -> List[Dict[str, Any]]:
    attachments: List[Dict[str, Any]] = []
    explicit_repo_id = str(repo_id or "").strip()
    explicit_repo_url = str(repo_url or "").strip()
    if explicit_repo_id:
        attachments.append(
            {
                "repo_id": explicit_repo_id,
                "repo_url": explicit_repo_url or _default_repo_url_for(explicit_repo_id) or "",
                "source": "explicit_input",
                "confidence": "high",
                "label": explicit_repo_id,
                "metadata": {},
            }
        )
    return attachments


def _resolve_supervisor_repo_binding(
    scope: str,
    *,
    user_id: str,
    repo_id: str,
    repo_url: Optional[str],
    topic_ref: Optional[Dict[str, Any]],
    transcript: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    rid = str(repo_id or "").strip()
    rurl = str(repo_url or "").strip()
    if rid:
        return {
            "id": rid,
            "url": rurl or _default_repo_url_for(rid) or "",
            "source": "explicit_input",
            "confidence": "high",
            "metadata": {},
        }
    return {"id": "", "url": "", "source": "unresolved", "confidence": "low", "metadata": {}}


def _resolve_supervisor_work_context(
    scope: str,
    *,
    user_id: str,
    repo_id: str,
    repo_url: Optional[str],
    topic_ref: Optional[Dict[str, Any]],
    transcript: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    attachments = _topic_repo_attachment_candidates(
        scope,
        repo_id=repo_id,
        repo_url=repo_url,
    )
    selected_repo = _resolve_supervisor_repo_binding(
        scope,
        user_id=user_id,
        repo_id=repo_id,
        repo_url=repo_url,
        topic_ref=topic_ref,
        transcript=transcript,
    )
    return {
        "repo": selected_repo,
        "attachments": {
            "repos": attachments,
            "selected_repo_id": str(selected_repo.get("id") or "").strip() or None,
        },
    }


def _controller_action_catalog() -> List[Dict[str, Any]]:
    return [
        {
            "id": "request_clarification",
            "source": "controller",
            "available": True,
            "description": "Ask concise follow-up questions when intent or scope is materially ambiguous.",
        },
        {
            "id": "update_plan_revision",
            "source": "controller",
            "available": True,
            "description": "Draft or revise the active topic spec/plan in thread.",
        },
        {
            "id": "start_execution",
            "source": "controller",
            "available": True,
            "description": "Start worker execution from the accepted plan after clear natural-language approval.",
        },
        {
            "id": "summarize_status",
            "source": "controller",
            "available": True,
            "description": "Summarize active plan, tasks, blockers, and completion evidence.",
        },
    ]


def _data_access_catalog(
    *,
    scope: str,
    transcript_count: int,
    topic_ref: Optional[Dict[str, Any]],
    work_context: Dict[str, Any],
    runtime_context: Dict[str, Any],
    integration_context: List[Dict[str, Any]],
    mcp_repo_tools: Dict[str, Any],
) -> List[Dict[str, Any]]:
    topic_ref = topic_ref if isinstance(topic_ref, dict) else {}
    topic_available = bool(
        transcript_count > 0
        or str(topic_ref.get("topic") or "").strip()
        or str(topic_ref.get("stream_name") or "").strip()
    )
    repo = work_context.get("repo") if isinstance(work_context.get("repo"), dict) else {}
    attachments = (
        work_context.get("attachments")
        if isinstance(work_context.get("attachments"), dict)
        else {}
    )
    repo_attachments = [
        item for item in (attachments.get("repos") or []) if isinstance(item, dict)
    ]
    repo_available = bool(
        str(repo.get("id") or "").strip()
        or str(repo.get("url") or "").strip()
        or repo_attachments
    )
    task_counts = _topic_task_counts(scope)
    scm_via_integration = any(
        bool(item.get("tools"))
        for item in integration_context
        if isinstance(item, dict)
        and str(item.get("integration") or "").strip() in {"github", "forgejo"}
        and str(item.get("credential_source") or "").strip()
    )
    scm_via_mcp = bool(mcp_repo_tools.get("available"))
    runtime_available = bool(runtime_context.get("workspace_path"))
    return [
        {
            "id": "zulip.query",
            "source": "controller",
            "available": topic_available,
            "mode": "read",
            "capabilities": ["current_topic_feed", "topic_history", "message_lookup"],
        },
        {
            "id": "task.query",
            "source": "controller",
            "available": True,
            "mode": "read",
            "capabilities": ["active_plan", "topic_tasks", "worker_outputs", "timeline_events"],
        },
        {
            "id": "scm.query",
            "source": "controller",
            "available": bool(repo_available and (scm_via_integration or scm_via_mcp)),
            "mode": "read",
            "capabilities": ["repo_metadata", "repo_search", "branches", "pull_requests", "ci_status"],
        },
        {
            "id": "workspace.query",
            "source": "controller",
            "available": runtime_available,
            "mode": "read",
            "capabilities": [
                "workspaces",
                "worktrees",
                "artifacts",
                "runtime_status",
                "uploads",
                "session_memory",
                "checkpoints",
            ],
        },
    ]


def _dynamic_mcp_tool_catalog(mcp_tools_inventory: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for server in (mcp_tools_inventory.get("servers") or []):
        if not isinstance(server, dict):
            continue
        server_name = str(server.get("name") or "").strip()
        if not server_name:
            continue
        enabled = bool(server.get("enabled", True))
        auth_state = "connected" if enabled else "disabled"
        for tool_name in (server.get("tools") or []):
            tool = str(tool_name or "").strip()
            if not tool:
                continue
            entries.append(
                {
                    "id": f"mcp.{server_name}.{tool}",
                    "source": "mcp",
                    "server": server_name,
                    "tool": tool,
                    "available": enabled,
                    "auth_state": auth_state,
                    "mode": "unknown",
                }
            )
    return entries


def _resolve_supervisor_tools_context(
    *,
    scope: str,
    session_id: Optional[str],
    user_id: str,
    transcript: List[Dict[str, Any]],
    topic_ref: Optional[Dict[str, Any]],
    repo_id: str,
    repo_url: Optional[str],
) -> Dict[str, Any]:
    transcript_items = [item for item in (transcript or []) if isinstance(item, dict)]
    policy = _effective_integration_policy(user_id)
    catalog_entries = _integration_catalog()
    catalog_by_id = {str(item.get("integration") or ""): item for item in catalog_entries}
    credentials = store.list_integration_credentials(user_id=user_id, include_revoked=False)
    connected = [item for item in credentials if item.status == "active"]
    connected_by_id: Dict[str, Any] = {item.integration: item for item in connected}
    connected_ids = sorted({item.integration for item in connected})

    enabled_ids = policy.get("enabled_integrations") or []
    if isinstance(enabled_ids, list) and enabled_ids:
        enabled_set = {
            normalize_integration_id(str(item).strip())
            for item in enabled_ids
            if str(item).strip()
        }
        connected_ids = [item for item in connected_ids if item in enabled_set]
    else:
        enabled_set = set()

    # Include service-level integrations (e.g., FORGEJO_API_KEY) so supervisor
    # can plan with repo access even before a user explicitly connects creds.
    effective_connected_ids = set(connected_ids)
    for integration_id in catalog_by_id:
        token, _source = _resolve_integration_token_for_user(
            user_id=user_id,
            integration=integration_id,
            credential=connected_by_id.get(integration_id),
        )
        if token:
            if enabled_set and integration_id not in enabled_set:
                continue
            effective_connected_ids.add(integration_id)

    tools_available: List[str] = []
    work_context = _resolve_supervisor_work_context(
        scope,
        user_id=user_id,
        repo_id=repo_id,
        repo_url=repo_url,
        topic_ref=topic_ref,
        transcript=transcript_items,
    )
    runtime_context = _describe_topic_runtime(scope, session_id=session_id)
    task_counts = _topic_task_counts(scope, session_id=session_id)
    active_plan = store.get_active_plan_revision(scope, session_id=session_id)
    topic_ref = topic_ref if isinstance(topic_ref, dict) else {}
    session_context = {
        "topic_scope_id": scope,
        "topic": {
            "stream_id": topic_ref.get("stream_id"),
            "stream_name": str(topic_ref.get("stream_name") or "").strip(),
            "topic": str(topic_ref.get("topic") or "").strip(),
        },
        "current_topic_feed": {
            "available": bool(policy.get("auto_topic_transcript", True)),
            "attached_messages": int(max(0, len(transcript_items))),
            "delivery": "auto_attached_each_turn",
        },
        "work_context": work_context,
        "active_plan": {
            "available": active_plan is not None,
            "plan_revision_id": active_plan.plan_revision_id if active_plan else "",
            "status": active_plan.status if active_plan else "",
        },
        "tasks": task_counts,
        "runtime": {
            "available": True,
            "workspace_path": runtime_context.get("workspace_path"),
            "uploads_path": runtime_context.get("uploads_path"),
            "outputs_path": runtime_context.get("outputs_path"),
            "checkpoints_path": runtime_context.get("checkpoints_path"),
            "memory_summary": runtime_context.get("memory_summary"),
            "upload_count": int(runtime_context.get("upload_count") or 0),
            "checkpoint_count": int(runtime_context.get("checkpoint_count") or 0),
        },
    }
    supervisor_actions = _controller_action_catalog()
    worker_backends = _worker_backend_catalog()
    tool_lines: List[str] = []
    tool_lines.append(
        "- workspace_runtime: topic-scoped workspace, uploads, outputs, checkpoints, and session memory are available."
    )

    integration_context: List[Dict[str, Any]] = []
    allow_external = bool(policy.get("allow_external_integrations", True))
    for integration_id in sorted(effective_connected_ids):
        entry = catalog_by_id.get(integration_id) or {"integration": integration_id}
        tools = [str(tool).strip() for tool in (entry.get("tools") or []) if str(tool).strip()]
        _token, token_source = _resolve_integration_token_for_user(
            user_id=user_id,
            integration=integration_id,
            credential=connected_by_id.get(integration_id),
        )
        source_entry = {
            "integration": integration_id,
            "display_name": str(entry.get("display_name") or integration_id),
            "source": "integration_api",
            "tools": tools if allow_external else [],
            "credential_source": token_source,
            "available": bool(allow_external and tools and token_source),
        }
        integration_context.append(
            {
                "integration": integration_id,
                "display_name": str(entry.get("display_name") or integration_id),
                "tools": tools,
                "base_url": str(entry.get("base_url") or "").strip(),
                "credential_source": token_source,
            }
        )
        integration_context[-1]["source_entry"] = source_entry
        if allow_external:
            source_label = f" [{token_source}]" if token_source else ""
            declared = f" ({', '.join(tools)})" if tools else ""
            tool_lines.append(f"- {integration_id}: connected API capabilities{declared}{source_label}.")
        else:
            tool_lines.append(f"- {integration_id}: credential available but disabled by policy.")

    should_query_mcp_inventory = bool(
        SUPERVISOR_ENGINE == "moltis"
        and MOLTIS_ENABLED
        and os.getenv("SUPERVISOR_MOLTIS_TOOL_INVENTORY_ENABLED", "true").strip().lower()
        in {"1", "true", "yes", "on", "y"}
    )
    mcp_tools_inventory = (
        _moltis_tools_inventory()
        if should_query_mcp_inventory
        else {"available": False, "reason": "inventory_skipped"}
    )
    mcp_repo_tools = _moltis_repo_management_tools_inventory_from_all(mcp_tools_inventory)
    dynamic_mcp_tools = _dynamic_mcp_tool_catalog(mcp_tools_inventory) if allow_external else []
    if allow_external and dynamic_mcp_tools:
        by_server: Dict[str, List[str]] = {}
        for item in dynamic_mcp_tools:
            server_name = str(item.get("server") or "").strip() or "mcp-server"
            tool_name = str(item.get("tool") or "").strip()
            if not tool_name:
                continue
            by_server.setdefault(server_name, []).append(tool_name)
        for server_name, tools in sorted(by_server.items()):
            tool_lines.append(f"- mcp:{server_name}: connected ({', '.join(sorted(set(tools)))}).")
    elif should_query_mcp_inventory and bool(mcp_tools_inventory.get("reason")):
        tool_lines.append(f"- mcp_tools: unavailable ({mcp_tools_inventory.get('reason')}).")

    data_access = _data_access_catalog(
        scope=scope,
        transcript_count=len(transcript_items),
        topic_ref=topic_ref,
        work_context=work_context,
        runtime_context=runtime_context,
        integration_context=integration_context,
        mcp_repo_tools=mcp_repo_tools,
    )
    capability_registry: Dict[str, Any] = {
        "session_context": session_context,
        "supervisor_actions": supervisor_actions,
        "data_access": data_access,
        "worker_backends": worker_backends,
        "integration_api": [
            item.get("source_entry")
            for item in integration_context
            if isinstance(item, dict) and isinstance(item.get("source_entry"), dict)
        ],
        "mcp": dynamic_mcp_tools,
        "runtime_features": {
            "topic_runtime": True,
            "uploads": True,
            "session_memory": True,
            "checkpoints": True,
        },
    }
    for section in ("supervisor_actions", "data_access", "worker_backends", "integration_api", "mcp"):
        for item in capability_registry.get(section, []):
            if not isinstance(item, dict):
                continue
            tool_id = str(item.get("id") or "").strip()
            if tool_id:
                tools_available.append(tool_id)

    legacy_mcp_migration = _legacy_integration_mcp_coverage(
        connected_integrations=integration_context,
        mcp_tools_inventory=mcp_tools_inventory,
    )

    dedup_tools = sorted(set(tools_available))
    return {
        "policy": policy,
        "tools_available": dedup_tools,
        "tool_lines": tool_lines,
        "capability_registry": capability_registry,
        "tool_registry": capability_registry,
        "connected_integrations": integration_context,
        "mcp_tools_inventory": mcp_tools_inventory,
        "mcp_repo_tools": mcp_repo_tools,
        "legacy_mcp_migration": legacy_mcp_migration,
        "work_context": work_context,
        "runtime_context": runtime_context,
    }


def _parse_csv_values(raw: str) -> List[str]:
    return [item.strip() for item in (raw or "").split(",") if item.strip()]


def _resolve_topic_scope_id(payload: "TaskCreateRequest") -> str:
    explicit = normalize_topic_scope_id(payload.topic_scope_id or "")
    if explicit:
        return explicit
    return derive_topic_scope_id(
        zulip_thread_ref=payload.zulip_thread_ref,
        repo_id=payload.repo_id.strip(),
        user_id=payload.user_id.strip(),
    )


def _merge_task_scope_options(
    *,
    base_options: Dict[str, Any],
    depends_on_task_ids: List[str],
    file_claims: List[str],
    area_claims: List[str],
) -> Dict[str, Any]:
    options = dict(base_options or {})
    dep_ids = [str(item).strip() for item in depends_on_task_ids if str(item).strip()]
    if dep_ids:
        options["depends_on_task_ids"] = dep_ids
    files = [str(item).strip() for item in file_claims if str(item).strip()]
    if files:
        options["file_claims"] = files
    areas = [str(item).strip() for item in area_claims if str(item).strip()]
    if areas:
        options["area_claims"] = areas
    return options


def _action_actor(payload: "TaskActionRequest") -> Dict[str, Any]:
    actor: Dict[str, Any] = {}
    user_id = (payload.actor_user_id or "").strip()
    email = (payload.actor_email or "").strip()
    if user_id:
        actor["user_id"] = user_id
    if email:
        actor["email"] = email
    return actor


def _release_blocked_approval_task(task_id: str, actor: Optional[Dict[str, Any]] = None):
    current = store.get_task(task_id)
    if current is None:
        return None
    if current.status != "blocked_approval":
        return current

    updated = store.set_task_status(
        task_id=task_id,
        status="queued",
        blocked_reason=None,
        clear_cancel_requested=True,
    )
    if updated is None:
        return current
    store.append_event(
        task_id,
        level="info",
        event_type="approval_gate_released",
        message="Approval recorded; task re-queued for dispatch",
        data={"actor": actor or {}},
    )
    coordinator.wake()
    return updated


def _ensure_supervisor_files() -> None:
    SUPERVISOR_DIR.mkdir(parents=True, exist_ok=True)
    if not SUPERVISOR_SOUL_PATH.exists():
        SUPERVISOR_SOUL_PATH.write_text(
            "\n".join(
                [
                    "# Supervisor Soul",
                    "",
                    "- Supervisor owns directive issuance and worker assignment.",
                    "- Supervisor resolves worker blockers autonomously before escalating to humans.",
                    "- Risky actions require explicit approval gates.",
                    "- Workers are isolated per task/worktree/container and never self-assign peer work.",
                    "",
                ]
            ),
            encoding="utf-8",
        )
    if not SUPERVISOR_MEMORY_PATH.exists():
        SUPERVISOR_MEMORY_PATH.write_text("# Supervisor Memory\n\n", encoding="utf-8")


def _load_supervisor_text(path: Path, *, max_chars: int = 12000) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return ""
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def _append_supervisor_memory(*, title: str, detail: str, tags: List[str], actor: Dict[str, Any]) -> None:
    ts = datetime.utcnow().isoformat() + "Z"
    clean_tags = [str(tag).strip().lower() for tag in tags if str(tag).strip()]
    tag_text = ", ".join(clean_tags) if clean_tags else "none"
    actor_bits = []
    if actor.get("user_id"):
        actor_bits.append(f"user_id={actor['user_id']}")
    if actor.get("email"):
        actor_bits.append(f"email={actor['email']}")
    actor_text = ", ".join(actor_bits) if actor_bits else "unknown"
    block = "\n".join(
        [
            f"## {ts} - {title.strip() or 'memory-entry'}",
            f"- actor: {actor_text}",
            f"- tags: {tag_text}",
            "",
            detail.strip(),
            "",
        ]
    )
    with SUPERVISOR_MEMORY_PATH.open("a", encoding="utf-8") as handle:
        handle.write(block)


def _topic_runtime_paths(scope: str):
    return get_runtime_paths().ensure_topic_dirs(scope)


def _describe_topic_runtime(scope: str, *, session_id: Optional[str] = None) -> Dict[str, Any]:
    paths = _topic_runtime_paths(scope)
    uploads = list_uploaded_files(paths)
    selected_session_id = str(session_id or "").strip()
    checkpoints = [
        checkpoint_to_dict(item)
        for item in list_checkpoints(paths, session_id=selected_session_id or None, limit=10)
    ]
    memory_state = load_memory_state(paths, session_id=selected_session_id or None)
    sessions = _list_supervisor_session_dicts(scope)
    payload = {
        **topic_runtime_to_dict(paths),
        "uploads": uploads,
        "upload_count": len(uploads),
        "sessions": sessions,
        "session_count": len(sessions),
        "memory_summary": str(memory_state.get("summary") or "").strip(),
        "memory_highlights": [
            str(item).strip()
            for item in (memory_state.get("highlights") or [])
            if str(item).strip()
        ],
        "checkpoints": checkpoints,
        "checkpoint_count": len(checkpoints),
    }
    if selected_session_id:
        payload.update(
            session_runtime_to_dict(
                get_runtime_paths().ensure_session_dirs(scope, selected_session_id)
            )
        )
    return payload


def _derive_supervisor_session_title(
    *,
    mode: str,
    actor_name: str,
    message: str,
    explicit_title: Optional[str] = None,
) -> str:
    user_message_match = re.search(
        r"<user_message>\s*(.*?)\s*</user_message>",
        str(message or ""),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if user_message_match:
        message = str(user_message_match.group(1) or "").strip()
    explicit = " ".join(str(explicit_title or "").split()).strip()
    if explicit:
        return explicit[:120]
    first_line = " ".join(str(message or "").split()).strip()
    if first_line:
        return first_line[:120]
    actor = " ".join(str(actor_name or "").split()).strip()
    if actor:
        if mode == "mention":
            return f"Mention from {actor}"[:120]
        return f"Session with {actor}"[:120]
    return "Supervisor session"


def _supervisor_task_display_status(task: TaskRecord, worker_session: Optional[WorkerSessionRecord]) -> str:
    worker_status = str(getattr(worker_session, "status", "") or "").strip().lower()
    worker_aliases = {
        "running": "working",
        "spawning": "working",
        "pr_open": "working",
        "review_pending": "working",
        "approved": "working",
        "mergeable": "working",
        "merged": "working",
        "cleanup": "working",
        "waiting_input": "needs_input",
        "needs_input": "needs_input",
        "stuck": "blocked",
        "errored": "failed",
        "completed": "done",
        "terminated": "done",
    }
    if worker_status:
        return worker_aliases.get(worker_status, worker_status)
    task_status = str(task.status or "").strip().lower()
    task_aliases = {
        "running": "working",
        "blocked_information": "needs_input",
        "blocked_dependency": "blocked",
        "blocked_approval": "blocked",
        "stalled": "blocked",
        "at_risk": "working",
    }
    return task_aliases.get(task_status, task_status or "queued")


def _supervisor_task_activity(task: TaskRecord, worker_session: Optional[WorkerSessionRecord]) -> str:
    worker_activity = str(getattr(worker_session, "activity", "") or "").strip().lower()
    if worker_activity and worker_activity not in {"active", "ready", "exited"}:
        return worker_activity
    blocked_reason = str(task.blocked_reason or "").strip()
    if blocked_reason:
        return blocked_reason
    return ""


def _plan_step_runtime_contract(step: Dict[str, Any]) -> Dict[str, Any]:
    title = str(step.get("title") or step.get("task_title") or "").strip()
    instruction = str(step.get("instruction") or "").strip()
    assigned_role = str(step.get("assigned_role") or step.get("kind") or "").strip()
    options = dict(step.get("options")) if isinstance(step.get("options"), dict) else {}
    if title and not str(options.get("task_title") or "").strip():
        options["task_title"] = title
    effective_options = _apply_task_contract(
        instruction=instruction,
        assigned_role=assigned_role,
        options=options,
    )
    task_contract = (
        dict(effective_options.get("task_contract"))
        if isinstance(effective_options.get("task_contract"), dict)
        else {}
    )
    required_artifacts = _merge_unique_text(
        list(task_contract.get("required_artifacts") or [])
        if isinstance(task_contract.get("required_artifacts"), list)
        else []
    )
    preferred_artifacts = _merge_unique_text(
        list(task_contract.get("preferred_artifacts") or [])
        if isinstance(task_contract.get("preferred_artifacts"), list)
        else []
    )
    evidence_classes = _merge_unique_text(
        list(task_contract.get("evidence_classes") or [])
        if isinstance(task_contract.get("evidence_classes"), list)
        else []
    )
    delivery_phase = _task_delivery_phase(
        assigned_role=assigned_role,
        instruction=instruction,
        options={"task_title": title},
    )
    return {
        "title": title,
        "instruction": instruction,
        "assigned_role": assigned_role,
        "delivery_phase": delivery_phase,
        "requires_execution": task_requires_executable_backend(
            instruction=instruction,
            assigned_role=assigned_role,
            options=effective_options,
        ),
        "requires_repo_output": bool(task_contract.get("requires_repo_output")),
        "requires_runtime_evidence": bool(task_contract.get("requires_runtime_evidence")),
        "requires_deployment_evidence": bool(task_contract.get("requires_deployment_evidence")),
        "requires_ci_evidence": bool(task_contract.get("requires_ci_evidence")),
        "prefer_pull_request": bool(task_contract.get("prefer_pull_request")),
        "require_pull_request": bool(task_contract.get("require_pull_request")),
        "required_artifacts": required_artifacts,
        "preferred_artifacts": preferred_artifacts,
        "evidence_classes": evidence_classes,
    }


def _plan_runtime_contract(plan: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    plan_obj = plan if isinstance(plan, dict) else {}
    source = dict(plan_obj.get("source")) if isinstance(plan_obj.get("source"), dict) else {}
    unknowns = [str(item).strip() for item in (plan_obj.get("unknowns") or []) if str(item).strip()]
    approval_points = [str(item).strip() for item in (plan_obj.get("approval_points") or []) if str(item).strip()]
    step_contracts = [
        _plan_step_runtime_contract(step)
        for step in (plan_obj.get("execution_steps") or [])
        if isinstance(step, dict)
    ]
    required_artifacts: List[str] = []
    preferred_artifacts: List[str] = []
    evidence_classes: List[str] = []
    delivery_phases: List[str] = []
    for item in step_contracts:
        required_artifacts = _merge_unique_text(required_artifacts + list(item.get("required_artifacts") or []))
        preferred_artifacts = _merge_unique_text(preferred_artifacts + list(item.get("preferred_artifacts") or []))
        evidence_classes = _merge_unique_text(evidence_classes + list(item.get("evidence_classes") or []))
        phase = str(item.get("delivery_phase") or "").strip()
        if phase:
            delivery_phases = _merge_unique_text(delivery_phases + [phase])

    requires_preview = bool(
        "preview_url" in required_artifacts
        or "preview_url" in preferred_artifacts
        or any(bool(item.get("requires_deployment_evidence")) for item in step_contracts)
    )
    requires_pull_request = bool(
        "pull_request_url" in required_artifacts
        or any(bool(item.get("require_pull_request")) for item in step_contracts)
    )
    prefers_pull_request = bool(
        requires_pull_request
        or "pull_request_url" in preferred_artifacts
        or any(bool(item.get("prefer_pull_request")) for item in step_contracts)
    )
    requires_ci_evidence = bool(
        "ci_status" in required_artifacts
        or any(bool(item.get("requires_ci_evidence")) for item in step_contracts)
    )
    requires_repo_attachment = bool(
        any(bool(item.get("requires_repo_output")) for item in step_contracts)
        or "branch_or_pr" in required_artifacts
        or "pull_request_url" in required_artifacts
        or "code_changes" in required_artifacts
    )
    requires_execution = bool(
        any(bool(item.get("requires_execution")) for item in step_contracts)
        or any(
            str(item.get("delivery_phase") or "").strip() in {"implementation", "deployment", "packaging"}
            for item in step_contracts
        )
    )
    return {
        "has_plan": bool(plan_obj),
        "plan_revision_id": str(plan_obj.get("plan_revision_id") or "").strip(),
        "has_actionable_steps": any(bool(item.get("instruction")) for item in step_contracts),
        "requires_execution": requires_execution,
        "requires_repo_attachment": requires_repo_attachment,
        "requires_preview": requires_preview,
        "requires_pull_request": requires_pull_request,
        "prefers_pull_request": prefers_pull_request,
        "requires_ci_evidence": requires_ci_evidence,
        "clarification_required": bool(unknowns),
        "clarification_questions": unknowns,
        "approval_points": approval_points,
        "required_artifacts": required_artifacts,
        "preferred_artifacts": preferred_artifacts,
        "evidence_classes": evidence_classes,
        "delivery_phases": delivery_phases,
        "execution_authorized": bool(source.get("execution_authorized")),
    }


def _repo_attachment_runtime_state(
    *,
    repo_id: str,
    repo_url: Optional[str],
    source: str,
    confidence: str,
    requires_repo_attachment: bool,
) -> Dict[str, Any]:
    normalized_source = str(source or "").strip().lower() or "unresolved"
    normalized_confidence = str(confidence or "").strip().lower() or "low"
    ready_sources = {"explicit_input", "topic_binding", "task_binding", "topic_discovery"}
    if not requires_repo_attachment:
        status = "not_required"
        ready = True
    elif repo_id and normalized_source in ready_sources and normalized_confidence in {"high", "medium"}:
        status = "bound"
        ready = True
    elif repo_id and normalized_source == "default_repo_config":
        status = "default_fallback"
        ready = False
    elif repo_id and normalized_confidence == "low":
        status = "low_confidence"
        ready = False
    else:
        status = "missing"
        ready = False
    return {
        "status": status,
        "ready": ready,
        "required": requires_repo_attachment,
        "repo_id": repo_id or None,
        "repo_url": repo_url or None,
        "source": normalized_source,
        "confidence": normalized_confidence,
        "action_required": "attach_or_create_repo" if requires_repo_attachment and not ready else None,
    }


def _observed_artifacts_from_tasks(
    tasks: List[TaskRecord],
    worker_sessions_by_task: Dict[str, WorkerSessionRecord],
) -> List[str]:
    observed: List[str] = []
    for task in tasks:
        worker_session = worker_sessions_by_task.get(task.task_id)
        task_status = str(task.status or "").strip().lower()
        if task.branch_name or str(getattr(worker_session, "branch_name", "") or "").strip():
            observed = _merge_unique_text(observed + ["branch_or_pr", "code_changes"])
        if str(getattr(worker_session, "pr_url", "") or "").strip():
            observed = _merge_unique_text(observed + ["branch_or_pr", "pull_request_url"])
        if task.preview_url or task.preview_port:
            observed = _merge_unique_text(observed + ["preview_url", "runtime_evidence"])
        if str(getattr(worker_session, "ci_status", "") or "").strip():
            observed = _merge_unique_text(observed + ["ci_status"])
        if task_status == "done" and (
            str(task.result_text or "").strip() or str(task.error_text or "").strip()
        ):
            observed = _merge_unique_text(observed + ["verification_results"])
    return observed


def _derive_supervisor_runtime_state(
    topic_scope_id: str,
    *,
    session_metadata: Optional[Dict[str, Any]] = None,
    active_plan: Optional[PlanRevisionRecord] = None,
    latest_plan: Optional[PlanRevisionRecord] = None,
    tasks: Optional[List[TaskRecord]] = None,
    worker_sessions_by_task: Optional[Dict[str, WorkerSessionRecord]] = None,
    completion_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    metadata = session_metadata if isinstance(session_metadata, dict) else {}
    task_items = list(tasks or [])
    worker_map = worker_sessions_by_task if isinstance(worker_sessions_by_task, dict) else {}
    current_plan = active_plan or latest_plan
    if current_plan is None and scope:
        revisions = store.list_plan_revisions(topic_scope_id=scope, limit=1)
        current_plan = revisions[0] if revisions else None
    latest_plan_obj = latest_plan or current_plan
    plan_dict = plan_revision_to_dict(current_plan) if current_plan is not None else {}
    latest_plan_dict = plan_revision_to_dict(latest_plan_obj) if latest_plan_obj is not None else {}
    current_plan_id = str(plan_dict.get("plan_revision_id") or "").strip()
    derived_session_id = (
        str(getattr(current_plan, "session_id", "") or "").strip()
        or str(getattr(latest_plan_obj, "session_id", "") or "").strip()
    )
    paths = _topic_runtime_paths(scope)
    uploads = list_uploaded_files(paths)
    memory_state = load_memory_state(paths, session_id=derived_session_id or None)
    task_rows = _task_summary_rows(task_items, worker_map)
    worker_rows = [
        worker_session_to_dict(item)
        for item in worker_map.values()
        if isinstance(item, WorkerSessionRecord)
    ]
    artifacts = [
        {**artifact, "task_id": row["task_id"]}
        for row in task_rows
        for artifact in (row.get("artifacts") or [])
        if isinstance(artifact, dict)
    ]
    previews = [
        {
            "task_id": row["task_id"],
            "url": str(row.get("preview_url") or "").strip(),
        }
        for row in task_rows
        if str(row.get("preview_url") or "").strip()
    ]
    runtime_state = build_topic_runtime_state(
        topic_scope_id=scope,
        session_id=derived_session_id,
        input_payload={
            "uploads": uploads,
            "new_uploads": [],
            "memory_summary": str(memory_state.get("summary") or "").strip(),
            "memory_highlights": [
                str(item).strip()
                for item in (memory_state.get("highlights") or [])
                if str(item).strip()
            ],
            "repo_attachments": _topic_repo_attachment_candidates(
                scope,
                repo_id=str(metadata.get("last_selected_repo_id") or "").strip(),
                repo_url=str(metadata.get("last_selected_repo_url") or "").strip() or None,
            )
            if scope
            else [],
            "selected_repo_id": str(metadata.get("last_selected_repo_id") or "").strip(),
            "active_plan": plan_dict,
            "latest_plan": latest_plan_dict,
            "approval_granted": _runtime_approval_granted(
                metadata,
                current_plan_id=current_plan_id,
                task_items=task_items,
            ),
            "has_tasks": bool(task_items),
            "worker_backends": _worker_backend_catalog(),
            "integration_tools": [],
            "mcp_tools": [],
            "task_clarification_questions": [
                question
                for task in task_items
                for question in (task.clarification_questions or [])
                if str(question).strip()
            ],
            "tasks": task_rows,
            "worker_sessions": worker_rows,
            "previews": previews,
            "artifacts": artifacts,
            "deployments": [],
        },
    )
    observed_artifacts = _observed_artifacts_from_tasks(task_items, worker_map)
    completion_missing_evidence = [
        str(item).strip()
        for item in ((completion_state or {}).get("missing_evidence") or [])
        if str(item).strip()
    ]
    follow_up_required = bool((completion_state or {}).get("follow_up_required"))
    selected_repo = (
        runtime_state.get("attachments", {}).get("selected_repo")
        if isinstance(runtime_state.get("attachments"), dict)
        else None
    )
    repo_attachments = (
        runtime_state.get("attachments", {}).get("repos")
        if isinstance(runtime_state.get("attachments"), dict)
        else []
    )
    repo_state = {
        "status": (
            "selected"
            if isinstance(selected_repo, dict) and str(selected_repo.get("repo_id") or "").strip()
            else "available"
            if repo_attachments
            else "missing"
        ),
        "ready": bool(isinstance(selected_repo, dict) and str(selected_repo.get("repo_id") or "").strip()),
        "required": False,
        "repo_id": str(selected_repo.get("repo_id") or "").strip() or None
        if isinstance(selected_repo, dict)
        else None,
        "repo_url": str(selected_repo.get("repo_url") or "").strip() or None
        if isinstance(selected_repo, dict)
        else None,
        "source": str(selected_repo.get("source") or "").strip() or "unresolved"
        if isinstance(selected_repo, dict)
        else "unresolved",
        "confidence": str(selected_repo.get("confidence") or "").strip() or "low"
        if isinstance(selected_repo, dict)
        else "low",
        "available_attachments": len(repo_attachments) if isinstance(repo_attachments, list) else 0,
    }
    backend_ready = bool(runtime_state.get("capabilities", {}).get("execution_available"))
    approval_required = bool(runtime_state.get("approvals", {}).get("required")) and not bool(
        runtime_state.get("approvals", {}).get("granted")
    )
    clarification_required = bool(runtime_state.get("clarifications", {}).get("required"))
    execution_blockers = [
        str(item).strip()
        for item in (runtime_state.get("execution_blockers") or [])
        if str(item).strip()
    ]
    if follow_up_required:
        execution_blockers = _merge_unique_text(execution_blockers + ["completion_follow_up_required"])

    phase = str(runtime_state.get("phase") or "").strip() or "idle"
    phase_reason = str(runtime_state.get("phase_reason") or "").strip() or "no active runtime evidence"
    if follow_up_required or completion_missing_evidence:
        phase = "follow_up_required"
        phase_reason = "delivery evidence or follow-up is still required"

    return {
        "phase": phase,
        "phase_reason": phase_reason,
        "approval_required": approval_required,
        "clarification_required": clarification_required,
        "execution_requested": _runtime_execution_requested(
            metadata,
            current_plan_id=current_plan_id,
            task_items=task_items,
        ),
        "execution_prerequisites_ready": bool(runtime_state.get("plan", {}).get("has_actionable_steps"))
        and not approval_required
        and not execution_blockers,
        "execution_blockers": execution_blockers,
        "completion_follow_up_required": follow_up_required,
        "completion_missing_evidence": completion_missing_evidence,
        "observed_artifacts": observed_artifacts,
        "repo_attachment": repo_state,
        "worker_backend_ready": backend_ready,
        "active_plan_revision_id": str(runtime_state.get("plan", {}).get("plan_revision_id") or "").strip() or None,
        "contract": {
            "has_plan": bool(runtime_state.get("plan", {}).get("has_plan")),
            "has_actionable_steps": bool(runtime_state.get("plan", {}).get("has_actionable_steps")),
            "approval_required": approval_required,
            "clarification_required": clarification_required,
        },
        "runtime_state": runtime_state,
    }


def _supervisor_task_priority(task: TaskRecord, worker_session: Optional[WorkerSessionRecord]) -> tuple[int, str, str]:
    display_status = _supervisor_task_display_status(task, worker_session)
    priorities = {
        "working": 90,
        "needs_input": 80,
        "blocked": 75,
        "queued": 65,
        "paused": 55,
        "done": 30,
        "failed": 20,
        "canceled": 10,
    }
    return (
        priorities.get(display_status, 0),
        str(task.updated_at or ""),
        str(task.created_at or ""),
    )


def _summarize_supervisor_session_tasks(
    tasks: List[TaskRecord],
    worker_sessions_by_task: Dict[str, WorkerSessionRecord],
    *,
    completion_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    counts: Dict[str, int] = {}
    active_task_count = 0
    active_candidate: Optional[tuple[tuple[int, str, str], Dict[str, Any]]] = None
    fallback_candidate: Optional[tuple[tuple[int, str, str], Dict[str, Any]]] = None
    worker_statuses: set[str] = set()
    follow_up_required = bool((completion_state or {}).get("follow_up_required"))
    for task in tasks:
        task_status = str(task.status or "").strip().lower() or "queued"
        counts[task_status] = counts.get(task_status, 0) + 1
        worker_session = worker_sessions_by_task.get(task.task_id)
        worker_status = str(getattr(worker_session, "status", "") or "").strip().lower()
        if worker_status:
            worker_statuses.add(worker_status)
        summary = {
            "task_id": task.task_id,
            "title": derive_task_title(task.instruction, task.options),
            "status": task_status,
            "display_status": _supervisor_task_display_status(task, worker_session),
            "worker_status": worker_status or None,
            "activity": _supervisor_task_activity(task, worker_session),
            "assigned_role": str(task.assigned_role or getattr(worker_session, "assigned_role", "") or "").strip()
            or "worker",
            "updated_at": task.updated_at,
        }
        priority = _supervisor_task_priority(task, worker_session)
        if fallback_candidate is None or priority > fallback_candidate[0]:
            fallback_candidate = (priority, summary)
        if task_status not in TERMINAL_TASK_STATUSES:
            active_task_count += 1
            if active_candidate is None or priority > active_candidate[0]:
                active_candidate = (priority, summary)

    overall_status = "idle"
    if active_task_count > 0:
        if counts.get("running", 0) > 0 or worker_statuses.intersection(
            {"running", "working", "spawning", "pr_open", "review_pending", "approved", "mergeable", "merged", "cleanup"}
        ):
            overall_status = "working"
        elif counts.get("blocked_information", 0) > 0 or worker_statuses.intersection({"waiting_input", "needs_input"}):
            overall_status = "needs_input"
        elif counts.get("blocked_dependency", 0) > 0 or counts.get("blocked_approval", 0) > 0 or counts.get("stalled", 0) > 0:
            overall_status = "blocked"
        else:
            overall_status = "queued"
    elif tasks:
        if counts.get("failed", 0) > 0 or worker_statuses.intersection({"failed", "errored"}):
            overall_status = "failed"
        elif counts.get("done", 0) == len(tasks):
            overall_status = "done"
        elif counts.get("canceled", 0) == len(tasks):
            overall_status = "canceled"

    if follow_up_required and active_task_count == 0:
        overall_status = "blocked"

    active_task = active_candidate or (None if follow_up_required else fallback_candidate)
    return {
        "task_count": len(tasks),
        "active_task_count": active_task_count,
        "counts": counts,
        "overall_status": overall_status,
        "completion_follow_up_required": follow_up_required,
        "completion_missing_evidence": [
            str(item).strip()
            for item in ((completion_state or {}).get("missing_evidence") or [])
            if str(item).strip()
        ],
        "active_task": active_task[1] if active_task else None,
    }


def _build_supervisor_session_views(
    scope: str,
    *,
    sessions: Optional[List[SupervisorSessionRecord]] = None,
    include_session: Optional[SupervisorSessionRecord] = None,
    limit: int = 100,
) -> tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    listed_sessions = (
        list(sessions)
        if sessions is not None
        else list(store.list_supervisor_sessions(topic_scope_id=scope, limit=limit))
    )
    if include_session is not None and all(item.session_id != include_session.session_id for item in listed_sessions):
        listed_sessions.append(include_session)
    if not listed_sessions:
        return [], {}

    session_ids = [item.session_id for item in listed_sessions]
    session_id_set = set(session_ids)
    last_message_ids = store.latest_supervisor_event_ids_by_session(
        topic_scope_id=scope,
        session_ids=session_ids,
    )

    plan_limit = min(500, max(200, max(limit, len(listed_sessions)) * 12))
    plans = store.list_plan_revisions(topic_scope_id=scope, limit=plan_limit)
    latest_plan_by_session: Dict[str, PlanRevisionRecord] = {}
    active_plan_by_session: Dict[str, PlanRevisionRecord] = {}
    session_plan_ids: Dict[str, List[str]] = {}
    fallback_latest_plan: Optional[PlanRevisionRecord] = None
    fallback_active_plan: Optional[PlanRevisionRecord] = None
    fallback_plan_ids: List[str] = []
    for plan in plans:
        sid = str(plan.session_id or "").strip()
        if sid:
            if sid not in session_id_set:
                continue
            session_plan_ids.setdefault(sid, []).append(plan.plan_revision_id)
            if sid not in latest_plan_by_session:
                latest_plan_by_session[sid] = plan
            if plan.status == "active" and sid not in active_plan_by_session:
                active_plan_by_session[sid] = plan
            continue
        fallback_plan_ids.append(plan.plan_revision_id)
        if fallback_latest_plan is None:
            fallback_latest_plan = plan
        if plan.status == "active" and fallback_active_plan is None:
            fallback_active_plan = plan

    tasks = store.list_tasks_for_topic(scope, limit=500)
    tasks_by_plan: Dict[str, List[TaskRecord]] = {}
    planless_tasks: List[TaskRecord] = []
    for task in tasks:
        plan_revision_id = str(task.plan_revision_id or "").strip()
        if plan_revision_id:
            tasks_by_plan.setdefault(plan_revision_id, []).append(task)
        else:
            planless_tasks.append(task)

    worker_sessions = store.list_worker_sessions_for_topic(
        scope,
        limit=min(2000, max(200, len(tasks) * 2)),
    )
    worker_sessions_by_task = {item.task_id: item for item in worker_sessions}
    rows: List[Dict[str, Any]] = []
    session_map: Dict[str, Dict[str, Any]] = {}
    for session in listed_sessions:
        metadata = dict(session.metadata or {})
        exact_plan_ids = session_plan_ids.get(session.session_id, [])
        task_bucket: List[TaskRecord] = []
        if exact_plan_ids:
            for plan_revision_id in exact_plan_ids:
                task_bucket.extend(tasks_by_plan.get(plan_revision_id, []))
        elif fallback_plan_ids:
            for plan_revision_id in fallback_plan_ids:
                task_bucket.extend(tasks_by_plan.get(plan_revision_id, []))
        elif len(listed_sessions) == 1 and planless_tasks:
            task_bucket = list(planless_tasks)
        task_bucket.sort(
            key=lambda item: (str(item.updated_at or ""), str(item.created_at or "")),
            reverse=True,
        )
        latest_plan = latest_plan_by_session.get(session.session_id) or fallback_latest_plan
        active_plan = active_plan_by_session.get(session.session_id) or fallback_active_plan
        completion_plan_id = (
            str(active_plan.plan_revision_id or "").strip()
            if active_plan is not None
            else str(latest_plan.plan_revision_id or "").strip()
            if latest_plan is not None
            else ""
        )
        completion_state = _plan_completion_assessment_state(metadata, completion_plan_id)
        task_summary = _summarize_supervisor_session_tasks(
            task_bucket,
            worker_sessions_by_task,
            completion_state=completion_state,
        )
        runtime_state = _derive_supervisor_runtime_state(
            scope,
            session_metadata=metadata,
            active_plan=active_plan,
            latest_plan=latest_plan,
            tasks=task_bucket,
            worker_sessions_by_task=worker_sessions_by_task,
            completion_state=completion_state,
        )
        task_summary["phase"] = str(runtime_state.get("phase") or "").strip() or None
        task_summary["runtime_state"] = runtime_state
        row = {
            **supervisor_session_to_dict(session),
            "title": str(metadata.get("title") or "").strip(),
            "created_via": str(metadata.get("created_via") or "").strip(),
            "created_by_user_id": str(metadata.get("created_by_user_id") or "").strip(),
            "created_by_name": str(metadata.get("created_by_name") or "").strip(),
            "latest_plan_revision_id": latest_plan.plan_revision_id if latest_plan else None,
            "active_plan_revision_id": active_plan.plan_revision_id if active_plan else None,
            "active_job_id": None,
            "last_message_id": last_message_ids.get(session.session_id),
            "phase": str(runtime_state.get("phase") or "").strip() or None,
            "runtime_state": runtime_state,
            "task_summary": task_summary,
        }
        rows.append(row)
        session_map[session.session_id] = row
    return rows, session_map


def _list_supervisor_session_dicts(scope: str, *, limit: int = 100) -> List[Dict[str, Any]]:
    rows, _session_map = _build_supervisor_session_views(scope, limit=limit)
    return rows


def _resolve_supervisor_session(
    *,
    scope: str,
    requested_session_id: Optional[str],
    session_create_mode: Optional[str],
    actor_user_id: Optional[str],
    actor_name: Optional[str],
    message: str = "",
    session_title: Optional[str] = None,
    status: str = "active",
) -> tuple[SupervisorSessionRecord, bool]:
    requested_sid = str(requested_session_id or "").strip()
    if requested_sid:
        existing = store.get_supervisor_session_by_id(requested_sid)
        if existing is not None and existing.topic_scope_id == scope:
            return existing, False

    mode = str(session_create_mode or "").strip().lower()
    if mode in {"manual", "mention"}:
        metadata = {
            "title": _derive_supervisor_session_title(
                mode=mode,
                actor_name=str(actor_name or "").strip(),
                message=message,
                explicit_title=session_title,
            ),
            "created_via": mode,
        }
        actor_id = str(actor_user_id or "").strip().lower()
        actor_display = str(actor_name or "").strip()
        if actor_id:
            metadata["created_by_user_id"] = actor_id
        if actor_display:
            metadata["created_by_name"] = actor_display
        session = store.create_supervisor_session(
            topic_scope_id=scope,
            status=status,
            metadata=metadata,
        )
        return session, True

    session = store.get_or_create_supervisor_session(topic_scope_id=scope, session_id=requested_sid, status=status)
    return session, False


def _build_supervisor_snapshot(
    *,
    scope: str,
    session: SupervisorSessionRecord,
    events: List[SupervisorEventRecord],
    next_after_id: int,
) -> Dict[str, Any]:
    sessions, session_map = _build_supervisor_session_views(scope, include_session=session)
    return {
        "ok": True,
        "topic_scope_id": scope,
        "session": session_map.get(session.session_id) or supervisor_session_to_dict(session),
        "sessions": sessions,
        "events": [supervisor_event_to_dict(item) for item in events],
        "task_summary": _supervisor_task_summary(
            scope,
            session.session_id,
            session.metadata if isinstance(session.metadata, dict) else {},
        ),
        "next_after_id": next_after_id,
    }


def _step_claims(step: Dict[str, Any]) -> tuple[set[str], set[str]]:
    file_claims = {
        str(item).strip().lower()
        for item in (step.get("file_claims") or [])
        if str(item).strip()
    }
    area_claims = {
        str(item).strip().lower()
        for item in (step.get("area_claims") or [])
        if str(item).strip()
    }
    return file_claims, area_claims


def _steps_conflict(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    left_files, left_areas = _step_claims(left)
    right_files, right_areas = _step_claims(right)
    return bool(left_files.intersection(right_files) or left_areas.intersection(right_areas))


def _build_parallel_seams(execution_steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    steps_by_id: Dict[str, Dict[str, Any]] = {}
    for idx, raw in enumerate(execution_steps):
        if not isinstance(raw, dict):
            continue
        step_id = str(raw.get("step_id") or raw.get("id") or f"step_{idx+1}").strip()
        if not step_id:
            continue
        normalized = dict(raw)
        normalized["step_id"] = step_id
        kind = str(raw.get("kind") or "write").strip().lower()
        if kind not in {"write", "read_only", "verify"}:
            kind = "write"
        normalized["kind"] = kind
        deps = [
            str(item).strip()
            for item in (raw.get("depends_on") or raw.get("depends_on_task_ids") or [])
            if str(item).strip()
        ]
        normalized["depends_on"] = deps
        steps_by_id[step_id] = normalized

    pending = set(steps_by_id.keys())
    completed: set[str] = set()
    seams: List[Dict[str, Any]] = []
    layer = 0

    while pending:
        ready = [
            steps_by_id[step_id]
            for step_id in sorted(pending)
            if all(dep in completed for dep in steps_by_id[step_id].get("depends_on", []))
        ]
        if not ready:
            # unresolved dependency cycle or missing refs; serialize remaining steps
            for step_id in sorted(pending):
                seams.append(
                    {
                        "seam_id": f"seam_{len(seams)+1}",
                        "layer": layer,
                        "mode": "serial_fallback",
                        "step_ids": [step_id],
                    }
                )
                completed.add(step_id)
            pending.clear()
            break

        layer += 1
        used: set[str] = set()
        for step in ready:
            sid = step["step_id"]
            if sid in used:
                continue

            kind = step.get("kind")
            if kind == "write":
                seam_steps = [step]
                used.add(sid)
                for peer in ready:
                    pid = peer["step_id"]
                    if pid in used:
                        continue
                    if peer.get("kind") != "write":
                        continue
                    if _steps_conflict(step, peer):
                        continue
                    seam_steps.append(peer)
                    used.add(pid)
                seams.append(
                    {
                        "seam_id": f"seam_{len(seams)+1}",
                        "layer": layer,
                        "mode": "write_parallel" if len(seam_steps) > 1 else "write_serial",
                        "step_ids": [item["step_id"] for item in seam_steps],
                    }
                )
                continue

            # read_only and verify can be grouped in the same layer.
            seam_steps = [step]
            used.add(sid)
            for peer in ready:
                pid = peer["step_id"]
                if pid in used:
                    continue
                if peer.get("kind") in {"read_only", "verify"}:
                    seam_steps.append(peer)
                    used.add(pid)
            seams.append(
                {
                    "seam_id": f"seam_{len(seams)+1}",
                    "layer": layer,
                    "mode": "readonly_parallel" if len(seam_steps) > 1 else "readonly_serial",
                    "step_ids": [item["step_id"] for item in seam_steps],
                }
            )

        for step in ready:
            sid = step["step_id"]
            if sid in pending:
                pending.remove(sid)
                completed.add(sid)

    return seams


def _derive_execution_steps_from_topic(scope: str) -> List[Dict[str, Any]]:
    tasks = store.list_tasks_for_topic(scope, limit=80)
    if not tasks:
        return []

    by_task_id: Dict[str, TaskRecord] = {task.task_id: task for task in tasks}
    ordered = list(reversed(tasks))
    steps: List[Dict[str, Any]] = []
    for idx, task in enumerate(ordered, start=1):
        options = task.options if isinstance(task.options, dict) else {}
        task_title = str(
            options.get("task_title")
            or options.get("title")
            or task.instruction.splitlines()[0]
            or task.task_id
        ).strip()
        role = str(task.assigned_role or options.get("assigned_role") or "writer").strip().lower()
        kind = "write"
        if role in {"read_only", "explorer"}:
            kind = "read_only"
        elif role in {"verify", "reviewer"}:
            kind = "verify"
        raw_depends = options.get("depends_on_task_ids") if isinstance(options, dict) else []
        depends_on_candidates = (
            [str(dep).strip() for dep in raw_depends if str(dep).strip()]
            if isinstance(raw_depends, list)
            else []
        )
        depends_on = [dep for dep in depends_on_candidates if dep in by_task_id]
        raw_file_claims = options.get("file_claims") if isinstance(options, dict) else []
        file_claims = (
            [str(value).strip() for value in raw_file_claims if str(value).strip()]
            if isinstance(raw_file_claims, list)
            else []
        )
        raw_area_claims = options.get("area_claims") if isinstance(options, dict) else []
        area_claims = (
            [str(value).strip() for value in raw_area_claims if str(value).strip()]
            if isinstance(raw_area_claims, list)
            else []
        )
        steps.append(
            {
                "step_id": f"step_{idx}_{task.task_id}",
                "title": task_title,
                "instruction": task.instruction,
                "kind": kind,
                "depends_on": depends_on,
                "assigned_worker": task.assigned_worker or "auto",
                "assigned_role": task.assigned_role or role or "writer",
                "file_claims": file_claims,
                "area_claims": area_claims,
                "source_task_id": task.task_id,
            }
        )
    return steps


class SupervisorPlanLLMOutput(BaseModel):
    summary: str = ""
    objective: str = ""
    assumptions: List[str] = Field(default_factory=list)
    unknowns: List[str] = Field(default_factory=list)
    execution_steps: List[Dict[str, Any]] = Field(default_factory=list)
    candidate_parallel_seams: List[Dict[str, Any]] = Field(default_factory=list)
    approval_points: List[str] = Field(default_factory=list)


def _strip_markdown_fences(text: str) -> str:
    trimmed = (text or "").strip()
    if not trimmed.startswith("```"):
        return trimmed
    lines = trimmed.splitlines()
    if not lines:
        return trimmed
    if lines[0].strip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _extract_json_object(text: str) -> Optional[str]:
    """
    Best-effort extraction of a top-level JSON object from LLM output.
    """
    cleaned = _strip_markdown_fences(text)
    if not cleaned:
        return None
    # Fast path: content already looks like JSON.
    if cleaned.lstrip().startswith("{") and cleaned.rstrip().endswith("}"):
        return cleaned

    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    for idx in range(start, len(cleaned)):
        ch = cleaned[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return cleaned[start : idx + 1]
    return None


def _resolve_supervisor_planner_api_key(*, user_id: str, provider: str) -> tuple[str, str]:
    provider_id = normalize_provider_id(provider)
    uid = (user_id or "").strip().lower()
    credential = store.get_provider_credential(
        user_id=uid,
        provider=provider_id,
        include_revoked=False,
    )
    if credential is not None:
        if credential.auth_mode == "api_key":
            api_key = str(credential.secret.get("api_key") or "").strip()
            if api_key:
                return api_key, "user.api_key"
        if credential.auth_mode == "oauth":
            access_token = str(credential.secret.get("access_token") or "").strip()
            if access_token:
                return access_token, "user.oauth"

    env_map = {
        "codex": os.getenv("OPENAI_API_KEY", "").strip(),
        "opencode": (os.getenv("OPENCODE_API_KEY", "").strip() or os.getenv("FIREWORKS_API_KEY", "").strip()),
        "claude_code": (
            os.getenv("CLAUDE_CODE_API_KEY", "").strip()
            or os.getenv("ANTHROPIC_API_KEY", "").strip()
            or os.getenv("CLOUD_CODE_API_KEY", "").strip()
        ),
    }
    fallback = str(env_map.get(provider_id) or "").strip()
    if fallback:
        return fallback, "env"
    return "", ""


def _format_topic_transcript(transcript: List[Dict[str, Any]], *, max_chars: int = 14000) -> str:
    parts: List[str] = []
    used = 0
    for msg in transcript:
        sender = str(msg.get("sender_full_name") or msg.get("sender_email") or "unknown").strip()
        ts = str(msg.get("ts") or "").strip()
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        # Keep messages small; planning does not need full walls of text.
        if len(content) > 1200:
            content = f"{content[:1197].rstrip()}..."
        line = f"[{ts}] {sender}: {content}"
        if used + len(line) + 1 > max_chars:
            break
        parts.append(line)
        used += len(line) + 1
    return "\n".join(parts).strip()


def _format_existing_tasks(scope: str, *, limit: int = 18) -> str:
    tasks, _active_plan_id, _all_tasks = _list_topic_tasks_for_view(
        scope,
        limit=max(1, int(limit)),
        statuses=None,
        plan_scope="active_preferred",
    )
    if not tasks:
        return ""
    rows: List[str] = []
    for task in tasks[:limit]:
        options = task.options if isinstance(task.options, dict) else {}
        title = str(options.get("task_title") or task.instruction.splitlines()[0] or task.task_id).strip()
        rows.append(
            " | ".join(
                [
                    task.task_id,
                    (task.status or "").strip(),
                    (task.provider or "").strip(),
                    (task.assigned_role or "").strip() or "writer",
                    title,
                ]
            )
        )
    return "\n".join(rows).strip()


def _moltis_topic_session_key(
    scope: str,
    *,
    session_id: Optional[str] = None,
    reset_counter: int = 0,
) -> str:
    normalized = normalize_topic_scope_id(scope)
    if not normalized:
        normalized = "unknown-topic"
    safe = re.sub(r"[^a-z0-9:._-]+", "_", normalized).strip("._-")
    if not safe:
        safe = "unknown-topic"
    safe_session = re.sub(r"[^a-z0-9:._-]+", "_", str(session_id or "").strip().lower()).strip("._-")
    if not safe_session:
        safe_session = "default"
    suffix = f":r{max(0, int(reset_counter))}"
    return f"zulip-topic:{safe[:160]}:s:{safe_session[:48]}{suffix}"


def _moltis_ws_url() -> str:
    parsed = urlparse(MOLTIS_BASE_URL)
    if not parsed.scheme or not parsed.netloc:
        raise RuntimeError(f"invalid MOLTIS_BASE_URL={MOLTIS_BASE_URL!r}")
    scheme = "wss" if parsed.scheme == "https" else "ws"
    base_path = (parsed.path or "").rstrip("/")
    ws_path = base_path if base_path.endswith("/ws/chat") else f"{base_path}/ws/chat"
    if not ws_path.startswith("/"):
        ws_path = f"/{ws_path}"
    return urlunparse((scheme, parsed.netloc, ws_path, "", "", ""))


def _moltis_rpc_error_message(error: Any) -> str:
    if isinstance(error, dict):
        msg = str(error.get("message") or error.get("detail") or "").strip()
        code = str(error.get("code") or "").strip()
        if code and msg:
            return f"{code}: {msg}"
        if msg:
            return msg
        if code:
            return code
    text = str(error or "").strip()
    return text or "unknown rpc error"


class _MoltisWsRpcClient:
    def __init__(self, *, timeout_seconds: Optional[float] = None) -> None:
        self.ws: Any = None
        self._next_id = 0
        base_timeout = float(timeout_seconds) if timeout_seconds is not None else MOLTIS_TIMEOUT_SECONDS
        self.timeout_seconds = max(1.0, base_timeout)

    def _new_id(self) -> str:
        self._next_id += 1
        return str(self._next_id)

    async def __aenter__(self) -> "_MoltisWsRpcClient":
        ws_url = _moltis_ws_url()
        headers: Dict[str, str] = {}
        if MOLTIS_API_KEY:
            headers["Authorization"] = f"Bearer {MOLTIS_API_KEY}"
        ssl_context: Optional[ssl.SSLContext] = None
        if ws_url.startswith("wss://") and not MOLTIS_VERIFY_TLS:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
        self.ws = await websockets.connect(
            ws_url,
            additional_headers=headers or None,
            open_timeout=self.timeout_seconds,
            close_timeout=2,
            ping_interval=20,
            ssl=ssl_context,
        )
        await self._handshake()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.ws is not None:
            await self.ws.close()
            self.ws = None

    async def _recv_json(self, *, timeout: float) -> Dict[str, Any]:
        if self.ws is None:
            raise RuntimeError("moltis websocket is not connected")
        raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        if not isinstance(raw, str):
            raise RuntimeError("moltis websocket returned a non-text frame")
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            raise RuntimeError("moltis websocket returned invalid json") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError("moltis websocket returned an invalid frame")
        return parsed

    async def _await_response(self, request_id: str, *, timeout: float) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            remaining = max(0.1, deadline - time.monotonic())
            frame = await self._recv_json(timeout=remaining)
            if frame.get("type") != "res":
                continue
            if str(frame.get("id") or "") != request_id:
                continue
            return frame

    async def _handshake(self) -> None:
        request_id = self._new_id()
        connect_frame = {
            "type": "req",
            "id": request_id,
            "method": "connect",
            "params": {
                "protocol": {"min": 3, "max": 4},
                "client": {
                    "id": "meridian-supervisor",
                    "version": "0.1.0",
                    "platform": "python",
                    "mode": "operator",
                },
                "locale": "en",
                "timezone": PRESTART_TIMEZONE or "UTC",
            },
        }
        assert self.ws is not None
        await self.ws.send(json.dumps(connect_frame, ensure_ascii=True))
        frame = await self._await_response(request_id, timeout=self.timeout_seconds)
        if not frame.get("ok"):
            raise RuntimeError(f"moltis connect failed: {_moltis_rpc_error_message(frame.get('error'))}")
        payload = frame.get("payload")
        payload_type = payload.get("type") if isinstance(payload, dict) else None
        if payload_type != "hello-ok":
            raise RuntimeError("moltis connect failed: unexpected handshake payload")

    async def call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        request_id = self._new_id()
        frame = {
            "type": "req",
            "id": request_id,
            "method": method,
            "params": params,
        }
        assert self.ws is not None
        await self.ws.send(json.dumps(frame, ensure_ascii=True))
        response = await self._await_response(request_id, timeout=MOLTIS_TIMEOUT_SECONDS)
        if not response.get("ok"):
            raise RuntimeError(f"moltis rpc {method} failed: {_moltis_rpc_error_message(response.get('error'))}")

        payload = response.get("payload")
        if isinstance(payload, dict) and payload.get("error"):
            raise RuntimeError(f"moltis rpc {method} failed: {_moltis_rpc_error_message(payload.get('error'))}")
        if isinstance(payload, dict):
            return payload
        if payload is not None:
            return {"value": payload}
        return {}


def _moltis_rpc_call(
    *,
    method: str,
    params: Dict[str, Any],
    timeout_seconds: Optional[float] = None,
) -> Dict[str, Any]:
    if not MOLTIS_ENABLED or not MOLTIS_BASE_URL:
        raise RuntimeError("moltis integration is disabled")

    async def _call_once() -> Dict[str, Any]:
        async with _MoltisWsRpcClient(timeout_seconds=timeout_seconds) as client:
            return await client.call(method, params)

    return asyncio.run(_call_once())


_MOLTIS_TOOL_INVENTORY_CACHE: Dict[str, Any] = {"fetched_at": 0.0, "value": None}


def _moltis_list_payload(raw: Dict[str, Any]) -> List[Any]:
    if isinstance(raw.get("value"), list):
        return [item for item in raw.get("value") if item is not None]
    if isinstance(raw.get("servers"), list):
        return [item for item in raw.get("servers") if item is not None]
    if isinstance(raw.get("tools"), list):
        return [item for item in raw.get("tools") if item is not None]
    if isinstance(raw.get("items"), list):
        return [item for item in raw.get("items") if item is not None]
    return []


def _moltis_tools_inventory() -> Dict[str, Any]:
    if not MOLTIS_ENABLED or not MOLTIS_BASE_URL:
        return {"available": False, "reason": "moltis_disabled"}

    cache_ttl = max(0.0, float(os.getenv("SUPERVISOR_MOLTIS_TOOL_CACHE_SECONDS", "10")))
    now = time.monotonic()
    cached = _MOLTIS_TOOL_INVENTORY_CACHE.get("value")
    fetched_at = float(_MOLTIS_TOOL_INVENTORY_CACHE.get("fetched_at") or 0.0)
    if cache_ttl > 0 and cached is not None and (now - fetched_at) <= cache_ttl:
        return dict(cached) if isinstance(cached, dict) else {"available": False, "reason": "cache_invalid"}

    try:
        rpc_timeout = max(1.0, float(os.getenv("SUPERVISOR_MOLTIS_TOOL_TIMEOUT_SECONDS", "4")))
        list_payload = _moltis_rpc_call(method="mcp.list", params={}, timeout_seconds=rpc_timeout)
        server_rows = _moltis_list_payload(list_payload)
        server_entries: List[Dict[str, Any]] = []
        for row in server_rows:
            if not isinstance(row, dict):
                continue
            server_name = str(row.get("name") or row.get("id") or "").strip()
            if not server_name:
                continue
            tools_payload = _moltis_rpc_call(
                method="mcp.tools",
                params={"name": server_name},
                timeout_seconds=rpc_timeout,
            )
            tool_rows = _moltis_list_payload(tools_payload)
            tool_names: List[str] = []
            for tool in tool_rows:
                if not isinstance(tool, dict):
                    continue
                tool_name = str(tool.get("name") or "").strip()
                if not tool_name:
                    continue
                tool_names.append(tool_name)
            server_entries.append(
                {
                    "name": server_name,
                    "enabled": bool(row.get("enabled", True)),
                    "tools": sorted(set(tool_names)),
                }
            )
        result: Dict[str, Any] = {
            "available": bool(server_rows),
            "server_count": len(server_rows),
            "servers": server_entries,
        }
        if not server_rows:
            result["reason"] = "no_mcp_servers_detected"
        _MOLTIS_TOOL_INVENTORY_CACHE["fetched_at"] = now
        _MOLTIS_TOOL_INVENTORY_CACHE["value"] = dict(result)
        return result
    except Exception as exc:
        result = {"available": False, "reason": f"mcp_inventory_failed:{exc}"}
        _MOLTIS_TOOL_INVENTORY_CACHE["fetched_at"] = now
        _MOLTIS_TOOL_INVENTORY_CACHE["value"] = dict(result)
        return result


def _moltis_repo_management_tools_inventory_from_all(
    all_tools_inventory: Dict[str, Any],
) -> Dict[str, Any]:
    if not isinstance(all_tools_inventory, dict):
        return {"available": False, "reason": "invalid_inventory"}
    if not bool(all_tools_inventory.get("available")):
        reason = str(all_tools_inventory.get("reason") or "").strip() or "inventory_unavailable"
        return {"available": False, "reason": reason}

    repo_keywords = ("repo", "repository", "pull", "pr", "branch", "issue", "git", "forgejo", "github")
    server_entries: List[Dict[str, Any]] = []
    for row in (all_tools_inventory.get("servers") or []):
        if not isinstance(row, dict):
            continue
        server_name = str(row.get("name") or "").strip()
        tool_names = [str(tool).strip() for tool in (row.get("tools") or []) if str(tool).strip()]
        matched = [name for name in tool_names if any(keyword in name.lower() for keyword in repo_keywords)]
        if not matched:
            continue
        server_entries.append(
            {
                "name": server_name,
                "enabled": bool(row.get("enabled", True)),
                "tools": sorted(set(matched)),
            }
        )

    result: Dict[str, Any] = {
        "available": bool(server_entries),
        "server_count": int(all_tools_inventory.get("server_count") or 0),
        "servers_with_repo_tools": len(server_entries),
        "servers": server_entries,
    }
    if not server_entries:
        result["reason"] = "no_repo_management_tools_detected"
    return result


def _moltis_repo_management_tools_inventory() -> Dict[str, Any]:
    return _moltis_repo_management_tools_inventory_from_all(_moltis_tools_inventory())


def _moltis_text_from_content(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: List[str] = []
        for item in value:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    parts.append(text)
                continue
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or "").strip().lower()
            if item_type == "text":
                text = str(item.get("text") or "").strip()
                if text:
                    parts.append(text)
                continue
            if item_type == "output_text":
                text = str(item.get("content") or item.get("text") or "").strip()
                if text:
                    parts.append(text)
        return "\n\n".join(parts).strip()
    if isinstance(value, dict):
        for key in ("text", "content", "message"):
            text = str(value.get(key) or "").strip()
            if text:
                return text
    return ""


def _moltis_read_last_assistant_message(session_key: str) -> str:
    payload = _moltis_rpc_call(
        method="chat.full_context",
        params={"_session_key": session_key},
    )
    messages: List[Dict[str, Any]] = []
    if isinstance(payload, dict) and isinstance(payload.get("messages"), list):
        for item in payload.get("messages") or []:
            if isinstance(item, dict):
                messages.append(item)
    for item in reversed(messages):
        role = str(item.get("role") or "").strip().lower()
        if role != "assistant":
            continue
        text = _moltis_text_from_content(item.get("content"))
        if text:
            return text
    return ""


async def _moltis_read_last_assistant_message_async(
    client: _MoltisWsRpcClient,
    session_key: str,
) -> str:
    payload = await client.call(
        method="chat.full_context",
        params={"_session_key": session_key},
    )
    messages: List[Dict[str, Any]] = []
    if isinstance(payload, dict) and isinstance(payload.get("messages"), list):
        for item in payload.get("messages") or []:
            if isinstance(item, dict):
                messages.append(item)
    for item in reversed(messages):
        role = str(item.get("role") or "").strip().lower()
        if role != "assistant":
            continue
        text = _moltis_text_from_content(item.get("content"))
        if text:
            return text
    return ""


def _moltis_wait_for_run_completion(*, session_key: str, timeout_seconds: float) -> Dict[str, Any]:
    deadline = time.time() + max(3.0, float(timeout_seconds))
    last_error = ""
    while time.time() < deadline:
        try:
            payload = _moltis_rpc_call(
                method="chat.peek",
                params={"sessionKey": session_key},
            )
            active = bool(payload.get("active"))
            if not active:
                return {"ok": True, "active": False}
        except Exception as exc:
            last_error = str(exc)
        time.sleep(max(0.2, MOLTIS_RUN_POLL_SECONDS))
    return {"ok": False, "active": True, "error": last_error}


async def _moltis_wait_for_run_completion_async(
    client: _MoltisWsRpcClient,
    *,
    session_key: str,
    timeout_seconds: float,
    on_snapshot: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    deadline = time.time() + max(3.0, float(timeout_seconds))
    last_error = ""
    while time.time() < deadline:
        try:
            payload = await client.call(
                method="chat.peek",
                params={"sessionKey": session_key},
            )
            if on_snapshot is not None:
                try:
                    on_snapshot(payload if isinstance(payload, dict) else {"value": payload})
                except Exception as exc:
                    logging.debug("moltis run snapshot callback failed: %s", exc)
            active = bool(payload.get("active"))
            if not active:
                return {"ok": True, "active": False, "peek": payload}
        except Exception as exc:
            last_error = str(exc)
        await asyncio.sleep(max(0.2, MOLTIS_RUN_POLL_SECONDS))
    return {"ok": False, "active": True, "error": last_error}


def _moltis_compact_trace_preview(text: str, *, max_chars: int = 420) -> str:
    collapsed = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(collapsed) <= max_chars:
        return collapsed
    return f"{collapsed[: max_chars - 1].rstrip()}…"


def _moltis_peek_candidate_nodes(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    roots: List[Dict[str, Any]] = []
    seen: set[int] = set()
    queue: List[Any] = [payload]
    while queue and len(roots) < 20:
        item = queue.pop(0)
        if not isinstance(item, dict):
            continue
        marker = id(item)
        if marker in seen:
            continue
        seen.add(marker)
        roots.append(item)
        for key in ("snapshot", "state", "run", "value", "data", "status", "active"):
            nested = item.get(key)
            if isinstance(nested, dict):
                queue.append(nested)
    return roots


def _moltis_extract_thinking_from_peek(payload: Dict[str, Any]) -> str:
    keys = (
        "thinkingText",
        "thinking_text",
        "thinking",
        "reasoningText",
        "reasoning_text",
        "reasoning",
        "statusText",
        "status_text",
        "status_message",
        "progress_message",
    )
    for node in _moltis_peek_candidate_nodes(payload):
        for key in keys:
            text = _moltis_text_from_content(node.get(key))
            if text:
                return text.strip()
    return ""


def _moltis_active_tool_map_from_peek(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    active_tools: Dict[str, Dict[str, Any]] = {}
    active_statuses = {"queued", "pending", "running", "in_progress", "active", "started"}
    terminal_statuses = {"done", "completed", "complete", "failed", "error", "cancelled", "canceled"}

    def _append_candidates(source: str, value: Any, out: List[tuple[str, Dict[str, Any]]]) -> None:
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    out.append((source, item))
            return
        if isinstance(value, dict):
            if any(key in value for key in ("name", "tool", "tool_name", "toolName")):
                out.append((source, value))
                return
            for item in value.values():
                if isinstance(item, dict):
                    out.append((source, item))

    for node in _moltis_peek_candidate_nodes(payload):
        candidates: List[tuple[str, Dict[str, Any]]] = []
        _append_candidates("activeToolCalls", node.get("activeToolCalls"), candidates)
        _append_candidates("active_tool_calls", node.get("active_tool_calls"), candidates)
        _append_candidates("activeTools", node.get("activeTools"), candidates)
        _append_candidates("active_tools", node.get("active_tools"), candidates)
        _append_candidates("toolCalls", node.get("toolCalls"), candidates)
        _append_candidates("tool_calls", node.get("tool_calls"), candidates)
        _append_candidates("toolCall", node.get("toolCall"), candidates)
        _append_candidates("tool_call", node.get("tool_call"), candidates)

        for source, item in candidates:
            tool_name = str(
                item.get("tool_name") or item.get("toolName") or item.get("tool") or item.get("name") or ""
            ).strip()
            if not tool_name:
                continue
            status = str(item.get("status") or item.get("state") or "").strip().lower()
            running_flag = item.get("running")
            default_active = source.startswith("active")
            if status in terminal_statuses:
                is_active = False
            elif status in active_statuses:
                is_active = True
            elif isinstance(running_flag, bool):
                is_active = running_flag
            else:
                is_active = default_active
            if not is_active:
                continue
            call_id = str(item.get("callId") or item.get("call_id") or item.get("id") or "").strip()
            key = f"{tool_name}:{call_id}" if call_id else tool_name
            if key in active_tools:
                continue
            active_tools[key] = {
                "tool_name": tool_name,
                "tool_call_id": call_id,
                "status": status or "running",
            }
    return active_tools


_LEGACY_SUPERVISOR_CONTROL_LINE_RE = re.compile(
    r"^\s*(?:"
    r"dispatch\s+readiness:\s*(?:ready|blocked)"
    r"|"
    r"selected\s+repo\s+attachment:\s*`?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+`?"
    r")\s*$",
    re.IGNORECASE,
)
_SUPERVISOR_STATUS_PATTERNS = (
    "status update",
    "progress update",
    "what is running",
    "what's running",
    "what is the status",
    "what's the status",
    "show the status",
    "give me a status",
    "what changed",
)
_SUPERVISOR_PLAN_PATTERNS = (
    "draft a concise spec",
    "draft spec",
    "write spec",
    "spec for this topic",
    "outline the plan",
    "plan in detail",
    "plan for review",
    "synthesize a plan",
    "scope this work",
    "scope this",
    "review the plan",
    "review this topic",
)
_SUPERVISOR_EXECUTION_PATTERNS = (
    "go ahead",
    "proceed",
    "ship it",
    "start work",
    "begin work",
    "continue with implementation",
    "continue implementation",
    "start implementation",
    "execute the plan",
    "execute this plan",
    "approve execution",
    "make code changes",
)
_SUPERVISOR_IMPLEMENTATION_PATTERNS = (
    "implement",
    "implementation",
    "make code changes",
    "open a pr",
    "pull request",
    "push a branch",
    "ship the change",
    "deliver the change",
)


def _normalize_supervisor_message_text(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def _message_matches_any(text: str, patterns: tuple[str, ...]) -> bool:
    normalized = _normalize_supervisor_message_text(text)
    if not normalized:
        return False
    return any(pattern in normalized for pattern in patterns)


def _message_requests_status(text: str) -> bool:
    return _message_matches_any(text, _SUPERVISOR_STATUS_PATTERNS)


def _message_requests_execution(text: str) -> bool:
    normalized = _normalize_supervisor_message_text(text)
    if not normalized:
        return False
    if normalized in {"approve", "approved", "lgtm", "ship it", "looks good", "go ahead", "proceed"}:
        return True
    if normalized.startswith("approve "):
        return True
    return _message_matches_any(normalized, _SUPERVISOR_EXECUTION_PATTERNS)


def _message_requests_plan(text: str) -> bool:
    if _message_requests_execution(text):
        return False
    return _message_matches_any(text, _SUPERVISOR_PLAN_PATTERNS)


def _message_requests_implementation(text: str) -> bool:
    return _message_matches_any(text, _SUPERVISOR_IMPLEMENTATION_PATTERNS)


def _strip_legacy_supervisor_control_lines(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    remaining = [
        line
        for line in raw.splitlines()
        if not _LEGACY_SUPERVISOR_CONTROL_LINE_RE.match(line.strip())
    ]
    return "\n".join(remaining).strip()


def _resolve_selected_repo_for_execution(
    *,
    runtime_state: Dict[str, Any],
    fallback_repo_id: str,
    fallback_repo_url: Optional[str],
) -> tuple[str, Optional[str], str, str]:
    attachments = (
        runtime_state.get("attachments")
        if isinstance(runtime_state.get("attachments"), dict)
        else {}
    )
    repo_attachments = [
        item for item in (attachments.get("repos") or []) if isinstance(item, dict)
    ]
    selected_repo = attachments.get("selected_repo") if isinstance(attachments, dict) else None
    if isinstance(selected_repo, dict) and str(selected_repo.get("repo_id") or "").strip():
        repo_id = str(selected_repo.get("repo_id") or "").strip()
        return (
            repo_id,
            str(selected_repo.get("repo_url") or "").strip() or _default_repo_url_for(repo_id) or None,
            str(selected_repo.get("source") or "").strip() or "runtime_attachment",
            str(selected_repo.get("confidence") or "").strip() or "medium",
        )

    fallback_id = str(fallback_repo_id or "").strip()
    if fallback_id:
        return (
            fallback_id,
            str(fallback_repo_url or "").strip() or _default_repo_url_for(fallback_id) or None,
            "explicit_input",
            "high",
        )
    return "", None, "unresolved", "low"


def _compact_json_for_prompt(value: Any, *, max_chars: int = 6000) -> str:
    try:
        text = json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2)
    except Exception:
        return "{}"
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}\n..."


def _build_supervisor_harness_contract(
    *,
    tools_context: Dict[str, Any],
    transcript_count: int,
) -> Dict[str, Any]:
    policy = tools_context.get("policy") if isinstance(tools_context.get("policy"), dict) else {}
    work_context = (
        tools_context.get("work_context")
        if isinstance(tools_context.get("work_context"), dict)
        else {}
    )
    connected_integrations = (
        tools_context.get("connected_integrations")
        if isinstance(tools_context.get("connected_integrations"), list)
        else []
    )
    mcp_repo_tools = (
        tools_context.get("mcp_repo_tools")
        if isinstance(tools_context.get("mcp_repo_tools"), dict)
        else {}
    )
    mcp_tools_inventory = (
        tools_context.get("mcp_tools_inventory")
        if isinstance(tools_context.get("mcp_tools_inventory"), dict)
        else {}
    )
    runtime_state = (
        tools_context.get("runtime_state")
        if isinstance(tools_context.get("runtime_state"), dict)
        else {}
    )
    capability_registry = (
        tools_context.get("capability_registry")
        if isinstance(tools_context.get("capability_registry"), dict)
        else {}
    )
    legacy_mcp_migration = (
        tools_context.get("legacy_mcp_migration")
        if isinstance(tools_context.get("legacy_mcp_migration"), dict)
        else {}
    )
    allow_external = bool(policy.get("allow_external_integrations", True))

    session_context = (
        capability_registry.get("session_context")
        if isinstance(capability_registry.get("session_context"), dict)
        else {
            "current_topic_feed": {
                "available": bool(policy.get("auto_topic_transcript", True)),
                "attached_messages": int(max(0, transcript_count)),
            },
            "work_context": work_context,
        }
    )
    supervisor_actions = [
        item
        for item in (capability_registry.get("supervisor_actions") or [])
        if isinstance(item, dict)
    ]
    data_access = [
        item for item in (capability_registry.get("data_access") or []) if isinstance(item, dict)
    ]
    worker_backends = [
        item
        for item in (capability_registry.get("worker_backends") or [])
        if isinstance(item, dict)
    ]
    mcp_tools = [item for item in (capability_registry.get("mcp") or []) if isinstance(item, dict)]

    integration_tools: List[Dict[str, Any]] = []
    for item in connected_integrations:
        if not isinstance(item, dict):
            continue
        integration = str(item.get("integration") or "").strip()
        if not integration:
            continue
        tools = [str(tool).strip() for tool in (item.get("tools") or []) if str(tool).strip()]
        integration_tools.append(
            {
                "integration": integration,
                "display_name": str(item.get("display_name") or integration).strip(),
                "base_url": str(item.get("base_url") or "").strip(),
                "credential_source": str(item.get("credential_source") or "").strip(),
                "enabled_by_policy": allow_external,
                "declared_capabilities": tools if allow_external else [],
                "note": "API capabilities are executable when credentials and policy allow.",
            }
        )

    return {
        "policy": {
            "auto_topic_transcript": bool(policy.get("auto_topic_transcript", True)),
            "auto_repo_context": bool(policy.get("auto_repo_context", True)),
            "allow_external_integrations": allow_external,
        },
        "session_context": session_context,
        "supervisor_actions": supervisor_actions,
        "data_access": data_access,
        "worker_backends": worker_backends,
        "mcp_tools": mcp_tools,
        "integration_tools": integration_tools,
        "mcp_repo_tools": mcp_repo_tools,
        "mcp_tools_inventory": mcp_tools_inventory,
        "legacy_mcp_migration": legacy_mcp_migration,
        "runtime_state": runtime_state,
    }


def _build_moltis_supervisor_input(
    *,
    scope: str,
    session_id: str,
    message: str,
    transcript: List[Dict[str, Any]],
    topic_ref: Dict[str, Any],
    tools_context: Dict[str, Any],
) -> str:
    _ensure_supervisor_files()
    soul = _load_supervisor_text(SUPERVISOR_SOUL_PATH, max_chars=4000).strip()
    memory_tail = _load_supervisor_text(SUPERVISOR_MEMORY_PATH, max_chars=3000).strip()
    runtime_context = (
        tools_context.get("runtime_context")
        if isinstance(tools_context.get("runtime_context"), dict)
        else _describe_topic_runtime(scope, session_id=session_id)
    )
    runtime_paths = _topic_runtime_paths(scope)
    runtime_memory_context = build_memory_prompt_context(runtime_paths, session_id=session_id)
    runtime_uploads = [
        item for item in (runtime_context.get("uploads") or []) if isinstance(item, dict)
    ]
    runtime_new_uploads = [
        item for item in (runtime_context.get("new_uploads") or []) if isinstance(item, dict)
    ]
    runtime_historical_uploads = [
        item
        for item in runtime_uploads
        if str(item.get("filename") or "").strip()
        not in {
            str(upload.get("filename") or "").strip()
            for upload in runtime_new_uploads
            if str(upload.get("filename") or "").strip()
        }
    ]
    runtime_upload_context = build_uploads_prompt_context(
        new_files=runtime_new_uploads,
        historical_files=runtime_historical_uploads,
    )
    stream_name = str(topic_ref.get("stream_name") or "").strip()
    topic_name = str(topic_ref.get("topic") or "").strip()
    work_context = tools_context.get("work_context") if isinstance(tools_context.get("work_context"), dict) else {}
    repo = work_context.get("repo") if isinstance(work_context.get("repo"), dict) else {}
    repo_id = str(repo.get("id") or "").strip()
    repo_url = str(repo.get("url") or "").strip()
    repo_source = str(repo.get("source") or "").strip()
    repo_confidence = str(repo.get("confidence") or "").strip()
    lines: List[str] = [
        "You are the shared supervisor for one Zulip topic.",
        "Supervisor rules:",
        "- One supervisor timeline per topic, shared by all humans.",
        "- Do not create worker tasks unless the human clearly authorizes execution in natural language.",
        "- Treat approval phrases like 'looks good', 'go ahead', 'ship it', or 'proceed' as authorization when they refer to the active spec/plan.",
        "- When information is missing, ask concise clarifying questions before dispatch.",
        "- Default dispatch topology is one writer plus bounded helpers.",
        "- Use only the capabilities defined in the harness contract below; do not invent tools.",
        "- Existing repo/app/context attachments are optional runtime context. Never treat them as selected unless runtime state or explicit output says so.",
        "- If repo context is unresolved or low-confidence, use available repo or runtime tools before making codebase claims.",
        "- When capability is unavailable, state limitation briefly and continue with best-effort grounded output.",
        "",
        f"Topic scope: {scope}",
        f"Stream/topic: {stream_name or '(unknown stream)'} / {topic_name or '(unknown topic)'}",
        f"Repository: {repo_id or '(unknown repo)'}{f' @ {repo_url}' if repo_url else ''}",
    ]
    if soul:
        lines.extend(["", "Supervisor soul:", soul])
    if memory_tail:
        lines.extend(["", "Supervisor memory tail:", memory_tail])
    if runtime_memory_context:
        lines.extend(["", runtime_memory_context])
    if runtime_upload_context:
        lines.extend(["", runtime_upload_context])
    policy = tools_context.get("policy") if isinstance(tools_context.get("policy"), dict) else {}
    contract = _build_supervisor_harness_contract(
        tools_context=tools_context,
        transcript_count=len(transcript),
    )
    session_context = contract.get("session_context") if isinstance(contract.get("session_context"), dict) else {}
    supervisor_actions = [
        item for item in (contract.get("supervisor_actions") or []) if isinstance(item, dict)
    ]
    data_access = [item for item in (contract.get("data_access") or []) if isinstance(item, dict)]
    worker_backends = [
        item for item in (contract.get("worker_backends") or []) if isinstance(item, dict)
    ]
    integration_tools = [
        item for item in (contract.get("integration_tools") or []) if isinstance(item, dict)
    ]
    dynamic_mcp_tools = [item for item in (contract.get("mcp_tools") or []) if isinstance(item, dict)]

    current_feed = (
        session_context.get("current_topic_feed")
        if isinstance(session_context.get("current_topic_feed"), dict)
        else {}
    )
    active_plan = (
        session_context.get("active_plan")
        if isinstance(session_context.get("active_plan"), dict)
        else {}
    )
    task_counts = session_context.get("tasks") if isinstance(session_context.get("tasks"), dict) else {}
    runtime_state = session_context.get("runtime") if isinstance(session_context.get("runtime"), dict) else {}
    lines.extend(
        [
            "",
            "Session Context",
            f"- Topic: {stream_name or '(unknown stream)'} / {topic_name or '(unknown topic)'}",
            f"- Current topic feed: attached {int(current_feed.get('attached_messages') or 0)} messages (auto-attached each turn)",
            f"- Selected repo attachment: {repo_id or 'none'}"
            f"{f' @ {repo_url}' if repo_url else ''}"
            f" (source={repo_source or 'unresolved'}, confidence={repo_confidence or 'low'})",
            f"- Available repo attachments: {len((session_context.get('work_context') or {}).get('attachments', {}).get('repos', [])) if isinstance((session_context.get('work_context') or {}).get('attachments'), dict) else 0}",
            f"- Active plan: {str(active_plan.get('plan_revision_id') or 'none')}",
            f"- Open tasks: {int(task_counts.get('open') or 0)}"
            f" total_open, {int(task_counts.get('running') or 0)} running, {int(task_counts.get('blocked') or 0)} blocked",
            f"- Topic runtime: workspace={str(runtime_state.get('workspace_path') or runtime_context.get('workspace_path') or 'n/a')}",
            f"  uploads={str(runtime_state.get('uploads_path') or runtime_context.get('uploads_path') or 'n/a')}"
            f" outputs={str(runtime_state.get('outputs_path') or runtime_context.get('outputs_path') or 'n/a')}",
            f"  checkpoints={str(runtime_state.get('checkpoints_path') or runtime_context.get('checkpoints_path') or 'n/a')}"
            f" uploads={int(runtime_state.get('upload_count') or runtime_context.get('upload_count') or 0)}"
            f" checkpoints={int(runtime_state.get('checkpoint_count') or runtime_context.get('checkpoint_count') or 0)}",
        ]
    )
    lines.extend(
        [
            "",
            "Supervisor control contract",
            "- The runtime state and capability registry are authoritative. Do not assume a repo, preview, deployment, or worker is active unless runtime evidence says so.",
            "- Use available tools when they materially improve accuracy or are required to inspect repos, apps, uploads, or runtime evidence.",
            "- Clarification and approval are runtime interrupts. If execution is blocked on either, say so explicitly and ask only for the missing input or approval.",
            "- The controller decides whether to revise the plan, ask for clarification, or start execution. Do not emit control tags or machine-readable execution markers.",
            "- Never output lines like `Dispatch readiness: ...` or `Selected repo attachment: ...`.",
            "- Never assume an attached repo is selected just because it is available in topic context.",
            "- If a new repo is required, use an available repo-create capability. If none exists, explain that capability is unavailable instead of pretending the repo exists.",
            "- When revising the plan, describe the execution graph in human-readable sections only; do not encode a worker protocol in markdown.",
            "- Add a verification step when delivery evidence should be checked after implementation.",
            "- For planning responses, include explicit sections: Scope, Non-goals, Worker topology, Task DAG, Validation loop, and Completion criteria.",
            "- Keep status/chat responses concise and grounded in live runtime evidence.",
            "- Do not declare chat/spec/begin-work/status modes. The controller uses runtime state, plan state, and actual execution evidence instead.",
        ]
    )

    lines.append("")
    lines.append("Supervisor Actions")
    if supervisor_actions:
        for item in supervisor_actions:
            lines.append(
                f"- {str(item.get('id') or '').strip()}: "
                f"{str(item.get('description') or 'controller action').strip()}"
            )
    else:
        lines.append("- None")

    lines.append("")
    lines.append("Data Access")
    if data_access:
        for item in data_access:
            access_id = str(item.get("id") or "").strip()
            capabilities = [
                str(value).strip()
                for value in (item.get("capabilities") or [])
                if str(value).strip()
            ]
            status = "available" if item.get("available") else "unavailable"
            capabilities_text = f" ({', '.join(capabilities)})" if capabilities else ""
            lines.append(
                f"- {access_id}: {status}{capabilities_text}"
            )
    else:
        lines.append("- None")

    lines.append("")
    lines.append("Worker Backends")
    if worker_backends:
        for item in worker_backends:
            provider = str(item.get("provider") or item.get("id") or "").strip()
            modes = [
                str(value).strip()
                for value in (item.get("runtime_modes") or [])
                if str(value).strip()
            ]
            backend = str(item.get("execution_backend") or "").strip()
            capability = (
                "command-executable"
                if item.get("supports_execution")
                else "api-text-only"
                if item.get("api_text_available")
                else "stub-command"
                if item.get("command_stub")
                else "unavailable"
            )
            lines.append(
                f"- {provider}: {', '.join(modes) if modes else 'unavailable'}"
                f"{f' (backend={backend}, capability={capability})' if backend else f' (capability={capability})'}"
            )
    else:
        lines.append("- None")

    if integration_tools:
        lines.append("")
        lines.append("Integration API Capabilities")
        for item in integration_tools[:12]:
            integration = str(item.get("integration") or "").strip()
            display_name = str(item.get("display_name") or integration).strip()
            credential_source = str(item.get("credential_source") or "unknown").strip()
            declared = [
                str(value).strip()
                for value in (item.get("declared_capabilities") or [])
                if str(value).strip()
            ]
            lines.append(
                f"- {display_name} ({integration}): "
                f"{', '.join(declared) if declared else 'no declared capabilities'} [credential_source={credential_source}]"
            )

    if dynamic_mcp_tools:
        lines.append("")
        lines.append("Dynamic MCP Tools")
        for item in dynamic_mcp_tools[:18]:
            lines.append(
                f"- {str(item.get('id') or '').strip()}: "
                f"server={str(item.get('server') or '').strip() or 'mcp-server'} "
                f"status={'available' if item.get('available') else 'unavailable'}"
            )

    if policy:
        lines.extend(
            [
                "",
                "Integration/tool policy:",
                f"- auto_topic_transcript={bool(policy.get('auto_topic_transcript', True))}",
                f"- auto_repo_context={bool(policy.get('auto_repo_context', True))}",
                f"- allow_external_integrations={bool(policy.get('allow_external_integrations', True))}",
            ]
        )
    lines.extend(
        [
            "",
            "Harness capability contract (authoritative JSON):",
            _compact_json_for_prompt(contract, max_chars=7000),
        ]
    )

    if transcript:
        transcript_text = _format_topic_transcript(transcript, max_chars=12000)
        if transcript_text:
            lines.extend(
                [
                    "",
                    f"Topic transcript excerpt ({len(transcript)} messages):",
                    transcript_text,
                ]
            )
    lines.extend(
        [
            "",
            "Human message:",
            (message or "").strip(),
            "",
            "Reply in clean markdown with concrete, non-placeholder content.",
        ]
    )
    return "\n".join(lines).strip()


def _run_moltis_supervisor_turn(
    *,
    scope: str,
    session_id: str,
    reset_counter: int,
    message: str,
    transcript: List[Dict[str, Any]],
    topic_ref: Dict[str, Any],
    tools_context: Dict[str, Any],
    on_run_snapshot: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    async def _run() -> Dict[str, Any]:
        session_key = _moltis_topic_session_key(
            scope,
            session_id=session_id,
            reset_counter=max(0, int(reset_counter)),
        )
        text = _build_moltis_supervisor_input(
            scope=scope,
            session_id=session_id,
            message=message,
            transcript=transcript,
            topic_ref=topic_ref,
            tools_context=tools_context,
        )
        send_params: Dict[str, Any] = {
            "sessionKey": session_key,
            "_session_key": session_key,
            "text": text,
            "message": text,
        }
        requested_model = MOLTIS_MODEL.strip() if MOLTIS_MODEL else ""
        fallback_model = MOLTIS_FALLBACK_MODEL.strip() if MOLTIS_FALLBACK_MODEL else ""
        if (
            requested_model.startswith("fireworks/")
            and not OPENCODE_API_KEY_PRESENT
            and fallback_model
        ):
            requested_model = fallback_model
        model_used = requested_model

        async with _MoltisWsRpcClient() as client:
            send_payload: Dict[str, Any]
            first_error = ""
            try:
                initial_params = dict(send_params)
                if requested_model:
                    initial_params["model"] = requested_model
                send_payload = await client.call(method="chat.send", params=initial_params)
            except Exception as exc:
                first_error = str(exc)
                should_retry = (
                    bool(requested_model)
                    and bool(fallback_model)
                    and requested_model != fallback_model
                    and "model" in first_error.lower()
                    and "not found" in first_error.lower()
                )
                if not should_retry:
                    raise
                retry_params = dict(send_params)
                retry_params["model"] = fallback_model
                send_payload = await client.call(method="chat.send", params=retry_params)
                model_used = fallback_model

            run_id = str(send_payload.get("runId") or "").strip()
            queued = bool(send_payload.get("queued"))

            completion = await _moltis_wait_for_run_completion_async(
                client,
                session_key=session_key,
                timeout_seconds=MOLTIS_RUN_TIMEOUT_SECONDS,
                on_snapshot=on_run_snapshot,
            )
            assistant_text = await _moltis_read_last_assistant_message_async(client, session_key)

        if not assistant_text and isinstance(completion.get("error"), str) and completion.get("error"):
            assistant_text = (
                "I could not complete the Moltis supervisor run for this topic. "
                f"Error: {completion['error']}"
            )

        return {
            "session_key": session_key,
            "run_id": run_id,
            "queued": queued,
            "completion": completion,
            "assistant_text": assistant_text.strip(),
            "model_requested": requested_model,
            "model_used": model_used,
        }

    return asyncio.run(_run())


def _choose_supervisor_planner_provider(payload: PlanSynthesisRequest) -> str:
    source = payload.source if isinstance(payload.source, dict) else {}
    hinted = normalize_provider_id(str(source.get("preferred_provider") or source.get("provider") or ""))
    if hinted in ALLOWED_PROVIDERS:
        return hinted
    env_choice = normalize_provider_id(os.getenv("SUPERVISOR_PLANNER_PROVIDER", ""))
    if env_choice in ALLOWED_PROVIDERS:
        return env_choice
    # Prefer OpenCode/Kimi K2 for planning where available.
    if "opencode" in ALLOWED_PROVIDERS:
        return "opencode"
    return DEFAULT_PROVIDER if DEFAULT_PROVIDER in ALLOWED_PROVIDERS else "codex"


def _call_opencode_chat_completion(
    *,
    api_key: str,
    messages: List[Dict[str, str]],
) -> tuple[str, Dict[str, Any]]:
    model = os.getenv("OPENCODE_MODEL", "fireworks/kimi-k2p5").strip()
    temperature = float(os.getenv("SUPERVISOR_PLANNER_TEMPERATURE", "0.2"))
    timeout_seconds = float(os.getenv("SUPERVISOR_PLANNER_TIMEOUT_SECONDS", "45"))
    base_url = (
        os.getenv(
            "OPENCODE_API_BASE_URL",
            os.getenv("OPENCODE_FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1"),
        )
        .strip()
        .rstrip("/")
    )
    request_body: Dict[str, Any] = {
        "model": model,
        "stream": False,
        "temperature": temperature,
        "messages": messages,
    }

    session = requests.Session()
    session.trust_env = False
    response = session.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        data=json.dumps(request_body),
        timeout=timeout_seconds,
    )
    if response.status_code >= 400:
        snippet = (response.text or "")[:1000]
        raise RuntimeError(f"OpenCode API error status={response.status_code} body={snippet}")
    payload = response.json()
    choices = payload.get("choices")
    content = ""
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message")
        if isinstance(message, dict):
            content = str(message.get("content") or "").strip()
    return content, {"model": model, "base_url": base_url}


def _synthesize_plan_from_transcript(
    *,
    scope: str,
    payload: PlanSynthesisRequest,
    transcript: List[Dict[str, Any]],
    derived_steps: List[Dict[str, Any]],
) -> tuple[Optional[SupervisorPlanLLMOutput], Dict[str, Any]]:
    _ensure_supervisor_files()
    soul = _load_supervisor_text(SUPERVISOR_SOUL_PATH, max_chars=14000)
    memory_tail = _load_supervisor_text(SUPERVISOR_MEMORY_PATH, max_chars=12000)
    transcript_text = _format_topic_transcript(transcript, max_chars=14000)
    tasks_text = _format_existing_tasks(scope, limit=18)
    hints_summary = (payload.summary or "").strip()
    hints_objective = (payload.objective or "").strip()
    provider_id = _choose_supervisor_planner_provider(payload)
    api_key, credential_source = _resolve_supervisor_planner_api_key(
        user_id=(payload.author_id or "").strip().lower(),
        provider=provider_id,
    )
    if not api_key:
        return None, {"provider": provider_id, "credential_source": credential_source or "missing"}

    schema_note = json.dumps(
        {
            "summary": "string",
            "objective": "string",
            "assumptions": ["string"],
            "unknowns": ["string"],
            "execution_steps": [
                {
                    "step_id": "string",
                    "title": "string",
                    "instruction": "string",
                    "kind": "write|read_only|verify",
                    "depends_on": ["task_id_or_step_id"],
                    "assigned_worker": "string",
                    "assigned_role": "writer|read_only|verify",
                    "file_claims": ["string"],
                    "area_claims": ["string"],
                }
            ],
            "candidate_parallel_seams": [
                {
                    "seam_id": "string",
                    "title": "string",
                    "mode": "writer_plus_helpers|readonly_parallel|readonly_serial",
                    "step_ids": ["step_id"],
                }
            ],
            "approval_points": ["string"],
        },
        ensure_ascii=True,
    )

    user_prompt = "\n".join(
        [
            "You are the Supervisor controller for an agent-based coding workflow.",
            "Synthesize the human discussion in this Zulip topic into a concrete work plan.",
            "",
            "Rules:",
            "- Supervisor is the sole authority that issues and assigns directives.",
            "- Default to 1 write-capable worker; add bounded helpers only when seams are truly independent.",
            "- Do not invent work that is not motivated by the transcript.",
            "- If key information is missing, put it in unknowns + approval_points as clarifications.",
            "",
            f"Supervisor soul:\n{soul}",
            "",
            f"Supervisor memory (tail):\n{memory_tail}",
            "",
            f"Topic transcript (most recent {len(transcript)} messages):\n{transcript_text}",
            "",
            "Existing tasks (if any):",
            tasks_text or "(none)",
            "",
            "Current derived steps (may be empty):",
            json.dumps(derived_steps[:18], ensure_ascii=True),
            "",
            "Human-provided hints (may be blank):",
            f"- summary_hint: {hints_summary or '(none)'}",
            f"- objective_hint: {hints_objective or '(none)'}",
            "",
            "Output requirements:",
            "- Respond with ONLY a single JSON object (no prose, no markdown fences).",
            "- Keep execution_steps to <= 12 items unless absolutely necessary.",
            f"- JSON schema (shape, not strict types): {schema_note}",
        ]
    ).strip()

    messages: List[Dict[str, str]] = [
        {
            "role": "system",
            "content": "You are a planning model. Return strict JSON only.",
        },
        {
            "role": "user",
            "content": user_prompt,
        },
    ]

    if provider_id != "opencode":
        # For now we only implement the OpenCode API path.
        return None, {"provider": provider_id, "credential_source": credential_source or "unknown"}

    raw_text, meta = _call_opencode_chat_completion(api_key=api_key, messages=messages)
    json_text = _extract_json_object(raw_text)
    if not json_text:
        return None, {
            "provider": provider_id,
            "credential_source": credential_source or "unknown",
            "model": meta.get("model"),
            "error": "no_json_found",
            "raw_snippet": (raw_text or "")[:800],
        }
    try:
        parsed = json.loads(json_text)
    except Exception as exc:
        return None, {
            "provider": provider_id,
            "credential_source": credential_source or "unknown",
            "model": meta.get("model"),
            "error": f"json_parse_failed:{exc}",
            "raw_snippet": (json_text or "")[:800],
        }
    if not isinstance(parsed, dict):
        return None, {
            "provider": provider_id,
            "credential_source": credential_source or "unknown",
            "model": meta.get("model"),
            "error": "json_not_object",
        }
    try:
        output = SupervisorPlanLLMOutput.model_validate(parsed)
    except ValidationError as exc:
        return None, {
            "provider": provider_id,
            "credential_source": credential_source or "unknown",
            "model": meta.get("model"),
            "error": f"validation_failed:{exc}",
        }
    meta_out: Dict[str, Any] = {
        "provider": provider_id,
        "credential_source": credential_source or "unknown",
        "model": meta.get("model"),
    }
    return output, meta_out


def _derive_plan_from_topic(scope: str, payload: PlanSynthesisRequest) -> Dict[str, Any]:
    steps = [item for item in payload.execution_steps if isinstance(item, dict)]
    if not steps:
        steps = _derive_execution_steps_from_topic(scope)

    source_obj = payload.source if isinstance(payload.source, dict) else {}
    transcript_raw = source_obj.get("topic_transcript")
    transcript = (
        [item for item in transcript_raw if isinstance(item, dict)]
        if isinstance(transcript_raw, list)
        else []
    )
    if transcript:
        llm_output: Optional[SupervisorPlanLLMOutput] = None
        llm_meta: Dict[str, Any] = {}
        planner_provider = _choose_supervisor_planner_provider(payload)
        try:
            llm_output, llm_meta = _synthesize_plan_from_transcript(
                scope=scope,
                payload=payload,
                transcript=transcript,
                derived_steps=steps,
            )
        except Exception as exc:
            # Keep begin_work/spec responsive even if the upstream planner API fails.
            logging.warning(
                "supervisor planner synthesis failed for scope=%s provider=%s: %s",
                scope,
                planner_provider,
                exc,
            )
            llm_meta = {
                "provider": planner_provider,
                "credential_source": "unknown",
                "error": f"planner_exception:{exc}",
            }
        if llm_output is not None:
            synthesized_source = dict(source_obj)
            synthesized_source["planner"] = llm_meta
            summary_out = llm_output.summary.strip() or (payload.summary or "").strip()
            objective_out = llm_output.objective.strip() or (payload.objective or "").strip()
            if not summary_out:
                summary_out = "Supervisor synthesized plan from topic discussion"
            if not objective_out:
                objective_out = "Clarify objective in topic thread before dispatching additional directives"
            assumptions_out = [
                str(item).strip() for item in llm_output.assumptions if str(item).strip()
            ]
            if not assumptions_out:
                assumptions_out = [
                    "Supervisor assigns directives; workers do not self-assign.",
                ]
            return {
                "summary": summary_out,
                "objective": objective_out,
                "assumptions": assumptions_out,
                "unknowns": [str(item).strip() for item in llm_output.unknowns if str(item).strip()],
                "execution_steps": [item for item in llm_output.execution_steps if isinstance(item, dict)],
                "candidate_parallel_seams": [
                    item for item in llm_output.candidate_parallel_seams if isinstance(item, dict)
                ],
                "approval_points": [str(item).strip() for item in llm_output.approval_points if str(item).strip()],
                "source": synthesized_source,
            }
        if llm_meta:
            # Preserve planner metadata even when we fall back, so the UI can
            # explain why transcript-based synthesis was skipped.
            source_obj = dict(source_obj)
            source_obj["planner"] = llm_meta

    summary = (payload.summary or "").strip()
    objective = (payload.objective or "").strip()
    if not summary:
        summary = (
            "Supervisor synthesized plan from topic discussion and queued task context"
            if steps
            else "Supervisor synthesized plan"
        )
    if not objective:
        objective = (
            str(steps[0].get("instruction") or "").strip()
            if steps
            else "Clarify objective in topic thread before dispatching additional directives"
        )
    assumptions = [str(item).strip() for item in payload.assumptions if str(item).strip()]
    if not assumptions and steps:
        write_steps = sum(1 for item in steps if str(item.get("kind") or "write") == "write")
        assumptions = [
            "Supervisor assigns directives; workers do not self-assign.",
            f"Current synthesized execution graph includes {len(steps)} step(s), {write_steps} write seam(s).",
        ]
    return {
        "summary": summary,
        "objective": objective,
        "assumptions": assumptions,
        "unknowns": [str(item).strip() for item in payload.unknowns if str(item).strip()],
        "execution_steps": steps,
        "candidate_parallel_seams": [],
        "approval_points": [str(item).strip() for item in payload.approval_points if str(item).strip()],
        "source": source_obj,
    }


def _default_repo_url_for(repo_id: str) -> Optional[str]:
    rid = (repo_id or "").strip()
    if not rid:
        return None
    base_url = DEFAULT_GIT_BASE_URL
    if not base_url:
        for entry in _integration_catalog():
            if normalize_integration_id(str(entry.get("integration") or "")) != "forgejo":
                continue
            candidate = str(entry.get("base_url") or "").strip().rstrip("/")
            if candidate:
                base_url = candidate
                break
    if not base_url:
        return None
    return f"{base_url}/{rid}.git"


def _normalize_directive_role(value: str) -> str:
    role = (value or "").strip().lower()
    if (
        role in {"read", "readonly", "read_only", "explorer"}
        or role.startswith("read_only")
        or role.startswith("readonly")
        or role.startswith("read ")
        or "investigat" in role
    ):
        return "read_only"
    if role in {"verify", "review", "reviewer"} or role.startswith("verify") or role.startswith("review"):
        return "verify"
    return "writer"


def _directive_worker_for_role(role: str, *, index: int) -> str:
    if role == "read_only":
        return f"helper-read-{index}"
    if role == "verify":
        return f"helper-verify-{index}"
    return f"writer-{index}"


def _render_plan_markdown(plan: Dict[str, Any], *, heading: str) -> str:
    summary = str(plan.get("summary") or "").strip() or "Supervisor draft"
    objective = str(plan.get("objective") or "").strip() or "Objective needs clarification"
    assumptions = [str(item).strip() for item in (plan.get("assumptions") or []) if str(item).strip()]
    unknowns = [str(item).strip() for item in (plan.get("unknowns") or []) if str(item).strip()]
    approval_points = [
        str(item).strip() for item in (plan.get("approval_points") or []) if str(item).strip()
    ]
    execution_steps = [
        item for item in (plan.get("execution_steps") or []) if isinstance(item, dict)
    ][:12]

    lines: List[str] = [f"### {heading}", "", f"**Summary:** {summary}", "", f"**Objective:** {objective}", ""]

    lines.append("**Execution steps:**")
    if execution_steps:
        for idx, step in enumerate(execution_steps, start=1):
            title = str(step.get("title") or f"Step {idx}").strip() or f"Step {idx}"
            kind = _normalize_directive_role(str(step.get("kind") or "writer"))
            worker = str(step.get("assigned_worker") or "").strip() or _directive_worker_for_role(kind, index=idx)
            depends = [
                str(item).strip()
                for item in (step.get("depends_on") or step.get("depends_on_task_ids") or [])
                if str(item).strip()
            ]
            instruction = str(step.get("instruction") or "").strip()
            lines.append(f"{idx}. `{kind}` {title}")
            lines.append(f"   - owner: `{worker}`")
            lines.append(f"   - depends_on: `{', '.join(depends) if depends else 'none'}`")
            if instruction:
                lines.append(f"   - {instruction[:500]}")
    else:
        lines.append("- None yet")
    lines.append("")

    lines.append("**Unknowns:**")
    if unknowns:
        for item in unknowns:
            lines.append(f"- {item}")
    else:
        lines.append("- None")
    lines.append("")

    lines.append("**Approval points:**")
    if approval_points:
        for item in approval_points:
            lines.append(f"- {item}")
    else:
        lines.append("- None")
    lines.append("")

    if assumptions:
        lines.append("**Assumptions:**")
        for item in assumptions:
            lines.append(f"- {item}")
        lines.append("")

    lines.append(
        "_When you are satisfied, tell me to proceed (for example: `looks good, go ahead`) and I will dispatch workers._"
    )
    return "\n".join(lines).strip()


def _resolve_supervisor_repo(
    scope: str,
    *,
    user_id: str,
    repo_id: Optional[str],
    repo_url: Optional[str],
    topic_ref: Optional[Dict[str, Any]],
    transcript: Optional[List[Dict[str, Any]]],
) -> tuple[str, Optional[str], str, str, Dict[str, Any]]:
    binding = _resolve_supervisor_repo_binding(
        scope,
        user_id=user_id,
        repo_id=(repo_id or "").strip(),
        repo_url=(repo_url or "").strip() or None,
        topic_ref=topic_ref,
        transcript=transcript,
    )
    rid = str(binding.get("id") or "").strip()
    rurl = str(binding.get("url") or "").strip() or None
    source = str(binding.get("source") or "").strip() or "unresolved"
    confidence = str(binding.get("confidence") or "").strip() or "low"
    metadata = binding.get("metadata") if isinstance(binding.get("metadata"), dict) else {}
    return rid, rurl, source, confidence, metadata


def _execution_directives_from_plan(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    def _step_tokens(step: Dict[str, Any], *, idx: int) -> List[str]:
        tokens: List[str] = []
        for raw in (
            step.get("step_id"),
            step.get("id"),
            step.get("source_task_id"),
            step.get("directive_id"),
            f"step_{idx}",
            str(idx),
        ):
            token = str(raw or "").strip().lower()
            if token:
                tokens.append(token)
        return sorted(set(tokens))

    def _depends_on_refs(step: Dict[str, Any]) -> List[str]:
        refs = [
            str(item).strip().lower()
            for item in (
                step.get("depends_on")
                or step.get("depends_on_step_ids")
                or step.get("depends_on_task_ids")
                or []
            )
            if str(item).strip()
        ]
        return sorted(set(refs))

    def _directive_from_step(
        step: Dict[str, Any],
        *,
        idx: int,
        role_counters: Dict[str, int],
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(step, dict):
            return None
        instruction = str(step.get("instruction") or "").strip()
        if not instruction:
            return None
        role = _normalize_directive_role(str(step.get("assigned_role") or step.get("kind") or "writer"))
        role_counters[role] = int(role_counters.get(role, 0)) + 1
        worker = str(step.get("assigned_worker") or "").strip() or _directive_worker_for_role(
            role, index=role_counters[role]
        )
        task_title = (
            str(step.get("task_title") or step.get("title") or "").strip()
            or instruction.splitlines()[0][:120]
        )
        step_options = dict(step.get("options")) if isinstance(step.get("options"), dict) else {}
        return {
            "instruction": instruction,
            "assigned_worker": worker,
            "assigned_role": role,
            "task_title": task_title[:120],
            "options": step_options,
            "file_claims": [str(v).strip() for v in (step.get("file_claims") or []) if str(v).strip()],
            "area_claims": [str(v).strip() for v in (step.get("area_claims") or []) if str(v).strip()],
            "depends_on_refs": _depends_on_refs(step),
            "step_tokens": _step_tokens(step, idx=idx),
        }

    chosen: List[Dict[str, Any]] = []
    steps = [item for item in (plan.get("execution_steps") or []) if isinstance(item, dict)]
    role_counters: Dict[str, int] = {"writer": 0, "read_only": 0, "verify": 0}
    for idx, item in enumerate(steps, start=1):
        directive = _directive_from_step(item, idx=idx, role_counters=role_counters)
        if directive is None:
            continue
        chosen.append(directive)
        if len(chosen) >= 6:
            break

    if not chosen:
        objective = str(plan.get("objective") or "").strip() or "Implement the agreed topic plan"
        return [
            {
                "instruction": objective,
                "assigned_worker": _directive_worker_for_role("writer", index=1),
                "assigned_role": "writer",
                "task_title": "Initial implementation pass",
                "options": {},
                "file_claims": [],
                "area_claims": [],
                "depends_on_directive_indices": [],
            }
        ]

    token_to_index: Dict[str, int] = {}
    for idx, directive in enumerate(chosen, start=1):
        for token in directive.get("step_tokens") or []:
            token_to_index[str(token).strip().lower()] = idx

    for idx, directive in enumerate(chosen, start=1):
        depends_on_indices: List[int] = []
        for ref in (directive.get("depends_on_refs") or []):
            normalized = str(ref).strip().lower()
            if not normalized:
                continue
            mapped = token_to_index.get(normalized)
            if mapped is not None and mapped < idx:
                depends_on_indices.append(mapped)
                continue
            if normalized.isdigit():
                num = int(normalized)
                if 1 <= num < idx:
                    depends_on_indices.append(num)

        if not depends_on_indices and directive.get("assigned_role") == "verify":
            prior_impl = [
                n
                for n in range(1, idx)
                if chosen[n - 1].get("assigned_role") in {"writer", "read_only"}
            ]
            if prior_impl:
                depends_on_indices.extend(prior_impl)

        directive["depends_on_directive_indices"] = sorted(set(depends_on_indices))
        directive.pop("depends_on_refs", None)
        directive.pop("step_tokens", None)

    return chosen


def _plan_completion_assessment_state(
    session_metadata: Dict[str, Any],
    plan_revision_id: str,
) -> Dict[str, Any]:
    if not plan_revision_id:
        return {}
    assessments = (
        session_metadata.get("plan_completion_assessments")
        if isinstance(session_metadata.get("plan_completion_assessments"), dict)
        else {}
    )
    state = assessments.get(plan_revision_id) if isinstance(assessments.get(plan_revision_id), dict) else {}
    return dict(state)


def _plan_completion_follow_up_required(session_metadata: Dict[str, Any], plan_revision_id: str) -> bool:
    state = _plan_completion_assessment_state(session_metadata, plan_revision_id)
    return bool(state.get("follow_up_required"))


def _build_implementation_follow_up_plan(
    *,
    message: str,
    scope: str,
    repo_id: str,
    repo_url: Optional[str],
    active_plan: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    prior_summary = str((active_plan or {}).get("summary") or "").strip()
    prior_objective = str((active_plan or {}).get("objective") or "").strip()
    prior_steps = [
        str(item.get("title") or item.get("task_title") or "").strip()
        for item in ((active_plan or {}).get("execution_steps") or [])
        if isinstance(item, dict) and str(item.get("title") or item.get("task_title") or "").strip()
    ]
    delivery_expectations = _derive_delivery_expectations(
        message,
        prior_objective,
        prior_summary,
        " ".join(prior_steps[:6]),
    )
    objective = " ".join(value for value in [message, prior_objective] if value).strip() or (
        prior_objective or "Continue with repository implementation"
    )
    summary = (
        "Implementation follow-up plan derived from the approved topic context"
        if active_plan
        else "Implementation plan derived from the current topic context"
    )
    writer_lines = [
        "Continue with real repository execution now.",
        "Inspect the bound repo, choose the next shippable implementation slice that satisfies the current request, and make the code changes directly.",
        "Run the relevant verification commands after the changes.",
        "Push a worker branch or open a PR before reporting done.",
        "Report changed files, verification output, and the branch or PR URL.",
        "Do not stop at analysis, planning, or documentation-only output.",
    ]
    if delivery_expectations.get("requires_runtime_evidence"):
        writer_lines.append(
            "Start the changed workflow or application and capture runtime evidence for the exact behavior you changed."
        )
    if delivery_expectations.get("requires_deployment_evidence"):
        writer_lines.extend(
            [
                "Make the change available at a dev or preview URL for human testing before claiming completion.",
                "If the app exposes a local dev server, include `preview_port: <port>` in your output so the controller can publish the preview URL.",
            ]
        )
    if delivery_expectations.get("require_pull_request"):
        writer_lines.append("Open a pull request from the worker branch and include the PR URL in the final report.")
    elif delivery_expectations.get("prefer_pull_request"):
        writer_lines.append(
            "Prefer opening a pull request from the worker branch once the implementation is ready; include the PR URL if one is created."
        )
    if delivery_expectations.get("requires_ci_evidence"):
        writer_lines.append("Include CI or status-check results when checks are available for the branch or PR.")
    if delivery_expectations.get("requires_traceability"):
        writer_lines.append("Map the delivered artifacts back to the request or acceptance criteria.")
    if repo_id:
        writer_lines.append(f"Repo: {repo_id}")
    if repo_url:
        writer_lines.append(f"Repo URL: {repo_url}")
    if prior_summary:
        writer_lines.append(f"Approved plan summary: {prior_summary[:300]}")
    if prior_objective:
        writer_lines.append(f"Approved plan objective: {prior_objective[:300]}")
    if prior_steps:
        writer_lines.append("Use the prior approved plan outputs as context:")
        for title in prior_steps[:6]:
            writer_lines.append(f"- {title}")
    writer_lines.extend(
        [
            "",
            f"Human execution request: {message}",
            "",
            "If blocked, report the exact missing dependency instead of claiming completion.",
        ]
    )
    verify_lines = [
        "Review the implementation changes in the bound repo.",
        "Confirm that verification results are present and grounded in actual command output or CI state.",
        "Confirm that a pushed branch or PR URL exists before marking the work complete.",
        "If anything is missing, report the precise gap back to the supervisor.",
    ]
    if delivery_expectations.get("requires_runtime_evidence"):
        verify_lines.append("Confirm that runtime evidence exists for the changed behavior.")
    if delivery_expectations.get("requires_deployment_evidence"):
        verify_lines.append("Confirm that a preview or dev URL exists and is suitable for human validation.")
    if delivery_expectations.get("require_pull_request"):
        verify_lines.append("Confirm that a pull request URL exists for the pushed branch.")
    if delivery_expectations.get("requires_ci_evidence"):
        verify_lines.append("Confirm that CI or status-check state is reported when checks are available.")
    if delivery_expectations.get("requires_traceability"):
        verify_lines.append("Confirm that the final report maps evidence back to the request or acceptance criteria.")
    if repo_id:
        verify_lines.append(f"Repo: {repo_id}")
    return {
        "summary": summary,
        "objective": objective,
        "assumptions": _merge_unique_text(
            [
                "The active request requires repository-changing implementation work.",
                "A real executable worker backend must be used for delivery.",
            ]
        ),
        "unknowns": [],
        "execution_steps": [
            {
                "step_id": "step_impl",
                "title": "Implement the next shippable slice",
                "instruction": "\n".join(writer_lines).strip(),
                "kind": "writer",
                "assigned_worker": "writer-1",
                "assigned_role": "writer",
                "options": {"delivery_expectations": delivery_expectations},
                "depends_on": [],
            },
            {
                "step_id": "step_verify",
                "title": "Verify repo output evidence",
                "instruction": "\n".join(verify_lines).strip(),
                "kind": "verify",
                "assigned_worker": "helper-verify-1",
                "assigned_role": "verify",
                "options": {"delivery_expectations": delivery_expectations},
                "depends_on": ["step_impl"],
            },
        ],
        "candidate_parallel_seams": [],
        "approval_points": [],
        "source": {
            "source": "implementation_follow_up",
            "topic_scope_id": scope,
            "repo_id": repo_id,
            "repo_url": repo_url,
            "derived_from_plan_revision_id": str((active_plan or {}).get("plan_revision_id") or "").strip(),
        },
    }


def _execution_step_is_approval_gate(step: Dict[str, Any]) -> bool:
    title = str(step.get("title") or step.get("task_title") or "").strip()
    instruction = str(step.get("instruction") or "").strip()
    role = str(step.get("assigned_role") or step.get("kind") or "").strip()
    phase = _task_delivery_phase(
        assigned_role=role,
        instruction=instruction,
        options={"task_title": title},
    )
    return phase == "approval"


def _plan_has_delivery_phase(plan: Dict[str, Any], *, phase: str) -> bool:
    for step in (plan.get("execution_steps") or []):
        if not isinstance(step, dict):
            continue
        step_phase = _task_delivery_phase(
            assigned_role=str(step.get("assigned_role") or step.get("kind") or ""),
            instruction=str(step.get("instruction") or ""),
            options={"task_title": str(step.get("title") or step.get("task_title") or "")},
        )
        if step_phase == phase:
            return True
    return False


def _plan_has_primary_execution_step(plan: Dict[str, Any]) -> bool:
    return any(
        _task_delivery_phase(
            assigned_role=str(step.get("assigned_role") or step.get("kind") or ""),
            instruction=str(step.get("instruction") or ""),
            options={"task_title": str(step.get("title") or step.get("task_title") or "")},
        )
        in {"implementation", "deployment", "packaging"}
        for step in (plan.get("execution_steps") or [])
        if isinstance(step, dict)
    )


def _approved_plan_revision_id(
    metadata: Dict[str, Any],
    *,
    current_plan_id: str,
    task_items: Optional[List[TaskRecord]] = None,
) -> str:
    approved = str(metadata.get("approved_plan_revision_id") or "").strip()
    if approved:
        return approved
    if current_plan_id and bool(metadata.get("approval_granted")):
        return current_plan_id
    for item in (task_items or []):
        plan_revision_id = str(getattr(item, "plan_revision_id", "") or "").strip()
        if plan_revision_id:
            return plan_revision_id
    return ""


def _runtime_approval_granted(
    metadata: Dict[str, Any],
    *,
    current_plan_id: str,
    task_items: Optional[List[TaskRecord]] = None,
) -> bool:
    approved = _approved_plan_revision_id(metadata, current_plan_id=current_plan_id, task_items=task_items)
    if current_plan_id:
        return approved == current_plan_id
    return bool(approved)


def _runtime_execution_requested(
    metadata: Dict[str, Any],
    *,
    current_plan_id: str,
    task_items: Optional[List[TaskRecord]] = None,
) -> bool:
    if task_items:
        return True
    return _runtime_approval_granted(
        metadata,
        current_plan_id=current_plan_id,
        task_items=task_items,
    )


def _friendly_execution_blocker(blocker: str) -> str:
    normalized = str(blocker or "").strip().lower()
    if normalized == "approval_required":
        return "Human approval is still required before execution can start."
    if normalized == "clarification_required":
        return "The supervisor still needs a concrete clarification before execution can start."
    if normalized == "completion_follow_up_required":
        return "The previously accepted plan still has unresolved delivery evidence or follow-up work."
    if normalized == "repo_selection_required":
        return "Execution needs a concrete repo binding before code-changing work can start."
    if normalized == "no_actionable_execution_steps":
        return "The active plan does not contain executable worker steps yet."
    return normalized.replace("_", " ") or "Execution is currently blocked."


def _render_execution_blocked_markdown(
    *,
    blockers: List[str],
    reason: str,
) -> str:
    lines = ["### Execution blocked", ""]
    if reason:
        lines.append(reason.strip())
        lines.append("")
    if blockers:
        lines.append("Current blockers:")
        for item in blockers:
            lines.append(f"- {_friendly_execution_blocker(item)}")
    else:
        lines.append("- Execution cannot proceed yet.")
    return "\n".join(lines).strip()


def _create_worker_tasks_from_execution_steps(
    *,
    scope: str,
    directives: List[Dict[str, Any]],
    task_owner: str,
    actor_email: str,
    repo_id: str,
    repo_url: Optional[str],
    thread_ref: Dict[str, Any],
    plan_revision_id: Optional[str],
    source_label: str,
) -> Dict[str, Any]:
    created_tasks: List[Dict[str, Any]] = []
    created_task_ids_by_index: Dict[int, str] = {}
    prepared_directives: List[Dict[str, Any]] = []
    backend_blockers: List[Dict[str, Any]] = []
    default_provider = (
        SUPERVISOR_DEFAULT_WORKER_PROVIDER
        if SUPERVISOR_DEFAULT_WORKER_PROVIDER in ALLOWED_PROVIDERS
        else DEFAULT_PROVIDER
    )

    for directive_idx, directive in enumerate(directives, start=1):
        dep_indices = [
            int(value)
            for value in (directive.get("depends_on_directive_indices") or [])
            if isinstance(value, int) or (isinstance(value, str) and str(value).isdigit())
        ]
        explicit_dep_task_ids = [
            str(value).strip()
            for value in (directive.get("depends_on_task_ids") or [])
            if str(value).strip()
        ]
        directive_options = (
            dict(directive.get("options"))
            if isinstance(directive.get("options"), dict)
            else {}
        )
        task_title = str(directive.get("task_title") or "").strip()
        if task_title and not str(directive_options.get("task_title") or "").strip():
            directive_options["task_title"] = task_title
        directive_options["source"] = source_label
        options = _merge_task_scope_options(
            base_options=directive_options,
            depends_on_task_ids=explicit_dep_task_ids,
            file_claims=directive.get("file_claims") or [],
            area_claims=directive.get("area_claims") or [],
        )
        provider_hint = normalize_provider_id(str(directive.get("provider") or "").strip())
        provider, selected_options, failure = _select_worker_backend_for_task(
            provider_hint=provider_hint or default_provider,
            instruction=str(directive.get("instruction") or ""),
            assigned_role=str(directive.get("assigned_role") or ""),
            options=options,
            allow_provider_fallback=not bool(provider_hint),
        )
        if not provider:
            backend_blockers.append(
                {
                    "directive_index": directive_idx,
                    "task_title": task_title or str(directive.get("instruction") or "")[:120],
                    "assigned_role": str(directive.get("assigned_role") or "").strip() or "writer",
                    **(failure or {}),
                }
            )
            continue
        prepared_directives.append(
            {
                "directive_index": directive_idx,
                "directive": directive,
                "provider": provider,
                "options": selected_options,
                "depends_on_directive_indices": sorted(set(dep_indices)),
                "depends_on_task_ids": explicit_dep_task_ids,
            }
        )

    if backend_blockers:
        return {
            "ok": False,
            "backend_blockers": backend_blockers,
            "worker_backends": _worker_backend_capability_summary(),
        }

    for item in prepared_directives:
        directive_idx = int(item["directive_index"])
        directive = item["directive"]
        dep_indices = item["depends_on_directive_indices"]
        dep_task_ids = [
            created_task_ids_by_index[index]
            for index in dep_indices
            if index < directive_idx and index in created_task_ids_by_index
        ]
        dep_task_ids.extend(
            [
                str(value).strip()
                for value in (item.get("depends_on_task_ids") or [])
                if str(value).strip()
            ]
        )
        selected_options = _merge_task_scope_options(
            base_options=dict(item["options"] or {}),
            depends_on_task_ids=sorted(set(dep_task_ids)),
            file_claims=directive.get("file_claims") or [],
            area_claims=directive.get("area_claims") or [],
        )
        task = store.create_task(
            user_id=task_owner,
            repo_id=repo_id,
            repo_url=repo_url,
            provider=str(item["provider"]),
            instruction=augment_instruction_with_task_contract(
                instruction=str(directive.get("instruction") or ""),
                assigned_role=str(directive.get("assigned_role") or ""),
                options=selected_options,
            ),
            zulip_thread_ref=thread_ref,
            options=selected_options,
            topic_scope_id=scope,
            assigned_worker=str(directive.get("assigned_worker") or ""),
            assigned_role=str(directive.get("assigned_role") or ""),
            assigned_by=actor_email,
            directive_id=None,
            plan_revision_id=plan_revision_id,
        )
        store.append_event(
            task.task_id,
            level="info",
            event_type="worker_session.requested",
            message="Supervisor started execution step",
            data={
                "supervisor_id": actor_email,
                "assigned_worker": directive.get("assigned_worker"),
                "assigned_role": directive.get("assigned_role"),
                "plan_revision_id": plan_revision_id,
                "topic_scope_id": scope,
                "depends_on_task_ids": sorted(set(dep_task_ids)),
            },
        )
        task_dict = task_to_dict(task)
        created_tasks.append(task_dict)
        created_task_ids_by_index[directive_idx] = task.task_id

    coordinator.wake()
    return {"ok": True, "tasks": created_tasks}


def _sanitize_execution_plan_for_execution(
    *,
    plan: Dict[str, Any],
    message: str,
    repo_id: str,
    repo_url: Optional[str],
    execution_requested: bool,
) -> Dict[str, Any]:
    if not execution_requested:
        return plan

    sanitized = dict(plan)
    delivery_expectations = _derive_delivery_expectations(
        message,
        sanitized.get("objective"),
        sanitized.get("summary"),
    )
    execution_steps: List[Dict[str, Any]] = []
    for raw_step in (sanitized.get("execution_steps") or []):
        if not isinstance(raw_step, dict):
            continue
        if _execution_step_is_approval_gate(raw_step):
            continue
        step = dict(raw_step)
        options = dict(step.get("options")) if isinstance(step.get("options"), dict) else {}
        if delivery_expectations and not isinstance(options.get("delivery_expectations"), dict):
            options["delivery_expectations"] = dict(delivery_expectations)
        elif delivery_expectations:
            merged_expectations = dict(options.get("delivery_expectations") or {})
            for key, value in delivery_expectations.items():
                if value and key not in merged_expectations:
                    merged_expectations[key] = True
            options["delivery_expectations"] = merged_expectations
        if options:
            step["options"] = options
        execution_steps.append(step)

    sanitized["approval_points"] = []
    has_primary_execution_step = any(
        _task_delivery_phase(
            assigned_role=str(step.get("assigned_role") or step.get("kind") or ""),
            instruction=str(step.get("instruction") or ""),
            options={"task_title": str(step.get("title") or step.get("task_title") or "")},
        )
        in {"implementation", "deployment", "packaging"}
        for step in execution_steps
        if isinstance(step, dict)
    )

    if (
        has_primary_execution_step
        and delivery_expectations.get("requires_deployment_evidence")
        and not _plan_has_delivery_phase(
        {"execution_steps": execution_steps}, phase="deployment"
        )
    ):
        depends_on = [
            str(step.get("step_id") or "").strip()
            for step in execution_steps
            if isinstance(step, dict) and str(step.get("step_id") or "").strip()
        ]
        deployment_lines = [
            "Publish a dev or preview URL for the implemented change.",
            "Start the changed application or workflow and verify it loads successfully.",
            "If a local dev server is used, include `preview_port: <port>` so the controller can publish the preview URL.",
            "Report the preview/dev URL and the runtime evidence needed for human validation.",
        ]
        if repo_id:
            deployment_lines.append(f"Repo: {repo_id}")
        if repo_url:
            deployment_lines.append(f"Repo URL: {repo_url}")
        execution_steps.append(
            {
                "step_id": "step_preview_publish",
                "title": "Publish preview/dev URL",
                "instruction": "\n".join(deployment_lines).strip(),
                "kind": "writer",
                "assigned_worker": "writer-1",
                "assigned_role": "writer",
                "options": {"delivery_expectations": dict(delivery_expectations)},
                "depends_on": depends_on[-1:] if depends_on else [],
            }
        )

    if (
        has_primary_execution_step
        and delivery_expectations.get("requires_ci_evidence")
        and not any(
        str(step.get("assigned_role") or step.get("kind") or "").strip().lower() == "verify"
        for step in execution_steps
        if isinstance(step, dict)
        )
    ):
        depends_on = [
            str(step.get("step_id") or "").strip()
            for step in execution_steps
            if isinstance(step, dict) and str(step.get("step_id") or "").strip()
        ]
        verify_lines = [
            "Inspect the implementation outputs and report verification evidence.",
            "Capture CI or status-check state when checks are available.",
            "Report any missing artifacts instead of claiming completion.",
        ]
        if repo_id:
            verify_lines.append(f"Repo: {repo_id}")
        execution_steps.append(
            {
                "step_id": "step_verify_delivery",
                "title": "Verify delivery evidence",
                "instruction": "\n".join(verify_lines).strip(),
                "kind": "verify",
                "assigned_worker": "helper-verify-1",
                "assigned_role": "verify",
                "options": {"delivery_expectations": dict(delivery_expectations)},
                "depends_on": depends_on[-1:] if depends_on else [],
            }
        )

    source_obj = dict(sanitized.get("source")) if isinstance(sanitized.get("source"), dict) else {}
    source_obj["execution_authorized"] = True
    sanitized["source"] = source_obj
    sanitized["execution_steps"] = execution_steps
    return sanitized


def _ensure_plan_has_actionable_steps(plan: Dict[str, Any]) -> Dict[str, Any]:
    execution_steps = [item for item in (plan.get("execution_steps") or []) if isinstance(item, dict)]
    if any(str(item.get("instruction") or "").strip() for item in execution_steps):
        return plan
    objective = str(plan.get("objective") or "").strip()
    if not objective:
        return plan
    normalized = dict(plan)
    normalized["execution_steps"] = [
        {
            "step_id": "step_1",
            "title": "Execute the current objective",
            "instruction": objective,
            "kind": "writer",
            "assigned_worker": "writer-1",
            "assigned_role": "writer",
            "depends_on": [],
        }
    ]
    return normalized


def _persist_supervisor_plan_revision(
    *,
    scope: str,
    session_id: Optional[str],
    actor_email: str,
    synthesis: Dict[str, Any],
) -> Any:
    synthesis = _ensure_plan_has_actionable_steps(synthesis)
    seams_raw = synthesis.get("candidate_parallel_seams")
    seams = [item for item in seams_raw if isinstance(item, dict)] if isinstance(seams_raw, list) else []
    if not seams:
        seams = _build_parallel_seams(
            [item for item in (synthesis.get("execution_steps") or []) if isinstance(item, dict)]
        )
    return store.create_plan_revision(
        topic_scope_id=scope,
        session_id=session_id,
        author_id=actor_email,
        summary=str(synthesis.get("summary") or "").strip(),
        objective=str(synthesis.get("objective") or "").strip(),
        assumptions=[str(item).strip() for item in (synthesis.get("assumptions") or []) if str(item).strip()],
        unknowns=[str(item).strip() for item in (synthesis.get("unknowns") or []) if str(item).strip()],
        execution_steps=[item for item in (synthesis.get("execution_steps") or []) if isinstance(item, dict)],
        candidate_parallel_seams=seams,
        approval_points=[
            str(item).strip() for item in (synthesis.get("approval_points") or []) if str(item).strip()
        ],
        source=dict(synthesis.get("source")) if isinstance(synthesis.get("source"), dict) else {},
        status="active",
    )


def require_api_token(authorization: Optional[str] = Header(default=None)) -> None:
    if not ORCHESTRATOR_API_TOKEN:
        return
    expected = f"Bearer {ORCHESTRATOR_API_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


class TaskCreateRequest(BaseModel):
    user_id: str = Field(min_length=1)
    repo_id: str = Field(min_length=1)
    repo_url: Optional[str] = None
    provider: str = Field(default=DEFAULT_PROVIDER)
    instruction: str = Field(min_length=1)
    zulip_thread_ref: Dict[str, Any] = Field(default_factory=dict)
    options: Dict[str, Any] = Field(default_factory=dict)
    topic_scope_id: Optional[str] = None
    task_title: Optional[str] = None
    assigned_worker: Optional[str] = None
    assigned_role: Optional[str] = None
    assigned_by: Optional[str] = None
    directive_id: Optional[str] = None
    plan_revision_id: Optional[str] = None
    depends_on_task_ids: List[str] = Field(default_factory=list)
    file_claims: List[str] = Field(default_factory=list)
    area_claims: List[str] = Field(default_factory=list)


class TaskApproveRequest(BaseModel):
    note: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class TaskActionRequest(BaseModel):
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None
    note: Optional[str] = None
    retry_instruction: Optional[str] = None
    retry_provider: Optional[str] = None
    retry_options: Dict[str, Any] = Field(default_factory=dict)
    clarification_reason: Optional[str] = None
    clarification_questions: List[str] = Field(default_factory=list)
    guidance: Optional[str] = None


class TaskReplyRequest(BaseModel):
    message: str = Field(min_length=1)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class WorkerSessionActionRequest(BaseModel):
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None
    note: Optional[str] = None


class PlanRevisionCreateRequest(BaseModel):
    session_id: Optional[str] = None
    author_id: Optional[str] = None
    summary: str = ""
    objective: str = ""
    assumptions: List[str] = Field(default_factory=list)
    unknowns: List[str] = Field(default_factory=list)
    execution_steps: List[Dict[str, Any]] = Field(default_factory=list)
    candidate_parallel_seams: List[Dict[str, Any]] = Field(default_factory=list)
    approval_points: List[str] = Field(default_factory=list)
    source: Dict[str, Any] = Field(default_factory=dict)
    status: str = Field(default="active")
    plan_revision_id: Optional[str] = None


class PlanSynthesisRequest(BaseModel):
    session_id: Optional[str] = None
    author_id: Optional[str] = None
    summary: str = ""
    objective: str = ""
    assumptions: List[str] = Field(default_factory=list)
    unknowns: List[str] = Field(default_factory=list)
    execution_steps: List[Dict[str, Any]] = Field(default_factory=list)
    approval_points: List[str] = Field(default_factory=list)
    source: Dict[str, Any] = Field(default_factory=dict)
    activate: bool = Field(default=False)


class SupervisorUploadedFile(BaseModel):
    filename: str = Field(min_length=1)
    size: int = Field(default=0)
    path: Optional[str] = None
    media_type: Optional[str] = None
    mime_type: Optional[str] = None
    status: Optional[str] = None
    content_base64: Optional[str] = None
    content_b64: Optional[str] = None


class SupervisorTopicMessageRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: Optional[str] = None
    session_create_mode: Optional[str] = None
    session_title: Optional[str] = None
    client_msg_id: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    repo_id: Optional[str] = None
    repo_url: Optional[str] = None
    stream_id: Optional[int] = None
    stream_name: Optional[str] = None
    topic: Optional[str] = None
    topic_transcript: List[Dict[str, Any]] = Field(default_factory=list)
    uploaded_files: List[SupervisorUploadedFile] = Field(default_factory=list)


class SupervisorSessionResetRequest(BaseModel):
    session_id: Optional[str] = None
    clear_events: bool = Field(default=True)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class NeedsClarificationRequest(BaseModel):
    reason: str = Field(min_length=1)
    questions: List[str] = Field(default_factory=list)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class ResolveClarificationRequest(BaseModel):
    guidance: str = Field(min_length=1)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class SupervisorMemoryAppendRequest(BaseModel):
    title: str = Field(min_length=1)
    detail: str = Field(min_length=1)
    tags: List[str] = Field(default_factory=list)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class ProviderAuthConnectRequest(BaseModel):
    auth_mode: str = Field(default="api_key")
    label: Optional[str] = None
    api_key: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    id_token: Optional[str] = None
    account_id: Optional[str] = None
    expires_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class ProviderAuthDisconnectRequest(BaseModel):
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class ProviderOAuthStartRequest(BaseModel):
    redirect_uri: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class ProviderOAuthCallbackRequest(BaseModel):
    state: str = Field(min_length=8)
    code: Optional[str] = None
    error: Optional[str] = None
    error_description: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class IntegrationConnectRequest(BaseModel):
    auth_mode: str = Field(default="api_key")
    label: Optional[str] = None
    api_key: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class IntegrationDisconnectRequest(BaseModel):
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class IntegrationPolicyUpdateRequest(BaseModel):
    policy: Dict[str, Any] = Field(default_factory=dict)
    merge: bool = Field(default=True)
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None


class PrestartItem(BaseModel):
    user_id: str = Field(min_length=1)
    repo_id: str = Field(min_length=1)
    repo_url: Optional[str] = None


class PrestartRequest(BaseModel):
    items: List[PrestartItem] = Field(default_factory=list)


def _parse_prestart_days(raw: str) -> set[int]:
    mapping = {
        "MON": 0,
        "TUE": 1,
        "WED": 2,
        "THU": 3,
        "FRI": 4,
        "SAT": 5,
        "SUN": 6,
    }
    out: set[int] = set()
    for item in (raw or "").split(","):
        key = item.strip().upper()
        if key in mapping:
            out.add(mapping[key])
    if not out:
        out = {0, 1, 2, 3, 4}
    return out


def _parse_prestart_time(value: str) -> tuple[int, int]:
    default = (8, 30)
    text = (value or "").strip()
    if ":" not in text:
        return default
    hh, mm = text.split(":", 1)
    try:
        hour = int(hh)
        minute = int(mm)
    except Exception:
        return default
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return default
    return hour, minute


def _parse_prestart_items(raw_json: str) -> List[PrestartItem]:
    text = (raw_json or "").strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except Exception as exc:
        logging.warning("invalid PRESTART_ITEMS_JSON: %s", exc)
        return []
    if not isinstance(payload, list):
        logging.warning("invalid PRESTART_ITEMS_JSON: expected list")
        return []
    items: List[PrestartItem] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        user_id = str(item.get("user_id") or "").strip()
        repo_id = str(item.get("repo_id") or "").strip()
        repo_url = str(item.get("repo_url") or "").strip() or None
        if not user_id or not repo_id:
            continue
        items.append(PrestartItem(user_id=user_id, repo_id=repo_id, repo_url=repo_url))
    return items


class PrestartScheduler:
    def __init__(
        self,
        *,
        enabled: bool,
        coordinator: TaskCoordinator,
        local_time: str,
        timezone_name: str,
        days_csv: str,
        items: List[PrestartItem],
        poll_seconds: int,
        max_parallel: int,
    ) -> None:
        self.enabled = enabled
        self.coordinator = coordinator
        self.days = _parse_prestart_days(days_csv)
        self.target_hour, self.target_minute = _parse_prestart_time(local_time)
        self.items = items
        self.poll_seconds = max(5, int(poll_seconds))
        self.max_parallel = max(1, int(max_parallel))
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._last_run_date: Optional[str] = None
        self._last_run_at: Optional[str] = None
        self._last_result: Dict[str, Any] = {}
        try:
            self.tz = ZoneInfo(timezone_name)
            self.timezone_name = timezone_name
        except Exception:
            self.tz = ZoneInfo("UTC")
            self.timezone_name = "UTC"
            logging.warning("invalid PRESTART_TIMEZONE '%s', falling back to UTC", timezone_name)

    def start(self) -> None:
        if not self.enabled:
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_loop, name="prestart-scheduler", daemon=True)
        self._thread.start()
        logging.info(
            "prestart scheduler enabled time=%02d:%02d tz=%s days=%s items=%d",
            self.target_hour,
            self.target_minute,
            self.timezone_name,
            sorted(self.days),
            len(self.items),
        )

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def status(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "timezone": self.timezone_name,
            "time_local": f"{self.target_hour:02d}:{self.target_minute:02d}",
            "days": sorted(self.days),
            "items": [item.model_dump() for item in self.items],
            "last_run_date": self._last_run_date,
            "last_run_at": self._last_run_at,
            "last_result": self._last_result,
        }

    def run_now(self) -> Dict[str, Any]:
        results = []
        sem = threading.Semaphore(self.max_parallel)
        lock = threading.Lock()
        threads: List[threading.Thread] = []

        def worker(item: PrestartItem) -> None:
            sem.acquire()
            try:
                try:
                    value = self.coordinator.prestart_workspace(
                        user_id=item.user_id,
                        repo_id=item.repo_id,
                        repo_url=item.repo_url,
                    )
                    result = {
                        "ok": True,
                        "user_id": item.user_id,
                        "repo_id": item.repo_id,
                        "status": value,
                    }
                except Exception as exc:
                    result = {
                        "ok": False,
                        "user_id": item.user_id,
                        "repo_id": item.repo_id,
                        "error": str(exc),
                    }
                with lock:
                    results.append(result)
            finally:
                sem.release()

        for item in self.items:
            thread = threading.Thread(target=worker, args=(item,), daemon=True)
            threads.append(thread)
            thread.start()
        for thread in threads:
            thread.join()

        now = datetime.now(self.tz).isoformat()
        self._last_run_at = now
        self._last_result = {"results": results}
        return self._last_result

    def _run_loop(self) -> None:
        while not self._stop.is_set():
            now = datetime.now(self.tz)
            date_key = now.strftime("%Y-%m-%d")
            in_window = now.hour == self.target_hour and now.minute == self.target_minute
            if now.weekday() in self.days and in_window and date_key != self._last_run_date:
                self._last_run_date = date_key
                logging.info("prestart scheduler firing date=%s", date_key)
                self.run_now()
            time.sleep(self.poll_seconds)


prestart_scheduler = PrestartScheduler(
    enabled=PRESTART_ENABLED,
    coordinator=coordinator,
    local_time=PRESTART_LOCAL_TIME,
    timezone_name=PRESTART_TIMEZONE,
    days_csv=PRESTART_DAYS,
    items=_parse_prestart_items(PRESTART_ITEMS_JSON),
    poll_seconds=PRESTART_POLL_SECONDS,
    max_parallel=PRESTART_MAX_PARALLEL,
)


@app.on_event("startup")
async def on_startup() -> None:
    _ensure_supervisor_files()
    coordinator.start()
    prestart_scheduler.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    prestart_scheduler.stop()
    coordinator.stop()


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "execution_backend": EXECUTION_BACKEND,
        "coder_enabled": bool(coder is not None),
        "workspace_scope": coordinator.workspace_scope,
        "task_container_runtime": coordinator.task_container_runtime,
        "allowed_providers": sorted(ALLOWED_PROVIDERS),
        "task_statuses": sorted(TASK_STATUSES),
        "prestart_enabled": PRESTART_ENABLED,
        "prestart_items": len(prestart_scheduler.items),
        "supervisor_dir": str(SUPERVISOR_DIR),
        "orchestrator_policy_path": orchestrator_policy.source_path,
    }


def _normalized_user_id(value: str) -> str:
    return (value or "").strip().lower()


def _require_supported_provider(value: str) -> str:
    provider = _normalize_provider(value)
    if provider not in ALLOWED_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported provider '{provider}', allowed={sorted(ALLOWED_PROVIDERS)}",
        )
    return provider


def _require_supported_integration(value: str) -> str:
    integration = normalize_integration_id(value)
    catalog = {
        str(item.get("integration") or "").strip()
        for item in _integration_catalog()
        if bool(item.get("enabled", True))
    }
    if integration not in catalog:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported integration '{integration}', allowed={sorted(catalog)}",
        )
    return integration


@app.get("/api/providers", dependencies=[Depends(require_api_token)])
def list_providers() -> Dict[str, Any]:
    return {
        "ok": True,
        "providers": _provider_catalog(),
        "allowed_providers": sorted(ALLOWED_PROVIDERS),
        "default_provider": DEFAULT_PROVIDER,
    }


@app.get("/api/users/{user_id:path}/providers/auth", dependencies=[Depends(require_api_token)])
def list_user_provider_auth(user_id: str) -> Dict[str, Any]:
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")

    by_provider = {
        item.provider: item
        for item in store.list_provider_credentials(user_id=normalized_user, include_revoked=True)
    }
    entries: List[Dict[str, Any]] = []
    for provider in sorted(ALLOWED_PROVIDERS):
        catalog = _provider_catalog_entry(provider)
        oauth_configured = bool(_provider_oauth_config(provider).get("configured"))
        item = by_provider.get(provider)
        entries.append(
            {
                "provider": provider,
                "display_name": catalog.get("display_name") or provider,
                "auth_modes": _provider_supported_auth_modes(provider),
                "oauth_configured": oauth_configured,
                "default_model": catalog.get("default_model"),
                "connected": bool(item and item.status == "active"),
                "credential": provider_credential_to_dict(item) if item else None,
            }
        )
    return {
        "ok": True,
        "user_id": normalized_user,
        "providers": entries,
    }


@app.post(
    "/api/users/{user_id:path}/providers/{provider}/connect",
    dependencies=[Depends(require_api_token)],
)
def connect_user_provider(
    user_id: str,
    provider: str,
    payload: ProviderAuthConnectRequest,
) -> Dict[str, Any]:
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")
    normalized_provider = _require_supported_provider(provider)
    mode = (payload.auth_mode or "api_key").strip().lower() or "api_key"
    if mode not in {"api_key", "oauth"}:
        raise HTTPException(status_code=400, detail="auth_mode must be one of: api_key, oauth")

    secret: Dict[str, Any] = {}
    if mode == "api_key":
        api_key = (payload.api_key or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key is required for auth_mode=api_key")
        secret["api_key"] = api_key
    else:
        access_token = (payload.access_token or "").strip()
        if not access_token:
            raise HTTPException(
                status_code=400,
                detail="access_token is required for auth_mode=oauth",
            )
        secret["access_token"] = access_token
        refresh_token = (payload.refresh_token or "").strip()
        if refresh_token:
            secret["refresh_token"] = refresh_token
        id_token = (payload.id_token or "").strip()
        if id_token:
            secret["id_token"] = id_token
        account_id = (payload.account_id or "").strip()
        if account_id:
            secret["account_id"] = account_id
        expires_at = (payload.expires_at or "").strip()
        if expires_at:
            secret["expires_at"] = expires_at

    credential = store.upsert_provider_credential(
        user_id=normalized_user,
        provider=normalized_provider,
        auth_mode=mode,
        secret=secret,
        metadata=dict(payload.metadata or {}),
        label=(payload.label or "").strip() or None,
        status="active",
    )
    return {
        "ok": True,
        "user_id": normalized_user,
        "provider": normalized_provider,
        "credential": provider_credential_to_dict(credential),
    }


@app.post(
    "/api/users/{user_id:path}/providers/{provider}/disconnect",
    dependencies=[Depends(require_api_token)],
)
def disconnect_user_provider(
    user_id: str,
    provider: str,
    payload: ProviderAuthDisconnectRequest,
) -> Dict[str, Any]:
    del payload
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")
    normalized_provider = _require_supported_provider(provider)
    credential = store.revoke_provider_credential(
        user_id=normalized_user,
        provider=normalized_provider,
    )
    return {
        "ok": True,
        "user_id": normalized_user,
        "provider": normalized_provider,
        "credential": provider_credential_to_dict(credential) if credential else None,
    }


@app.post(
    "/api/users/{user_id:path}/providers/{provider}/oauth/start",
    dependencies=[Depends(require_api_token)],
)
def start_user_provider_oauth(
    user_id: str,
    provider: str,
    payload: ProviderOAuthStartRequest,
) -> Dict[str, Any]:
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")
    normalized_provider = _require_supported_provider(provider)
    catalog = _provider_catalog_entry(normalized_provider)
    auth_modes = catalog.get("auth_modes") or []
    if "oauth" not in auth_modes:
        raise HTTPException(
            status_code=400,
            detail=f"provider '{normalized_provider}' does not support oauth",
        )
    oauth = _provider_oauth_config(normalized_provider)
    if not oauth.get("configured"):
        raise HTTPException(
            status_code=400,
            detail=f"oauth is not configured for provider '{normalized_provider}'",
        )
    redirect_uri = (payload.redirect_uri or oauth.get("redirect_uri") or "").strip()
    if not redirect_uri:
        raise HTTPException(status_code=400, detail="redirect_uri is required")

    scopes = [str(item).strip() for item in (payload.scopes or []) if str(item).strip()]
    if not scopes:
        scopes = [str(item).strip() for item in (oauth.get("scopes") or []) if str(item).strip()]

    state = secrets.token_urlsafe(24)
    code_verifier = _pkce_code_verifier()
    code_challenge = _pkce_code_challenge(code_verifier)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    state_record = store.create_provider_oauth_state(
        state=state,
        user_id=normalized_user,
        provider=normalized_provider,
        redirect_uri=redirect_uri,
        scopes=scopes,
        metadata=dict(payload.metadata or {}),
        code_verifier=code_verifier,
        expires_at=expires_at,
    )

    query_params: Dict[str, Any] = {
        "response_type": "code",
        "client_id": oauth["client_id"],
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if scopes:
        query_params["scope"] = " ".join(scopes)
    extra_authorize_params = oauth.get("extra_authorize_params") or {}
    if isinstance(extra_authorize_params, dict):
        for key, value in extra_authorize_params.items():
            key_text = str(key).strip()
            value_text = str(value).strip()
            if key_text and value_text:
                query_params[key_text] = value_text
    authorize_url = str(oauth["authorize_url"])
    separator = "&" if "?" in authorize_url else "?"
    full_authorize_url = f"{authorize_url}{separator}{urlencode(query_params)}"

    return {
        "ok": True,
        "user_id": normalized_user,
        "provider": normalized_provider,
        "state": state_record.state,
        "expires_at": state_record.expires_at,
        "authorize_url": full_authorize_url,
        "redirect_uri": redirect_uri,
        "scopes": scopes,
    }


@app.post("/api/providers/oauth/callback", dependencies=[Depends(require_api_token)])
def complete_provider_oauth_callback(payload: ProviderOAuthCallbackRequest) -> Dict[str, Any]:
    state_token = (payload.state or "").strip()
    if not state_token:
        raise HTTPException(status_code=400, detail="state is required")

    state_record = store.get_provider_oauth_state(state=state_token, include_consumed=False)
    if state_record is None:
        consumed = store.get_provider_oauth_state(state=state_token, include_consumed=True)
        if consumed is not None and consumed.consumed_at:
            raise HTTPException(status_code=409, detail="oauth state is already consumed")
        raise HTTPException(status_code=400, detail="invalid oauth state")

    try:
        expires_at_dt = datetime.fromisoformat(state_record.expires_at)
    except Exception:
        expires_at_dt = datetime.now(timezone.utc) + timedelta(minutes=1)
    if expires_at_dt.tzinfo is None:
        expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) >= expires_at_dt:
        store.consume_provider_oauth_state(state=state_record.state)
        raise HTTPException(status_code=400, detail="oauth state expired")

    if payload.error:
        store.consume_provider_oauth_state(state=state_record.state)
        detail = (payload.error_description or payload.error or "").strip()
        raise HTTPException(status_code=400, detail=detail or "oauth provider returned an error")

    auth_code = (payload.code or "").strip()
    if not auth_code:
        raise HTTPException(status_code=400, detail="code is required")

    provider = _require_supported_provider(state_record.provider)
    oauth = _provider_oauth_config(provider)
    if not oauth.get("configured"):
        raise HTTPException(status_code=400, detail=f"oauth is not configured for provider '{provider}'")

    token_url = str(oauth["token_url"])
    redirect_uri = (state_record.redirect_uri or oauth.get("redirect_uri") or "").strip()
    form_payload: Dict[str, Any] = {
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": redirect_uri,
        "client_id": oauth["client_id"],
    }
    client_secret = str(oauth.get("client_secret") or "").strip()
    if client_secret:
        form_payload["client_secret"] = client_secret
    if state_record.code_verifier:
        form_payload["code_verifier"] = state_record.code_verifier

    try:
        token_response = requests.post(
            token_url,
            data=form_payload,
            timeout=25,
            headers={"Accept": "application/json"},
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"oauth token exchange failed: {exc}") from exc

    if token_response.status_code >= 400:
        snippet = (token_response.text or "")[:700]
        raise HTTPException(
            status_code=400,
            detail=f"oauth token exchange failed status={token_response.status_code}: {snippet}",
        )
    try:
        token_data = token_response.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"oauth token response invalid JSON: {exc}") from exc
    if not isinstance(token_data, dict):
        raise HTTPException(status_code=400, detail="oauth token response has unexpected shape")

    access_token = str(token_data.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=400, detail="oauth token response missing access_token")
    refresh_token = str(token_data.get("refresh_token") or "").strip()
    id_token = str(token_data.get("id_token") or "").strip()
    account_id = str(token_data.get("account_id") or "").strip()
    if provider == "codex" and not account_id:
        account_id = _resolve_codex_account_id(token_data)
    expires_at = ""
    expires_in_raw = token_data.get("expires_in")
    try:
        expires_in = int(expires_in_raw)
    except Exception:
        expires_in = 0
    if expires_in > 0:
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    secret: Dict[str, Any] = {"access_token": access_token}
    if refresh_token:
        secret["refresh_token"] = refresh_token
    if id_token:
        secret["id_token"] = id_token
    if account_id:
        secret["account_id"] = account_id
    if expires_at:
        secret["expires_at"] = expires_at

    metadata: Dict[str, Any] = {
        "token_type": str(token_data.get("token_type") or "").strip(),
        "scope": str(token_data.get("scope") or "").strip(),
        "oauth_completed_at": datetime.now(timezone.utc).isoformat(),
    }
    if isinstance(state_record.metadata, dict):
        metadata.update(state_record.metadata)

    credential = store.upsert_provider_credential(
        user_id=state_record.user_id,
        provider=provider,
        auth_mode="oauth",
        secret=secret,
        metadata=metadata,
        label="OAuth",
        status="active",
    )
    store.consume_provider_oauth_state(state=state_record.state)

    return {
        "ok": True,
        "user_id": state_record.user_id,
        "provider": provider,
        "credential": provider_credential_to_dict(credential),
    }


@app.get("/api/integrations", dependencies=[Depends(require_api_token)])
def list_integrations() -> Dict[str, Any]:
    catalog = _integration_catalog()
    return {
        "ok": True,
        "integrations": catalog,
        "default_policy": _default_integration_policy(),
    }


@app.get("/api/users/{user_id:path}/integrations", dependencies=[Depends(require_api_token)])
def list_user_integrations(user_id: str) -> Dict[str, Any]:
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")

    by_integration = {
        item.integration: item
        for item in store.list_integration_credentials(user_id=normalized_user, include_revoked=True)
    }
    catalog = [item for item in _integration_catalog() if bool(item.get("enabled", True))]
    entries: List[Dict[str, Any]] = []
    for item in catalog:
        integration = str(item.get("integration") or "").strip()
        if not integration:
            continue
        credential = by_integration.get(integration)
        entries.append(
            {
                "integration": integration,
                "display_name": item.get("display_name") or integration,
                "auth_modes": item.get("auth_modes") or ["api_key"],
                "tools": item.get("tools") or [],
                "notes": item.get("notes") or "",
                "base_url": item.get("base_url") or "",
                "oauth_configured": bool(item.get("oauth_configured")),
                "connected": bool(credential and credential.status == "active"),
                "credential": integration_credential_to_dict(credential) if credential else None,
            }
        )
    policy_record = store.get_integration_policy(user_id=normalized_user)
    effective_policy = _effective_integration_policy(normalized_user)
    return {
        "ok": True,
        "user_id": normalized_user,
        "integrations": entries,
        "policy": effective_policy,
        "stored_policy": integration_policy_to_dict(policy_record) if policy_record else None,
    }


@app.post(
    "/api/users/{user_id:path}/integrations/{integration}/connect",
    dependencies=[Depends(require_api_token)],
)
def connect_user_integration(
    user_id: str,
    integration: str,
    payload: IntegrationConnectRequest,
) -> Dict[str, Any]:
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")
    normalized_integration = _require_supported_integration(integration)
    mode = (payload.auth_mode or "api_key").strip().lower() or "api_key"
    if mode not in {"api_key", "oauth"}:
        raise HTTPException(status_code=400, detail="auth_mode must be one of: api_key, oauth")

    secret: Dict[str, Any] = {}
    if mode == "api_key":
        api_key = (payload.api_key or payload.token or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="api_key is required for auth_mode=api_key")
        secret["api_key"] = api_key
    else:
        access_token = (payload.access_token or payload.token or "").strip()
        if not access_token:
            raise HTTPException(status_code=400, detail="access_token is required for auth_mode=oauth")
        secret["access_token"] = access_token
        refresh_token = (payload.refresh_token or "").strip()
        if refresh_token:
            secret["refresh_token"] = refresh_token

    credential = store.upsert_integration_credential(
        user_id=normalized_user,
        integration=normalized_integration,
        auth_mode=mode,
        secret=secret,
        metadata=dict(payload.metadata or {}),
        label=(payload.label or "").strip() or None,
        status="active",
    )
    return {
        "ok": True,
        "user_id": normalized_user,
        "integration": normalized_integration,
        "credential": integration_credential_to_dict(credential),
    }


@app.post(
    "/api/users/{user_id:path}/integrations/{integration}/disconnect",
    dependencies=[Depends(require_api_token)],
)
def disconnect_user_integration(
    user_id: str,
    integration: str,
    payload: IntegrationDisconnectRequest,
) -> Dict[str, Any]:
    del payload
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")
    normalized_integration = _require_supported_integration(integration)
    credential = store.revoke_integration_credential(
        user_id=normalized_user,
        integration=normalized_integration,
    )
    return {
        "ok": True,
        "user_id": normalized_user,
        "integration": normalized_integration,
        "credential": integration_credential_to_dict(credential) if credential else None,
    }


@app.post(
    "/api/users/{user_id:path}/integrations/policy",
    dependencies=[Depends(require_api_token)],
)
def update_user_integration_policy(
    user_id: str,
    payload: IntegrationPolicyUpdateRequest,
) -> Dict[str, Any]:
    normalized_user = _normalized_user_id(user_id)
    if not normalized_user:
        raise HTTPException(status_code=400, detail="user_id is required")
    base_policy: Dict[str, Any] = {}
    if payload.merge:
        existing = store.get_integration_policy(user_id=normalized_user)
        if existing and isinstance(existing.policy, dict):
            base_policy = dict(existing.policy)
    base_policy.update(payload.policy if isinstance(payload.policy, dict) else {})
    normalized_policy = _normalize_integration_policy(base_policy)
    record = store.upsert_integration_policy(user_id=normalized_user, policy=normalized_policy)
    return {
        "ok": True,
        "user_id": normalized_user,
        "policy": normalized_policy,
        "stored_policy": integration_policy_to_dict(record),
    }


@app.post("/api/tasks", dependencies=[Depends(require_api_token)])
def create_task(payload: TaskCreateRequest) -> Dict[str, Any]:
    options = _merge_task_scope_options(
        base_options=dict(payload.options or {}),
        depends_on_task_ids=payload.depends_on_task_ids,
        file_claims=payload.file_claims,
        area_claims=payload.area_claims,
    )
    task_title = (payload.task_title or "").strip()
    if task_title and not str(options.get("task_title") or "").strip():
        options["task_title"] = task_title
    provider, options, failure = _select_worker_backend_for_task(
        provider_hint=payload.provider,
        instruction=payload.instruction,
        assigned_role=(payload.assigned_role or "").strip(),
        options=options,
        allow_provider_fallback=False,
    )
    if not provider:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "No suitable worker backend is configured for this task.",
                **(failure or {}),
            },
        )
    topic_scope_id = _resolve_topic_scope_id(payload)
    worker_instruction = augment_instruction_with_task_contract(
        instruction=payload.instruction,
        assigned_role=(payload.assigned_role or "").strip(),
        options=options,
    )
    task = store.create_task(
        user_id=payload.user_id.strip(),
        repo_id=payload.repo_id.strip(),
        repo_url=(payload.repo_url or "").strip() or None,
        provider=provider,
        instruction=worker_instruction,
        zulip_thread_ref=payload.zulip_thread_ref,
        options=options,
        topic_scope_id=topic_scope_id,
        assigned_worker=payload.assigned_worker,
        assigned_role=payload.assigned_role,
        assigned_by=payload.assigned_by,
        directive_id=payload.directive_id,
        plan_revision_id=payload.plan_revision_id,
    )
    coordinator.wake()
    return {"ok": True, "task": task_to_dict(task)}


@app.get("/api/topics/{topic_scope_id:path}/tasks", dependencies=[Depends(require_api_token)])
def list_topic_tasks(
    topic_scope_id: str,
    limit: int = 200,
    statuses: str = "",
    plan_scope: str = "active_preferred",
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    wanted = [item.strip().lower() for item in _parse_csv_values(statuses)]
    items, active_plan_id, all_items = _list_topic_tasks_for_view(
        scope,
        limit=limit,
        statuses=wanted,
        plan_scope=plan_scope,
    )
    counts: Dict[str, int] = {}
    for item in items:
        counts[item.status] = counts.get(item.status, 0) + 1
    all_counts: Dict[str, int] = {}
    for item in all_items:
        all_counts[item.status] = all_counts.get(item.status, 0) + 1
    return {
        "ok": True,
        "topic_scope_id": scope,
        "active_plan_revision_id": active_plan_id or None,
        "filtered_plan_revision_id": active_plan_id if str(plan_scope or "").strip().lower() != "all" and active_plan_id else None,
        "tasks": [task_to_dict(item) for item in items],
        "counts": counts,
        "all_task_count": len(all_items),
        "all_counts": all_counts,
    }


@app.get("/api/topics/{topic_scope_id:path}/worker-sessions", dependencies=[Depends(require_api_token)])
def list_topic_worker_sessions(
    topic_scope_id: str,
    limit: int = 200,
    statuses: str = "",
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    wanted = [item.strip().lower() for item in _parse_csv_values(statuses)]
    if wanted:
        items = [
            item
            for item in store.list_worker_sessions_for_topic(scope, limit=limit)
            if item.status in set(wanted)
        ]
    else:
        items = store.list_worker_sessions_for_topic(scope, limit=limit)
    return {
        "ok": True,
        "topic_scope_id": scope,
        "worker_sessions": [worker_session_to_dict(item) for item in items],
    }


@app.get("/api/worker-sessions/{worker_session_id}", dependencies=[Depends(require_api_token)])
def get_worker_session(worker_session_id: str) -> Dict[str, Any]:
    item = store.get_worker_session(worker_session_id)
    if item is None:
        raise HTTPException(status_code=404, detail="worker session not found")
    return {"ok": True, "worker_session": worker_session_to_dict(item)}


@app.post("/api/worker-sessions/{worker_session_id}/restore", dependencies=[Depends(require_api_token)])
def restore_worker_session(
    worker_session_id: str,
    payload: WorkerSessionActionRequest,
) -> Dict[str, Any]:
    item = store.get_worker_session(worker_session_id)
    if item is None:
        raise HTTPException(status_code=404, detail="worker session not found")
    source_task = store.get_task(item.task_id)
    if source_task is None:
        raise HTTPException(status_code=404, detail="source task not found")

    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
            note=payload.note,
        )
    )
    note = (payload.note or "").strip()
    options = dict(source_task.options or {})
    options["restore_worker_session_id"] = item.worker_session_id
    if note:
        options["restore_note"] = note[:500]
    if actor:
        options["restore_actor"] = actor

    if source_task.status == "running":
        raise HTTPException(status_code=409, detail="cannot restore while task is running")
    if source_task.status == "queued":
        restored_task = source_task
        coordinator.wake()
    else:
        restored_task = store.requeue_task(
            task_id=source_task.task_id,
            instruction=source_task.instruction,
            options=options,
        ) or source_task
        coordinator.wake()

    ts = store.now_iso()
    restored_session = store.upsert_worker_session_from_task(
        restored_task,
        session_status="queued",
        activity="ready",
        last_event_type="worker_session.restore",
        last_event_ts=ts,
        restored_at=ts,
        metadata_patch={
            "last_restore_note": note[:500] if note else "",
            "last_restore_actor": actor,
        },
    )
    store.append_event(
        restored_task.task_id,
        level="info",
        event_type="worker_session_restored",
        message=f"Worker session restored: {item.worker_session_id}",
        data={
            "worker_session_id": item.worker_session_id,
            "actor": actor,
            "note": note[:500] if note else "",
        },
    )

    scope = normalize_topic_scope_id(restored_task.topic_scope_id)
    if scope:
        try:
            sup_session = store.get_or_create_supervisor_session(topic_scope_id=scope, status="active")
            store.append_supervisor_event(
                topic_scope_id=scope,
                session_id=sup_session.session_id,
                kind="lifecycle.restore",
                role="assistant",
                content_md="\n".join(
                    [
                        "### Worker session restored",
                        "",
                        f"- Worker session: `{item.worker_session_id}`",
                        f"- Task: `{restored_task.task_id}`",
                        f"- Status: `{restored_task.status}`",
                    ]
                ).strip(),
                payload={
                    "worker_session_id": item.worker_session_id,
                    "task_id": restored_task.task_id,
                    "actor": actor,
                },
                author_id="supervisor",
                author_name="Supervisor",
            )
        except Exception as exc:
            logging.warning("failed to append supervisor restore event: %s", exc)

    return {
        "ok": True,
        "worker_session": worker_session_to_dict(restored_session),
        "task": task_to_dict(restored_task),
    }


@app.post("/api/worker-sessions/{worker_session_id}/cleanup", dependencies=[Depends(require_api_token)])
def cleanup_worker_session(
    worker_session_id: str,
    payload: WorkerSessionActionRequest,
) -> Dict[str, Any]:
    item = store.get_worker_session(worker_session_id)
    if item is None:
        raise HTTPException(status_code=404, detail="worker session not found")
    source_task = store.get_task(item.task_id)
    if source_task is None:
        raise HTTPException(status_code=404, detail="source task not found")

    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
            note=payload.note,
        )
    )
    note = (payload.note or "").strip()
    ts = store.now_iso()

    workspace_stopped: Optional[bool] = None
    if item.workspace_id:
        try:
            workspace_stopped = coordinator.stop_workspace_if_idle(item.workspace_id)
        except Exception as exc:
            logging.warning("worker session cleanup failed to stop workspace=%s: %s", item.workspace_id, exc)
            workspace_stopped = False

    updated_session = store.update_worker_session(
        worker_session_id=item.worker_session_id,
        last_event_type="worker_session.cleanup",
        last_event_ts=ts,
        metadata_patch={
            "cleanup_ts": ts,
            "cleanup_actor": actor,
            "cleanup_note": note[:500] if note else "",
            "workspace_stopped": workspace_stopped,
        },
    ) or item

    store.append_event(
        source_task.task_id,
        level="info",
        event_type="worker_session_cleanup",
        message=f"Worker session cleanup requested: {item.worker_session_id}",
        data={
            "worker_session_id": item.worker_session_id,
            "actor": actor,
            "note": note[:500] if note else "",
            "workspace_stopped": workspace_stopped,
        },
    )

    scope = normalize_topic_scope_id(source_task.topic_scope_id)
    if scope:
        try:
            sup_session = store.get_or_create_supervisor_session(topic_scope_id=scope, status="active")
            store.append_supervisor_event(
                topic_scope_id=scope,
                session_id=sup_session.session_id,
                kind="lifecycle.cleanup",
                role="assistant",
                content_md="\n".join(
                    [
                        "### Worker session cleanup",
                        "",
                        f"- Worker session: `{item.worker_session_id}`",
                        f"- Task: `{source_task.task_id}`",
                        f"- Workspace stopped: `{workspace_stopped}`",
                    ]
                ).strip(),
                payload={
                    "worker_session_id": item.worker_session_id,
                    "task_id": source_task.task_id,
                    "actor": actor,
                    "workspace_stopped": workspace_stopped,
                },
                author_id="supervisor",
                author_name="Supervisor",
            )
        except Exception as exc:
            logging.warning("failed to append supervisor cleanup event: %s", exc)

    return {"ok": True, "worker_session": worker_session_to_dict(updated_session)}


@app.get("/api/topics/{topic_scope_id:path}/sidebar", dependencies=[Depends(require_api_token)])
def topic_sidebar(
    topic_scope_id: str,
    limit: int = 200,
    plan_scope: str = "active_preferred",
    session_id: str = "",
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    selected_session_id = str(session_id or "").strip() or None
    session, _created = _resolve_supervisor_session(
        scope=scope,
        requested_session_id=selected_session_id,
        session_create_mode=None,
        actor_user_id=None,
        actor_name=None,
    )
    summary = _supervisor_task_summary(
        scope,
        session.session_id,
        session.metadata if isinstance(session.metadata, dict) else {},
    )
    return {
        "ok": True,
        "topic_scope_id": scope,
        "session_id": session.session_id,
        "active_plan_revision_id": summary.get("active_plan_revision_id"),
        "filtered_plan_revision_id": summary.get("filtered_plan_revision_id"),
        "task_count": int(summary.get("task_count") or 0),
        "counts": dict(summary.get("counts") or {}),
        "all_task_count": int(summary.get("all_task_count") or 0),
        "all_counts": dict(summary.get("all_counts") or {}),
        "phase": summary.get("phase"),
        "runtime_state": summary.get("runtime_state"),
        "tasks": [
            item
            for item in (summary.get("tasks") or [])[: max(1, min(int(limit or 0), 500))]
            if isinstance(item, dict)
        ],
    }


@app.get("/api/topics/{topic_scope_id:path}/events", dependencies=[Depends(require_api_token)])
def topic_events(
    topic_scope_id: str,
    after_id: int = 0,
    limit: int = 200,
    event_types: str = "",
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    wanted = _parse_csv_values(event_types)
    events = store.list_topic_events(
        scope,
        after_id=max(0, int(after_id or 0)),
        limit=limit,
        event_types=wanted,
    )
    next_after_id = int(events[-1]["id"]) if events else max(0, int(after_id or 0))
    return {"ok": True, "topic_scope_id": scope, "events": events, "next_after_id": next_after_id}


@app.get("/api/topics/{topic_scope_id:path}/supervisor/session", dependencies=[Depends(require_api_token)])
def topic_supervisor_session(
    topic_scope_id: str,
    after_id: int = 0,
    limit: int = 200,
    session_id: str = "",
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    session, _created = _resolve_supervisor_session(
        scope=scope,
        requested_session_id=session_id,
        session_create_mode=None,
        actor_user_id=None,
        actor_name=None,
    )
    events = store.list_supervisor_events(
        topic_scope_id=scope,
        session_id=session.session_id,
        after_id=max(0, int(after_id or 0)),
        limit=limit,
    )
    next_after_id = int(events[-1].id) if events else max(0, int(after_id or 0))
    return _build_supervisor_snapshot(
        scope=scope,
        session=session,
        events=events,
        next_after_id=next_after_id,
    )


@app.get(
    "/api/topics/{topic_scope_id:path}/supervisor/session/stream",
    dependencies=[Depends(require_api_token)],
)
async def stream_supervisor_session_events(
    topic_scope_id: str,
    after_id: int = 0,
    session_id: str = "",
    poll_interval_seconds: Optional[float] = None,
    heartbeat_seconds: Optional[float] = None,
):
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    selected_session_id = str(session_id or "").strip()

    poll = (
        EVENT_STREAM_POLL_SECONDS
        if poll_interval_seconds is None
        else max(0.1, float(poll_interval_seconds))
    )
    heartbeat = (
        EVENT_STREAM_HEARTBEAT_SECONDS
        if heartbeat_seconds is None
        else max(1.0, float(heartbeat_seconds))
    )

    async def event_generator():
        cursor = max(0, int(after_id or 0))
        loop = asyncio.get_running_loop()
        last_heartbeat = loop.time()
        polls_since_state = 0

        while True:
            events = store.list_supervisor_events(
                topic_scope_id=scope,
                session_id=selected_session_id or None,
                after_id=cursor,
                limit=500,
            )
            if events:
                for item in events:
                    cursor = max(cursor, int(item.id))
                    yield f"data: {json.dumps(supervisor_event_to_dict(item), ensure_ascii=True)}\n\n"
                last_heartbeat = loop.time()
            else:
                now = loop.time()
                if now - last_heartbeat >= heartbeat:
                    yield ": keepalive\n\n"
                    last_heartbeat = now

            polls_since_state += 1
            if polls_since_state >= 10:
                polls_since_state = 0
                try:
                    session, _created = _resolve_supervisor_session(
                        scope=scope,
                        requested_session_id=selected_session_id,
                        session_create_mode=None,
                        actor_user_id=None,
                        actor_name=None,
                    )
                    sessions, session_map = _build_supervisor_session_views(scope, include_session=session)
                    state_payload = {
                        "type": "session_state",
                        "session": session_map.get(session.session_id) or supervisor_session_to_dict(session),
                        "sessions": sessions,
                        "task_summary": _supervisor_task_summary(
                            scope,
                            session.session_id,
                            session.metadata if isinstance(session.metadata, dict) else {},
                        ),
                    }
                    yield f"data: {json.dumps(state_payload, ensure_ascii=True)}\n\n"
                    last_heartbeat = loop.time()
                except Exception:
                    pass

            await asyncio.sleep(poll)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/topics/{topic_scope_id:path}/supervisor/session/reset", dependencies=[Depends(require_api_token)])
def topic_supervisor_session_reset(
    topic_scope_id: str,
    payload: SupervisorSessionResetRequest,
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    session = store.reset_supervisor_session(
        topic_scope_id=scope,
        session_id=(payload.session_id or "").strip() or None,
        clear_events=bool(payload.clear_events),
    )
    events = store.list_supervisor_events(
        topic_scope_id=scope,
        session_id=session.session_id,
        after_id=0,
        limit=250,
    )
    next_after_id = int(events[-1].id) if events else 0
    return _build_supervisor_snapshot(
        scope=scope,
        session=session,
        events=events,
        next_after_id=next_after_id,
    )


@app.post("/api/topics/{topic_scope_id:path}/supervisor/message", dependencies=[Depends(require_api_token)])
def topic_supervisor_message(
    topic_scope_id: str,
    payload: SupervisorTopicMessageRequest,
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")

    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    actor_email = (payload.actor_email or payload.actor_user_id or "").strip().lower() or "unknown"
    actor_name = (payload.actor_name or payload.actor_email or payload.actor_user_id or "").strip()
    if not actor_name:
        actor_name = actor_email
    session, _session_created = _resolve_supervisor_session(
        scope=scope,
        requested_session_id=payload.session_id,
        session_create_mode=payload.session_create_mode,
        actor_user_id=actor_email,
        actor_name=actor_name,
        message=message,
        session_title=payload.session_title,
    )
    dedupe_key = (payload.client_msg_id or "").strip() or None
    if dedupe_key:
        existing = store.get_supervisor_event_by_client_msg_id(
            topic_scope_id=scope,
            client_msg_id=dedupe_key,
            session_id=session.session_id,
        )
        if existing is not None:
            events = store.list_supervisor_events(
                topic_scope_id=scope,
                session_id=session.session_id,
                after_id=max(0, existing.id - 1),
                limit=20,
            )
            response = _build_supervisor_snapshot(
                scope=scope,
                session=session,
                events=events,
                next_after_id=int(events[-1].id) if events else existing.id,
            )
            response["duplicate"] = True
            return response
    transcript = [item for item in (payload.topic_transcript or []) if isinstance(item, dict)]
    topic_ref = {
        "stream_id": payload.stream_id,
        "stream_name": (payload.stream_name or "").strip(),
        "topic": (payload.topic or "").strip(),
    }
    (
        resolved_repo_id,
        resolved_repo_url,
        resolved_repo_source,
        resolved_repo_confidence,
        resolved_repo_metadata,
    ) = _resolve_supervisor_repo(
        scope,
        user_id=actor_email,
        repo_id=payload.repo_id,
        repo_url=payload.repo_url,
        topic_ref=topic_ref,
        transcript=transcript,
    )
    runtime_paths = _topic_runtime_paths(scope)
    new_uploads = materialize_uploaded_files(
        runtime_paths,
        [
            item.model_dump()
            for item in (payload.uploaded_files or [])
            if hasattr(item, "model_dump")
        ],
    )
    runtime_context = _describe_topic_runtime(scope, session_id=session.session_id)
    if new_uploads:
        runtime_context["new_uploads"] = new_uploads

    active_plan_for_dispatch = store.get_active_plan_revision(scope, session_id=session.session_id)
    user_event = store.append_supervisor_event(
        topic_scope_id=scope,
        session_id=session.session_id,
        kind="message",
        role="user",
        content_md=message,
        author_id=actor_email,
        author_name=actor_name,
        client_msg_id=dedupe_key,
        payload={"uploaded_files": new_uploads} if new_uploads else {},
    )

    tools_context = _resolve_supervisor_tools_context(
        scope=scope,
        session_id=session.session_id,
        user_id=actor_email,
        transcript=transcript,
        topic_ref=topic_ref,
        repo_id=(payload.repo_id or "").strip(),
        repo_url=(payload.repo_url or "").strip() or None,
    )
    tools_context["runtime_context"] = runtime_context
    capability_registry = (
        tools_context.get("capability_registry")
        if isinstance(tools_context.get("capability_registry"), dict)
        else {}
    )
    latest_plan_for_runtime = next(
        iter(store.list_plan_revisions(topic_scope_id=scope, session_id=session.session_id, limit=1)),
        None,
    )
    visible_tasks_for_runtime, _runtime_plan_id, all_tasks_for_runtime = _list_topic_tasks_for_view(
        scope,
        limit=200,
        statuses=None,
        plan_scope="active_preferred",
        session_id=session.session_id,
    )
    worker_sessions_for_runtime = store.list_worker_sessions_for_topic(
        scope,
        limit=min(2000, max(200, len(all_tasks_for_runtime) * 2)),
    )
    worker_sessions_by_task_for_runtime = {
        item.task_id: item for item in worker_sessions_for_runtime
    }
    runtime_task_rows = _task_summary_rows(
        visible_tasks_for_runtime,
        worker_sessions_by_task_for_runtime,
    )
    runtime_state = build_topic_runtime_state(
        topic_scope_id=scope,
        session_id=session.session_id,
        input_payload={
            "uploads": [
                item for item in (runtime_context.get("uploads") or []) if isinstance(item, dict)
            ],
            "new_uploads": new_uploads,
            "memory_summary": str(runtime_context.get("memory_summary") or "").strip(),
            "memory_highlights": [
                str(item).strip()
                for item in (runtime_context.get("memory_highlights") or [])
                if str(item).strip()
            ],
            "repo_attachments": _topic_repo_attachment_candidates(
                scope,
                repo_id=resolved_repo_id,
                repo_url=resolved_repo_url,
            ),
            "selected_repo_id": resolved_repo_id,
            "active_plan": plan_revision_to_dict(active_plan_for_dispatch) if active_plan_for_dispatch is not None else {},
            "latest_plan": plan_revision_to_dict(latest_plan_for_runtime) if latest_plan_for_runtime is not None else {},
            "approval_granted": _runtime_approval_granted(
                dict(session.metadata or {}),
                current_plan_id=str(getattr(active_plan_for_dispatch, "plan_revision_id", "") or "").strip(),
                task_items=visible_tasks_for_runtime,
            ),
            "has_tasks": bool(visible_tasks_for_runtime),
            "worker_backends": capability_registry.get("worker_backends") or _worker_backend_catalog(),
            "integration_tools": [
                {
                    "integration": str(item.get("integration") or "").strip(),
                    "display_name": str(item.get("display_name") or "").strip(),
                    "declared_capabilities": [
                        str(tool).strip()
                        for tool in (item.get("tools") or [])
                        if str(tool).strip()
                    ],
                    "credential_source": str(item.get("credential_source") or "").strip(),
                }
                for item in (tools_context.get("connected_integrations") or [])
                if isinstance(item, dict)
            ],
            "mcp_tools": [
                item for item in (capability_registry.get("mcp") or []) if isinstance(item, dict)
            ],
            "task_clarification_questions": [
                question
                for task in visible_tasks_for_runtime
                for question in (task.clarification_questions or [])
                if str(question).strip()
            ],
            "tasks": runtime_task_rows,
            "worker_sessions": [worker_session_to_dict(item) for item in worker_sessions_for_runtime],
            "previews": [
                {"task_id": row["task_id"], "url": row["preview_url"]}
                for row in runtime_task_rows
                if str(row.get("preview_url") or "").strip()
            ],
            "artifacts": [
                {**artifact, "task_id": row["task_id"]}
                for row in runtime_task_rows
                for artifact in (row.get("artifacts") or [])
                if isinstance(artifact, dict)
            ],
            "deployments": [],
        },
    )
    tools_context["runtime_state"] = runtime_state
    if resolved_repo_id:
        try:
            store.upsert_topic_repo_binding(
                topic_scope_id=scope,
                repo_id=resolved_repo_id,
                repo_url=resolved_repo_url,
                source=resolved_repo_source,
                confidence=resolved_repo_confidence,
                metadata=resolved_repo_metadata,
            )
        except Exception as exc:
            logging.warning("failed to persist topic repo binding for %s: %s", scope, exc)
    tools_available: List[str] = [
        str(item).strip()
        for item in (tools_context.get("tools_available") or [])
        if str(item).strip()
    ]
    tools_invoked: List[str] = []
    if transcript and "zulip.query" in tools_available:
        tools_invoked.append("zulip.query")
        transcript_loaded_text = (
            f"Data access `zulip.query` attached the current topic feed "
            f"({len(transcript)} message{'' if len(transcript) == 1 else 's'}) for this turn."
        )
        store.append_supervisor_event(
            topic_scope_id=scope,
            session_id=session.session_id,
            kind="tool_call",
            role="assistant",
            content_md=transcript_loaded_text,
            author_id="supervisor-tool/zulip.query",
            author_name="Tool",
            payload={
                "tool_name": "zulip.query",
                "query_scope": "current_topic_feed",
                "topic_transcript_count": len(transcript),
                "stream_id": payload.stream_id,
                "topic": (payload.topic or "").strip(),
            },
        )
    if new_uploads:
        tools_invoked.append("workspace.uploads")
        store.append_supervisor_event(
            topic_scope_id=scope,
            session_id=session.session_id,
            kind="tool_call",
            role="assistant",
            content_md=(
                f"Topic runtime attached {len(new_uploads)} uploaded file"
                f"{'' if len(new_uploads) == 1 else 's'} for this turn."
            ),
            author_id="supervisor-tool/workspace.uploads",
            author_name="Tool",
            payload={
                "tool_name": "workspace.uploads",
                "upload_count": len(new_uploads),
                "files": new_uploads,
            },
        )

    assistant_text = ""
    assistant_kind = "assistant"
    assistant_payload: Dict[str, Any] = {"engine": "local"}
    assistant_payload["topic_transcript_count"] = len(transcript)
    assistant_payload["tools_available"] = tools_available
    assistant_payload["tools_invoked"] = tools_invoked
    assistant_payload["repo_id"] = resolved_repo_id
    assistant_payload["repo_url"] = resolved_repo_url
    assistant_payload["work_context"] = tools_context.get("work_context") or {}
    assistant_payload["session_context"] = (
        (tools_context.get("capability_registry") or {}).get("session_context")
        if isinstance(tools_context.get("capability_registry"), dict)
        else {}
    )
    assistant_payload["integration_policy"] = tools_context.get("policy") or {}
    assistant_payload["connected_integrations"] = tools_context.get("connected_integrations") or []
    assistant_payload["capability_registry"] = tools_context.get("capability_registry") or {}
    assistant_payload["tool_registry"] = tools_context.get("tool_registry") or {}
    assistant_payload["mcp_tools_inventory"] = tools_context.get("mcp_tools_inventory") or {}
    assistant_payload["mcp_repo_tools"] = tools_context.get("mcp_repo_tools") or {}
    assistant_payload["runtime_context"] = runtime_context
    assistant_payload["runtime_state"] = runtime_state
    request_checkpoint = write_checkpoint(
        paths=runtime_paths,
        session_id=session.session_id,
        stage=f"{int(user_event.id):06d}-request",
        payload={
            "topic_scope_id": scope,
            "session_id": session.session_id,
            "user_event_id": int(user_event.id),
            "message": message,
            "topic_ref": topic_ref,
            "topic_transcript_count": len(transcript),
            "uploaded_files": new_uploads,
            "runtime_context": runtime_context,
        },
    )
    assistant_payload["runtime_context"]["last_request_checkpoint"] = str(request_checkpoint)
    moltis_turn: Optional[Dict[str, Any]] = None
    live_trace_state: Dict[str, Any] = {
        "last_thinking_text": "",
        "active_tools": {},
    }

    def _append_supervisor_live_event(
        *,
        kind: str,
        content_md: str,
        payload_patch: Dict[str, Any],
        author_id: str,
        author_name: str,
    ) -> None:
        text = str(content_md or "").strip()
        if not text:
            return
        try:
            store.append_supervisor_event(
                topic_scope_id=scope,
                session_id=session.session_id,
                kind=kind,
                role="assistant",
                content_md=text,
                payload=payload_patch,
                author_id=author_id,
                author_name=author_name,
            )
        except Exception as exc:
            logging.debug("failed to append live supervisor event (%s): %s", kind, exc)

    def _on_moltis_snapshot(snapshot: Dict[str, Any]) -> None:
        if not isinstance(snapshot, dict):
            return

        run_id = str(snapshot.get("runId") or snapshot.get("run_id") or "").strip()
        thinking_text = _moltis_extract_thinking_from_peek(snapshot)
        if thinking_text:
            compact = _moltis_compact_trace_preview(thinking_text, max_chars=700)
            previous = str(live_trace_state.get("last_thinking_text") or "")
            emit = compact != previous
            # Emit smaller deltas so the UI shows richer live thinking traces.
            if emit and previous and compact.startswith(previous) and (len(compact) - len(previous)) < 24:
                emit = False
            live_trace_state["last_thinking_text"] = compact
            if emit:
                _append_supervisor_live_event(
                    kind="thinking",
                    content_md=compact,
                    payload_patch={
                        "engine": "moltis",
                        "source": "chat.peek",
                        "run_id": run_id,
                        "active": bool(snapshot.get("active")),
                    },
                    author_id="supervisor-thinking",
                    author_name="Supervisor",
                )

        previous_tools_raw = live_trace_state.get("active_tools")
        previous_tools: Dict[str, Dict[str, Any]]
        if isinstance(previous_tools_raw, dict):
            previous_tools = {
                str(key): value
                for key, value in previous_tools_raw.items()
                if isinstance(key, str) and isinstance(value, dict)
            }
        else:
            previous_tools = {}

        current_tools = _moltis_active_tool_map_from_peek(snapshot)
        started = sorted(set(current_tools) - set(previous_tools))
        finished = sorted(set(previous_tools) - set(current_tools))

        for key in started:
            item = current_tools.get(key) or {}
            tool_name = str(item.get("tool_name") or "tool").strip() or "tool"
            tool_call_id = str(item.get("tool_call_id") or "").strip()
            _append_supervisor_live_event(
                kind="tool_call",
                content_md=f"Tool `{tool_name}` is running.",
                payload_patch={
                    "engine": "moltis",
                    "source": "chat.peek",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "tool_call_id": tool_call_id,
                    "status": str(item.get("status") or "running"),
                },
                author_id=f"supervisor-tool/{tool_name}",
                author_name="Tool",
            )

        for key in finished:
            item = previous_tools.get(key) or {}
            tool_name = str(item.get("tool_name") or "tool").strip() or "tool"
            tool_call_id = str(item.get("tool_call_id") or "").strip()
            _append_supervisor_live_event(
                kind="tool_result",
                content_md=f"Tool `{tool_name}` completed.",
                payload_patch={
                    "engine": "moltis",
                    "source": "chat.peek",
                    "run_id": run_id,
                    "tool_name": tool_name,
                    "tool_call_id": tool_call_id,
                    "status": "completed",
                },
                author_id=f"supervisor-tool/{tool_name}",
                author_name="Tool",
            )

        live_trace_state["active_tools"] = current_tools

    reset_counter_raw = (session.metadata or {}).get("reset_counter") if isinstance(session.metadata, dict) else 0
    try:
        session_reset_counter = int(reset_counter_raw)
    except Exception:
        session_reset_counter = 0

    session_meta = dict(session.metadata if isinstance(session.metadata, dict) else {})
    if SUPERVISOR_ENGINE == "moltis":
        session_meta["engine"] = "moltis"
        session_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        session = (
            store.update_supervisor_session(session_id=session.session_id, metadata=session_meta)
            or session
        )

    if SUPERVISOR_ENGINE == "moltis" and MOLTIS_ENABLED:
        try:
            moltis_turn = _run_moltis_supervisor_turn(
                scope=scope,
                session_id=session.session_id,
                reset_counter=max(0, int(session_reset_counter)),
                message=message,
                transcript=transcript,
                topic_ref=topic_ref,
                tools_context=tools_context,
                on_run_snapshot=_on_moltis_snapshot,
            )
            assistant_payload["engine"] = "moltis"
            assistant_payload["moltis_session_key"] = moltis_turn.get("session_key")
            assistant_payload["moltis_run_id"] = moltis_turn.get("run_id")
            assistant_payload["moltis_queued"] = bool(moltis_turn.get("queued"))
            if moltis_turn.get("model_requested"):
                assistant_payload["moltis_model_requested"] = moltis_turn.get("model_requested")
            if moltis_turn.get("model_used"):
                assistant_payload["moltis_model_used"] = moltis_turn.get("model_used")
            completion = moltis_turn.get("completion")
            if isinstance(completion, dict):
                assistant_payload["moltis_completion"] = completion
            assistant_text = str(moltis_turn.get("assistant_text") or "").strip()

            updated_meta = dict(session.metadata if isinstance(session.metadata, dict) else {})
            updated_meta["engine"] = "moltis"
            if moltis_turn.get("session_key"):
                updated_meta["moltis_session_key"] = str(moltis_turn.get("session_key"))
            if moltis_turn.get("run_id"):
                updated_meta["moltis_last_run_id"] = str(moltis_turn.get("run_id"))
            model_used = str(moltis_turn.get("model_used") or "").strip()
            model_requested = str(moltis_turn.get("model_requested") or "").strip()
            if model_used:
                updated_meta["moltis_model"] = model_used
            elif MOLTIS_MODEL:
                updated_meta["moltis_model"] = MOLTIS_MODEL
            if model_requested:
                updated_meta["moltis_model_requested"] = model_requested
            updated_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
            session = (
                store.update_supervisor_session(session_id=session.session_id, metadata=updated_meta)
                or session
            )
        except Exception as exc:
            logging.warning("moltis supervisor turn failed for scope=%s: %s", scope, exc)
            assistant_payload["engine"] = "local_fallback"
            assistant_payload["moltis_error"] = str(exc)
    assistant_text = _strip_legacy_supervisor_control_lines(assistant_text)
    session_metadata = dict(session.metadata if isinstance(session.metadata, dict) else {})
    execution_requested = _message_requests_execution(message)
    status_requested = _message_requests_status(message)
    plan_requested = _message_requests_plan(message)
    implementation_requested = _message_requests_implementation(message)
    turn_intent = (
        "execution"
        if execution_requested
        else "plan"
        if plan_requested
        else "status"
        if status_requested
        else "chat"
    )
    assistant_payload["intent"] = turn_intent
    assistant_payload["execution_requested"] = execution_requested
    assistant_payload["planning_requested"] = plan_requested
    assistant_payload["status_requested"] = status_requested

    selected_repo_id_for_execution, selected_repo_url_for_execution, selected_repo_source, selected_repo_confidence = (
        _resolve_selected_repo_for_execution(
            runtime_state=runtime_state,
            fallback_repo_id=resolved_repo_id,
            fallback_repo_url=resolved_repo_url,
        )
    )
    if selected_repo_id_for_execution:
        assistant_payload["repo_id"] = selected_repo_id_for_execution
        assistant_payload["repo_url"] = selected_repo_url_for_execution
        assistant_payload["selected_repo"] = {
            "repo_id": selected_repo_id_for_execution,
            "repo_url": selected_repo_url_for_execution,
            "source": selected_repo_source,
            "confidence": selected_repo_confidence,
        }

    execution_blockers = [
        str(item).strip()
        for item in (runtime_state.get("execution_blockers") or [])
        if str(item).strip()
    ]
    if execution_requested:
        execution_blockers = [item for item in execution_blockers if item != "approval_required"]
    if execution_requested and implementation_requested and not selected_repo_id_for_execution:
        execution_blockers = _merge_unique_text(execution_blockers + ["repo_selection_required"])

    synthesis: Dict[str, Any] = {}
    plan_item: Optional[PlanRevisionRecord] = None
    created_plan_revision = False
    active_plan_id = str(getattr(active_plan_for_dispatch, "plan_revision_id", "") or "").strip()
    active_plan_dict = plan_revision_to_dict(active_plan_for_dispatch) if active_plan_for_dispatch is not None else {}
    active_plan_has_primary_execution = _plan_has_primary_execution_step(active_plan_dict)
    active_plan_needs_follow_up = bool(
        active_plan_for_dispatch is not None
        and _plan_completion_follow_up_required(session_metadata, active_plan_id)
    )

    if execution_requested:
        if active_plan_for_dispatch is not None and active_plan_has_primary_execution and not active_plan_needs_follow_up:
            plan_item = active_plan_for_dispatch
            synthesis = active_plan_dict
            assistant_payload["execution_plan_source"] = "active_plan"
            if _plan_revision_has_existing_tasks(scope, active_plan_id):
                assistant_payload["plan_revision_id"] = active_plan_id
                assistant_payload["execution_in_progress"] = True
                assistant_payload["execution_reason"] = "active_plan_already_running"
                if not assistant_text:
                    assistant_text = (
                        f"Execution is already active for plan `{active_plan_id}`. "
                        "Use a status request to inspect live worker state, blockers, and evidence."
                    )
        else:
            if active_plan_for_dispatch is not None:
                assistant_payload["active_plan_skip_plan_revision_id"] = active_plan_id
                assistant_payload["active_plan_skip_reason"] = (
                    "active_plan_follow_up_required"
                    if active_plan_needs_follow_up
                    else "active_plan_not_executable"
                )
            if active_plan_for_dispatch is not None:
                synthesis = _build_implementation_follow_up_plan(
                    message=message,
                    scope=scope,
                    repo_id=selected_repo_id_for_execution,
                    repo_url=selected_repo_url_for_execution,
                    active_plan=active_plan_dict,
                )
                assistant_payload["execution_plan_source"] = "implementation_follow_up_plan"
            else:
                synthesis = _derive_plan_from_topic(
                    scope,
                    PlanSynthesisRequest(
                        author_id=actor_email,
                        summary="",
                        objective=message,
                        source={"topic_transcript": transcript, "topic": topic_ref},
                        activate=False,
                    ),
                )
                assistant_payload["execution_plan_source"] = "synthesized_execution_plan"
            synthesis = _ensure_plan_has_actionable_steps(
                _sanitize_execution_plan_for_execution(
                    plan=synthesis,
                    message=message,
                    repo_id=selected_repo_id_for_execution,
                    repo_url=selected_repo_url_for_execution,
                    execution_requested=True,
                )
            )
            plan_item = _persist_supervisor_plan_revision(
                scope=scope,
                session_id=session.session_id,
                actor_email=actor_email,
                synthesis=synthesis,
            )
            created_plan_revision = True
            assistant_payload["plan_summary"] = synthesis.get("summary")
            assistant_payload["plan_revision_id"] = plan_item.plan_revision_id

        if plan_item is not None and synthesis:
            assistant_payload["plan_summary"] = synthesis.get("summary")
            assistant_payload["plan_revision_id"] = plan_item.plan_revision_id

        if not assistant_payload.get("execution_in_progress"):
            if execution_blockers:
                assistant_payload["execution_blocked"] = True
                assistant_payload["execution_reason"] = "runtime_blocked"
                blocked_text = _render_execution_blocked_markdown(
                    blockers=execution_blockers,
                    reason="Execution cannot start until the current runtime interrupts are resolved.",
                )
                if created_plan_revision and synthesis:
                    assistant_kind = "plan_draft"
                    assistant_text = "\n\n".join(
                        [
                            part
                            for part in [
                                _render_plan_markdown(synthesis, heading="Supervisor plan draft"),
                                blocked_text,
                            ]
                            if part
                        ]
                    ).strip()
                else:
                    assistant_text = "\n\n".join(
                        [part for part in [assistant_text, blocked_text] if part]
                    ).strip()
            else:
                directives = _execution_directives_from_plan(synthesis)
                if not directives:
                    assistant_payload["execution_blocked"] = True
                    assistant_payload["execution_reason"] = "no_actionable_execution_steps"
                    blocked_text = _render_execution_blocked_markdown(
                        blockers=["no_actionable_execution_steps"],
                        reason="The current plan does not contain executable worker steps.",
                    )
                    if created_plan_revision and synthesis:
                        assistant_kind = "plan_draft"
                        assistant_text = "\n\n".join(
                            [
                                part
                                for part in [
                                    _render_plan_markdown(synthesis, heading="Supervisor plan draft"),
                                    blocked_text,
                                ]
                                if part
                            ]
                        ).strip()
                    else:
                        assistant_text = "\n\n".join(
                            [part for part in [assistant_text, blocked_text] if part]
                        ).strip()
                else:
                    thread_ref: Dict[str, Any] = {}
                    if payload.stream_id is not None and payload.topic:
                        thread_ref = {
                            "message_type": "stream",
                            "stream_id": int(payload.stream_id),
                            "stream": (payload.stream_name or "").strip(),
                            "topic": (payload.topic or "").strip(),
                        }
                    execution_result = _create_worker_tasks_from_execution_steps(
                        scope=scope,
                        directives=directives,
                        task_owner=actor_email or "supervisor",
                        actor_email=actor_email,
                        repo_id=selected_repo_id_for_execution,
                        repo_url=selected_repo_url_for_execution,
                        thread_ref=thread_ref,
                        plan_revision_id=plan_item.plan_revision_id if plan_item is not None else None,
                        source_label="supervisor_execution",
                    )
                    if not execution_result.get("ok"):
                        assistant_payload["execution_blocked"] = True
                        assistant_payload["execution_reason"] = "no_executable_worker_backend"
                        assistant_payload["backend_blockers"] = execution_result.get("backend_blockers") or []
                        assistant_payload["worker_backends"] = execution_result.get("worker_backends") or []
                        blocked_lines = [
                            "### Execution blocked",
                            "",
                            "Implementation work requires an executable worker backend, but none is currently configured for one or more execution steps.",
                            "",
                            "Configured worker backends:",
                        ]
                        for item in _worker_backend_capability_summary():
                            blocked_lines.append(f"- `{item['provider']}`: {item['state']}")
                        backend_blockers = execution_result.get("backend_blockers") or []
                        if backend_blockers:
                            blocked_lines.extend(["", "Blocked steps:"])
                            for item in backend_blockers[:6]:
                                blocked_lines.append(
                                    f"- Step {item['directive_index']}: `{item['assigned_role']}` {str(item['task_title'])[:140]}"
                                )
                        blocked_lines.extend(
                            [
                                "",
                                "Configure a real executable worker backend and then approve execution again.",
                            ]
                        )
                        blocked_text = "\n".join(blocked_lines).strip()
                        if created_plan_revision and synthesis:
                            assistant_kind = "plan_draft"
                            assistant_text = "\n\n".join(
                                [
                                    part
                                    for part in [
                                        _render_plan_markdown(synthesis, heading="Supervisor plan draft"),
                                        blocked_text,
                                    ]
                                    if part
                                ]
                            ).strip()
                        else:
                            assistant_text = "\n\n".join(
                                [part for part in [assistant_text, blocked_text] if part]
                            ).strip()
                    else:
                        created_tasks = [
                            item
                            for item in (execution_result.get("tasks") or [])
                            if isinstance(item, dict)
                        ]
                        assistant_kind = "execution_result"
                        assistant_payload["tasks"] = [
                            {
                                "task_id": item["task_id"],
                                "status": item["status"],
                                "assigned_worker": item.get("assigned_worker"),
                                "assigned_role": item.get("assigned_role"),
                                "provider": item.get("provider"),
                                "depends_on_task_ids": (
                                    item.get("options", {}).get("depends_on_task_ids")
                                    if isinstance(item.get("options"), dict)
                                    else []
                                ),
                            }
                            for item in created_tasks
                        ]
                        summary_lines = [
                            f"### Execution started ({len(created_tasks)} task{'s' if len(created_tasks) != 1 else ''})",
                            "",
                            f"- Active plan: `{plan_item.plan_revision_id if plan_item is not None else 'none'}`",
                            f"- Selected repo: `{selected_repo_id_for_execution or 'none'}`",
                        ]
                        for item in created_tasks:
                            title = str(item.get("task_title") or item.get("instruction") or item["task_id"]).splitlines()[0]
                            options = item.get("options") if isinstance(item.get("options"), dict) else {}
                            dep_ids = [
                                str(dep).strip()
                                for dep in (options.get("depends_on_task_ids") or [])
                                if str(dep).strip()
                            ]
                            provider_label = str(item.get("provider") or "").strip()
                            summary_lines.append(
                                f"- `{item['task_id']}` `queued` `{item.get('assigned_role') or 'writer'}`"
                                f" provider=`{provider_label or 'n/a'}` deps=`{', '.join(dep_ids) if dep_ids else 'none'}` {title[:140]}"
                            )
                        summary_lines.append("")
                        summary_lines.append(
                            "_Live worker state, previews, PRs, and blockers are shown in the task dashboard from runtime evidence._"
                        )
                        assistant_text = "\n\n".join(
                            [part for part in [assistant_text, "\n".join(summary_lines).strip()] if part]
                        ).strip()

                        try:
                            _append_supervisor_memory(
                                title="supervisor-execution-started",
                                detail="\n".join(
                                    [
                                        f"topic_scope_id: {scope}",
                                        f"plan_revision_id: {plan_item.plan_revision_id if plan_item is not None else ''}",
                                        f"task_count: {len(created_tasks)}",
                                        f"tasks: {', '.join(item['task_id'] for item in created_tasks[:20])}",
                                    ]
                                ),
                                tags=["execution", "supervisor", "chat"],
                                actor={"user_id": actor_email, "email": actor_email},
                            )
                        except Exception as exc:
                            logging.warning("failed to append supervisor memory for execution start: %s", exc)
    elif plan_requested:
        synthesis = _ensure_plan_has_actionable_steps(
            _derive_plan_from_topic(
                scope,
                PlanSynthesisRequest(
                    author_id=actor_email,
                    summary="",
                    objective=message,
                    source={"topic_transcript": transcript, "topic": topic_ref},
                    activate=False,
                ),
            )
        )
        plan_item = _persist_supervisor_plan_revision(
            scope=scope,
            session_id=session.session_id,
            actor_email=actor_email,
            synthesis=synthesis,
        )
        created_plan_revision = True
        assistant_payload["plan_summary"] = synthesis.get("summary")
        assistant_payload["plan_revision_id"] = plan_item.plan_revision_id
        assistant_kind = "plan_draft"
        if not assistant_text:
            assistant_text = _render_plan_markdown(synthesis, heading="Supervisor plan draft")

    if not assistant_text:
        active_plan = store.get_active_plan_revision(scope, session_id=session.session_id)
        if active_plan is None:
            assistant_text = (
                "I am ready for this topic. Ask me to draft the worker topology, answer clarification prompts, "
                "or approve execution in plain language and I will start worker execution from the runtime state."
            )
        else:
            assistant_text = (
                f"I am tracking active plan `{active_plan.plan_revision_id}`. "
                "Continue here to revise the plan, answer clarifications, or approve execution."
            )

    if selected_repo_id_for_execution and (
        execution_requested or str(payload.repo_id or "").strip()
    ):
        try:
            store.upsert_topic_repo_binding(
                topic_scope_id=scope,
                repo_id=selected_repo_id_for_execution,
                repo_url=selected_repo_url_for_execution,
                source=selected_repo_source,
                confidence=selected_repo_confidence,
                metadata={},
            )
        except Exception as exc:
            logging.warning("failed to persist selected repo attachment for %s: %s", scope, exc)

    assistant_payload["response_kind"] = assistant_kind
    memory_state = update_memory_state(
        paths=runtime_paths,
        session_id=session.session_id,
        user_text=message,
        assistant_text=assistant_text,
        assistant_payload=assistant_payload,
        transcript_count=len(transcript),
        uploaded_files=[
            item for item in (runtime_context.get("uploads") or []) if isinstance(item, dict)
        ],
    )
    assistant_payload["runtime_context"]["memory_summary"] = str(memory_state.get("summary") or "").strip()
    assistant_payload["runtime_context"]["memory_highlights"] = [
        str(item).strip()
        for item in (memory_state.get("highlights") or [])
        if str(item).strip()
    ]
    session_meta = dict(session.metadata if isinstance(session.metadata, dict) else {})
    session_meta["last_assistant_kind"] = assistant_kind
    session_meta["last_execution_requested"] = bool(assistant_payload.get("execution_requested"))
    session_meta["last_execution_blocked"] = bool(assistant_payload.get("execution_blocked"))
    session_meta["last_execution_reason"] = str(assistant_payload.get("execution_reason") or "").strip()
    if assistant_payload.get("plan_revision_id"):
        session_meta["last_plan_revision_id"] = str(assistant_payload.get("plan_revision_id") or "").strip()
    if execution_requested and assistant_payload.get("plan_revision_id"):
        session_meta["approved_plan_revision_id"] = str(assistant_payload.get("plan_revision_id") or "").strip()
    if created_plan_revision and not bool(assistant_payload.get("execution_requested")):
        session_meta.pop("approved_plan_revision_id", None)
    session_meta.pop("approval_granted", None)
    if selected_repo_id_for_execution:
        session_meta["last_selected_repo_id"] = selected_repo_id_for_execution
        session_meta["last_selected_repo_url"] = selected_repo_url_for_execution or ""
    session_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    session = store.update_supervisor_session(session_id=session.session_id, metadata=session_meta) or session
    refreshed_summary = _supervisor_task_summary(
        scope,
        session.session_id,
        session.metadata if isinstance(session.metadata, dict) else {},
    )
    assistant_payload["runtime_state"] = refreshed_summary.get("runtime_state") or assistant_payload.get("runtime_state") or {}

    assistant_event = store.append_supervisor_event(
        topic_scope_id=scope,
        session_id=session.session_id,
        kind=assistant_kind,
        role="assistant",
        content_md=assistant_text,
        payload=assistant_payload,
        author_id="supervisor",
        author_name="Supervisor",
    )
    response_checkpoint = write_checkpoint(
        paths=runtime_paths,
        session_id=session.session_id,
        stage=f"{int(assistant_event.id):06d}-response",
        payload={
            "topic_scope_id": scope,
            "session_id": session.session_id,
            "assistant_event_id": int(assistant_event.id),
            "assistant_kind": assistant_kind,
            "assistant_payload": assistant_payload,
            "assistant_text": assistant_text,
            "memory_summary": str(memory_state.get("summary") or "").strip(),
        },
    )

    turn_events = store.list_supervisor_events(
        topic_scope_id=scope,
        session_id=session.session_id,
        after_id=max(0, user_event.id - 1),
        limit=80,
    )
    next_after_id = int(turn_events[-1].id) if turn_events else int(assistant_event.id)
    latest_session = store.get_or_create_supervisor_session(
        topic_scope_id=scope,
        session_id=session.session_id,
    )
    response = _build_supervisor_snapshot(
        scope=scope,
        session=latest_session,
        events=turn_events,
        next_after_id=next_after_id,
    )
    response["runtime"] = {
        **_describe_topic_runtime(scope, session_id=session.session_id),
        "last_request_checkpoint": str(request_checkpoint),
        "last_response_checkpoint": str(response_checkpoint),
        "session": response.get("session"),
    }
    return response


@app.get("/api/topics/{topic_scope_id:path}/plan/revisions", dependencies=[Depends(require_api_token)])
def list_plan_revisions(
    topic_scope_id: str,
    limit: int = 50,
    session_id: str = "",
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    items = store.list_plan_revisions(
        topic_scope_id=scope,
        session_id=str(session_id or "").strip() or None,
        limit=limit,
    )
    return {
        "ok": True,
        "topic_scope_id": scope,
        "plan_revisions": [plan_revision_to_dict(item) for item in items],
    }


@app.get("/api/topics/{topic_scope_id:path}/plan/current", dependencies=[Depends(require_api_token)])
def get_active_plan_revision(topic_scope_id: str, session_id: str = "") -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    item = store.get_active_plan_revision(scope, session_id=str(session_id or "").strip() or None)
    return {"ok": True, "topic_scope_id": scope, "plan_revision": plan_revision_to_dict(item) if item else None}


@app.post("/api/topics/{topic_scope_id:path}/plan/revisions", dependencies=[Depends(require_api_token)])
def create_plan_revision(
    topic_scope_id: str,
    payload: PlanRevisionCreateRequest,
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    status = (payload.status or "active").strip().lower()
    if status not in {"draft", "active", "superseded", "archived"}:
        raise HTTPException(status_code=400, detail="invalid plan revision status")
    item = store.create_plan_revision(
        topic_scope_id=scope,
        session_id=(payload.session_id or "").strip() or None,
        author_id=(payload.author_id or "").strip() or None,
        summary=payload.summary,
        objective=payload.objective,
        assumptions=payload.assumptions,
        unknowns=payload.unknowns,
        execution_steps=payload.execution_steps,
        candidate_parallel_seams=payload.candidate_parallel_seams,
        approval_points=payload.approval_points,
        source=payload.source,
        status=status,
        plan_revision_id=payload.plan_revision_id,
    )
    return {"ok": True, "topic_scope_id": scope, "plan_revision": plan_revision_to_dict(item)}


@app.post("/api/topics/{topic_scope_id:path}/plan/synthesize", dependencies=[Depends(require_api_token)])
def synthesize_plan_revision(
    topic_scope_id: str,
    payload: PlanSynthesisRequest,
) -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    derived = _derive_plan_from_topic(scope, payload)
    seams_raw = derived.get("candidate_parallel_seams")
    seams = (
        [item for item in seams_raw if isinstance(item, dict)]
        if isinstance(seams_raw, list)
        else []
    )
    if not seams:
        seams = _build_parallel_seams(derived["execution_steps"])
    source_obj = derived.get("source") if isinstance(derived.get("source"), dict) else {}
    synthesized = {
        "summary": derived["summary"],
        "objective": derived["objective"],
        "assumptions": derived["assumptions"],
        "unknowns": derived["unknowns"],
        "execution_steps": derived["execution_steps"],
        "candidate_parallel_seams": seams,
        "approval_points": derived["approval_points"],
        "source": source_obj,
    }
    if payload.activate:
        actor_id = (payload.author_id or "").strip() or "supervisor"
        item = store.create_plan_revision(
            topic_scope_id=scope,
            session_id=(payload.session_id or "").strip() or None,
            author_id=actor_id or None,
            summary=synthesized["summary"],
            objective=synthesized["objective"],
            assumptions=synthesized["assumptions"],
            unknowns=synthesized["unknowns"],
            execution_steps=synthesized["execution_steps"],
            candidate_parallel_seams=synthesized["candidate_parallel_seams"],
            approval_points=synthesized["approval_points"],
            source=synthesized["source"],
            status="active",
        )
        try:
            _append_supervisor_memory(
                title="plan-synthesized-activated",
                detail="\n".join(
                    [
                        f"topic_scope_id: {scope}",
                        f"plan_revision_id: {item.plan_revision_id}",
                        f"execution_steps: {len(synthesized['execution_steps'])}",
                        f"parallel_seams: {len(synthesized['candidate_parallel_seams'])}",
                        f"approval_points: {len(synthesized['approval_points'])}",
                    ]
                ),
                tags=["plan", "synthesis", "active"],
                actor={"user_id": actor_id, "email": actor_id},
            )
        except Exception as exc:
            logging.warning("failed to append supervisor memory for plan synthesis: %s", exc)
        return {
            "ok": True,
            "topic_scope_id": scope,
            "synthesized": synthesized,
            "plan_revision": plan_revision_to_dict(item),
        }
    return {"ok": True, "topic_scope_id": scope, "synthesized": synthesized}


@app.get("/api/tasks/{task_id}", dependencies=[Depends(require_api_token)])
def get_task(task_id: str) -> Dict[str, Any]:
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"ok": True, "task": task_to_dict(task)}


@app.get("/api/tasks/{task_id}/events", dependencies=[Depends(require_api_token)])
def get_task_events(
    task_id: str,
    after_id: int = 0,
    limit: int = 200,
    event_types: str = "",
) -> Dict[str, Any]:
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    wanted = [item.strip() for item in (event_types or "").split(",") if item.strip()]
    events = store.list_events(
        task_id,
        after_id=max(0, int(after_id or 0)),
        limit=limit,
        event_types=wanted,
    )
    next_after_id = int(events[-1]["id"]) if events else max(0, int(after_id or 0))
    return {
        "ok": True,
        "events": events,
        "next_after_id": next_after_id,
    }


@app.get(
    "/api/tasks/{task_id}/events/stream",
    dependencies=[Depends(require_api_token)],
)
async def stream_task_events(
    task_id: str,
    after_id: int = 0,
    poll_interval_seconds: Optional[float] = None,
    heartbeat_seconds: Optional[float] = None,
):
    task = store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    poll = (
        EVENT_STREAM_POLL_SECONDS
        if poll_interval_seconds is None
        else max(0.1, float(poll_interval_seconds))
    )
    heartbeat = (
        EVENT_STREAM_HEARTBEAT_SECONDS
        if heartbeat_seconds is None
        else max(1.0, float(heartbeat_seconds))
    )

    async def event_generator():
        cursor = max(0, int(after_id or 0))
        loop = asyncio.get_running_loop()
        last_heartbeat = loop.time()
        terminal = {"done", "failed", "canceled"}

        while True:
            events = store.list_events(task_id, after_id=cursor, limit=500)
            if events:
                for item in events:
                    cursor = max(cursor, int(item["id"]))
                    yield f"data: {json.dumps(item, ensure_ascii=True)}\n\n"
                last_heartbeat = loop.time()
            else:
                now = loop.time()
                if now - last_heartbeat >= heartbeat:
                    yield ": keepalive\n\n"
                    last_heartbeat = now

            current = store.get_task(task_id)
            if current is None:
                break
            if current.status in terminal and not events:
                break
            await asyncio.sleep(poll)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def _classify_reply_intent(message: str) -> str:
    parsed = parse_task_command(message)
    if parsed is not None and parsed.intent and parsed.intent != "unclear":
        return parsed.intent
    text = (message or "").strip().lower()
    if not text:
        return "unclear"
    if any(token in text for token in ("stop", "cancel", "abort", "kill")):
        return "cancel"
    if any(token in text for token in ("status", "progress", "update")):
        return "ask_status"
    if any(token in text for token in ("retry", "rerun", "run again", "again")):
        return "retry"
    if (
        text in {"approve", "approved", "lgtm", "ship it", "looks good"}
        or text.startswith("approve ")
    ):
        return "approve"
    return "revise"


def _build_retry_instruction(current_instruction: str, user_message: str) -> str:
    trimmed = (user_message or "").strip()
    if not trimmed:
        return current_instruction
    lower = trimmed.lower()
    if lower in {"retry", "rerun", "run again", "again", "continue", "go ahead"}:
        return current_instruction
    return (
        f"{current_instruction.rstrip()}\n\n"
        f"User follow-up:\n{trimmed}"
    ).strip()


def _spawn_followup_task(
    *,
    source_task: Any,
    message: str,
    actor: Dict[str, Any],
    reason: str,
) -> Any:
    retry_instruction = _build_retry_instruction(source_task.instruction, message)
    retry_options = dict(source_task.options or {})
    retry_options["retry_of_task_id"] = source_task.task_id
    retry_options["retry_reason"] = reason
    retry_options["chat_reply"] = message
    if actor:
        retry_options["reply_actor"] = actor
    provider, retry_options, failure = _select_worker_backend_for_task(
        provider_hint=source_task.provider,
        instruction=retry_instruction,
        assigned_role=source_task.assigned_role or "",
        options=retry_options,
        allow_provider_fallback=True,
    )
    if not provider:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "No suitable worker backend is configured for the follow-up task.",
                "source_task_id": source_task.task_id,
                **(failure or {}),
            },
        )

    spawned = store.create_task(
        user_id=source_task.user_id,
        repo_id=source_task.repo_id,
        repo_url=source_task.repo_url,
        provider=provider,
        instruction=augment_instruction_with_task_contract(
            instruction=retry_instruction,
            assigned_role=source_task.assigned_role or "",
            options=retry_options,
        ),
        zulip_thread_ref=source_task.zulip_thread_ref,
        options=retry_options,
        topic_scope_id=source_task.topic_scope_id,
        assigned_worker=source_task.assigned_worker,
        assigned_role=source_task.assigned_role,
        assigned_by=(
            str((actor or {}).get("user_id") or (actor or {}).get("email") or "").strip() or None
        ),
        directive_id=source_task.directive_id,
        plan_revision_id=source_task.plan_revision_id,
    )
    coordinator.wake()
    return spawned


@app.post("/api/tasks/{task_id}/actions/{action}", dependencies=[Depends(require_api_token)])
def task_action(task_id: str, action: str, payload: TaskActionRequest) -> Dict[str, Any]:
    current = store.get_task(task_id)
    if current is None:
        raise HTTPException(status_code=404, detail="task not found")

    action_key = (action or "").strip().lower()
    supported = {
        "cancel",
        "retry",
        "status",
        "approve",
        "pause",
        "resume",
        "mark_at_risk",
        "needs_clarification",
        "resolve_clarification",
    }
    if action_key not in supported:
        raise HTTPException(status_code=400, detail=f"unsupported action '{action_key}'")

    actor = _action_actor(payload)
    audit_data: Dict[str, Any] = {"action": action_key}
    if actor:
        audit_data["actor"] = actor
    if payload.note:
        audit_data["note"] = payload.note.strip()[:500]

    store.append_event(
        task_id,
        level="info",
        event_type="task_action_requested",
        message=f"Task action requested: {action_key}",
        data=audit_data,
    )

    if action_key == "status":
        latest = store.get_task(task_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="task not found")
        store.append_event(
            task_id,
            level="info",
            event_type="task_action_applied",
            message="Task action applied: status",
            data=audit_data,
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(latest)}

    if action_key == "cancel":
        updated = store.request_cancel(task_id)
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        coordinator.wake()
        store.append_event(
            task_id,
            level="info",
            event_type="task_action_applied",
            message="Task action applied: cancel",
            data={**audit_data, "status": updated.status},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if action_key == "approve":
        updated = store.set_task_approved(task_id)
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        updated = _release_blocked_approval_task(task_id, actor) or updated
        if payload.note:
            store.append_event(
                task_id,
                level="info",
                event_type="approval_note",
                message=payload.note.strip()[:2000],
            )
        store.append_event(
            task_id,
            level="info",
            event_type="task_action_applied",
            message="Task action applied: approve",
            data={**audit_data, "approved": True},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if action_key == "pause":
        if current.status in TERMINAL_TASK_STATUSES:
            raise HTTPException(status_code=409, detail=f"cannot pause task in status '{current.status}'")
        if current.status == "running":
            store.request_cancel(task_id)
        updated = store.set_task_status(
            task_id=task_id,
            status="paused",
            blocked_reason=(payload.note or "").strip() or None,
            clear_cancel_requested=False,
        )
        coordinator.wake()
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        store.append_event(
            task_id,
            level="info",
            event_type="task_action_applied",
            message="Task action applied: pause",
            data={**audit_data, "status": updated.status},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if action_key == "resume":
        resumable = {"paused", "stalled", "blocked_dependency", "blocked_approval", "at_risk"}
        if current.status not in resumable:
            raise HTTPException(status_code=409, detail=f"cannot resume task in status '{current.status}'")
        updated = store.set_task_status(
            task_id=task_id,
            status="queued",
            blocked_reason=None,
            clear_cancel_requested=True,
        )
        coordinator.wake()
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        store.append_event(
            task_id,
            level="info",
            event_type="task_action_applied",
            message="Task action applied: resume",
            data={**audit_data, "status": updated.status},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if action_key == "mark_at_risk":
        if current.status in TERMINAL_TASK_STATUSES:
            raise HTTPException(status_code=409, detail=f"cannot mark at risk in status '{current.status}'")
        updated = store.set_task_status(
            task_id=task_id,
            status="at_risk",
            blocked_reason=(payload.note or "").strip() or "manual at-risk mark",
            clear_cancel_requested=False,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        store.append_event(
            task_id,
            level="warning",
            event_type="task_action_applied",
            message="Task action applied: mark_at_risk",
            data={**audit_data, "status": updated.status},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if action_key == "needs_clarification":
        reason = (payload.clarification_reason or payload.note or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="clarification_reason or note is required")
        updated = store.request_clarification(
            task_id=task_id,
            reason=reason,
            questions=payload.clarification_questions,
            actor=actor or None,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        coordinator.wake()
        store.append_event(
            task_id,
            level="warning",
            event_type="task_action_applied",
            message="Task action applied: needs_clarification",
            data={**audit_data, "status": updated.status, "questions": payload.clarification_questions},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if action_key == "resolve_clarification":
        guidance = (payload.guidance or payload.note or "").strip()
        if not guidance:
            raise HTTPException(status_code=400, detail="guidance or note is required")
        updated = store.resolve_clarification(
            task_id=task_id,
            guidance=guidance,
            actor=actor or None,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        coordinator.wake()
        store.append_event(
            task_id,
            level="info",
            event_type="task_action_applied",
            message="Task action applied: resolve_clarification",
            data={**audit_data, "status": updated.status},
        )
        return {"ok": True, "action": action_key, "task": task_to_dict(updated)}

    if current.status not in TERMINAL_TASK_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"cannot retry task in status '{current.status}'",
        )

    retry_instruction = (payload.retry_instruction or current.instruction or "").strip()
    if not retry_instruction:
        raise HTTPException(status_code=400, detail="retry instruction cannot be empty")

    retry_options = dict(current.options or {})
    if payload.retry_options:
        retry_options.update(payload.retry_options)
    retry_options["retry_of_task_id"] = current.task_id
    retry_provider, retry_options, failure = _select_worker_backend_for_task(
        provider_hint=payload.retry_provider or current.provider,
        instruction=retry_instruction,
        assigned_role=current.assigned_role or "",
        options=retry_options,
        allow_provider_fallback=not bool(str(payload.retry_provider or "").strip()),
    )
    if not retry_provider:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "No suitable worker backend is configured for retry.",
                "source_task_id": current.task_id,
                **(failure or {}),
            },
        )

    spawned = store.create_task(
        user_id=current.user_id,
        repo_id=current.repo_id,
        repo_url=current.repo_url,
        provider=retry_provider,
        instruction=augment_instruction_with_task_contract(
            instruction=retry_instruction,
            assigned_role=current.assigned_role or "",
            options=retry_options,
        ),
        zulip_thread_ref=current.zulip_thread_ref,
        options=retry_options,
        topic_scope_id=current.topic_scope_id,
        assigned_worker=current.assigned_worker,
        assigned_role=current.assigned_role,
        assigned_by=(str(actor.get("user_id") or actor.get("email") or "").strip() or None),
        directive_id=current.directive_id,
        plan_revision_id=current.plan_revision_id,
    )
    coordinator.wake()

    retry_data = {**audit_data, "spawned_task_id": spawned.task_id}
    store.append_event(
        current.task_id,
        level="info",
        event_type="task_retry_spawned",
        message=f"Retry spawned as {spawned.task_id}",
        data=retry_data,
    )
    store.append_event(
        spawned.task_id,
        level="info",
        event_type="task_retry_of",
        message=f"Retry of {current.task_id}",
        data={"source_task_id": current.task_id, **({"actor": actor} if actor else {})},
    )
    store.append_event(
        current.task_id,
        level="info",
        event_type="task_action_applied",
        message="Task action applied: retry",
        data=retry_data,
    )

    return {
        "ok": True,
        "action": action_key,
        "task": task_to_dict(current),
        "spawned_task": task_to_dict(spawned),
    }


@app.post("/api/tasks/{task_id}/reply", dependencies=[Depends(require_api_token)])
def task_reply(task_id: str, payload: TaskReplyRequest) -> Dict[str, Any]:
    current = store.get_task(task_id)
    if current is None:
        raise HTTPException(status_code=404, detail="task not found")

    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="reply message cannot be empty")

    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
        )
    )
    parsed_command = parse_task_command(message)
    if parsed_command is not None and parsed_command.intent and parsed_command.intent != "unclear":
        intent = parsed_command.intent
    else:
        intent = _classify_reply_intent(message)

    store.append_event(
        task_id,
        level="info",
        event_type="chat.user",
        message=message[:4000],
        data={
            "intent": intent,
            **({"command": parsed_command.to_dict()} if parsed_command else {}),
            **({"actor": actor} if actor else {}),
        },
    )

    response: Dict[str, Any] = {
        "ok": True,
        "task_id": task_id,
        "parsed_intent": intent,
    }
    if parsed_command is not None:
        response["parsed_command"] = parsed_command.to_dict()

    if intent == "cancel":
        updated = store.request_cancel(task_id)
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        coordinator.wake()
        assistant_message = f"Stopping {task_id} now."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "cancel"},
        )
        response["action_taken"] = "cancel"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated)
        return response

    if intent == "ask_status":
        latest = store.get_task(task_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="task not found")
        latest_task = task_to_dict(latest)
        elapsed_seconds = latest_task.get("elapsed_seconds")
        assistant_message = (
            f"{task_id} is currently {latest.status}."
            + (f" Elapsed: {elapsed_seconds}s." if elapsed_seconds is not None else "")
        )
        response["action_taken"] = "status"
        response["task"] = latest_task
        response["assistant_message"] = assistant_message
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "status", "status": latest.status},
        )
        return response

    if intent == "approve":
        updated = store.set_task_approved(task_id)
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        updated = _release_blocked_approval_task(task_id, actor) or updated
        assistant_message = f"Marked {task_id} as approved."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "approve"},
        )
        response["action_taken"] = "approve"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated)
        return response

    if intent == "pause":
        latest = store.get_task(task_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="task not found")
        if latest.status in TERMINAL_TASK_STATUSES:
            raise HTTPException(status_code=409, detail=f"cannot pause task in status '{latest.status}'")
        if latest.status == "running":
            store.request_cancel(task_id)
        reason = (
            (parsed_command.argument if parsed_command else "")
            or "paused by explicit task command"
        )
        updated = store.set_task_status(
            task_id=task_id,
            status="paused",
            blocked_reason=reason,
            clear_cancel_requested=False,
        )
        coordinator.wake()
        assistant_message = f"Paused {task_id}."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "pause"},
        )
        response["action_taken"] = "pause"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated or latest)
        return response

    if intent == "resume":
        latest = store.get_task(task_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="task not found")
        resumable = {"paused", "stalled", "blocked_dependency", "blocked_approval", "blocked_information", "at_risk"}
        if latest.status not in resumable:
            raise HTTPException(status_code=409, detail=f"cannot resume task in status '{latest.status}'")
        updated = store.set_task_status(
            task_id=task_id,
            status="queued",
            blocked_reason=None,
            clear_cancel_requested=True,
        )
        coordinator.wake()
        assistant_message = f"Resumed {task_id}; queued for execution."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "resume"},
        )
        response["action_taken"] = "resume"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated or latest)
        return response

    if intent == "needs_clarification":
        reason = (
            (parsed_command.argument if parsed_command else "")
            or "additional context requested"
        )
        updated = store.request_clarification(
            task_id=task_id,
            reason=reason,
            questions=[],
            actor=actor or None,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        coordinator.wake()
        assistant_message = f"Marked {task_id} as needing clarification."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "needs_clarification"},
        )
        response["action_taken"] = "needs_clarification"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated)
        return response

    if intent == "resolve_clarification":
        guidance = (
            (parsed_command.argument if parsed_command else "")
            or message
        ).strip()
        updated = store.resolve_clarification(
            task_id=task_id,
            guidance=guidance,
            actor=actor or None,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="task not found")
        coordinator.wake()
        assistant_message = f"Resolved clarification and re-queued {task_id}."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "resolve_clarification"},
        )
        response["action_taken"] = "resolve_clarification"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated)
        return response

    latest = store.get_task(task_id)
    if latest is None:
        raise HTTPException(status_code=404, detail="task not found")

    ts = store.now_iso()
    next_instruction = (
        latest.instruction if intent == "retry" else _build_retry_instruction(latest.instruction, message)
    )
    next_options = dict(latest.options or {})
    next_options["last_chat_reply"] = message
    next_options["last_chat_reply_intent"] = intent
    next_options["last_chat_reply_ts"] = ts
    if actor:
        next_options["last_chat_reply_actor"] = actor

    if latest.status == "running":
        next_options["followup_pending"] = {
            "reason": "chat_reply",
            "intent": intent,
            "ts": ts,
            "actor": actor or {},
        }
        store.update_task_instruction_and_options(
            task_id=task_id,
            instruction=next_instruction,
            options=next_options,
        )
        canceled = store.request_cancel(task_id)
        assistant_message = (
            f"Received. Interrupting the current run and will continue in {task_id}."
        )
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "interrupt_and_requeue", "intent": intent},
        )
        response["action_taken"] = "interrupt_and_requeue"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(canceled or latest)
        return response

    if latest.status == "queued" or latest.status in TERMINAL_TASK_STATUSES:
        updated = store.requeue_task(
            task_id=task_id,
            instruction=next_instruction,
            options=next_options,
        )
        coordinator.wake()
        assistant_message = f"Queued follow-up execution for {task_id}."
        store.append_event(
            task_id,
            level="info",
            event_type="chat.assistant",
            message=assistant_message,
            data={"action": "requeued", "intent": intent},
        )
        response["action_taken"] = "requeued"
        response["assistant_message"] = assistant_message
        response["task"] = task_to_dict(updated or latest)
        return response

    assistant_message = (
        "Guidance received. I could not apply it immediately due to the current task state."
    )
    store.append_event(
        task_id,
        level="info",
        event_type="chat.assistant",
        message=assistant_message,
        data={"action": "guidance_recorded"},
    )
    response["action_taken"] = "guidance_recorded"
    response["assistant_message"] = assistant_message
    response["task"] = task_to_dict(latest)
    return response


@app.post("/api/tasks/{task_id}/needs-clarification", dependencies=[Depends(require_api_token)])
def mark_task_needs_clarification(
    task_id: str,
    payload: NeedsClarificationRequest,
) -> Dict[str, Any]:
    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
        )
    )
    updated = store.request_clarification(
        task_id=task_id,
        reason=payload.reason,
        questions=payload.questions,
        actor=actor or None,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="task not found")
    coordinator.wake()
    return {"ok": True, "task": task_to_dict(updated)}


@app.post("/api/tasks/{task_id}/resolve-clarification", dependencies=[Depends(require_api_token)])
def resolve_task_clarification(
    task_id: str,
    payload: ResolveClarificationRequest,
) -> Dict[str, Any]:
    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
        )
    )
    updated = store.resolve_clarification(
        task_id=task_id,
        guidance=payload.guidance,
        actor=actor or None,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="task not found")
    coordinator.wake()
    return {"ok": True, "task": task_to_dict(updated)}


@app.get("/api/supervisor/context", dependencies=[Depends(require_api_token)])
def supervisor_context() -> Dict[str, Any]:
    _ensure_supervisor_files()
    mcp_tools_inventory = _moltis_tools_inventory()
    mcp_repo_tools = _moltis_repo_management_tools_inventory_from_all(mcp_tools_inventory)
    integration_catalog = _integration_catalog()
    env_connected_integrations: List[Dict[str, Any]] = []
    for entry in integration_catalog:
        if not isinstance(entry, dict):
            continue
        integration = normalize_integration_id(str(entry.get("integration") or "").strip())
        if not integration:
            continue
        _token, token_source = _integration_env_token(integration)
        if not token_source:
            continue
        env_connected_integrations.append(
            {
                "integration": integration,
                "credential_source": f"env:{token_source}",
            }
        )
    legacy_mcp_migration = _legacy_integration_mcp_coverage(
        connected_integrations=env_connected_integrations,
        mcp_tools_inventory=mcp_tools_inventory,
    )
    integration_api_entries: List[Dict[str, Any]] = []
    for item in integration_catalog:
        if not isinstance(item, dict):
            continue
        integration_id = normalize_integration_id(str(item.get("integration") or "").strip())
        _token, token_source = _integration_env_token(integration_id)
        integration_api_entries.append(
            {
                "integration": integration_id,
                "display_name": str(item.get("display_name") or "").strip(),
                "tools": [str(tool).strip() for tool in (item.get("tools") or []) if str(tool).strip()],
                "enabled": bool(item.get("enabled", True)),
                "oauth_configured": bool(item.get("oauth_configured", False)),
                "credential_source": f"env:{token_source}" if token_source else "",
                "api_access_available": bool(token_source),
            }
        )

    system_capability_registry = {
        "session_context": {
            "current_topic_feed": {
                "available": True,
                "attached_messages": 0,
                "delivery": "auto_attached_each_turn",
            },
            "work_context": {
                "repo": {
                    "id": "",
                    "url": "",
                    "source": "unresolved",
                    "confidence": "low",
                }
            },
            "active_plan": {"available": False, "plan_revision_id": "", "status": ""},
            "tasks": {"total": 0, "open": 0, "running": 0, "queued": 0, "blocked": 0, "done": 0, "failed": 0},
            "runtime": {
                "available": True,
                "workspace_path": "",
                "uploads_path": "",
                "outputs_path": "",
                "checkpoints_path": "",
                "memory_summary": "",
                "upload_count": 0,
                "checkpoint_count": 0,
            },
        },
        "supervisor_actions": _controller_action_catalog(),
        "data_access": [
            {
                "id": "zulip.query",
                "source": "controller",
                "available": True,
                "mode": "read",
                "capabilities": ["current_topic_feed", "topic_history", "message_lookup"],
            },
            {
                "id": "task.query",
                "source": "controller",
                "available": True,
                "mode": "read",
                "capabilities": ["active_plan", "topic_tasks", "worker_outputs", "timeline_events"],
            },
            {
                "id": "scm.query",
                "source": "controller",
                "available": bool(
                    mcp_repo_tools.get("available")
                    or any(bool(item.get("api_access_available")) for item in integration_api_entries)
                ),
                "mode": "read",
                "capabilities": ["repo_metadata", "repo_search", "branches", "pull_requests", "ci_status"],
            },
            {
                "id": "workspace.query",
                "source": "controller",
                "available": True,
                "mode": "read",
                "capabilities": [
                    "workspaces",
                    "worktrees",
                    "artifacts",
                    "runtime_status",
                    "uploads",
                    "session_memory",
                    "checkpoints",
                ],
            },
        ],
        "worker_backends": _worker_backend_catalog(),
        "integration_api": integration_api_entries,
        "mcp": _dynamic_mcp_tool_catalog(mcp_tools_inventory),
        "runtime_features": {
            "topic_runtime": True,
            "uploads": True,
            "session_memory": True,
            "checkpoints": True,
        },
    }
    return {
        "ok": True,
        "soul": _load_supervisor_text(SUPERVISOR_SOUL_PATH, max_chars=20000),
        "memory_tail": _load_supervisor_text(SUPERVISOR_MEMORY_PATH, max_chars=30000),
        "capability_registry": system_capability_registry,
        "tool_registry": system_capability_registry,
        "mcp_tools_inventory": mcp_tools_inventory,
        "mcp_repo_tools": mcp_repo_tools,
        "legacy_mcp_migration": legacy_mcp_migration,
        "integration_catalog": integration_catalog,
        "paths": {
            "soul": str(SUPERVISOR_SOUL_PATH),
            "memory": str(SUPERVISOR_MEMORY_PATH),
            "runtime_base": str(get_runtime_paths().base_dir),
        },
    }


@app.get("/api/topics/{topic_scope_id:path}/supervisor/runtime", dependencies=[Depends(require_api_token)])
def get_topic_supervisor_runtime(topic_scope_id: str, session_id: str = "") -> Dict[str, Any]:
    scope = normalize_topic_scope_id(topic_scope_id)
    if not scope:
        raise HTTPException(status_code=400, detail="invalid topic_scope_id")
    selected_session: Optional[SupervisorSessionRecord] = None
    requested_session_id = str(session_id or "").strip()
    if requested_session_id:
        candidate = store.get_supervisor_session_by_id(requested_session_id)
        if candidate is not None and candidate.topic_scope_id == scope:
            selected_session = candidate
    if selected_session is None:
        selected_session = store.get_supervisor_session(scope)
    sessions, session_map = _build_supervisor_session_views(scope, include_session=selected_session)
    return {
        "ok": True,
        "topic_scope_id": scope,
        "session": session_map.get(selected_session.session_id) if selected_session else None,
        "sessions": sessions,
        "runtime": _describe_topic_runtime(
            scope,
            session_id=selected_session.session_id if selected_session is not None else None,
        ),
    }


@app.post("/api/supervisor/memory", dependencies=[Depends(require_api_token)])
def append_supervisor_memory(payload: SupervisorMemoryAppendRequest) -> Dict[str, Any]:
    _ensure_supervisor_files()
    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
        )
    )
    _append_supervisor_memory(
        title=payload.title,
        detail=payload.detail,
        tags=payload.tags,
        actor=actor,
    )
    return {"ok": True, "memory_path": str(SUPERVISOR_MEMORY_PATH)}


@app.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(require_api_token)])
def cancel_task(task_id: str) -> Dict[str, Any]:
    task = store.request_cancel(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    coordinator.wake()
    return {"ok": True, "task": task_to_dict(task)}


@app.post("/api/tasks/{task_id}/approve", dependencies=[Depends(require_api_token)])
def approve_task(task_id: str, payload: TaskApproveRequest) -> Dict[str, Any]:
    actor = _action_actor(
        TaskActionRequest(
            actor_user_id=payload.actor_user_id,
            actor_email=payload.actor_email,
        )
    )
    task = store.set_task_approved(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    task = _release_blocked_approval_task(task_id, actor) or task
    if payload.note:
        store.append_event(
            task_id,
            level="info",
            event_type="approval_note",
            message=payload.note.strip()[:2000],
        )
    return {"ok": True, "task": task_to_dict(task)}


@app.post("/api/workspaces/prestart", dependencies=[Depends(require_api_token)])
def prestart_workspaces(payload: PrestartRequest) -> Dict[str, Any]:
    items = payload.items or []
    results = []
    for item in items:
        try:
            status = coordinator.prestart_workspace(
                user_id=item.user_id,
                repo_id=item.repo_id,
                repo_url=item.repo_url,
            )
            results.append({
                "user_id": item.user_id,
                "repo_id": item.repo_id,
                "ok": True,
                "status": status,
            })
        except Exception as exc:
            results.append(
                {
                    "user_id": item.user_id,
                    "repo_id": item.repo_id,
                    "ok": False,
                    "error": str(exc),
                }
            )
    return {"ok": True, "results": results}


@app.get("/api/admin/prestart/status", dependencies=[Depends(require_api_token)])
def prestart_status() -> Dict[str, Any]:
    return {"ok": True, "prestart": prestart_scheduler.status()}


@app.post("/api/admin/prestart/run", dependencies=[Depends(require_api_token)])
def prestart_run_now() -> Dict[str, Any]:
    result = prestart_scheduler.run_now()
    return {"ok": True, "prestart": prestart_scheduler.status(), "run": result}


@app.post(
    "/api/workspaces/{workspace_id}/stop-if-idle",
    dependencies=[Depends(require_api_token)],
)
def stop_workspace_if_idle(workspace_id: str) -> Dict[str, Any]:
    try:
        stopped = coordinator.stop_workspace_if_idle(workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "workspace_id": workspace_id, "stopped": stopped}


@app.get("/api/workspaces", dependencies=[Depends(require_api_token)])
def list_workspaces(scope: str = "") -> Dict[str, Any]:
    normalized_scope = (scope or "").strip().lower()
    if normalized_scope not in {"", "repo", "user_repo", "all"}:
        raise HTTPException(status_code=400, detail="scope must be one of: repo,user_repo,all")

    effective_scope = normalized_scope
    if effective_scope == "":
        effective_scope = coordinator.workspace_scope
    if effective_scope == "all":
        effective_scope = ""

    items = [workspace_to_dict(item) for item in store.list_workspace_mappings(scope=effective_scope)]
    return {"ok": True, "scope": (effective_scope or "all"), "workspaces": items}
