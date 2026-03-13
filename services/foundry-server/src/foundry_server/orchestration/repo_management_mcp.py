import argparse
import base64
import json
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
from mcp.server.fastmcp import FastMCP

REPO_CACHE_DIR = Path(os.getenv("REPO_MCP_CACHE_DIR", "/repos")).expanduser().resolve()
REPO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
REPO_SYNC_SECONDS = max(0.0, float(os.getenv("REPO_MCP_SYNC_SECONDS", "60")))
MAX_READ_LINES = max(50, int(os.getenv("REPO_MCP_MAX_READ_LINES", "400")))
MAX_READ_CHARS = max(2000, int(os.getenv("REPO_MCP_MAX_READ_CHARS", "40000")))
MAX_SEARCH_RESULTS = max(10, int(os.getenv("REPO_MCP_MAX_SEARCH_RESULTS", "100")))
MAX_DIFF_LINES = max(100, int(os.getenv("REPO_MCP_MAX_DIFF_LINES", "800")))
REQUEST_TIMEOUT_SECONDS = max(1.0, float(os.getenv("REPO_MCP_REQUEST_TIMEOUT_SECONDS", "20")))
GIT_TIMEOUT_SECONDS = max(10.0, float(os.getenv("REPO_MCP_GIT_TIMEOUT_SECONDS", "180")))

FORGEJO_URL = (
    os.getenv("FORGEJO_URL", "").strip()
    or os.getenv("FORGEJO_BASE_URL", "").strip()
)
FORGEJO_API_BASE_URL = (
    os.getenv("FORGEJO_API_BASE_URL", "").strip()
    or (FORGEJO_URL.rstrip("/") + "/api/v1" if FORGEJO_URL else "")
)
FORGEJO_TOKEN = os.getenv("FORGEJO_API_KEY", "").strip() or os.getenv("FORGEJO_TOKEN", "").strip()
FORGEJO_USERNAME = os.getenv("FORGEJO_USERNAME", "").strip()

GITHUB_BASE_URL = os.getenv("GITHUB_BASE_URL", "https://github.com").strip()
GITHUB_API_BASE_URL = os.getenv("GITHUB_API_BASE_URL", "https://api.github.com").strip()
GITHUB_TOKEN = os.getenv("GITHUB_API_KEY", "").strip() or os.getenv("GITHUB_TOKEN", "").strip()

_REPO_LOCKS: Dict[str, threading.Lock] = {}
_LAST_SYNC_AT: Dict[str, float] = {}


class RepoManagementError(RuntimeError):
    pass


@dataclass(frozen=True)
class RepoSpec:
    provider: str
    host: str
    owner: str
    name: str
    web_url: str
    clone_url: str

    @property
    def repo_id(self) -> str:
        return f"{self.host}/{self.owner}/{self.name}"

    @property
    def cache_key(self) -> str:
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", f"{self.host}-{self.owner}-{self.name}")
        return f"{slug}.git"

    @property
    def api_repo_path(self) -> str:
        return f"repos/{self.owner}/{self.name}"



def _normalized_host(base_url: str) -> str:
    if not base_url:
        return ""
    parsed = urlparse(base_url if "://" in base_url else f"https://{base_url}")
    return (parsed.netloc or parsed.path or "").strip().lower()


FORGEJO_HOST = _normalized_host(FORGEJO_URL or FORGEJO_API_BASE_URL)
GITHUB_HOST = _normalized_host(GITHUB_BASE_URL) or "github.com"


