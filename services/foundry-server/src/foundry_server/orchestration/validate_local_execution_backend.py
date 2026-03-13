#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
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


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="meridian-local-exec-"))
    remote = root / "remote.git"
    seed = root / "seed"
    db_path = root / "orchestrator.db"
    local_root = root / "local-work"
    worker = root / "worker.sh"
    verify = root / "verify"

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

    worker.write_text(
        textwrap.dedent(
            """\
            #!/bin/sh
            set -eu
            printf 'worker running in %s\n' "$PWD"
            if [ -f README.md ]; then
              echo 'smoke change' >> README.md
              git status --short
              git add README.md
              git commit -m 'smoke worker change'
              git push -u origin HEAD
            else
              echo 'scratch workspace ok' > scratch.txt
              git status --short || true
            fi
            """
        ),
        encoding="utf-8",
    )
    worker.chmod(0o755)

    os.environ["RUN_STORE_PATH"] = str(db_path)
    os.environ["SUPERVISOR_ENGINE"] = "local"
    os.environ["MOLTIS_ENABLED"] = "0"
    os.environ["MOLTIS_BASE_URL"] = ""
    os.environ["ORCHESTRATOR_API_TOKEN"] = ""
    os.environ["EXECUTION_BACKEND"] = "local"
    os.environ["CODER_BASE_URL"] = ""
    os.environ["CODER_API_TOKEN"] = ""
    os.environ["WORKSPACE_SCOPE"] = "task"
    os.environ["MERIDIAN_DEFAULT_REPO_ID"] = ""
    os.environ["DEFAULT_PROVIDER"] = "codex"
    os.environ["SUPERVISOR_DEFAULT_WORKER_PROVIDER"] = "codex"
    os.environ["CODEX_COMMAND"] = str(worker)
    os.environ["CODEX_API_ENABLED"] = "false"
    os.environ["OPENCODE_API_ENABLED"] = "false"
    os.environ["LOCAL_WORK_ROOT"] = str(local_root)

    package_root = Path(__file__).resolve().parents[2]
    if str(package_root) not in sys.path:
        sys.path.insert(0, str(package_root))
    importlib.invalidate_caches()
    app = importlib.import_module("foundry_server.orchestration.app")

    shared_options = {
        "assigned_role": "read_only",
        "file_claims": ["README.md"],
        "task_title": "Inspect README claims",
    }
    shared_task = app.store.create_task(
        user_id="smoke@example.com",
        repo_id="meridian/runtime-smoke",
        repo_url=str(remote),
        provider="codex",
        instruction="Inspect README usage without modifying files.",
        zulip_thread_ref={},
        options=shared_options,
        topic_scope_id="stream_id:1:topic:claim-smoke",
        assigned_worker="helper-read-1",
        assigned_role="read_only",
        assigned_by="smoke",
    )
    shared_claimed = app.store.claim_task(
        task_id=shared_task.task_id,
        worker_id="claims-worker",
        workspace_id="claims-workspace",
        workspace_name="claims-workspace",
        branch_name=app.coordinator._branch_name(shared_task),
        worktree_path=str(local_root / "claims" / "running"),
        container_name="claims-container",
        container_runtime="local-cli",
    )
    if not shared_claimed:
        raise RuntimeError("failed to claim shared read_only task")
    candidate_shared_task = app.store.create_task(
        user_id="smoke@example.com",
        repo_id="meridian/runtime-smoke",
        repo_url=str(remote),
        provider="codex",
        instruction="Verify README references without modifying files.",
        zulip_thread_ref={},
        options={
            "assigned_role": "verify",
            "file_claims": ["README.md"],
            "task_title": "Verify shared README claims",
        },
        topic_scope_id="stream_id:1:topic:claim-smoke",
        assigned_worker="helper-verify-1",
        assigned_role="verify",
        assigned_by="smoke",
    )
    shared_conflicts = app.store.find_claim_conflicts(candidate_shared_task)
    if shared_conflicts.get("conflict"):
        raise RuntimeError(f"expected shared read_only/verify claims to coexist, got {shared_conflicts}")

    options = {
        "assigned_role": "writer",
        "requires_executable_backend": True,
        "requires_repo_output": True,
        "requires_verification": True,
        "task_contract": {
            "delivery_type": "implementation",
            "requires_repo_output": True,
            "requires_verification": True,
            "required_artifacts": ["code_changes", "verification_results", "branch_or_pr"],
        },
    }
    instruction = app.augment_instruction_with_task_contract(
        instruction="Implement a smoke-test README change and push the branch.",
        assigned_role="writer",
        options=options,
    )
    task = app.store.create_task(
        user_id="smoke@example.com",
        repo_id="meridian/runtime-smoke",
        repo_url=str(remote),
        provider="codex",
        instruction=instruction,
        zulip_thread_ref={},
        options=options,
        topic_scope_id="stream_id:1:topic:runtime-smoke",
        assigned_worker="writer-1",
        assigned_role="writer",
        assigned_by="smoke",
    )
    mirror_path = app.coordinator._local_mirror_path(task)
    mirror_path.parent.mkdir(parents=True, exist_ok=True)
    _run(["git", "clone", "--mirror", str(remote), str(mirror_path)])
    _run(
        [
            "git",
            "--git-dir",
            str(mirror_path),
            "symbolic-ref",
            "HEAD",
            "refs/heads/does-not-exist",
        ]
    )
    branch = app.coordinator._branch_name(task)
    worktree_path = app.coordinator._worktree_path(task)
    workspace_id = app.coordinator._local_workspace_id(task.repo_id)
    workspace_name = app.coordinator._workspace_name(task.repo_id)
    claimed = app.store.claim_task(
        task_id=task.task_id,
        worker_id="smoke-worker",
        workspace_id=workspace_id,
        workspace_name=workspace_name,
        branch_name=branch,
        worktree_path=worktree_path,
        container_name="smoke-container",
        container_runtime="local-cli",
    )
    if not claimed:
        raise RuntimeError("failed to claim smoke task")
    claimed_task = app.store.get_task(task.task_id)
    if claimed_task is None:
        raise RuntimeError("claimed task missing")

    result = app.coordinator._execute_local(claimed_task)
    pushed = _run(["git", "ls-remote", str(remote), f"refs/heads/{branch}"])
    _run(["git", "clone", "--branch", branch, str(remote), str(verify)])
    readme = (verify / "README.md").read_text(encoding="utf-8")
    if not pushed.stdout.strip():
        raise RuntimeError("branch was not pushed to origin")
    if "smoke change" not in readme:
        raise RuntimeError("expected smoke change was not present in cloned branch")

    scratch_task = app.store.create_task(
        user_id="smoke@example.com",
        repo_id="",
        repo_url=None,
        provider="codex",
        instruction="Create a local repo bootstrap workspace and record proof of execution.",
        zulip_thread_ref={},
        options={
            "assigned_role": "writer",
            "requires_executable_backend": True,
            "task_title": "Bootstrap scratch workspace",
        },
        topic_scope_id="stream_id:1:topic:scratch-smoke",
        assigned_worker="writer-2",
        assigned_role="writer",
        assigned_by="smoke",
    )
    scratch_branch = app.coordinator._branch_name(scratch_task)
    scratch_worktree_path = app.coordinator._worktree_path(scratch_task)
    scratch_workspace_id = app.coordinator._local_workspace_id(scratch_task.repo_id)
    scratch_workspace_name = app.coordinator._workspace_name(scratch_task)
    scratch_claimed = app.store.claim_task(
        task_id=scratch_task.task_id,
        worker_id="scratch-worker",
        workspace_id=scratch_workspace_id,
        workspace_name=scratch_workspace_name,
        branch_name=scratch_branch,
        worktree_path=scratch_worktree_path,
        container_name="scratch-container",
        container_runtime="local-cli",
    )
    if not scratch_claimed:
        raise RuntimeError("failed to claim scratch smoke task")
    claimed_scratch_task = app.store.get_task(scratch_task.task_id)
    if claimed_scratch_task is None:
        raise RuntimeError("claimed scratch task missing")
    scratch_result = app.coordinator._execute_local(claimed_scratch_task)
    scratch_file = Path(scratch_worktree_path) / "scratch.txt"
    if not scratch_file.exists():
        raise RuntimeError("repo-less scratch workspace did not execute in a writable local directory")
    if "scratch workspace ok" not in scratch_file.read_text(encoding="utf-8"):
        raise RuntimeError("repo-less scratch workspace did not persist expected proof output")

    print(
        json.dumps(
            {
                "ok": True,
                "task_id": task.task_id,
                "branch": branch,
                "worktree_path": worktree_path,
                "scratch_worktree_path": scratch_worktree_path,
                "shared_claims_ok": True,
                "scratch_workspace_ok": True,
                "stale_mirror_head_recovered": True,
                "summary_tail": result.summary.splitlines()[-6:],
                "scratch_summary_tail": scratch_result.summary.splitlines()[-6:],
            }
        )
    )


if __name__ == "__main__":
    main()
