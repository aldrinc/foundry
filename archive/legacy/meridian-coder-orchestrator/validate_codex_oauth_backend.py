#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import os
import subprocess
import tempfile
import textwrap
from pathlib import Path


def _run(cmd: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd is not None else None,
        check=True,
        capture_output=True,
        text=True,
    )


def _seed_remote_repo(root: Path) -> Path:
    remote = root / "remote.git"
    seed = root / "seed"

    _run(["git", "init", "--bare", str(remote)])
    _run(["git", "init", str(seed)])
    (seed / "README.md").write_text("seed\n", encoding="utf-8")
    _run(["git", "-C", str(seed), "config", "user.name", "Smoke"])
    _run(["git", "-C", str(seed), "config", "user.email", "smoke@example.com"])
    _run(["git", "-C", str(seed), "add", "README.md"])
    _run(["git", "-C", str(seed), "commit", "-m", "seed"])
    _run(["git", "-C", str(seed), "branch", "-M", "main"])
    _run(["git", "-C", str(seed), "remote", "add", "origin", str(remote)])
    _run(["git", "-C", str(seed), "push", "-u", "origin", "main"])
    return remote


def _configure_env(root: Path) -> None:
    os.environ["RUN_STORE_PATH"] = str(root / "orchestrator.db")
    os.environ["SUPERVISOR_ENGINE"] = "local"
    os.environ["MOLTIS_ENABLED"] = "0"
    os.environ["MOLTIS_BASE_URL"] = ""
    os.environ["ORCHESTRATOR_API_TOKEN"] = ""
    os.environ["EXECUTION_BACKEND"] = "local"
    os.environ["CODER_BASE_URL"] = ""
    os.environ["CODER_API_TOKEN"] = ""
    os.environ["WORKSPACE_SCOPE"] = "task"
    os.environ["DEFAULT_PROVIDER"] = "codex"
    os.environ["SUPERVISOR_DEFAULT_WORKER_PROVIDER"] = "codex"
    os.environ["CODEX_COMMAND"] = (
        "codex exec --dangerously-bypass-approvals-and-sandbox {quoted_instruction}"
    )
    os.environ["CODEX_API_ENABLED"] = "true"
    os.environ["OPENCODE_API_ENABLED"] = "false"
    os.environ["LOCAL_WORK_ROOT"] = str(root / "local-work")
    os.environ["OPENAI_API_KEY"] = "service-api-key-should-not-leak"


def _oauth_secret(*, account_id: str) -> dict[str, str]:
    return {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "id_token": "header.payload.sig",
        "account_id": account_id,
    }


def _probe_web_oauth_configuration(app_module):
    default_config = app_module._provider_oauth_config("codex")
    if default_config.get("configured"):
        raise RuntimeError("codex web oauth should not be configured from built-in defaults alone")
    if default_config.get("configured_source"):
        raise RuntimeError("unexpected configured_source for default codex oauth config")
    auth_modes = app_module._provider_supported_auth_modes("codex")
    if "oauth" not in auth_modes:
        raise RuntimeError("codex should still advertise oauth capability when web oauth is unconfigured")

    prior_env = {
        "CODEX_OAUTH_AUTHORIZE_URL": os.environ.get("CODEX_OAUTH_AUTHORIZE_URL"),
        "CODEX_OAUTH_TOKEN_URL": os.environ.get("CODEX_OAUTH_TOKEN_URL"),
        "CODEX_OAUTH_CLIENT_ID": os.environ.get("CODEX_OAUTH_CLIENT_ID"),
    }
    try:
        os.environ["CODEX_OAUTH_AUTHORIZE_URL"] = "https://auth.example.com/oauth/authorize"
        os.environ["CODEX_OAUTH_TOKEN_URL"] = "https://auth.example.com/oauth/token"
        os.environ["CODEX_OAUTH_CLIENT_ID"] = "example-client-id"
        reloaded = importlib.reload(app_module)
        env_config = reloaded._provider_oauth_config("codex")
        if not env_config.get("configured"):
            raise RuntimeError("explicit CODEX_OAUTH_* envs should configure codex web oauth")
        if env_config.get("configured_source") != "env":
            raise RuntimeError("expected env configured_source for explicit codex oauth envs")
    finally:
        for key, value in prior_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        app_module = importlib.reload(app_module)

    return {
        "default_configured": bool(default_config.get("configured")),
        "default_configured_source": str(default_config.get("configured_source") or ""),
        "auth_modes": auth_modes,
    }, app_module


def _claim_task(app_module, task):
    branch = app_module.coordinator._branch_name(task)
    worktree_path = app_module.coordinator._worktree_path(task)
    workspace_id = app_module.coordinator._local_workspace_id(task.repo_id)
    workspace_name = app_module.coordinator._workspace_name(task.repo_id)
    claimed = app_module.store.claim_task(
        task_id=task.task_id,
        worker_id="probe-worker",
        workspace_id=workspace_id,
        workspace_name=workspace_name,
        branch_name=branch,
        worktree_path=worktree_path,
        container_name="probe-container",
        container_runtime="local-cli",
    )
    if not claimed:
        raise RuntimeError("failed to claim task")
    claimed_task = app_module.store.get_task(task.task_id)
    if claimed_task is None:
        raise RuntimeError("claimed task missing")
    return claimed_task


