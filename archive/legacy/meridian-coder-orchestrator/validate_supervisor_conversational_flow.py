#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import textwrap
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi.testclient import TestClient


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str


def _encode_scope(scope: str) -> str:
    return quote(scope, safe="")


def _assert(condition: bool, detail: str) -> None:
    if not condition:
        raise RuntimeError(detail)


def _find_event(events: List[Dict[str, Any]], kind: str) -> Optional[Dict[str, Any]]:
    wanted = kind.strip().lower()
    for event in reversed(events):
        if str(event.get("kind") or "").strip().lower() == wanted:
            return event
    return None


def _latest_event(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not events:
        raise RuntimeError("expected at least one supervisor event")
    last = events[-1]
    if not isinstance(last, dict):
        raise RuntimeError("latest event is not a dict")
    return last


def _extract_runtime_projection(payload: Dict[str, Any]) -> Dict[str, Any]:
    runtime_projection = payload.get("runtime_projection")
    if isinstance(runtime_projection, dict) and runtime_projection:
        return runtime_projection

    session = payload.get("session")
    if isinstance(session, dict):
        runtime_state = session.get("runtime_state")
        if isinstance(runtime_state, dict) and runtime_state:
            return runtime_state

    task_summary = payload.get("task_summary")
    if isinstance(task_summary, dict):
        runtime_state = task_summary.get("runtime_state")
        if isinstance(runtime_state, dict) and runtime_state:
            return runtime_state

    return {}


def _api_get(client: TestClient, path: str, *, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    resp = client.get(path, params=params or {})
    if resp.status_code != 200:
        raise RuntimeError(f"GET {path} failed status={resp.status_code} body={resp.text[:400]}")
    data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"GET {path} returned non-dict payload")
    return data


def _api_post(client: TestClient, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    resp = client.post(path, json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"POST {path} failed status={resp.status_code} body={resp.text[:500]}")
    data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"POST {path} returned non-dict payload")
    return data


def _fake_moltis_turn(
    *,
    scope: str,
    session_id: str,
    reset_counter: int,
    message: str,
    transcript: List[Dict[str, Any]],
    topic_ref: Dict[str, Any],
    tools_context: Dict[str, Any],
    on_run_snapshot: Any = None,
) -> Dict[str, Any]:
    del transcript, topic_ref, tools_context, on_run_snapshot

    lower_message = " ".join(str(message or "").strip().lower().split())
    if any(marker in lower_message for marker in ("status", "progress", "what is running", "what's running")):
        body = textwrap.dedent(
            """
            ### Supervisor status

            - Runtime state is authoritative.
            - Use the active plan plus worker evidence to decide what happens next.
            """
        ).strip()
        run_label = "status"
    elif any(
        marker in lower_message
        for marker in ("go ahead", "implement", "execute", "begin work", "start work", "ship")
    ):
        body = "Proceed with the approved execution plan and report real repo evidence."
        run_label = "execution"
    else:
        body = "I will keep the current plan aligned with the topic."
        run_label = "chat"

    return {
        "assistant_text": body,
        "session_key": f"validation:{scope}:{session_id}:{reset_counter}",
        "run_id": f"run_validation_{run_label}",
        "queued": False,
        "model_requested": "validation-model",
        "model_used": "validation-model",
        "completion": {"ok": True, "active": False},
    }


def _load_app_module():
    module_dir = Path(__file__).resolve().parent
    if str(module_dir) not in sys.path:
        sys.path.insert(0, str(module_dir))

    for name in [
        "app",
        "store",
        "executor",
        "orchestrator_policy",
        "supervisor_runtime.thread_state",
    ]:
        sys.modules.pop(name, None)

    importlib.invalidate_caches()
    return importlib.import_module("app")


def _configure_validation_env(temp_dir: str) -> None:
    db_path = Path(temp_dir) / "orchestrator.db"
    runtime_dir = Path(temp_dir) / "supervisor-runtime"

    os.environ["RUN_STORE_PATH"] = str(db_path)
    os.environ["SUPERVISOR_RUNTIME_DIR"] = str(runtime_dir)
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
    os.environ["CODEX_COMMAND"] = "printf 'codex-command-ready\\n'"
    os.environ["CODEX_API_ENABLED"] = "false"
    os.environ["OPENCODE_API_ENABLED"] = "true"
    os.environ["OPENCODE_API_KEY"] = "validation-opencode-key"
    os.environ["OPENCODE_COMMAND"] = "echo '[opencode] {instruction}'"


def _configure_module(module: Any) -> None:
    module.WORKSPACE_SCOPE = "task"
    module.SUPERVISOR_ENGINE = "moltis"
    module.MOLTIS_ENABLED = True
    module._run_moltis_supervisor_turn = _fake_moltis_turn
    if hasattr(module, "coordinator"):
        module.coordinator.workspace_scope = "task"
        module.coordinator.dispatch_interval_seconds = 3600.0
        module.coordinator.wake = lambda: None


def _synthesize_active_plan(
    client: TestClient,
    *,
    scope: str,
    summary: str,
    objective: str,
    execution_steps: List[Dict[str, Any]],
) -> Dict[str, Any]:
    payload = {
        "author_id": "validator@example.com",
        "summary": summary,
        "objective": objective,
        "execution_steps": execution_steps,
        "activate": True,
        "source": {"source": "validation"},
    }
    return _api_post(client, f"/api/topics/{_encode_scope(scope)}/plan/synthesize", payload)


def _message_payload(
    *,
    message: str,
    session_id: Optional[str] = None,
    repo_id: Optional[str] = None,
    repo_url: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "message": message,
        "session_id": session_id,
        "session_create_mode": "manual" if not session_id else None,
        "session_title": "Validation session" if not session_id else None,
        "client_msg_id": f"msg_{datetime.now(timezone.utc).timestamp()}_{abs(hash(message))}",
        "actor_email": "validator@example.com",
        "actor_name": "Validator",
        "repo_id": repo_id,
        "repo_url": repo_url,
        "stream_id": 1,
        "stream_name": "validation",
        "topic": "supervisor-flow",
    }


def _validate_removed_dispatch_route(client: TestClient, details: Dict[str, Any]) -> CheckResult:
    scope = "stream_id:1:topic:route-removal"
    resp = client.post(f"/api/topics/{_encode_scope(scope)}/directives/dispatch", json={})
    details["route_removal"] = {"status_code": resp.status_code, "body": resp.text[:200]}
    _assert(resp.status_code == 404, "legacy /directives/dispatch route should be removed")
    return CheckResult("Legacy dispatch route removed", "PASS", "POST /directives/dispatch now returns 404.")


def _validate_plan_contract(
    client: TestClient,
    module: Any,
    details: Dict[str, Any],
) -> CheckResult:
    scope = "stream_id:1:topic:plan-contract"
    plan_response = _synthesize_active_plan(
        client,
        scope=scope,
        summary="Validation execution plan",
        objective="Implement the requested change in the repo.",
        execution_steps=[
            {
                "step_id": "step_impl",
                "title": "Implement the change",
                "instruction": "Make the requested code change in the bound repo.",
                "kind": "write",
                "assigned_worker": "writer-1",
                "assigned_role": "writer",
            },
            {
                "step_id": "step_verify",
                "title": "Verify delivered output",
                "instruction": "Review the repo output and report concrete verification evidence.",
                "kind": "verify",
                "assigned_worker": "helper-verify-1",
                "assigned_role": "verify",
                "depends_on": ["step_impl"],
            },
        ],
    )
    synthesized = plan_response.get("synthesized") if isinstance(plan_response.get("synthesized"), dict) else {}
    plan_revision = plan_response.get("plan_revision") if isinstance(plan_response.get("plan_revision"), dict) else {}
    current_plan = _api_get(client, f"/api/topics/{_encode_scope(scope)}/plan/current")
    current_plan_revision = (
        current_plan.get("plan_revision") if isinstance(current_plan.get("plan_revision"), dict) else {}
    )

    details["plan_contract"] = {
        "synthesized": synthesized,
        "plan_revision": plan_revision,
        "current_plan": current_plan_revision,
    }

    _assert("recommended_directives" not in synthesized, "synthesized plan still exposes recommended_directives")
    _assert("recommended_directives" not in plan_revision, "stored plan revision still exposes recommended_directives")
    _assert(
        "recommended_directives" not in (current_plan_revision.get("source") or {}),
        "plan source still persists recommended_directives",
    )
    _assert(
        len([step for step in (current_plan_revision.get("execution_steps") or []) if isinstance(step, dict)]) == 2,
        "current plan should preserve the two execution steps",
    )

    store_count = len(module.store.list_plan_revisions(topic_scope_id=scope))
    _assert(store_count == 1, f"expected exactly one stored plan revision, found {store_count}")
    return CheckResult(
        "Plan contract uses execution steps only",
        "PASS",
        "Plan synthesis no longer emits or stores recommended_directives.",
    )


def _validate_status_contract(
    client: TestClient,
    details: Dict[str, Any],
) -> CheckResult:
    scope = "stream_id:1:topic:status-contract"
    _synthesize_active_plan(
        client,
        scope=scope,
        summary="Status validation plan",
        objective="Prepare the topic for execution.",
        execution_steps=[
            {
                "step_id": "step_impl",
                "title": "Implement the change",
                "instruction": "Make the requested code change when approved.",
                "kind": "write",
                "assigned_worker": "writer-1",
                "assigned_role": "writer",
            }
        ],
    )
    response = _api_post(
        client,
        f"/api/topics/{_encode_scope(scope)}/supervisor/message",
        _message_payload(message="What is the status right now?"),
    )
    runtime_projection = _extract_runtime_projection(response)
    last_event = _latest_event(response.get("events") or [])
    event_text = str(last_event.get("content_md") or "")
    event_payload = last_event.get("payload") if isinstance(last_event.get("payload"), dict) else {}

    details["status_contract"] = {
        "runtime_projection": runtime_projection,
        "last_event": last_event,
    }

    _assert(last_event.get("kind") == "assistant", "status request should return an assistant event")
    _assert("Dispatch readiness:" not in event_text, "assistant status text still emits Dispatch readiness markers")
    _assert(
        "Selected repo attachment:" not in event_text,
        "assistant status text still emits Selected repo attachment markers",
    )
    _assert(
        "execution_prerequisites_ready" in runtime_projection,
        "runtime projection is missing execution_prerequisites_ready",
    )
    _assert("execution_blockers" in runtime_projection, "runtime projection is missing execution_blockers")
    _assert(
        "dispatch_prerequisites_ready" not in runtime_projection,
        "runtime projection still exposes dispatch_prerequisites_ready",
    )
    _assert("dispatch_blockers" not in runtime_projection, "runtime projection still exposes dispatch_blockers")
    _assert("dispatch_readiness" not in event_payload, "assistant payload still exposes dispatch_readiness")
    return CheckResult(
        "Supervisor status contract is execution-based",
        "PASS",
        "Status messages and runtime projection no longer expose dispatch markers.",
    )


def _validate_execution_flow(
    client: TestClient,
    module: Any,
    details: Dict[str, Any],
) -> CheckResult:
    scope = "stream_id:1:topic:execution-flow"
    plan_response = _synthesize_active_plan(
        client,
        scope=scope,
        summary="Execution validation plan",
        objective="Implement the requested change in the repo.",
        execution_steps=[
            {
                "step_id": "step_impl",
                "title": "Implement the change",
                "instruction": "Make the requested code change in the bound repo.",
                "kind": "write",
                "assigned_worker": "writer-1",
                "assigned_role": "writer",
            },
            {
                "step_id": "step_verify",
                "title": "Verify delivered output",
                "instruction": "Review the repo output and report verification evidence.",
                "kind": "verify",
                "assigned_worker": "helper-verify-1",
                "assigned_role": "verify",
                "depends_on": ["step_impl"],
            },
        ],
    )
    active_plan = plan_response.get("plan_revision") if isinstance(plan_response.get("plan_revision"), dict) else {}
    active_plan_id = str(active_plan.get("plan_revision_id") or "").strip()
    _assert(active_plan_id, "active execution validation plan was not created")

    execution_response = _api_post(
        client,
        f"/api/topics/{_encode_scope(scope)}/supervisor/message",
        _message_payload(
            message="Go ahead and implement this now.",
            repo_id="example/repo",
            repo_url="https://example.test/example/repo.git",
        ),
    )
    session = execution_response.get("session") if isinstance(execution_response.get("session"), dict) else {}
    session_id = str(session.get("session_id") or "").strip()
    execution_event = _find_event(execution_response.get("events") or [], "execution_result")
    _assert(execution_event is not None, "execution request should emit an execution_result event")
    payload = execution_event.get("payload") if isinstance(execution_event.get("payload"), dict) else {}
    tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []

    snapshot = _api_get(
        client,
        f"/api/topics/{_encode_scope(scope)}/supervisor/session",
        params={"session_id": session_id},
    )
    runtime_projection = _extract_runtime_projection(snapshot)
    stored_tasks = module.store.list_tasks_for_topic(scope, plan_revision_id=active_plan_id)

    details["execution_flow"] = {
        "execution_event": execution_event,
        "runtime_projection": runtime_projection,
        "stored_task_ids": [task.task_id for task in stored_tasks],
    }

    _assert(str(execution_event.get("kind") or "") == "execution_result", "latest execution event kind is wrong")
    _assert(str(payload.get("execution_plan_source") or "").strip() == "active_plan", "execution should reuse the active plan")
    _assert(str(payload.get("plan_revision_id") or "").strip() == active_plan_id, "execution should target the active plan revision")
    _assert(len(tasks) == 2, f"expected 2 created tasks, found {len(tasks)}")
    _assert(len(stored_tasks) == 2, f"expected 2 stored tasks, found {len(stored_tasks)}")
    _assert(runtime_projection.get("execution_requested") is True, "runtime projection should show execution_requested=true")
    _assert("dispatch_result" not in json.dumps(execution_response), "response still references dispatch_result")
    return CheckResult(
        "Execution request uses execution_result events",
        "PASS",
        "Approved execution now creates tasks from the active plan and emits execution_result.",
    )


def _validate_duplicate_execution_guard(
    client: TestClient,
    module: Any,
    details: Dict[str, Any],
) -> CheckResult:
    scope = "stream_id:1:topic:duplicate-execution"
    plan_response = _synthesize_active_plan(
        client,
        scope=scope,
        summary="Duplicate execution guard plan",
        objective="Implement the requested change in the repo.",
        execution_steps=[
            {
                "step_id": "step_impl",
                "title": "Implement the change",
                "instruction": "Make the requested code change in the bound repo.",
                "kind": "write",
                "assigned_worker": "writer-1",
                "assigned_role": "writer",
            }
        ],
    )
    active_plan = plan_response.get("plan_revision") if isinstance(plan_response.get("plan_revision"), dict) else {}
    active_plan_id = str(active_plan.get("plan_revision_id") or "").strip()
    _assert(active_plan_id, "duplicate execution guard plan was not created")

    first_response = _api_post(
        client,
        f"/api/topics/{_encode_scope(scope)}/supervisor/message",
        _message_payload(
            message="Go ahead and implement this now.",
            repo_id="example/repo",
            repo_url="https://example.test/example/repo.git",
        ),
    )
    session = first_response.get("session") if isinstance(first_response.get("session"), dict) else {}
    session_id = str(session.get("session_id") or "").strip()

    second_response = _api_post(
        client,
        f"/api/topics/{_encode_scope(scope)}/supervisor/message",
        _message_payload(
            message="Go ahead and implement this again.",
            session_id=session_id,
            repo_id="example/repo",
            repo_url="https://example.test/example/repo.git",
        ),
    )

    last_event = _latest_event(second_response.get("events") or [])
    payload = last_event.get("payload") if isinstance(last_event.get("payload"), dict) else {}
    stored_tasks = module.store.list_tasks_for_topic(scope, plan_revision_id=active_plan_id)
    plan_revisions = module.store.list_plan_revisions(topic_scope_id=scope)

    details["duplicate_execution_guard"] = {
        "latest_event": last_event,
        "stored_task_ids": [task.task_id for task in stored_tasks],
        "plan_revision_ids": [item.plan_revision_id for item in plan_revisions],
    }

    _assert(last_event.get("kind") == "assistant", "duplicate execution guard should return an assistant event")
    _assert(payload.get("execution_in_progress") is True, "duplicate execution should set execution_in_progress")
    _assert(
        str(payload.get("execution_reason") or "").strip() == "active_plan_already_running",
        "duplicate execution should report active_plan_already_running",
    )
    _assert(len(stored_tasks) == 1, f"duplicate execution should not create extra tasks; found {len(stored_tasks)}")
    _assert(len(plan_revisions) == 1, f"duplicate execution should not create extra plans; found {len(plan_revisions)}")
    return CheckResult(
        "Duplicate execution reuses the active plan",
        "PASS",
        "Repeated approval does not synthesize new plans or create duplicate tasks.",
    )


def _validate_follow_up_execution_plan(
    client: TestClient,
    module: Any,
    details: Dict[str, Any],
) -> CheckResult:
    scope = "stream_id:1:topic:follow-up-execution"
    planning_only = _synthesize_active_plan(
        client,
        scope=scope,
        summary="Recon plan",
        objective="Gather enough context to prepare implementation.",
        execution_steps=[
            {
                "step_id": "step_research",
                "title": "Inspect the repo",
                "instruction": "Review the repo and summarize the current implementation constraints.",
                "kind": "read_only",
                "assigned_worker": "helper-read-1",
                "assigned_role": "read_only",
            }
        ],
    )
    original_plan = planning_only.get("plan_revision") if isinstance(planning_only.get("plan_revision"), dict) else {}
    original_plan_id = str(original_plan.get("plan_revision_id") or "").strip()
    _assert(original_plan_id, "planning-only validation plan was not created")

    response = _api_post(
        client,
        f"/api/topics/{_encode_scope(scope)}/supervisor/message",
        _message_payload(
            message="Go ahead and implement the real fix now.",
            repo_id="example/repo",
            repo_url="https://example.test/example/repo.git",
        ),
    )
    execution_event = _find_event(response.get("events") or [], "execution_result")
    _assert(execution_event is not None, "follow-up execution should emit an execution_result event")
    payload = execution_event.get("payload") if isinstance(execution_event.get("payload"), dict) else {}
    new_plan_id = str(payload.get("plan_revision_id") or "").strip()
    new_plan = module.store.get_plan_revision(new_plan_id)
    new_plan_dict = module.plan_revision_to_dict(new_plan) if new_plan is not None else {}
    stored_tasks = module.store.list_tasks_for_topic(scope, plan_revision_id=new_plan_id)

    details["follow_up_execution"] = {
        "execution_event": execution_event,
        "new_plan": new_plan_dict,
        "stored_task_ids": [task.task_id for task in stored_tasks],
    }

    _assert(
        str(payload.get("execution_plan_source") or "").strip() == "implementation_follow_up_plan",
        "planning-only active plans should route through implementation_follow_up_plan",
    )
    _assert(new_plan_id and new_plan_id != original_plan_id, "follow-up execution should persist a new executable plan revision")
    _assert(len(stored_tasks) >= 2, f"follow-up execution should create implementation + verify tasks; found {len(stored_tasks)}")
    return CheckResult(
        "Planning-only plans are replaced by executable follow-up plans",
        "PASS",
        "Execution now promotes non-executable plans into a fresh implementation follow-up plan.",
    )


def _run_local_validation() -> tuple[List[CheckResult], Dict[str, Any]]:
    checks: List[CheckResult] = []
    details: Dict[str, Any] = {}

    with tempfile.TemporaryDirectory(prefix="meridian-supervisor-flow-") as temp_dir:
        _configure_validation_env(temp_dir)
        module = _load_app_module()
        _configure_module(module)

        with TestClient(module.app) as client:
            checks.append(_validate_removed_dispatch_route(client, details))
            checks.append(_validate_plan_contract(client, module, details))
            checks.append(_validate_status_contract(client, details))
            checks.append(_validate_execution_flow(client, module, details))
            checks.append(_validate_duplicate_execution_guard(client, module, details))
            checks.append(_validate_follow_up_execution_plan(client, module, details))

    return checks, details


def _write_report(report_path: Path, checks: List[CheckResult], details: Dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    lines: List[str] = []
    lines.append("# Supervisor Conversational Flow Validation Report")
    lines.append("")
    lines.append(f"Generated: `{now}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Check | Status | Detail |")
    lines.append("|---|---|---|")
    for item in checks:
        lines.append(f"| {item.name} | {item.status} | {item.detail} |")
    lines.append("")
    lines.append("## Details")
    lines.append("")
    lines.append("```json")
    lines.append(json.dumps(details, indent=2, ensure_ascii=True))
    lines.append("```")
    report_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[3]
    checks: List[CheckResult] = []
    details: Dict[str, Any] = {}

    try:
        local_checks, local_details = _run_local_validation()
        checks.extend(local_checks)
        details.update(local_details)
    except Exception as exc:
        checks.append(CheckResult("Local supervisor flow validation", "FAIL", str(exc)))

    checks.append(
        CheckResult(
            "Dev deployment probe",
            "BLOCKED",
            "No dev URL is configured in this validator. Local API validation completed only.",
        )
    )

    report_path = repo_root / "var" / "supervisor_conversational_flow_validation_2026-03-13.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    _write_report(report_path, checks, details)

    for item in checks:
        print(f"[{item.status}] {item.name}: {item.detail}")
    print(f"REPORT: {report_path}")

    return 0 if all(item.status in {"PASS", "BLOCKED"} for item in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