@lru_cache(maxsize=1)
def _forgejo_login() -> str:
    if FORGEJO_USERNAME:
        return FORGEJO_USERNAME
    if not (FORGEJO_API_BASE_URL and FORGEJO_TOKEN):
        raise RepoManagementError("Forgejo login is unavailable because FORGEJO token/base URL is not configured")
    response = requests.get(
        f"{FORGEJO_API_BASE_URL.rstrip('/')}/user",
        headers={"Authorization": f"token {FORGEJO_TOKEN}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    login = str(payload.get("login") or "").strip()
    if not login:
        raise RepoManagementError("Forgejo API did not return a login for the configured token")
    return login


@lru_cache(maxsize=128)
def _repo_metadata_cached(repo_id: str) -> Dict[str, Any]:
    spec = _resolve_repo(repo_id)
    base_url = ""
    headers: Dict[str, str] = {"Accept": "application/json"}
    if spec.provider == "forgejo":
        base_url = FORGEJO_API_BASE_URL.rstrip("/")
        if FORGEJO_TOKEN:
            headers["Authorization"] = f"token {FORGEJO_TOKEN}"
    elif spec.provider == "github":
        base_url = GITHUB_API_BASE_URL.rstrip("/")
        if GITHUB_TOKEN:
            headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    else:
        return {}
    if not base_url:
        return {}
    response = requests.get(
        f"{base_url}/{spec.api_repo_path}",
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    if response.status_code == 404:
        raise RepoManagementError(f"repository not found via {spec.provider} API: {spec.repo_id}")
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


@lru_cache(maxsize=128)
def _pull_request_list_cached(repo_id: str, state: str, limit: int) -> List[Dict[str, Any]]:
    spec = _resolve_repo(repo_id)
    base_url = ""
    headers: Dict[str, str] = {"Accept": "application/json"}
    params = {"state": state, "limit": str(limit)}
    if spec.provider == "forgejo":
        if not FORGEJO_API_BASE_URL:
            raise RepoManagementError("Forgejo API base URL is not configured")
        base_url = FORGEJO_API_BASE_URL.rstrip("/")
        if FORGEJO_TOKEN:
            headers["Authorization"] = f"token {FORGEJO_TOKEN}"
    elif spec.provider == "github":
        base_url = GITHUB_API_BASE_URL.rstrip("/")
        if GITHUB_TOKEN:
            headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
        params["per_page"] = params.pop("limit")
    else:
        raise RepoManagementError(f"pull request listing is not supported for provider '{spec.provider}'")

    response = requests.get(
        f"{base_url}/{spec.api_repo_path}/pulls",
        headers=headers,
        params=params,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, list) else []



def _lock_for_repo(spec: RepoSpec) -> threading.Lock:
    lock = _REPO_LOCKS.get(spec.cache_key)
    if lock is None:
        lock = threading.Lock()
        _REPO_LOCKS[spec.cache_key] = lock
    return lock



def _resolve_repo(repo: str) -> RepoSpec:
    raw = str(repo or "").strip()
    if not raw:
        raise RepoManagementError("repo is required")

    scheme = "https"
    host = ""
    path = ""
    if "://" in raw:
        parsed = urlparse(raw)
        scheme = parsed.scheme or "https"
        host = (parsed.netloc or "").strip().lower()
        path = parsed.path
    else:
        parts = [part for part in raw.strip("/").split("/") if part]
        if len(parts) >= 3 and "." in parts[0]:
            host = parts[0].strip().lower()
            path = "/" + "/".join(parts[1:])
        elif len(parts) == 2:
            if FORGEJO_HOST:
                host = FORGEJO_HOST
                path = "/" + raw.strip("/")
            else:
                host = GITHUB_HOST
                path = "/" + raw.strip("/")
        else:
            raise RepoManagementError(
                "repo must be a full URL, host/owner/name, or owner/name when a default host is configured"
            )

    segments = [segment for segment in path.strip("/").split("/") if segment]
    if len(segments) < 2:
        raise RepoManagementError(f"repo path is invalid: {raw}")
    owner = segments[0]
    name = re.sub(r"\.git$", "", segments[1])
    if not owner or not name:
        raise RepoManagementError(f"repo path is invalid: {raw}")

    provider = "generic"
    if host == FORGEJO_HOST and FORGEJO_HOST:
        provider = "forgejo"
        web_base = FORGEJO_URL.rstrip("/") if FORGEJO_URL else f"{scheme}://{host}"
    elif host == GITHUB_HOST:
        provider = "github"
        web_base = GITHUB_BASE_URL.rstrip("/") if GITHUB_BASE_URL else f"{scheme}://{host}"
    else:
        web_base = f"{scheme}://{host}"

    web_url = f"{web_base}/{owner}/{name}"
    clone_url = f"{web_url}.git"
    return RepoSpec(provider=provider, host=host, owner=owner, name=name, web_url=web_url, clone_url=clone_url)



def _repo_dir(spec: RepoSpec) -> Path:
    return REPO_CACHE_DIR / spec.cache_key



def _git_auth_args(spec: RepoSpec) -> List[str]:
    if spec.provider == "forgejo" and FORGEJO_TOKEN:
        username = _forgejo_login()
        token = FORGEJO_TOKEN
    elif spec.provider == "github" and GITHUB_TOKEN:
        username = "x-access-token"
        token = GITHUB_TOKEN
    else:
        return []
    basic = base64.b64encode(f"{username}:{token}".encode("utf-8")).decode("ascii")
    return ["-c", f"http.extraheader=Authorization: Basic {basic}"]



def _redacted_git_command(args: List[str]) -> str:
    redacted: List[str] = []
    for arg in args:
        if arg.startswith("http.extraheader=Authorization:"):
            redacted.append("http.extraheader=<redacted>")
        else:
            redacted.append(arg)
    return " ".join(redacted)



def _run_git(args: List[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ["git", *args],
        text=True,
        capture_output=True,
        timeout=GIT_TIMEOUT_SECONDS,
    )
    if check and completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "git command failed").strip()
        raise RepoManagementError(f"git command failed ({_redacted_git_command(['git', *args])}): {stderr}")
    return completed



def _sync_repo(spec: RepoSpec, *, force: bool = False) -> Path:
    repo_dir = _repo_dir(spec)
    with _lock_for_repo(spec):
        now = time.time()
        last_sync = float(_LAST_SYNC_AT.get(spec.cache_key) or 0.0)
        if repo_dir.exists() and not force and (now - last_sync) < REPO_SYNC_SECONDS:
            return repo_dir

        auth_args = _git_auth_args(spec)
        if not repo_dir.exists():
            REPO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            _run_git([*auth_args, "clone", "--mirror", spec.clone_url, str(repo_dir)])
        else:
            _run_git(["--git-dir", str(repo_dir), "config", "remote.origin.url", spec.clone_url])
            _run_git([*auth_args, "--git-dir", str(repo_dir), "fetch", "--prune", "--tags", "origin"])
        _LAST_SYNC_AT[spec.cache_key] = now
        return repo_dir



def _git_repo(args: List[str], spec: RepoSpec) -> str:
    repo_dir = _sync_repo(spec)
    completed = _run_git(["--git-dir", str(repo_dir), *args])
    return completed.stdout



def _assert_relative_repo_path(path: str) -> str:
    normalized = str(path or "").strip().lstrip("./")
    if normalized.startswith("/") or normalized.startswith("../") or "/../" in normalized:
        raise RepoManagementError("path must be repo-relative")
    return normalized



def _default_branch(spec: RepoSpec) -> str:
    metadata = _repo_metadata_cached(spec.repo_id)
    branch = str(metadata.get("default_branch") or "").strip()
    if branch:
        return branch
    try:
        head_ref = _git_repo(["symbolic-ref", "HEAD"], spec).strip()
        if head_ref.startswith("refs/heads/"):
            return head_ref.removeprefix("refs/heads/")
    except RepoManagementError:
        pass
    return "HEAD"



def _effective_ref(spec: RepoSpec, ref: str) -> str:
    value = str(ref or "HEAD").strip()
    if value in {"", "HEAD", "default"}:
        branch = _default_branch(spec)
        return branch if branch != "HEAD" else "HEAD"
    return value



def _truncate_text(text: str, *, max_lines: int, max_chars: int) -> Dict[str, Any]:
    lines = text.splitlines()
    truncated = False
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        truncated = True
    output = "\n".join(lines)
    if len(output) > max_chars:
        output = output[:max_chars]
        truncated = True
    return {"text": output, "truncated": truncated}



def _parse_grep_output(raw: str, *, limit: int) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for line in raw.splitlines():
        if len(results) >= limit:
            break
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        path, line_number, content = parts
        try:
            line_no = int(line_number)
        except ValueError:
            continue
        results.append({"path": path, "line": line_no, "preview": content})
    return results



def _parse_log_output(raw: str) -> List[Dict[str, Any]]:
    commits: List[Dict[str, Any]] = []
    for line in raw.splitlines():
        sha, author, authored_at, subject = (line.split("\x1f", 3) + [""] * 4)[:4]
        if not sha:
            continue
        commits.append(
            {
                "sha": sha,
                "author": author,
                "authored_at": authored_at,
                "subject": subject,
            }
        )
    return commits



def _parse_branch_output(raw: str) -> List[Dict[str, Any]]:
    branches: List[Dict[str, Any]] = []
    for line in raw.splitlines():
        name, sha, committed_at, subject = (line.split("\t", 3) + [""] * 4)[:4]
        if not name:
            continue
        branches.append(
            {
                "name": name,
                "sha": sha,
                "committed_at": committed_at,
                "subject": subject,
            }
        )
    return branches


def _search_repositories(provider: str, query: str, limit: int) -> List[Dict[str, Any]]:
    needle = str(query or "").strip()
    if not needle:
        raise RepoManagementError("query is required")
    requested = str(provider or "auto").strip().lower() or "auto"
    providers = [requested]
    if requested == "auto":
        providers = []
        if FORGEJO_API_BASE_URL or FORGEJO_URL:
            providers.append("forgejo")
        if GITHUB_API_BASE_URL or GITHUB_BASE_URL:
            providers.append("github")
    max_limit = max(1, min(int(limit or 10), 25))
    out: List[Dict[str, Any]] = []
    for provider_id in providers:
        if provider_id == "forgejo":
            if not FORGEJO_API_BASE_URL:
                continue
            headers = {"Accept": "application/json"}
            if FORGEJO_TOKEN:
                headers["Authorization"] = f"token {FORGEJO_TOKEN}"
            response = requests.get(
                f"{FORGEJO_API_BASE_URL.rstrip('/')}/repos/search",
                params={"q": needle, "limit": str(max_limit)},
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            payload = response.json()
            items = payload.get("data") if isinstance(payload, dict) else []
        elif provider_id == "github":
            headers = {"Accept": "application/json"}
            if GITHUB_TOKEN:
                headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
            response = requests.get(
                f"{GITHUB_API_BASE_URL.rstrip('/')}/search/repositories",
                params={"q": needle, "per_page": str(max_limit)},
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            payload = response.json()
            items = payload.get("items") if isinstance(payload, dict) else []
        else:
            continue
        if not isinstance(items, list):
            continue
        for item in items[:max_limit]:
            if not isinstance(item, dict):
                continue
            full_name = str(item.get("full_name") or "").strip()
            if not full_name:
                continue
            out.append(
                {
                    "repo": full_name,
                    "provider": provider_id,
                    "name": str(item.get("name") or "").strip(),
                    "web_url": str(item.get("html_url") or item.get("web_url") or "").strip(),
                    "clone_url": str(item.get("clone_url") or "").strip(),
                    "default_branch": str(item.get("default_branch") or "").strip(),
                    "language": str(item.get("language") or "").strip(),
                    "private": bool(item.get("private")),
                }
            )
    return out



def build_server(host: str, port: int) -> FastMCP:
    server = FastMCP(
        name="repo_management",
        instructions=(
            "Inspect Git repositories using cached mirrors and Forgejo/GitHub APIs. "
            "Use full repo URLs when available; owner/name also works when a default host is configured."
        ),
        host=host,
        port=port,
        sse_path="/mcp",
        streamable_http_path="/mcp",
        message_path="/messages/",
        mount_path="/",
        json_response=False,
        stateless_http=True,
    )

    @server.tool(name="repo_overview", description="Resolve a repository, sync its mirror, and return summary metadata.")
    def repo_overview(repo: str, ref: str = "HEAD") -> Dict[str, Any]:
        spec = _resolve_repo(repo)
        _sync_repo(spec)
        effective_ref = _effective_ref(spec, ref)
        head_sha = _git_repo(["rev-parse", effective_ref], spec).strip()
        metadata = _repo_metadata_cached(spec.repo_id)
        branch_rows = _git_repo(
            [
                "for-each-ref",
                "--count=20",
                "--format=%(refname:short)\t%(objectname)\t%(committerdate:iso8601)\t%(subject)",
                "refs/heads",
            ],
            spec,
        )
        return {
            "repo": spec.repo_id,
            "provider": spec.provider,
            "web_url": spec.web_url,
            "clone_url": spec.clone_url,
            "default_branch": _default_branch(spec),
            "effective_ref": effective_ref,
            "head_sha": head_sha,
            "private": metadata.get("private"),
            "description": metadata.get("description"),
            "open_issues": metadata.get("open_issues_count") or metadata.get("open_issues"),
            "branches": _parse_branch_output(branch_rows),
        }

    @server.tool(
        name="repo_search_repositories",
        description="Search Forgejo/GitHub for repositories by name or keyword.",
    )
    def repo_search_repositories(query: str, provider: str = "auto", limit: int = 10) -> Dict[str, Any]:
        return {
            "query": str(query or "").strip(),
            "provider": str(provider or "auto").strip().lower() or "auto",
            "results": _search_repositories(provider, query, limit),
        }

    @server.tool(name="repo_list_files", description="List files or directories in a repository tree.")
    def repo_list_files(
        repo: str,
        path: str = "",
        ref: str = "HEAD",
        recursive: bool = False,
        max_entries: int = 200,
    ) -> Dict[str, Any]:
        spec = _resolve_repo(repo)
        effective_ref = _effective_ref(spec, ref)
        repo_path = _assert_relative_repo_path(path)
        args = ["ls-tree", "--name-only"]
        if recursive:
            args.append("-r")
        args.append(effective_ref)
        if repo_path:
            args.extend(["--", repo_path])
        rows = [line for line in _git_repo(args, spec).splitlines() if line.strip()]
        limited = rows[: max(1, min(max_entries, 1000))]
        return {
            "repo": spec.repo_id,
            "ref": effective_ref,
            "path": repo_path,
            "recursive": recursive,
            "total_entries": len(rows),
            "entries": limited,
            "truncated": len(limited) < len(rows),
        }

    @server.tool(name="repo_read_file", description="Read a text file from a repository at a given ref.")
    def repo_read_file(
        repo: str,
        path: str,
        ref: str = "HEAD",
        start_line: int = 1,
        end_line: int = 0,
    ) -> Dict[str, Any]:
        spec = _resolve_repo(repo)
        effective_ref = _effective_ref(spec, ref)
        repo_path = _assert_relative_repo_path(path)
        raw = _git_repo(["show", f"{effective_ref}:{repo_path}"], spec)
        lines = raw.splitlines()
        total_lines = len(lines)
        start = max(1, int(start_line or 1))
        end = int(end_line or 0)
        if end <= 0:
            end = min(total_lines, start + MAX_READ_LINES - 1)
        if end < start:
            raise RepoManagementError("end_line must be greater than or equal to start_line")
        selected = lines[start - 1 : end]
        payload = _truncate_text("\n".join(selected), max_lines=MAX_READ_LINES, max_chars=MAX_READ_CHARS)
        return {
            "repo": spec.repo_id,
            "ref": effective_ref,
            "path": repo_path,
            "start_line": start,
            "end_line": min(end, total_lines),
            "total_lines": total_lines,
            "content": payload["text"],
            "truncated": bool(payload["truncated"]),
        }

    @server.tool(name="repo_search", description="Search a repository using git grep.")
    def repo_search(
        repo: str,
        query: str,
        ref: str = "HEAD",
        pathspec: str = "",
        regexp: bool = False,
        max_results: int = 50,
    ) -> Dict[str, Any]:
        needle = str(query or "").strip()
        if not needle:
            raise RepoManagementError("query is required")
        spec = _resolve_repo(repo)
        effective_ref = _effective_ref(spec, ref)
        safe_pathspec = _assert_relative_repo_path(pathspec)
        limit = max(1, min(int(max_results or 50), MAX_SEARCH_RESULTS))
        args = ["grep", "-n", "-I"]
        if not regexp:
            args.append("-F")
        args.extend([needle, effective_ref])
        if safe_pathspec:
            args.extend(["--", safe_pathspec])
        completed = _run_git(["--git-dir", str(_sync_repo(spec)), *args], check=False)
        if completed.returncode not in {0, 1}:
            stderr = (completed.stderr or completed.stdout or "git grep failed").strip()
            raise RepoManagementError(stderr)
        results = _parse_grep_output(completed.stdout or "", limit=limit)
        return {
            "repo": spec.repo_id,
            "ref": effective_ref,
            "query": needle,
            "regexp": regexp,
            "pathspec": safe_pathspec,
            "results": results,
            "truncated": len(results) >= limit,
        }

    @server.tool(name="repo_log", description="Return recent commits for a repository ref.")
    def repo_log(repo: str, ref: str = "HEAD", max_count: int = 20) -> Dict[str, Any]:
        spec = _resolve_repo(repo)
        effective_ref = _effective_ref(spec, ref)
        count = max(1, min(int(max_count or 20), 100))
        raw = _git_repo(
            [
                "log",
                f"--max-count={count}",
                "--date=iso-strict",
                "--format=%H%x1f%an%x1f%ad%x1f%s",
                effective_ref,
            ],
            spec,
        )
        return {
            "repo": spec.repo_id,
            "ref": effective_ref,
            "commits": _parse_log_output(raw),
        }

    @server.tool(name="repo_diff", description="Show a diff between two refs in a repository.")
    def repo_diff(
        repo: str,
        base: str,
        head: str = "HEAD",
        path: str = "",
        context_lines: int = 3,
    ) -> Dict[str, Any]:
        base_ref = str(base or "").strip()
        if not base_ref:
            raise RepoManagementError("base is required")
        spec = _resolve_repo(repo)
        head_ref = _effective_ref(spec, head)
        safe_path = _assert_relative_repo_path(path)
        context = max(0, min(int(context_lines or 3), 20))
        args = ["diff", f"--unified={context}", base_ref, head_ref]
        if safe_path:
            args.extend(["--", safe_path])
        raw = _git_repo(args, spec)
        payload = _truncate_text(raw, max_lines=MAX_DIFF_LINES, max_chars=MAX_READ_CHARS)
        return {
            "repo": spec.repo_id,
            "base": base_ref,
            "head": head_ref,
            "path": safe_path,
            "diff": payload["text"],
            "truncated": bool(payload["truncated"]),
        }

    @server.tool(name="repo_list_pull_requests", description="List pull requests for a repository via Forgejo/GitHub API.")
    def repo_list_pull_requests(repo: str, state: str = "open", limit: int = 20) -> Dict[str, Any]:
        spec = _resolve_repo(repo)
        requested_state = str(state or "open").strip().lower() or "open"
        max_limit = max(1, min(int(limit or 20), 100))
        pulls = _pull_request_list_cached(spec.repo_id, requested_state, max_limit)
        items: List[Dict[str, Any]] = []
        for pr in pulls[:max_limit]:
            if not isinstance(pr, dict):
                continue
            items.append(
                {
                    "number": pr.get("number"),
                    "title": pr.get("title"),
                    "state": pr.get("state"),
                    "draft": pr.get("draft"),
                    "html_url": pr.get("html_url"),
                    "created_at": pr.get("created_at"),
                    "updated_at": pr.get("updated_at"),
                    "head": ((pr.get("head") or {}).get("ref") if isinstance(pr.get("head"), dict) else None),
                    "base": ((pr.get("base") or {}).get("ref") if isinstance(pr.get("base"), dict) else None),
                    "user": ((pr.get("user") or {}).get("login") if isinstance(pr.get("user"), dict) else None),
                }
            )
        return {
            "repo": spec.repo_id,
            "state": requested_state,
            "pull_requests": items,
        }

    return server



def main() -> None:
    parser = argparse.ArgumentParser(description="Repo management MCP server")
    parser.add_argument("--transport", choices=["stdio", "sse", "streamable-http"], default=os.getenv("REPO_MCP_TRANSPORT", "sse"))
    parser.add_argument("--host", default=os.getenv("REPO_MCP_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("REPO_MCP_PORT", "8001")))
    args = parser.parse_args()
    server = build_server(host=args.host, port=args.port)
    server.run(transport=args.transport)


if __name__ == "__main__":
    main()