def _probe_auth_bootstrap(app_module, *, user_id: str) -> dict[str, object]:
    app_module.store.upsert_provider_credential(
        user_id=user_id,
        provider="codex",
        auth_mode="oauth",
        secret=_oauth_secret(account_id="acct_bootstrap"),
        metadata={"provider": "codex"},
    )
    task = app_module.store.create_task(
        user_id=user_id,
        repo_id="meridian/codex-oauth-bootstrap",
        repo_url="https://example.invalid/bootstrap.git",
        provider="codex",
        instruction="noop",
        zulip_thread_ref={},
        options={},
        topic_scope_id="stream:test:topic:codex-oauth-bootstrap",
    )

    env, credential_source = app_module.coordinator._provider_command_env(
        task=task,
        provider="codex",
    )
    auth_home = Path(env["CODEX_HOME"])
    auth_path = auth_home / "auth.json"
    if credential_source != "user.oauth":
        raise RuntimeError(f"unexpected credential source: {credential_source}")
    if env.get("MERIDIAN_PROVIDER_AUTH_MODE") != "oauth":
        raise RuntimeError("oauth auth mode missing from env")
    if "OPENAI_API_KEY" in env:
        raise RuntimeError("OPENAI_API_KEY should be removed for codex oauth env")
    if not auth_path.exists():
        raise RuntimeError("expected CODEX_HOME/auth.json to exist")

    payload = json.loads(auth_path.read_text(encoding="utf-8"))
    if payload.get("auth_mode") != "chatgpt":
        raise RuntimeError(f"unexpected auth_mode: {payload.get('auth_mode')}")
    for key, expected in _oauth_secret(account_id="acct_bootstrap").items():
        if payload.get("tokens", {}).get(key) != expected:
            raise RuntimeError(f"{key} missing from auth.json")

    app_module.coordinator._ensure_provider_cli_auth(task=task, provider="codex", env=env)
    events = app_module.store.list_events(
        task.task_id,
        limit=20,
        event_types=["provider_cli_auth"],
    )
    messages = [event["message"] for event in events]
    if not any("Prepared task-scoped Codex ChatGPT OAuth session" in message for message in messages):
        raise RuntimeError("expected provider_cli_auth event for oauth bootstrap")

    return {
        "task_id": task.task_id,
        "codex_home": str(auth_home),
        "provider_cli_auth_events": messages,
    }


def _build_cli_probe_worker(path: Path) -> None:
    path.write_text(
        textwrap.dedent(
            """\
            #!/bin/sh
            set -eu
            if [ -z "${CODEX_HOME:-}" ]; then
              echo 'missing CODEX_HOME'
              exit 1
            fi
            if [ ! -f "$CODEX_HOME/auth.json" ]; then
              echo 'missing auth.json'
              exit 1
            fi
            python - <<'PY'
            import json
            import os
            from pathlib import Path

            payload = json.loads((Path(os.environ["CODEX_HOME"]) / "auth.json").read_text())
            print("oauth-mode=" + str(payload.get("auth_mode")))
            print("account=" + str(payload.get("tokens", {}).get("account_id")))
            print("model=" + str(os.environ.get("MERIDIAN_PROVIDER_MODEL", "")))
            PY
            """
        ),
        encoding="utf-8",
    )
    path.chmod(0o755)


def _probe_cli_fallback(app_module, *, user_id: str, remote: Path, worker_path: Path) -> dict[str, object]:
    app_module.store.upsert_provider_credential(
        user_id=user_id,
        provider="codex",
        auth_mode="oauth",
        secret=_oauth_secret(account_id="acct_cli_fallback"),
    )
    app_module.coordinator.provider_commands["codex"] = str(worker_path)

    task = app_module.store.create_task(
        user_id=user_id,
        repo_id="meridian/codex-cli-fallback",
        repo_url=str(remote),
        provider="codex",
        instruction="Describe the session.",
        zulip_thread_ref={},
        options={"model": "gpt-5.3-codex"},
        topic_scope_id="stream:test:topic:codex-cli-fallback",
        assigned_worker="writer-1",
        assigned_role="writer",
        assigned_by="probe",
    )
    claimed_task = _claim_task(app_module, task)
    result = app_module.coordinator._execute_local(claimed_task)
    summary = result.summary
    if "oauth-mode=chatgpt" not in summary:
        raise RuntimeError(f"expected CLI worker output in summary, got: {summary!r}")
    if "account=acct_cli_fallback" not in summary:
        raise RuntimeError("expected account id from task-scoped auth file in CLI worker output")
    if "model=gpt-5.3-codex" not in summary:
        raise RuntimeError("expected model override in CLI worker output")

    events = app_module.store.list_events(task.task_id, limit=50)
    command_events = [event for event in events if event["event_type"] == "provider_command"]
    if not command_events:
        raise RuntimeError("expected provider_command event proving CLI path execution")

    return {
        "task_id": task.task_id,
        "summary": summary,
        "provider_command_count": len(command_events),
    }


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="meridian-codex-oauth-"))
    remote = _seed_remote_repo(root)
    worker_path = root / "codex-worker.sh"
    _build_cli_probe_worker(worker_path)
    _configure_env(root)

    app_module = importlib.import_module("app")
    user_id = "oauth@example.com"

    web_oauth_result, app_module = _probe_web_oauth_configuration(app_module)

    injected = app_module.coordinator._inject_provider_model_flag(
        command="codex exec --dangerously-bypass-approvals-and-sandbox 'noop'",
        provider="codex",
        model="gpt-5.3-codex",
    )
    if " -m " not in injected or "gpt-5.3-codex" not in injected:
        raise RuntimeError("expected codex command model override to be injected")

    bootstrap_result = _probe_auth_bootstrap(app_module, user_id=user_id)
    cli_fallback_result = _probe_cli_fallback(
        app_module,
        user_id=user_id,
        remote=remote,
        worker_path=worker_path,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "web_oauth_config": web_oauth_result,
                "command_injection": injected,
                "bootstrap": bootstrap_result,
                "cli_fallback": cli_fallback_result,
            }
        )
    )


if __name__ == "__main__":
    main()
