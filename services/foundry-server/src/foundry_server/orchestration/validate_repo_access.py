#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests


@dataclass
class Check:
    status: str
    name: str
    detail: str


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = _env(name)
        if value:
            return value
    return default


def _forgejo_api_base() -> str:
    explicit = _env("FORGEJO_API_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    base = _env_first("FORGEJO_BASE_URL", "FORGEJO_URL")
    if base:
        return f"{base.rstrip('/')}/api/v1"
    return ""


def _repo_provider(repo_url: str) -> str:
    host = urlparse(repo_url).hostname or ""
    if host.endswith("github.com"):
        return "github"
    return "forgejo"


def _print_checks(checks: List[Check]) -> None:
    for check in checks:
        print(f"[{check.status}] {check.name}: {check.detail}")


def _orchestrator_headers(token: str) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _check_orchestrator_context(
    *,
    orchestrator_url: str,
    token: str,
    require_supervisor_repo_tool: bool,
) -> List[Check]:
    checks: List[Check] = []
    if not orchestrator_url:
        checks.append(Check("WARN", "orchestrator context", "ORCHESTRATOR_URL not set; skipping orchestrator checks"))
        return checks

    url = f"{orchestrator_url.rstrip('/')}/api/supervisor/context"
    try:
        response = requests.get(url, headers=_orchestrator_headers(token), timeout=10)
    except requests.RequestException as exc:
        checks.append(Check("FAIL", "orchestrator context", f"{url} not reachable: {exc}"))
        return checks

    if response.status_code != 200:
        checks.append(
            Check(
                "FAIL",
                "orchestrator context",
                f"{url} returned {response.status_code}: {response.text[:200]}",
            )
        )
        return checks

    payload = response.json()
    capability_registry = payload.get("capability_registry") if isinstance(payload, dict) else {}
    if not isinstance(capability_registry, dict):
        capability_registry = {}

    data_access = capability_registry.get("data_access") if isinstance(capability_registry.get("data_access"), list) else []
    scm_query = next(
        (
            item
            for item in data_access
            if isinstance(item, dict) and str(item.get("id") or "").strip() == "scm.query"
        ),
        None,
    )
    if scm_query:
        checks.append(
            Check(
                "PASS" if scm_query.get("available") else "WARN",
                "scm.query advertised",
                f"available={bool(scm_query.get('available'))}",
            )
        )
    else:
        checks.append(Check("FAIL", "scm.query advertised", "missing from capability_registry.data_access"))

    mcp_repo_tools = payload.get("mcp_repo_tools") if isinstance(payload, dict) else {}
    if not isinstance(mcp_repo_tools, dict):
        mcp_repo_tools = {}
    mcp_available = bool(mcp_repo_tools.get("available"))
    if mcp_available:
        checks.append(Check("PASS", "supervisor repo tool", "repo_management MCP tools are visible to Moltis"))
    else:
        status = "FAIL" if require_supervisor_repo_tool else "WARN"
        reason = str(mcp_repo_tools.get("reason") or "repo_management MCP not detected")
        checks.append(
            Check(
                status,
                "supervisor repo tool",
                f"{reason}; supervisor can plan from metadata but cannot inspect repo contents directly",
            )
        )

    integration_catalog = payload.get("integration_catalog") if isinstance(payload, dict) else {}
    if not isinstance(integration_catalog, list):
        integration_catalog = []
    forgejo_entry = next(
        (
            item
            for item in integration_catalog
            if isinstance(item, dict) and str(item.get("integration") or "").strip() == "forgejo"
        ),
        None,
    )
    if forgejo_entry:
        checks.append(
            Check(
                "PASS" if forgejo_entry.get("api_access_available") else "WARN",
                "controller Forgejo API access",
                f"api_access_available={bool(forgejo_entry.get('api_access_available'))}",
            )
        )
    else:
        checks.append(Check("WARN", "controller Forgejo API access", "forgejo integration not present in catalog"))

    return checks


def _check_forgejo_api() -> Optional[Check]:
    api_base = _forgejo_api_base()
    token = _env_first("FORGEJO_API_KEY", "FORGEJO_TOKEN")
    if not api_base or not token:
        return Check(
            "WARN",
            "Forgejo API probe",
            "FORGEJO_API_BASE_URL/FORGEJO_BASE_URL/FORGEJO_URL or FORGEJO_API_KEY/FORGEJO_TOKEN not set",
        )

    try:
        response = requests.get(
            f"{api_base}/user",
            headers={"Authorization": f"token {token}", "Accept": "application/json"},
            timeout=10,
        )
    except requests.RequestException as exc:
        return Check("FAIL", "Forgejo API probe", f"{api_base}/user not reachable: {exc}")

    if response.status_code != 200:
        return Check("FAIL", "Forgejo API probe", f"{api_base}/user returned {response.status_code}: {response.text[:200]}")

    data = response.json() if response.content else {}
    login = ""
    if isinstance(data, dict):
        login = str(data.get("login") or "").strip()
    return Check("PASS", "Forgejo API probe", f"authenticated as {login or '(unknown user)'}")


def _check_git_remote(repo_url: str) -> Check:
    try:
        result = subprocess.run(
            ["git", "ls-remote", repo_url, "HEAD"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except FileNotFoundError:
        return Check("FAIL", "git remote probe", "git is not installed in this runtime")
    except subprocess.TimeoutExpired:
        return Check("FAIL", "git remote probe", f"git ls-remote timed out for {repo_url}")

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        return Check("FAIL", "git remote probe", detail[0] if detail else f"git ls-remote failed for {repo_url}")

    return Check("PASS", "git remote probe", f"git ls-remote succeeded for {repo_url}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate supervisor/controller/worker repo access for private repositories."
    )
    parser.add_argument("--repo-url", default=_env("REPO_ACCESS_TEST_URL"))
    parser.add_argument("--orchestrator-url", default=_env("ORCHESTRATOR_URL", "http://127.0.0.1:18090"))
    parser.add_argument("--orchestrator-token", default=_env("ORCHESTRATOR_API_TOKEN"))
    parser.add_argument("--skip-git", action="store_true")
    parser.add_argument("--skip-orchestrator", action="store_true")
    parser.add_argument("--skip-forgejo-api", action="store_true")
    parser.add_argument("--require-supervisor-repo-tool", action="store_true")
    args = parser.parse_args()

    checks: List[Check] = []
    if not args.skip_orchestrator:
        checks.extend(
            _check_orchestrator_context(
                orchestrator_url=args.orchestrator_url,
                token=args.orchestrator_token,
                require_supervisor_repo_tool=args.require_supervisor_repo_tool,
            )
        )

    provider = _repo_provider(args.repo_url) if args.repo_url else "forgejo"
    if not args.skip_forgejo_api and provider == "forgejo":
        checks.append(_check_forgejo_api())

    if args.repo_url and not args.skip_git:
        checks.append(_check_git_remote(args.repo_url))
    elif not args.repo_url and not args.skip_git:
        checks.append(Check("WARN", "git remote probe", "--repo-url not provided; skipping git connectivity check"))

    _print_checks(checks)
    return 1 if any(check.status == "FAIL" for check in checks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
