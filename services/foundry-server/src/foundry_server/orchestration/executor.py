#!/usr/bin/env python3
import hashlib
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple
from urllib.parse import quote, urlparse

import requests

from .coder_api import CoderAPIError, CoderClient
from .orchestrator_policy import (
    LifecyclePolicy,
    MonitoringPolicy,
    OrchestratorPolicy,
    ReactionRulePolicy,
    load_orchestrator_policy,
)
from .store import (
    TaskRecord,
    TaskStore,
    WorkerSessionRecord,
    derive_task_title,
    normalize_provider_id,
    normalize_topic_scope_id,
)
from .zulip_notifier import ZulipNotifier


# Require explicit markers to avoid false positives from incidental output like
# "started server on port 3000" in non-preview tasks.
PORT_HINT_RE = re.compile(
    r"\b(?:preview[_\s-]*port|port)\s*[:=]\s*(\d{2,5})\b",
    re.IGNORECASE,
)
JSON_PREVIEW_PORT_RE = re.compile(r'"preview_port"\s*:\s*(\d{2,5})', re.IGNORECASE)
PR_URL_RE = re.compile(
    r"https?://[^\s)]+/(?:pull|pulls|merge_requests)/\d+\b",
    re.IGNORECASE,
)
IMPLEMENTATION_HINT_RE = re.compile(
    r"\b("
    r"implement|implementation|modify|change|fix|refactor|update|build|rebuild|recreate|write code|"
    r"push|commit|branch|pull request|pr|merge request|ship|deploy"
    r")\b",
    re.IGNORECASE,
)
USER_TESTABLE_HINT_RE = re.compile(
    r"\b("
    r"ui|ux|frontend|sidebar|button|dialog|modal|page|screen|view|layout|component|"
    r"desktop app|web app|browser|manual test|user test|human test|preview|dev url|"
    r"staging|launch|run the app|open the app"
    r")\b",
    re.IGNORECASE,
)
PREVIEW_OR_DEPLOY_HINT_RE = re.compile(
    r"\b("
    r"preview|dev url|staging|deploy|deployment|spin up|launch|run the app|"
    r"make available for testing|test in the ui"
    r")\b",
    re.IGNORECASE,
)
PR_REQUIRED_HINT_RE = re.compile(
    r"\b(?:open|create|submit|include|report)\b.{0,40}\b(?:pull request|pr)\b",
    re.IGNORECASE,
)
BRANCH_ONLY_HINT_RE = re.compile(
    r"\b(?:branch only|without (?:a )?pr|without pull request|no pr|no pull request)\b",
    re.IGNORECASE,
)
CI_HINT_RE = re.compile(
    r"\b(?:ci|checks|pipeline|buildkite|github actions|gitlab ci|status checks)\b",
    re.IGNORECASE,
)
TRACEABILITY_HINT_RE = re.compile(
    r"\b("
    r"acceptance criteria|traceability|map(?:ping)? to the request|prove it works|"
    r"verification summary|manual validation"
    r")\b",
    re.IGNORECASE,
)
TASK_CONTRACT_MARKER = "Task contract requirements:"
TRACEABILITY_RESULT_RE = re.compile(
    r"\b("
    r"acceptance criteria|request satisfied|request addressed|maps? to the request|"
    r"proof artifact|manual validation|verification summary"
    r")\b",
    re.IGNORECASE,
)


def command_template_is_stub(template: str) -> bool:
    raw = " ".join(str(template or "").split()).strip()
    if not raw:
        return True
    lowered = raw.lower()
    if lowered == "echo" or lowered.startswith("echo "):
        return True
    if lowered in {"true", ":"}:
        return True
    return False


def _command_template_entrypoint(template: str) -> str:
    raw = str(template or "").strip()
    if not raw:
        return ""
    try:
        tokens = shlex.split(raw, posix=True)
    except Exception:
        return ""
    if not tokens:
        return ""
    index = 0
    if tokens[0] == "env":
        index = 1
        while index < len(tokens) and "=" in tokens[index] and not tokens[index].startswith("-"):
            index += 1
    while index < len(tokens):
        token = tokens[index].strip()
        if not token:
            index += 1
            continue
        if "=" in token and not token.startswith("-"):
            index += 1
            continue
        return token
    return ""


def provider_backend_profile(
    *,
    provider: str,
    execution_backend: str,
    provider_commands: Dict[str, str],
    codex_api_enabled: bool,
    opencode_api_enabled: bool,
) -> Dict[str, Any]:
    provider_id = normalize_provider_id(provider)
    command_template = (
        str(provider_commands.get(provider_id) or "").strip()
        or str(provider_commands.get(provider) or "").strip()
        or str(provider_commands.get("default") or "").strip()
    )
    command_stub = command_template_is_stub(command_template)
    command_entrypoint = _command_template_entrypoint(command_template)
    command_resolved_path = shutil.which(command_entrypoint) if command_entrypoint else None
    command_available = (
        bool(command_template)
        and not command_stub
        and execution_backend == "local"
        and bool(command_resolved_path)
    )
    api_text_available = (
        (provider_id == "codex" and codex_api_enabled)
        or (provider_id == "opencode" and opencode_api_enabled)
    )
    runtime_modes: List[str] = []
    if command_available:
        runtime_modes.append("command")
    if api_text_available:
        runtime_modes.append("api_text")
    default_mode = "unavailable"
    if api_text_available:
        default_mode = "api_text"
    elif command_available:
        default_mode = "command"
    return {
        "provider": provider_id,
        "execution_backend": str(execution_backend or "").strip().lower(),
        "command_template": command_template,
        "command_entrypoint": command_entrypoint,
        "command_resolved_path": command_resolved_path or "",
        "command_stub": command_stub,
        "command_available": command_available,
        "api_text_available": api_text_available,
        "supports_execution": command_available,
        "runtime_modes": runtime_modes,
        "default_mode": default_mode,
    }


def merge_unique_text(items: List[Any]) -> List[str]:
    seen: set[str] = set()
    merged: List[str] = []
    for item in items:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append(text)
    return merged


def option_truthy(options: Optional[Dict[str, Any]], key: str) -> bool:
    if not isinstance(options, dict):
        return False
    return str(options.get(key) or "").strip().lower() in {"1", "true", "yes", "on"}


def merge_delivery_expectations(*sources: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    merged: Dict[str, bool] = {}
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key, value in source.items():
            if bool(value):
                merged[str(key).strip()] = True
    return merged


def delivery_expectations_from_options(options: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    opts = options if isinstance(options, dict) else {}
    payload = (
        dict(opts.get("delivery_expectations"))
        if isinstance(opts.get("delivery_expectations"), dict)
        else {}
    )
    return {
        key: True
        for key in (
            "requires_repo_output",
            "requires_verification",
            "requires_runtime_evidence",
            "requires_deployment_evidence",
            "prefer_pull_request",
            "require_pull_request",
            "requires_ci_evidence",
            "requires_traceability",
        )
        if option_truthy(opts, key) or bool(payload.get(key))
    }


def derive_delivery_expectations_from_text(*texts: Any) -> Dict[str, bool]:
    merged = " ".join(" ".join(str(value or "").split()).strip() for value in texts if str(value or "").strip())
    if not merged:
        return {}
    implementation_requested = bool(IMPLEMENTATION_HINT_RE.search(merged))
    user_testable = bool(USER_TESTABLE_HINT_RE.search(merged))
    preview_or_deploy_requested = bool(PREVIEW_OR_DEPLOY_HINT_RE.search(merged))
    branch_only = bool(BRANCH_ONLY_HINT_RE.search(merged))
    require_pull_request = bool(PR_REQUIRED_HINT_RE.search(merged))
    require_ci = bool(CI_HINT_RE.search(merged))
    requires_runtime_evidence = user_testable or preview_or_deploy_requested
    requires_deployment_evidence = preview_or_deploy_requested or requires_runtime_evidence
    if implementation_requested and user_testable and not branch_only:
        require_pull_request = True
        require_ci = True
    prefer_pull_request = bool(implementation_requested and not branch_only)
    if require_pull_request:
        prefer_pull_request = True
    requires_traceability = bool(TRACEABILITY_HINT_RE.search(merged)) or requires_runtime_evidence
    expectations = {
        "requires_repo_output": implementation_requested,
        "requires_verification": implementation_requested,
        "requires_runtime_evidence": requires_runtime_evidence,
        "requires_deployment_evidence": requires_deployment_evidence,
        "prefer_pull_request": prefer_pull_request,
        "require_pull_request": require_pull_request,
        "requires_ci_evidence": require_ci,
        "requires_traceability": requires_traceability,
    }
    return {key: value for key, value in expectations.items() if value}


def task_requires_executable_backend(
    *,
    instruction: str,
    assigned_role: str = "",
    options: Optional[Dict[str, Any]] = None,
) -> bool:
    opts = options if isinstance(options, dict) else {}
    contract = dict(opts.get("task_contract")) if isinstance(opts.get("task_contract"), dict) else {}
    truthy = {"1", "true", "yes", "on"}
    if (
        str(contract.get("delivery_type") or "").strip().lower() in {"analysis", "approval", "verification"}
        and str(contract.get("requires_repo_output") or "").strip().lower() not in truthy
    ):
        raw_file_claims = opts.get("file_claims")
        raw_area_claims = opts.get("area_claims")
        file_claims = (
            [str(item).strip() for item in raw_file_claims if str(item).strip()]
            if isinstance(raw_file_claims, list)
            else []
        )
        area_claims = (
            [str(item).strip() for item in raw_area_claims if str(item).strip()]
            if isinstance(raw_area_claims, list)
            else []
        )
        if not file_claims and not area_claims:
            return False
    if str(opts.get("required_backend_capability") or "").strip().lower() == "executable":
        return True
    if str(opts.get("worker_execution_mode") or "").strip().lower() == "command":
        return True
    if str(opts.get("requires_executable_backend") or "").strip().lower() in truthy:
        return True
    role = str(assigned_role or opts.get("assigned_role") or "").strip().lower()
    raw_file_claims = opts.get("file_claims")
    raw_area_claims = opts.get("area_claims")
    file_claims = (
        [str(item).strip() for item in raw_file_claims if str(item).strip()]
        if isinstance(raw_file_claims, list)
        else []
    )
    area_claims = (
        [str(item).strip() for item in raw_area_claims if str(item).strip()]
        if isinstance(raw_area_claims, list)
        else []
    )
    if file_claims or area_claims:
        return True
    if option_truthy(opts, "requires_repo_output") or str(contract.get("requires_repo_output") or "").strip().lower() in truthy:
        return True
    return role == "writer" and bool(
        str(opts.get("preview_required") or "").strip().lower() in truthy
    )


def augment_instruction_with_task_contract(
    *,
    instruction: str,
    assigned_role: str = "",
    options: Optional[Dict[str, Any]] = None,
) -> str:
    raw_instruction = str(instruction or "").strip()
    if not raw_instruction:
        return ""
    if TASK_CONTRACT_MARKER.lower() in raw_instruction.lower():
        return raw_instruction

    opts = dict(options if isinstance(options, dict) else {})
    normalized_role = str(assigned_role or opts.get("assigned_role") or "").strip().lower()
    contract = dict(opts.get("task_contract")) if isinstance(opts.get("task_contract"), dict) else {}
    delivery_type = str(contract.get("delivery_type") or "").strip().lower()
    requires_repo_output = option_truthy(opts, "requires_repo_output") or (
        str(contract.get("requires_repo_output") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    requires_verification = option_truthy(opts, "requires_verification") or (
        str(contract.get("requires_verification") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    requires_runtime_evidence = option_truthy(opts, "requires_runtime_evidence") or (
        str(contract.get("requires_runtime_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    requires_deployment_evidence = option_truthy(opts, "requires_deployment_evidence") or (
        str(contract.get("requires_deployment_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    prefer_pull_request = option_truthy(opts, "prefer_pull_request") or (
        str(contract.get("prefer_pull_request") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    require_pull_request = option_truthy(opts, "require_pull_request") or (
        str(contract.get("require_pull_request") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    requires_ci_evidence = option_truthy(opts, "requires_ci_evidence") or (
        str(contract.get("requires_ci_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    requires_traceability = option_truthy(opts, "requires_traceability") or (
        str(contract.get("requires_traceability") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    requires_execution = task_requires_executable_backend(
        instruction=raw_instruction,
        assigned_role=assigned_role,
        options=opts,
    )
    if requires_execution:
        if delivery_type in {"implementation", "deployment", "packaging"}:
            requires_repo_output = True
            requires_verification = True
        elif delivery_type == "verification":
            requires_verification = True
        elif not contract and normalized_role == "writer":
            requires_repo_output = True
            requires_verification = True
        elif not contract and normalized_role in {"verify", "review", "reviewer"}:
            requires_verification = True
    if requires_deployment_evidence:
        requires_runtime_evidence = True

    contract_lines: List[str] = []
    if requires_repo_output:
        contract_lines.extend(
            [
                "- Make the requested code changes in the checked-out repo worktree.",
                "- Commit the changes on the current branch.",
                "- Push the current branch to origin before claiming completion.",
                "- If you open a PR, include the PR URL. Otherwise include the pushed branch name.",
                "- Do not claim completion without repo evidence.",
            ]
        )
    if requires_runtime_evidence:
        contract_lines.append(
            "- Start the changed workflow or application and capture runtime evidence, not just static analysis."
        )
    if requires_deployment_evidence:
        contract_lines.extend(
            [
                "- Publish a dev or preview URL that a human can open for validation.",
                "- If the app exposes a local dev server, include `preview_port: <port>` in your output so the controller can publish the preview.",
            ]
        )
    if require_pull_request:
        contract_lines.append(
            "- Open a pull request from the pushed branch and report the PR URL before claiming completion."
        )
    elif prefer_pull_request:
        contract_lines.append(
            "- Open a pull request from the pushed branch when repo integration allows it; otherwise report the pushed branch."
        )
    if requires_verification:
        contract_lines.extend(
            [
                "- Run the relevant verification commands for the change.",
                "- Report concrete verification output, not just a narrative summary.",
            ]
        )
    if requires_ci_evidence:
        contract_lines.append(
            "- Include CI or status-check state when checks are available for the branch or PR."
        )
    if requires_traceability:
        contract_lines.append(
            "- Map the changed files and verification evidence back to the request or acceptance criteria."
        )
    required_artifacts = merge_unique_text(
        [str(item).strip() for item in (contract.get("required_artifacts") or []) if str(item).strip()]
    )
    if required_artifacts:
        contract_lines.append(
            f"- Required artifacts: {', '.join(required_artifacts)}."
        )
    done_when = merge_unique_text(
        [str(item).strip() for item in (contract.get("done_when") or []) if str(item).strip()]
    )
    if done_when:
        contract_lines.append("- Done conditions:")
        contract_lines.extend([f"  - {item}" for item in done_when])

    if not contract_lines:
        return raw_instruction
    return "\n\n".join([raw_instruction, TASK_CONTRACT_MARKER, "\n".join(contract_lines)]).strip()


@dataclass
class ExecutionResult:
    summary: str
    preview_port: Optional[int] = None


@dataclass
class SCMProbeResult:
    pr_url: str
    provider: str
    pr_state: str
    ci_status: str
    review_status: str
    mergeability: str
    source_host: str


class ReactionEngine:
    TRIGGER_ALIASES = {
        "worker_failed": "task.failed",
        "stuck": "task.stalled",
        "needs_input": "needs_clarification",
        "completed": "task.completed",
    }

    def __init__(self, rules: List[ReactionRulePolicy]) -> None:
        self._rules = [item for item in rules if item.enabled and item.max_attempts >= 0]

    def for_trigger(self, trigger: str) -> List[ReactionRulePolicy]:
        raw = (trigger or "").strip().lower()
        key = self.TRIGGER_ALIASES.get(raw, raw)
        return sorted(
            [item for item in self._rules if item.trigger == key],
            key=lambda item: item.priority,
            reverse=True,
        )


class SessionManager:
    def __init__(self, backend: str) -> None:
        self.backend = (backend or "stub").strip().lower()

    def start(self, task: TaskRecord) -> Dict[str, Any]:
        return {
            "backend": self.backend,
            "task_id": task.task_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }

    def send(
        self,
        task: TaskRecord,
        *,
        run_stub: Any,
        run_local: Any,
    ) -> ExecutionResult:
        if self.backend == "stub":
            return run_stub(task)
        if self.backend == "local":
            return run_local(task)
        if self.backend == "runner":
            raise RuntimeError(
                "runner backend transport is not configured; refusing local fallback"
            )
        raise RuntimeError(f"unsupported EXECUTION_BACKEND: {self.backend}")

    def pause(self, task: TaskRecord) -> bool:
        return True

    def resume(self, task: TaskRecord) -> bool:
        return True

    def terminate(self, task: TaskRecord) -> bool:
        return True


class MonitorManager:
    def __init__(self, *, store: TaskStore, policy: MonitoringPolicy) -> None:
        self.store = store
        self.policy = policy

    def progress(
        self,
        *,
        task_id: str,
        phase: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
        level: str = "info",
    ) -> None:
        if not self.policy.emit_progress_events:
            return
        payload = {"phase": str(phase or "").strip().lower()}
        if data:
            payload.update(data)
        self.store.append_event(
            task_id,
            level=level,
            event_type="progress.update",
            message=message,
            data=payload,
        )

    def evidence(
        self,
        *,
        task: TaskRecord,
        summary: str,
    ) -> None:
        if not self.policy.emit_evidence_events:
            return
        text = str(summary or "").strip()
        elapsed = max(1, int(self.store._elapsed_seconds_for_task(task) or 1))
        evidence_score = round(float(len(text)) / float(elapsed), 4)
        self.store.append_event(
            task.task_id,
            level="info",
            event_type="evidence.update",
            message="Task evidence summary recorded",
            data={
                "evidence_chars": len(text),
                "cost_basis": self.policy.evidence_cost_basis,
                "cost_units": elapsed,
                "evidence_per_cost": evidence_score,
            },
        )


class HookManager:
    def __init__(self, *, store: TaskStore) -> None:
        self.store = store

    def before(self, *, task_id: str, hook: str, data: Optional[Dict[str, Any]] = None) -> None:
        self.store.append_event(
            task_id,
            level="info",
            event_type=f"hook.before.{hook}",
            message=f"Hook before {hook}",
            data=data or {},
        )

    def after(self, *, task_id: str, hook: str, data: Optional[Dict[str, Any]] = None) -> None:
        self.store.append_event(
            task_id,
            level="info",
            event_type=f"hook.after.{hook}",
            message=f"Hook after {hook}",
            data=data or {},
        )

    def error(self, *, task_id: str, hook: str, error: str, data: Optional[Dict[str, Any]] = None) -> None:
        payload = dict(data or {})
        payload["error"] = str(error or "")[:1000]
        self.store.append_event(
            task_id,
            level="error",
            event_type=f"hook.error.{hook}",
            message=f"Hook error {hook}",
            data=payload,
        )


class WorkerLifecycleManager:
    def __init__(
        self,
        *,
        store: TaskStore,
        wake_callback: Any,
        reaction_engine: ReactionEngine,
        lifecycle_policy: LifecyclePolicy,
    ) -> None:
        self.store = store
        self._wake_callback = wake_callback
        self.reaction_engine = reaction_engine
        self.max_chain_retries = max(0, int(lifecycle_policy.max_retries))
        self._reaction_lock = threading.Lock()

    @staticmethod
    def _task_to_state(task: TaskRecord) -> Tuple[str, str]:
        status = str(task.status or "").strip().lower()
        if status == "queued":
            return "queued", "ready"
        if status == "running":
            return "running", "active"
        if status == "blocked_information":
            return "waiting_input", "waiting_input"
        if status in {"blocked_dependency", "blocked_approval", "stalled", "at_risk"}:
            return "blocked", "blocked"
        if status == "paused":
            return "paused", "blocked"
        if status == "done":
            return "completed", "exited"
        if status == "failed":
            return "failed", "exited"
        if status == "canceled":
            return "canceled", "exited"
        return "queued", "ready"

    @staticmethod
    def _event_trigger(task: TaskRecord, explicit_trigger: Optional[str]) -> str:
        trigger = (explicit_trigger or "").strip().lower()
        if trigger:
            return trigger
        status = str(task.status or "").strip().lower()
        if status == "failed":
            return "task.failed"
        if status == "blocked_information":
            return "needs_clarification"
        if status in {"stalled", "at_risk", "paused"}:
            return "task.stalled"
        if status == "done":
            return "task.completed"
        return ""

    @staticmethod
    def _truncate(value: str, *, max_chars: int) -> str:
        text = str(value or "").strip()
        if len(text) <= max_chars:
            return text
        return f"{text[: max(0, max_chars - 3)].rstrip()}..."

    @staticmethod
    def _should_manage(task: TaskRecord) -> bool:
        scope = normalize_topic_scope_id(task.topic_scope_id)
        if not scope:
            return False
        options = task.options if isinstance(task.options, dict) else {}
        source = str(options.get("source") or "").strip().lower()
        if source.startswith("supervisor"):
            return True
        if str(options.get("directive_assigned_by_supervisor") or "").strip():
            return True
        return bool(str(task.assigned_by or "").strip())

    def _append_supervisor_event(
        self,
        *,
        task: TaskRecord,
        kind: str,
        content_md: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not self._should_manage(task):
            return
        scope = normalize_topic_scope_id(task.topic_scope_id)
        if not scope:
            return
        try:
            session = self._supervisor_session_for_task(task=task)
            self.store.append_supervisor_event(
                topic_scope_id=scope,
                session_id=session.session_id,
                kind=kind,
                role="assistant",
                content_md=content_md.strip(),
                payload=payload or {},
                author_id="supervisor",
                author_name="Supervisor",
            )
        except Exception as exc:
            logging.warning(
                "worker lifecycle failed to append supervisor event task=%s scope=%s: %s",
                task.task_id,
                scope,
                exc,
            )

    def _supervisor_session_for_plan(
        self,
        *,
        topic_scope_id: str,
        plan_revision_id: Optional[str],
    ):
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return None
        session_id = ""
        plan_id = str(plan_revision_id or "").strip()
        if plan_id:
            plan = self.store.get_plan_revision(plan_id)
            if plan is not None:
                session_id = str(plan.session_id or "").strip()
        return self.store.get_or_create_supervisor_session(
            topic_scope_id=scope,
            session_id=session_id or None,
            status="active",
        )

    def _supervisor_session_for_task(self, *, task: TaskRecord):
        return self._supervisor_session_for_plan(
            topic_scope_id=task.topic_scope_id,
            plan_revision_id=task.plan_revision_id,
        )

    def _spawn_followup_task(
        self,
        *,
        task: TaskRecord,
        action: str,
        trigger: str,
        reason: str,
        attempt: int,
        max_attempts: int,
    ) -> Optional[TaskRecord]:
        if str(task.status or "").strip().lower() == "canceled":
            return None
        options = dict(task.options if isinstance(task.options, dict) else {})
        root_task_id = str(options.get("lifecycle_root_task_id") or task.task_id).strip() or task.task_id
        current_chain_attempt = 0
        try:
            current_chain_attempt = int(options.get("lifecycle_root_attempt") or 0)
        except Exception:
            current_chain_attempt = 0
        next_chain_attempt = current_chain_attempt + 1
        if self.max_chain_retries >= 0 and next_chain_attempt > self.max_chain_retries:
            self.store.append_event(
                task.task_id,
                level="warning",
                event_type="lifecycle.reaction.skipped",
                message=(
                    "Lifecycle reaction spawn skipped because policy max retry chain was reached"
                ),
                data={
                    "trigger": trigger,
                    "action": action,
                    "root_task_id": root_task_id,
                    "chain_attempt": next_chain_attempt,
                    "max_chain_retries": self.max_chain_retries,
                },
            )
            return None
        root_instruction = str(options.get("lifecycle_root_instruction") or task.instruction or "").strip()
        if not root_instruction:
            root_instruction = str(task.instruction or "").strip()
        options["lifecycle_root_instruction"] = root_instruction
        options["lifecycle_root_task_id"] = root_task_id
        options["lifecycle_root_attempt"] = next_chain_attempt
        options["retry_of_task_id"] = task.task_id
        options["reaction_trigger"] = trigger
        options["reaction_attempt"] = attempt
        options["reaction_max_attempts"] = max_attempts

        latest_output = str(task.error_text or task.result_text or task.blocked_reason or "").strip()
        excerpt = self._truncate(latest_output, max_chars=600)
        followup_lines = [
            "Lifecycle reaction follow-up:",
            f"- trigger: {trigger}",
            f"- reason: {reason}",
            f"- previous task_id: {task.task_id}",
            f"- attempt: {attempt}/{max_attempts}",
            "- complete the remaining work and provide clear completion evidence.",
        ]
        if excerpt:
            followup_lines.extend(
                [
                    "",
                    "Previous output excerpt:",
                    excerpt,
                ]
            )
        next_instruction = "\n".join([root_instruction, "", "\n".join(followup_lines)]).strip()
        spawned = self.store.create_task(
            user_id=task.user_id,
            repo_id=task.repo_id,
            repo_url=task.repo_url,
            provider=task.provider,
            instruction=augment_instruction_with_task_contract(
                instruction=next_instruction,
                assigned_role=task.assigned_role or "",
                options=options,
            ),
            zulip_thread_ref=task.zulip_thread_ref,
            options=options,
            topic_scope_id=task.topic_scope_id,
            assigned_worker=task.assigned_worker,
            assigned_role=task.assigned_role,
            assigned_by=task.assigned_by,
            directive_id=task.directive_id,
            plan_revision_id=task.plan_revision_id,
        )
        self.store.append_event(
            task.task_id,
            level="warning",
            event_type=f"lifecycle.reaction.{action}",
            message=f"Lifecycle reaction spawned follow-up task {spawned.task_id}",
            data={
                "trigger": trigger,
                "reason": reason,
                "attempt": attempt,
                "max_attempts": max_attempts,
                "spawned_task_id": spawned.task_id,
                "action": action,
            },
        )
        self.store.append_event(
            spawned.task_id,
            level="info",
            event_type="lifecycle.reaction.parent",
            message=f"Lifecycle reaction follow-up of {task.task_id}",
            data={
                "trigger": trigger,
                "reason": reason,
                "source_task_id": task.task_id,
                "attempt": attempt,
            },
        )
        self._wake_callback()
        self._append_supervisor_event(
            task=task,
            kind="lifecycle.reaction",
            content_md="\n".join(
                [
                    "### Worker lifecycle reaction",
                    "",
                    f"- Trigger: `{trigger}`",
                    f"- Action: `{action}`",
                    f"- Source task: `{task.task_id}`",
                    f"- Spawned task: `{spawned.task_id}`",
                    f"- Reason: {reason}",
                ]
            ),
            payload={
                "trigger": trigger,
                "action": action,
                "task_id": task.task_id,
                "spawned_task_id": spawned.task_id,
                "attempt": attempt,
            },
        )
        return spawned

    def _notify_human(self, *, task: TaskRecord, trigger: str, reason: str) -> None:
        title = derive_task_title(task.instruction, task.options if isinstance(task.options, dict) else {})
        summary = self._truncate(
            str(task.result_text or task.error_text or task.blocked_reason or "").strip(),
            max_chars=1400,
        )
        lines = [
            "### Worker lifecycle notice",
            "",
            f"- Trigger: `{trigger}`",
            f"- Task: `{task.task_id}` `{task.status}`",
            f"- Title: {title}",
            f"- Reason: {reason}",
        ]
        if summary:
            lines.extend(["", "**Latest worker output:**", summary])
        self._append_supervisor_event(
            task=task,
            kind="lifecycle.notice",
            content_md="\n".join(lines).strip(),
            payload={
                "trigger": trigger,
                "action": "notify_human",
                "task_id": task.task_id,
                "status": task.status,
            },
        )

    def _pause_task(self, *, task: TaskRecord, reason: str, trigger: str) -> Optional[TaskRecord]:
        status = str(task.status or "").strip().lower()
        if status in {"done", "failed", "canceled", "paused"}:
            return task
        updated = self.store.set_task_status(
            task_id=task.task_id,
            status="paused",
            blocked_reason=reason,
            clear_cancel_requested=False,
        )
        if updated is None:
            return None
        self.store.append_event(
            task.task_id,
            level="warning",
            event_type="lifecycle.reaction.pause",
            message="Task paused by lifecycle reaction policy",
            data={"trigger": trigger, "reason": reason},
        )
        self._append_supervisor_event(
            task=updated,
            kind="lifecycle.reaction",
            content_md="\n".join(
                [
                    "### Worker lifecycle reaction",
                    "",
                    f"- Trigger: `{trigger}`",
                    "- Action: `pause`",
                    f"- Task: `{task.task_id}`",
                    f"- Reason: {reason}",
                ]
            ),
            payload={"trigger": trigger, "action": "pause", "task_id": task.task_id},
        )
        self._wake_callback()
        return updated

    def _terminate_replan(
        self,
        *,
        task: TaskRecord,
        reason: str,
        trigger: str,
    ) -> Optional[TaskRecord]:
        status = str(task.status or "").strip().lower()
        if status in {"done", "failed", "canceled"}:
            return task
        updated = self.store.set_task_status(
            task_id=task.task_id,
            status="stalled",
            blocked_reason=f"terminate_replan: {reason}",
            clear_cancel_requested=False,
        )
        if updated is None:
            return None
        self.store.append_event(
            task.task_id,
            level="warning",
            event_type="lifecycle.reaction.terminate_replan",
            message="Task terminated for replan by lifecycle policy",
            data={"trigger": trigger, "reason": reason},
        )
        self._append_supervisor_event(
            task=updated,
            kind="lifecycle.reaction",
            content_md="\n".join(
                [
                    "### Worker lifecycle reaction",
                    "",
                    f"- Trigger: `{trigger}`",
                    "- Action: `terminate_replan`",
                    f"- Task: `{task.task_id}`",
                    f"- Reason: {reason}",
                ]
            ),
            payload={"trigger": trigger, "action": "terminate_replan", "task_id": task.task_id},
        )
        self._wake_callback()
        return updated

    def _apply_reactions(
        self,
        *,
        task: TaskRecord,
        session: WorkerSessionRecord,
        trigger: str,
    ) -> None:
        if not trigger:
            return
        rules = self.reaction_engine.for_trigger(trigger)
        if not rules:
            return
        reason = str(task.blocked_reason or task.error_text or task.result_text or "").strip()
        if not reason:
            reason = f"task transitioned to {task.status}"
        with self._reaction_lock:
            for rule in rules:
                key = f"{rule.name}:{trigger}:{rule.action}"
                current_attempts = int(session.metadata.get(key) or 0)
                if current_attempts >= max(0, int(rule.max_attempts)):
                    continue
                if rule.action in {"spawn_helper", "redirect"}:
                    attempt = current_attempts + 1
                    spawned = self._spawn_followup_task(
                        task=task,
                        action=rule.action,
                        trigger=trigger,
                        reason=reason,
                        attempt=attempt,
                        max_attempts=max(0, int(rule.max_attempts)),
                    )
                    if spawned is None:
                        continue
                    session = self.store.update_worker_session(
                        worker_session_id=session.worker_session_id,
                        metadata_patch={
                            key: attempt,
                            f"last_reaction_task:{trigger}": spawned.task_id,
                            "last_reaction_rule": rule.name,
                        },
                        last_event_type=f"lifecycle.reaction.{rule.action}",
                        last_event_ts=self.store.now_iso(),
                    ) or session
                elif rule.action == "pause":
                    updated_task = self._pause_task(task=task, reason=reason, trigger=trigger)
                    if updated_task is None:
                        continue
                    task = updated_task
                    session = self.store.update_worker_session(
                        worker_session_id=session.worker_session_id,
                        metadata_patch={key: current_attempts + 1, "last_reaction_rule": rule.name},
                        last_event_type="lifecycle.reaction.pause",
                        last_event_ts=self.store.now_iso(),
                    ) or session
                elif rule.action == "terminate_replan":
                    updated_task = self._terminate_replan(task=task, reason=reason, trigger=trigger)
                    if updated_task is None:
                        continue
                    task = updated_task
                    session = self.store.update_worker_session(
                        worker_session_id=session.worker_session_id,
                        metadata_patch={key: current_attempts + 1, "last_reaction_rule": rule.name},
                        last_event_type="lifecycle.reaction.terminate_replan",
                        last_event_ts=self.store.now_iso(),
                    ) or session
                elif rule.action == "notify_human":
                    self._notify_human(task=task, trigger=trigger, reason=reason)
                    session = self.store.update_worker_session(
                        worker_session_id=session.worker_session_id,
                        metadata_patch={key: current_attempts + 1, "last_reaction_rule": rule.name},
                        last_event_type="lifecycle.reaction.notify_human",
                        last_event_ts=self.store.now_iso(),
                    ) or session

    def sync_from_task(
        self,
        task: TaskRecord,
        *,
        event_type: Optional[str] = None,
        trigger: Optional[str] = None,
        apply_reactions: bool = True,
    ) -> Optional[WorkerSessionRecord]:
        session_status, session_activity = self._task_to_state(task)
        session = self.store.upsert_worker_session_from_task(
            task,
            session_status=session_status,
            activity=session_activity,
            last_event_type=(event_type or "").strip() or None,
            last_event_ts=self.store.now_iso(),
            runtime_handle={
                "worker_id": task.worker_id,
                "workspace_id": task.workspace_id,
                "container_name": task.container_name,
                "container_runtime": task.container_runtime,
            },
            attach_info={
                "workspace_id": task.workspace_id,
                "workspace_name": task.workspace_name,
                "branch_name": task.branch_name,
                "worktree_path": task.worktree_path,
                "container_name": task.container_name,
            },
        )
        if apply_reactions and self._should_manage(task):
            event_trigger = self._event_trigger(task, trigger)
            self._apply_reactions(task=task, session=session, trigger=event_trigger)
        return session

    def reconcile(self) -> None:
        active = self.store.list_worker_sessions(
            statuses=["queued", "running", "blocked", "waiting_input", "paused"],
            limit=800,
        )
        for session in active:
            task = self.store.get_task(session.task_id)
            if task is None:
                continue
            target_status, target_activity = self._task_to_state(task)
            if session.status == target_status and session.activity == target_activity:
                continue
            self.store.update_worker_session(
                worker_session_id=session.worker_session_id,
                status=target_status,
                activity=target_activity,
                last_event_type="lifecycle.reconcile",
                last_event_ts=self.store.now_iso(),
            )


class TaskCoordinator:
    CODER_WORKSPACE_NAME_MAX = 32
    REPO_SCOPE_MAPPING_USER_ID = "__repo_scope__"
    TASK_SCOPE_MAPPING_PREFIX = "__task_scope__:"

    def __init__(
        self,
        *,
        store: TaskStore,
        coder: Optional[CoderClient],
        notifier: ZulipNotifier,
        worker_id: str,
        template_id: str,
        template_version_id: str,
        max_parallel_tasks: int,
        per_workspace_concurrency: int,
        keepalive_window_hours: int,
        keepalive_interval_seconds: int,
        port_policy_interval_seconds: int,
        dispatch_interval_seconds: float,
        execution_backend: str,
        provider_commands: Dict[str, str],
        local_work_root: str,
        owner_override: str,
        owner_map_json: str,
        workspace_scope: str,
        repo_workspace_owner: str,
        task_container_runtime: str,
        orchestrator_policy: Optional[OrchestratorPolicy] = None,
    ) -> None:
        self.store = store
        self.coder = coder
        self.notifier = notifier
        self.orchestrator_policy = orchestrator_policy or load_orchestrator_policy()
        self.store.set_lifecycle_policy(self.orchestrator_policy.lifecycle)
        self.worker_id = worker_id
        self.template_id = template_id.strip()
        self.template_version_id = template_version_id.strip()
        self.max_parallel_tasks = max(1, int(max_parallel_tasks))
        self.per_workspace_concurrency = max(1, int(per_workspace_concurrency))
        self.keepalive_window_hours = max(1, int(keepalive_window_hours))
        self.keepalive_interval_seconds = max(10, int(keepalive_interval_seconds))
        self.port_policy_interval_seconds = max(15, int(port_policy_interval_seconds))
        self.dispatch_interval_seconds = max(0.2, float(dispatch_interval_seconds))
        self.execution_backend = (execution_backend or "stub").strip().lower()
        self.provider_commands = provider_commands
        self.local_work_root = Path(local_work_root).resolve()
        self.local_work_root.mkdir(parents=True, exist_ok=True)
        self.owner_override = owner_override.strip()
        self.owner_map = self._parse_owner_map(owner_map_json)
        raw_scope = (workspace_scope or "repo").strip().lower()
        self.workspace_scope = raw_scope if raw_scope in {"repo", "user_repo", "task"} else "repo"
        self.repo_workspace_owner = repo_workspace_owner.strip()
        self.task_container_runtime = (task_container_runtime or "task-sandbox").strip() or "task-sandbox"
        self.task_notifications_enabled = (
            os.getenv("CODER_TASK_ZULIP_NOTIFICATIONS_ENABLED", "false").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.codex_api_enabled = os.getenv("CODEX_API_ENABLED", "false").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.openai_base_url = (
            os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
        )
        self.codex_model = os.getenv("CODEX_MODEL", "gpt-5.2-2025-12-11").strip()
        self.codex_timeout_seconds = float(os.getenv("CODEX_TIMEOUT_SECONDS", "180"))
        self.codex_max_output_tokens = int(os.getenv("CODEX_MAX_OUTPUT_TOKENS", "8000"))
        self.codex_reasoning_effort = os.getenv("CODEX_REASONING_EFFORT", "medium").strip().lower()
        if self.codex_reasoning_effort not in {"low", "medium", "high"}:
            self.codex_reasoning_effort = "medium"
        self.opencode_api_enabled = (
            os.getenv(
                "OPENCODE_API_ENABLED",
                os.getenv("OPENCODE_FIREWORKS_ENABLED", "true"),
            )
            .strip()
            .lower()
            in {"1", "true", "yes", "on"}
        )
        self.opencode_model = os.getenv("OPENCODE_MODEL", "fireworks/kimi-k2p5").strip()
        self.opencode_timeout_seconds = float(os.getenv("OPENCODE_TIMEOUT_SECONDS", "180"))
        self.opencode_temperature = float(os.getenv("OPENCODE_TEMPERATURE", "0.1"))
        self.opencode_api_base_url = (
            os.getenv(
                "OPENCODE_API_BASE_URL",
                os.getenv("OPENCODE_FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1"),
            )
            .strip()
            .rstrip("/")
        )
        self.opencode_api_key = os.getenv("OPENCODE_API_KEY", "").strip()
        self.opencode_fireworks_api_key = os.getenv("FIREWORKS_API_KEY", "").strip()
        self.claude_code_api_key = (
            os.getenv("CLAUDE_CODE_API_KEY", "").strip()
            or os.getenv("ANTHROPIC_API_KEY", "").strip()
            or os.getenv("CLOUD_CODE_API_KEY", "").strip()
        )
        self.preview_port_wait_seconds = max(
            0.0, float(os.getenv("PREVIEW_PORT_WAIT_SECONDS", "15"))
        )
        self.preview_port_poll_seconds = max(
            0.2, float(os.getenv("PREVIEW_PORT_POLL_SECONDS", "1.5"))
        )
        self.approval_blocking_enabled = (
            os.getenv("APPROVAL_BLOCKING_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
        )
        self.orphan_running_recovery_enabled = (
            os.getenv("ORPHAN_RUNNING_RECOVERY_ENABLED", "true").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.orphan_running_recovery_seconds = max(
            0.0, float(os.getenv("ORPHAN_RUNNING_RECOVERY_SECONDS", "120"))
        )
        self.auto_stall_detect_enabled = (
            os.getenv("SUPERVISOR_AUTO_STALL_ENABLED", "true").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.auto_stall_seconds = max(
            30.0, float(os.getenv("SUPERVISOR_AUTO_STALL_SECONDS", "240"))
        )
        self.auto_pause_after_at_risk_seconds = max(
            self.auto_stall_seconds,
            float(
                os.getenv(
                    "SUPERVISOR_AUTO_PAUSE_AFTER_AT_RISK_SECONDS",
                    str(int(self.auto_stall_seconds * 2)),
                )
            ),
        )
        self.auto_loop_detect_enabled = (
            os.getenv("SUPERVISOR_AUTO_LOOP_ENABLED", "true").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.auto_loop_repeat_threshold = max(
            2, int(os.getenv("SUPERVISOR_AUTO_LOOP_REPEAT_THRESHOLD", "3"))
        )
        self.scm_reconcile_enabled = (
            os.getenv("SCM_LIFECYCLE_RECONCILE_ENABLED", "true").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.scm_poll_interval_seconds = max(
            10.0, float(os.getenv("SCM_POLL_INTERVAL_SECONDS", "30"))
        )
        self.scm_request_timeout_seconds = max(
            2.0, float(os.getenv("SCM_REQUEST_TIMEOUT_SECONDS", "15"))
        )
        self.plan_completion_assess_interval_seconds = max(
            5.0, float(os.getenv("SUPERVISOR_PLAN_COMPLETION_ASSESS_INTERVAL_SECONDS", "10"))
        )
        self.plan_follow_up_enabled = (
            os.getenv("SUPERVISOR_PLAN_FOLLOW_UP_ENABLED", "true").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.plan_follow_up_max_attempts = max(
            0, int(os.getenv("SUPERVISOR_PLAN_FOLLOW_UP_MAX_ATTEMPTS", "1"))
        )
        forgejo_base_url = (
            os.getenv("FORGEJO_BASE_URL", "").strip()
            or os.getenv("FORGEJO_URL", "").strip()
        ).rstrip("/")
        self.github_api_base_url = (
            os.getenv("GITHUB_API_BASE_URL", "https://api.github.com").strip().rstrip("/")
        )
        self.forgejo_api_base_url = (
            os.getenv("FORGEJO_API_BASE_URL", "").strip().rstrip("/")
            or (f"{forgejo_base_url}/api/v1" if forgejo_base_url else "")
        )
        self.github_api_key = os.getenv("GITHUB_API_KEY", "").strip() or os.getenv(
            "GITHUB_TOKEN", ""
        ).strip()
        self.forgejo_api_key = os.getenv("FORGEJO_API_KEY", "").strip() or os.getenv(
            "FORGEJO_TOKEN", ""
        ).strip()
        self._openai_http = requests.Session()

        self._stop = threading.Event()
        self._wake = threading.Event()
        self._loop_thread: Optional[threading.Thread] = None
        self.lifecycle_manager_enabled = (
            os.getenv("WORKER_LIFECYCLE_MANAGER_ENABLED", "true").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.reaction_engine = ReactionEngine(self.orchestrator_policy.reactions)
        self.session_manager = SessionManager(self.execution_backend)
        self.monitor_manager = MonitorManager(
            store=self.store,
            policy=self.orchestrator_policy.monitoring,
        )
        self.hook_manager = HookManager(store=self.store)

        self._task_threads: Dict[str, threading.Thread] = {}
        self._task_threads_lock = threading.Lock()
        self._local_repo_locks: Dict[str, threading.Lock] = {}
        self._local_repo_locks_lock = threading.Lock()
        self._provider_cli_auth_lock = threading.Lock()
        self._provider_cli_auth_state: Dict[str, str] = {}
        self.lifecycle_manager = (
            WorkerLifecycleManager(
                store=self.store,
                wake_callback=self.wake,
                reaction_engine=self.reaction_engine,
                lifecycle_policy=self.orchestrator_policy.lifecycle,
            )
            if self.lifecycle_manager_enabled
            else None
        )

        self._next_keepalive_ts = 0.0
        self._next_port_policy_ts = 0.0
        self._next_scm_poll_ts = 0.0
        self._next_plan_completion_assess_ts = 0.0
        self._startup_recovery_done = False

    @staticmethod
    def _parse_owner_map(raw_json: str) -> Dict[str, str]:
        value = (raw_json or "").strip()
        if not value:
            return {}
        try:
            parsed = json.loads(value)
        except Exception:
            logging.warning("invalid CODER_OWNER_MAP_JSON; ignoring")
            return {}
        if not isinstance(parsed, dict):
            return {}
        out: Dict[str, str] = {}
        for key, val in parsed.items():
            k = str(key).strip().lower()
            v = str(val).strip()
            if k and v:
                out[k] = v
        return out

    @staticmethod
    def _slug(value: str) -> str:
        clean = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower())
        clean = clean.strip("-")
        return clean or "x"

    def _workspace_owner_for_user(self, user_id: str) -> str:
        if self.owner_override:
            return self.owner_override
        key = (user_id or "").strip().lower()
        if key in self.owner_map:
            return self.owner_map[key]
        if "@" in key:
            key = key.split("@", 1)[0]
        return self._slug(key)

    def _workspace_mapping_user_id(self, task: TaskRecord) -> str:
        if self.workspace_scope == "repo":
            return self.REPO_SCOPE_MAPPING_USER_ID
        if self.workspace_scope == "task":
            return f"{self.TASK_SCOPE_MAPPING_PREFIX}{task.task_id}"
        return task.user_id

    def _workspace_owner_for_task(self, task: TaskRecord) -> str:
        if self.workspace_scope == "repo":
            if self.repo_workspace_owner:
                return self.repo_workspace_owner
            if self.owner_override:
                return self.owner_override
            raise RuntimeError(
                "repo workspace scope requires REPO_WORKSPACE_OWNER or CODER_OWNER_OVERRIDE"
            )
        if self.workspace_scope == "task":
            if self.repo_workspace_owner:
                return self.repo_workspace_owner
            if self.owner_override:
                return self.owner_override
        return self._workspace_owner_for_user(task.user_id)

    def _workspace_name(self, task: TaskRecord | str) -> str:
        repo_id = task.repo_id if isinstance(task, TaskRecord) else str(task or "")
        base = f"repo-{self._slug(repo_id)}"
        if self.workspace_scope == "task" and isinstance(task, TaskRecord):
            task_suffix = self._slug(task.task_id)[:12]
            base = f"{base}-{task_suffix}"
        if len(base) <= self.CODER_WORKSPACE_NAME_MAX:
            return base

        digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]
        head_len = self.CODER_WORKSPACE_NAME_MAX - len(digest) - 1
        head = base[: max(1, head_len)].rstrip("-")
        if not head:
            head = "repo"
        return f"{head}-{digest}"[: self.CODER_WORKSPACE_NAME_MAX]

    def _local_workspace_id(self, task: TaskRecord | str) -> str:
        repo_id = task.repo_id if isinstance(task, TaskRecord) else str(task or "")
        base = f"local:{self._slug(repo_id)}"
        if self.workspace_scope == "task" and isinstance(task, TaskRecord):
            return f"{base}:{self._slug(task.task_id)}"
        return base

    @staticmethod
    def _is_local_workspace_id(workspace_id: str) -> bool:
        return str(workspace_id or "").strip().startswith("local:")

    def _branch_name(self, task: TaskRecord) -> str:
        worker_slot = self._slug(task.assigned_worker or task.task_id)[:24]
        return f"agent/{task.task_id}/{worker_slot}"

    def _worktree_path(self, task: TaskRecord) -> str:
        repo_slug = self._slug(task.repo_id)
        worker_slot = self._slug(task.assigned_worker or task.task_id)[:24]
        if self.execution_backend == "local":
            return str(
                self.local_work_root
                / repo_slug
                / "tasks"
                / task.task_id
                / "workers"
                / worker_slot
                / "worktree"
            )
        return f"/home/coder/repos/{repo_slug}/tasks/{task.task_id}/workers/{worker_slot}/worktree"

    def _task_container_name(self, task: TaskRecord) -> str:
        worker_slot = self._slug(task.assigned_worker or task.task_id)[:16]
        return f"meridian-w-{task.task_id}-{worker_slot}"

    def start(self) -> None:
        if self._loop_thread and self._loop_thread.is_alive():
            return
        self._stop.clear()
        self._wake.clear()
        self._loop_thread = threading.Thread(target=self._run_loop, name="task-coordinator", daemon=True)
        self._loop_thread.start()

    def stop(self, timeout_seconds: int = 10) -> None:
        self._stop.set()
        self._wake.set()
        if self._loop_thread:
            self._loop_thread.join(timeout=max(1, int(timeout_seconds)))

    def wake(self) -> None:
        self._wake.set()

    def _run_loop(self) -> None:
        logging.info(
            "task coordinator started backend=%s max_parallel=%s per_workspace=%s workspace_scope=%s policy=%s",
            self.execution_backend,
            self.max_parallel_tasks,
            self.per_workspace_concurrency,
            self.workspace_scope,
            self.orchestrator_policy.source_path,
        )
        while not self._stop.is_set():
            try:
                if not self._startup_recovery_done:
                    self._recover_orphaned_running_tasks()
                    self._startup_recovery_done = True
                self._cleanup_finished_threads()
                self._requeue_unblocked_dependency_tasks()
                self._requeue_unblocked_stalled_tasks()
                self._dispatch_queued_tasks()
                self._evaluate_task_health()
                if self.lifecycle_manager is not None:
                    self.lifecycle_manager.reconcile()

                now = time.monotonic()
                if now >= self._next_keepalive_ts:
                    self._extend_workspace_deadlines_for_running_tasks()
                    self._next_keepalive_ts = now + self.keepalive_interval_seconds

                if now >= self._next_port_policy_ts:
                    self._reconcile_port_share_policy()
                    self._next_port_policy_ts = now + self.port_policy_interval_seconds

                if self.scm_reconcile_enabled and now >= self._next_scm_poll_ts:
                    self._reconcile_worker_session_lifecycle()
                    self._next_scm_poll_ts = now + self.scm_poll_interval_seconds

                if now >= self._next_plan_completion_assess_ts:
                    self._emit_plan_completion_assessments()
                    self._next_plan_completion_assess_ts = (
                        now + self.plan_completion_assess_interval_seconds
                    )
            except Exception as exc:
                logging.exception("coordinator loop error: %s", exc)

            woke = self._wake.wait(timeout=self.dispatch_interval_seconds)
            if woke:
                self._wake.clear()

        logging.info("task coordinator stopped")

    def _active_task_count(self) -> int:
        with self._task_threads_lock:
            return len(self._task_threads)

    def _cleanup_finished_threads(self) -> None:
        with self._task_threads_lock:
            dead = [task_id for task_id, thread in self._task_threads.items() if not thread.is_alive()]
            for task_id in dead:
                self._task_threads.pop(task_id, None)

    def _task_thread_alive(self, task_id: str) -> bool:
        with self._task_threads_lock:
            thread = self._task_threads.get(task_id)
            return bool(thread and thread.is_alive())

    def _requeue_unblocked_dependency_tasks(self) -> None:
        blocked = self.store.list_tasks_by_status(statuses=["blocked_dependency"], limit=500)
        for task in blocked:
            ok, pending = self.store.dependencies_satisfied(task)
            if not ok:
                continue
            updated = self.store.set_task_status(
                task_id=task.task_id,
                status="queued",
                blocked_reason=None,
                clear_cancel_requested=True,
            )
            if updated is None:
                continue
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="dependency_unblocked",
                message="Dependencies satisfied; re-queued for dispatch",
            )
            if self.lifecycle_manager is not None:
                self.lifecycle_manager.sync_from_task(
                    updated,
                    event_type="dependency_unblocked",
                    apply_reactions=False,
                )

    def _requeue_unblocked_stalled_tasks(self) -> None:
        stalled = self.store.list_tasks_by_status(statuses=["stalled"], limit=500)
        for task in stalled:
            reason = (task.blocked_reason or "").strip().lower()
            if not reason.startswith("claim_conflict"):
                continue
            conflicts = self.store.find_claim_conflicts(task)
            if conflicts.get("conflict"):
                continue
            updated = self.store.set_task_status(
                task_id=task.task_id,
                status="queued",
                blocked_reason=None,
                clear_cancel_requested=True,
            )
            if updated is None:
                continue
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="claim_unblocked",
                message="Claim conflict resolved; re-queued for dispatch",
            )
            if self.lifecycle_manager is not None:
                self.lifecycle_manager.sync_from_task(
                    updated,
                    event_type="claim_unblocked",
                    apply_reactions=False,
                )

    @staticmethod
    def _option_truthy(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        text = str(value or "").strip().lower()
        return text in {"1", "true", "yes", "on", "required"}

    def _task_requires_approval(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if not options:
            return False

        bool_keys = (
            "approval_required",
            "requires_approval",
            "approval_gate",
            "needs_approval",
            "require_human_approval",
        )
        for key in bool_keys:
            if self._option_truthy(options.get(key)):
                return True

        list_keys = (
            "required_approvals",
            "tools_requiring_approval",
            "sensitive_actions",
            "approval_points",
        )
        for key in list_keys:
            value = options.get(key)
            if isinstance(value, list) and any(str(item).strip() for item in value):
                return True
            if isinstance(value, str) and value.strip():
                return True

        return False

    @staticmethod
    def _iso_age_seconds(iso_value: Optional[str]) -> float:
        raw = str(iso_value or "").strip()
        if not raw:
            return 0.0
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except Exception:
            return 0.0
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        return max(0.0, (now - dt.astimezone(timezone.utc)).total_seconds())

    @staticmethod
    def _event_failure_fingerprint(event: Dict[str, Any]) -> str:
        event_type = str(event.get("event_type") or "").strip().lower()
        level = str(event.get("level") or "").strip().lower()
        message = str(event.get("message") or "").strip().lower()
        short_message = message[:180]
        return f"{event_type}|{level}|{short_message}"

    @staticmethod
    def _event_is_failure(event: Dict[str, Any]) -> bool:
        event_type = str(event.get("event_type") or "").strip().lower()
        level = str(event.get("level") or "").strip().lower()
        if level in {"error", "fatal"}:
            return True
        return (
            event_type.endswith(".error")
            or event_type.endswith("_error")
            or "failed" in event_type
            or event_type in {"task_dispatch_error", "provider_stderr", "provider.stderr"}
        )

    def _mark_task_at_risk(
        self,
        task: TaskRecord,
        *,
        reason: str,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        if task.status != "running":
            return
        updated = self.store.set_task_status(
            task_id=task.task_id,
            status="at_risk",
            blocked_reason=reason,
            clear_cancel_requested=False,
        )
        if updated is None:
            return
        self.store.append_event(
            task.task_id,
            level="warning",
            event_type=event_type,
            message=reason,
            data=data or {},
        )
        if self.lifecycle_manager is not None:
            self.lifecycle_manager.sync_from_task(
                updated,
                event_type=event_type,
                trigger="task.stalled",
            )

    def _pause_at_risk_task(
        self,
        task: TaskRecord,
        *,
        reason: str,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        if task.status != "at_risk":
            return
        if self._task_thread_alive(task.task_id):
            return
        updated = self.store.set_task_status(
            task_id=task.task_id,
            status="paused",
            blocked_reason=reason,
            clear_cancel_requested=False,
        )
        if updated is None:
            return
        self.store.append_event(
            task.task_id,
            level="warning",
            event_type=event_type,
            message=reason,
            data=data or {},
        )
        if self.lifecycle_manager is not None:
            self.lifecycle_manager.sync_from_task(
                updated,
                event_type=event_type,
                trigger="task.stalled",
            )

    @staticmethod
    def _is_terminal_task_status(status: str) -> bool:
        return str(status or "").strip().lower() in {"done", "failed", "canceled"}

    @staticmethod
    def _plan_completion_signature(tasks: List[TaskRecord]) -> str:
        parts = [
            "|".join(
                [
                    str(item.task_id or ""),
                    str(item.status or ""),
                    str(item.updated_at or ""),
                    str(item.finished_at or ""),
                ]
            )
            for item in sorted(tasks, key=lambda value: str(value.task_id or ""))
        ]
        return "\n".join(parts)

    @staticmethod
    def _task_retry_parent_id(task: TaskRecord) -> str:
        options = task.options if isinstance(task.options, dict) else {}
        return str(options.get("retry_of_task_id") or "").strip()

    @staticmethod
    def _task_effective_identity(task: TaskRecord) -> str:
        directive_id = str(task.directive_id or "").strip()
        if directive_id:
            return f"directive:{directive_id}"
        options = task.options if isinstance(task.options, dict) else {}
        title = derive_task_title(task.instruction, options)
        return "|".join(
            [
                str(task.assigned_role or "").strip().lower(),
                str(task.assigned_worker or "").strip().lower(),
                " ".join(str(title or "").split()).strip().lower(),
            ]
        )

    def _effective_plan_tasks(self, tasks: List[TaskRecord]) -> List[TaskRecord]:
        superseded_by_retry = {
            parent_id
            for parent_id in (self._task_retry_parent_id(task) for task in tasks)
            if parent_id
        }
        retry_leaves = [
            task
            for task in tasks
            if str(task.task_id or "").strip() not in superseded_by_retry
        ]
        latest_by_identity: Dict[str, TaskRecord] = {}
        for task in sorted(
            retry_leaves,
            key=lambda item: (
                str(item.created_at or ""),
                str(item.updated_at or ""),
                str(item.task_id or ""),
            ),
        ):
            latest_by_identity[self._task_effective_identity(task)] = task
        return list(latest_by_identity.values())

    @staticmethod
    def _repo_locator_from_task(task: TaskRecord) -> Optional[Dict[str, str]]:
        repo_id = str(task.repo_id or "").strip()
        if "/" not in repo_id:
            return None
        owner, repo = repo_id.split("/", 1)
        owner = owner.strip()
        repo = repo.strip()
        if not owner or not repo:
            return None

        repo_url = str(task.repo_url or "").strip()
        parsed = urlparse(repo_url) if repo_url else None
        host = str(parsed.netloc or "").strip().lower() if parsed is not None else ""
        provider = "github" if host.endswith("github.com") else "forgejo"
        return {
            "owner": owner,
            "repo": repo,
            "host": host,
            "provider": provider,
        }

    def _probe_remote_branch(self, *, task: TaskRecord) -> Optional[Dict[str, str]]:
        branch_name = str(task.branch_name or "").strip()
        if not branch_name:
            return None
        locator = self._repo_locator_from_task(task)
        if locator is None:
            return None

        provider = str(locator.get("provider") or "").strip().lower()
        owner = str(locator.get("owner") or "").strip()
        repo = str(locator.get("repo") or "").strip()
        if not owner or not repo:
            return None

        if provider == "github":
            base = self.github_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="github")
            headers = self._github_headers(token)
            url = f"{base}/repos/{owner}/{repo}/branches/{quote(branch_name, safe='')}"
        else:
            base = self.forgejo_api_base_url.rstrip("/")
            if not base:
                return None
            token = self._resolve_integration_token(task=task, provider="forgejo")
            headers = self._forgejo_headers(token)
            url = f"{base}/repos/{owner}/{repo}/branches/{quote(branch_name, safe='')}"

        try:
            response = self._openai_http.get(
                url,
                headers=headers,
                timeout=self.scm_request_timeout_seconds,
            )
        except Exception:
            return None
        if response.status_code >= 400:
            return None
        payload = response.json() if response.content else {}
        commit = payload.get("commit") if isinstance(payload, dict) else {}
        return {
            "branch_name": branch_name,
            "provider": provider,
            "host": str(locator.get("host") or ""),
            "head_sha": str(commit.get("id") or commit.get("sha") or "").strip(),
        }

    def _repo_default_branch(self, *, task: TaskRecord) -> str:
        locator = self._repo_locator_from_task(task)
        if locator is None:
            return "main"
        provider = str(locator.get("provider") or "").strip().lower()
        owner = str(locator.get("owner") or "").strip()
        repo = str(locator.get("repo") or "").strip()
        if not owner or not repo:
            return "main"
        if provider == "github":
            base = self.github_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="github")
            headers = self._github_headers(token)
        else:
            base = self.forgejo_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="forgejo")
            headers = self._forgejo_headers(token)
        if not base:
            return "main"
        try:
            response = self._openai_http.get(
                f"{base}/repos/{owner}/{repo}",
                headers=headers,
                timeout=self.scm_request_timeout_seconds,
            )
            if response.status_code < 400:
                payload = response.json() if response.content else {}
                branch = str(payload.get("default_branch") or "").strip()
                if branch:
                    return branch
        except Exception:
            pass
        return "upstream-main"

    def _find_existing_pull_request_for_branch(self, *, task: TaskRecord) -> Optional[str]:
        locator = self._repo_locator_from_task(task)
        branch_name = str(task.branch_name or "").strip()
        if locator is None or not branch_name:
            return None
        provider = str(locator.get("provider") or "").strip().lower()
        owner = str(locator.get("owner") or "").strip()
        repo = str(locator.get("repo") or "").strip()
        if provider == "github":
            base = self.github_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="github")
            headers = self._github_headers(token)
            head_value = f"{owner}:{branch_name}"
        else:
            base = self.forgejo_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="forgejo")
            headers = self._forgejo_headers(token)
            head_value = branch_name
        if not base:
            return None
        try:
            response = self._openai_http.get(
                f"{base}/repos/{owner}/{repo}/pulls",
                params={"state": "open", "head": head_value},
                headers=headers,
                timeout=self.scm_request_timeout_seconds,
            )
            if response.status_code >= 400:
                return None
            payload = response.json() if response.content else []
            if not isinstance(payload, list) or not payload:
                return None
            for item in payload:
                if not isinstance(item, dict):
                    continue
                pr_url = str(item.get("html_url") or item.get("url") or "").strip()
                if pr_url:
                    return pr_url
        except Exception:
            return None
        return None

    def _open_pull_request_for_task(
        self,
        *,
        task: TaskRecord,
        plan_summary: str,
        plan_objective: str,
    ) -> Optional[str]:
        locator = self._repo_locator_from_task(task)
        branch_name = str(task.branch_name or "").strip()
        if locator is None or not branch_name:
            return None
        existing = self._find_existing_pull_request_for_branch(task=task)
        if existing:
            return existing
        provider = str(locator.get("provider") or "").strip().lower()
        owner = str(locator.get("owner") or "").strip()
        repo = str(locator.get("repo") or "").strip()
        if not owner or not repo:
            return None
        base_branch = self._repo_default_branch(task=task)
        if not base_branch or base_branch == branch_name:
            return None
        title = self._task_display_title(task) or plan_objective or "Automated implementation update"
        title = title[:120]
        body_parts = [
            "Automated pull request opened by Meridian Orchestrator.",
            "",
        ]
        if plan_objective:
            body_parts.append(f"Objective: {plan_objective[:400]}")
        if plan_summary:
            body_parts.append(f"Plan summary: {plan_summary[:400]}")
        body_parts.extend(
            [
                "",
                f"Task: {task.task_id}",
                f"Branch: {branch_name}",
            ]
        )
        payload: Dict[str, Any] = {
            "title": title,
            "base": base_branch,
            "body": "\n".join(body_parts).strip(),
        }
        if provider == "github":
            base = self.github_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="github")
            headers = self._github_headers(token)
            payload["head"] = f"{owner}:{branch_name}"
        else:
            base = self.forgejo_api_base_url.rstrip("/")
            token = self._resolve_integration_token(task=task, provider="forgejo")
            headers = self._forgejo_headers(token)
            payload["head"] = branch_name
        if not base or not token:
            return None
        try:
            response = self._openai_http.post(
                f"{base}/repos/{owner}/{repo}/pulls",
                headers=headers,
                json=payload,
                timeout=self.scm_request_timeout_seconds,
            )
            if response.status_code >= 400:
                return None
            pr_payload = response.json() if response.content else {}
            pr_url = str(pr_payload.get("html_url") or pr_payload.get("url") or "").strip()
            if not pr_url:
                return None
            session = self.store.get_worker_session_by_task_id(task.task_id)
            if session is not None:
                self.store.update_worker_session(
                    worker_session_id=session.worker_session_id,
                    pr_url=pr_url,
                    last_event_type="scm.pull_request_opened",
                    last_event_ts=self.store.now_iso(),
                )
            else:
                current = self.store.get_task(task.task_id)
                if current is not None:
                    self.store.upsert_worker_session_from_task(
                        current,
                        pr_url=pr_url,
                        last_event_type="scm.pull_request_opened",
                        last_event_ts=self.store.now_iso(),
                    )
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="pull_request_opened",
                message="Controller opened a pull request for the pushed worker branch",
                data={"pr_url": pr_url, "base_branch": base_branch, "branch_name": branch_name},
            )
            return pr_url
        except Exception:
            return None

    def _collect_plan_repo_evidence(
        self,
        tasks: List[TaskRecord],
        *,
        plan_summary: str,
        plan_objective: str,
        required_evidence: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        pr_urls: List[str] = []
        pr_statuses: List[Dict[str, str]] = []
        remote_branches: List[Dict[str, str]] = []
        preview_urls: List[str] = []
        required = dict(required_evidence or {})
        requires_pr = bool(required.get("require_pull_request"))
        prefers_pr = bool(required.get("prefer_pull_request"))

        for task in tasks:
            preview_url = str(task.preview_url or "").strip()
            if preview_url and preview_url not in preview_urls:
                preview_urls.append(preview_url)

            if (requires_pr or prefers_pr) and not str(self._detect_pr_url_for_task(task) or "").strip():
                opened_pr = self._open_pull_request_for_task(
                    task=task,
                    plan_summary=plan_summary,
                    plan_objective=plan_objective,
                )
                if opened_pr and opened_pr not in pr_urls:
                    pr_urls.append(opened_pr)

            pr_url = self._detect_pr_url_for_task(task)
            if pr_url and pr_url not in pr_urls:
                pr_urls.append(pr_url)
                probe = self._probe_pr_status(task=task, pr_url=pr_url)
                if probe is not None:
                    pr_statuses.append(
                        {
                            "pr_url": probe.pr_url,
                            "provider": probe.provider,
                            "state": probe.pr_state,
                            "ci_status": probe.ci_status,
                            "review_status": probe.review_status,
                            "mergeability": probe.mergeability,
                        }
                    )

            branch_probe = self._probe_remote_branch(task=task)
            if branch_probe is not None and branch_probe not in remote_branches:
                remote_branches.append(branch_probe)

        return {
            "pr_urls": pr_urls,
            "pr_statuses": pr_statuses,
            "remote_branches": remote_branches,
            "preview_urls": preview_urls,
            "ci_statuses": merge_unique_text(
                [
                    str(item.get("ci_status") or "").strip()
                    for item in pr_statuses
                    if str(item.get("ci_status") or "").strip()
                ]
            ),
            "repo_push_evidence_detected": bool(pr_urls or remote_branches),
            "deliverable_evidence_detected": bool(pr_urls or remote_branches or preview_urls),
            "runtime_evidence_detected": bool(preview_urls),
            "deployment_evidence_detected": bool(preview_urls),
            "pull_request_evidence_detected": bool(pr_urls),
            "ci_evidence_detected": bool(pr_statuses),
        }

    def _supervisor_session_for_plan(
        self,
        *,
        topic_scope_id: str,
        plan_revision_id: Optional[str],
    ):
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return None
        session_id = ""
        plan_id = str(plan_revision_id or "").strip()
        if plan_id:
            plan = self.store.get_plan_revision(plan_id)
            if plan is not None:
                session_id = str(plan.session_id or "").strip()
        return self.store.get_or_create_supervisor_session(
            topic_scope_id=scope,
            session_id=session_id or None,
            status="active",
        )

    @staticmethod
    def _task_contract(task: TaskRecord) -> Dict[str, Any]:
        options = task.options if isinstance(task.options, dict) else {}
        contract = options.get("task_contract")
        return dict(contract) if isinstance(contract, dict) else {}

    @staticmethod
    def _option_key_truthy(options: Dict[str, Any], key: str) -> bool:
        return str(options.get(key) or "").strip().lower() in {"1", "true", "yes", "on"}

    def _task_requires_repo_output(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "requires_repo_output"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("requires_repo_output") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        required_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("required_artifacts") or [])
            if str(item).strip()
        }
        if {"branch_or_pr", "code_changes"} & required_artifacts:
            return True
        return task_requires_executable_backend(
            instruction=task.instruction,
            assigned_role=task.assigned_role or "",
            options=options,
        )

    def _task_requires_verification(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "requires_verification"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("requires_verification") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        return False

    def _task_requires_runtime_evidence(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "requires_runtime_evidence"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("requires_runtime_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        required_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("required_artifacts") or [])
            if str(item).strip()
        }
        return "runtime_evidence" in required_artifacts

    def _task_requires_deployment_evidence(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "requires_deployment_evidence"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("requires_deployment_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        required_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("required_artifacts") or [])
            if str(item).strip()
        }
        return "preview_url" in required_artifacts

    def _task_prefers_pull_request(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "prefer_pull_request"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("prefer_pull_request") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        preferred_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("preferred_artifacts") or [])
            if str(item).strip()
        }
        return "pull_request_url" in preferred_artifacts

    def _task_requires_pull_request(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "require_pull_request"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("require_pull_request") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        required_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("required_artifacts") or [])
            if str(item).strip()
        }
        return "pull_request_url" in required_artifacts

    def _task_requires_ci_evidence(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "requires_ci_evidence"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("requires_ci_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        required_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("required_artifacts") or [])
            if str(item).strip()
        }
        return "ci_status" in required_artifacts

    def _task_requires_traceability(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        if self._option_key_truthy(options, "requires_traceability"):
            return True
        contract = self._task_contract(task)
        if str(contract.get("requires_traceability") or "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        required_artifacts = {
            str(item).strip().lower()
            for item in (contract.get("required_artifacts") or [])
            if str(item).strip()
        }
        return "traceability_summary" in required_artifacts

    def _plan_required_evidence(
        self,
        tasks: List[TaskRecord],
        *,
        plan_summary: str,
        plan_objective: str,
    ) -> Dict[str, Any]:
        required_artifacts: List[str] = []
        evidence_classes: List[str] = []
        inferred_expectations = derive_delivery_expectations_from_text(
            plan_objective,
            plan_summary,
            *[self._task_display_title(task) for task in tasks],
            *[str(task.instruction or "") for task in tasks],
        )
        task_delivery_expectations: Dict[str, bool] = {}
        for task in tasks:
            contract = self._task_contract(task)
            required_artifacts.extend(
                [str(item).strip() for item in (contract.get("required_artifacts") or []) if str(item).strip()]
            )
            evidence_classes.extend(
                [str(item).strip() for item in (contract.get("evidence_classes") or []) if str(item).strip()]
            )
            task_delivery_expectations = merge_delivery_expectations(
                task_delivery_expectations,
                delivery_expectations_from_options(task.options if isinstance(task.options, dict) else {}),
            )

        merged_expectations = merge_delivery_expectations(
            inferred_expectations,
            task_delivery_expectations,
        )

        requires_repo_output = any(self._task_requires_repo_output(task) for task in tasks) or bool(
            merged_expectations.get("requires_repo_output")
        )
        requires_verification = any(self._task_requires_verification(task) for task in tasks) or bool(
            merged_expectations.get("requires_verification")
        )
        requires_runtime_evidence = any(self._task_requires_runtime_evidence(task) for task in tasks) or bool(
            merged_expectations.get("requires_runtime_evidence")
        )
        requires_deployment_evidence = any(self._task_requires_deployment_evidence(task) for task in tasks) or bool(
            merged_expectations.get("requires_deployment_evidence")
        )
        prefer_pull_request = any(self._task_prefers_pull_request(task) for task in tasks) or bool(
            merged_expectations.get("prefer_pull_request")
        )
        require_pull_request = any(self._task_requires_pull_request(task) for task in tasks) or bool(
            merged_expectations.get("require_pull_request")
        )
        requires_ci_evidence = any(self._task_requires_ci_evidence(task) for task in tasks) or bool(
            merged_expectations.get("requires_ci_evidence")
        )
        requires_traceability = any(self._task_requires_traceability(task) for task in tasks) or bool(
            merged_expectations.get("requires_traceability")
        )

        if requires_repo_output:
            required_artifacts.extend(["code_changes", "branch_or_pr"])
            evidence_classes.append("code")
            evidence_classes.append("scm")
        if requires_verification:
            required_artifacts.append("verification_results")
            evidence_classes.append("validation")
        if requires_runtime_evidence:
            required_artifacts.append("runtime_evidence")
            evidence_classes.append("runtime")
        if requires_deployment_evidence:
            required_artifacts.append("preview_url")
            evidence_classes.append("deployment")
        if require_pull_request:
            required_artifacts.append("pull_request_url")
            evidence_classes.append("scm")
        if requires_ci_evidence:
            required_artifacts.append("ci_status")
            evidence_classes.append("ci")
        if requires_traceability:
            required_artifacts.append("traceability_summary")
            evidence_classes.append("traceability")

        return {
            "required_artifacts": merge_unique_text(required_artifacts),
            "evidence_classes": merge_unique_text(evidence_classes),
            "requires_repo_output": requires_repo_output,
            "requires_verification": requires_verification,
            "requires_runtime_evidence": requires_runtime_evidence,
            "requires_deployment_evidence": requires_deployment_evidence,
            "prefer_pull_request": prefer_pull_request,
            "require_pull_request": require_pull_request,
            "requires_ci_evidence": requires_ci_evidence,
            "requires_traceability": requires_traceability,
        }

    def _follow_up_backend_summary(self) -> List[Dict[str, Any]]:
        summary: List[Dict[str, Any]] = []
        for provider in merge_unique_text(["codex", "claude_code", "opencode"]):
            profile = provider_backend_profile(
                provider=provider,
                execution_backend=self.execution_backend,
                provider_commands=self.provider_commands,
                codex_api_enabled=self.codex_api_enabled,
                opencode_api_enabled=self.opencode_api_enabled,
            )
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

    def _select_follow_up_provider(
        self,
        *,
        provider_hint: str,
        instruction: str,
        assigned_role: str,
        options: Dict[str, Any],
    ) -> Tuple[Optional[str], Dict[str, Any], Optional[Dict[str, Any]]]:
        clean_options = dict(options if isinstance(options, dict) else {})
        requires_execution = task_requires_executable_backend(
            instruction=instruction,
            assigned_role=assigned_role,
            options=clean_options,
        )
        candidates = merge_unique_text(
            [
                normalize_provider_id(provider_hint),
                "codex",
                "claude_code",
                "opencode",
            ]
        )
        profiles: Dict[str, Dict[str, Any]] = {}
        for provider in candidates:
            profiles[provider] = provider_backend_profile(
                provider=provider,
                execution_backend=self.execution_backend,
                provider_commands=self.provider_commands,
                codex_api_enabled=self.codex_api_enabled,
                opencode_api_enabled=self.opencode_api_enabled,
            )
        ordered_candidates = list(candidates)
        if not requires_execution:
            api_text_candidates = [
                provider
                for provider in candidates
                if str((profiles.get(provider) or {}).get("default_mode") or "").strip().lower() == "api_text"
            ]
            ordered_candidates = api_text_candidates + [
                provider for provider in candidates if provider not in api_text_candidates
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
            selected = dict(clean_options)
            if requires_execution:
                selected["required_backend_capability"] = "executable"
                selected["requires_executable_backend"] = True
                selected["worker_execution_mode"] = "command"
            else:
                default_mode = str(profile.get("default_mode") or "").strip().lower()
                if default_mode in {"command", "api_text"}:
                    selected["worker_execution_mode"] = default_mode
            return provider, selected, None

        return (
            None,
            clean_options,
            {
                "reason": "no_executable_worker_backend"
                if requires_execution
                else "no_worker_backend_available",
                "required_capability": "executable" if requires_execution else "any",
                "requested_provider": normalize_provider_id(provider_hint),
                "backend_capabilities": self._follow_up_backend_summary(),
            },
        )

    @staticmethod
    def _select_follow_up_source_task(tasks: List[TaskRecord]) -> Optional[TaskRecord]:
        if not tasks:
            return None
        role_order = {"writer": 0, "read_only": 1, "verify": 2}
        best_role = min(
            role_order.get(str(item.assigned_role or "").strip().lower(), 9)
            for item in tasks
        )
        candidates = [
            item
            for item in tasks
            if role_order.get(str(item.assigned_role or "").strip().lower(), 9) == best_role
        ]
        return max(
            candidates,
            key=lambda item: (
                str(item.updated_at or item.finished_at or item.created_at or ""),
                str(item.task_id or ""),
            ),
        )

    def _build_plan_follow_up_instruction(
        self,
        *,
        repo_id: str,
        plan_summary: str,
        plan_objective: str,
        tasks: List[TaskRecord],
        missing_evidence: List[str],
    ) -> str:
        objective = " ".join(value for value in [plan_objective, plan_summary] if value).strip()
        completed_titles = merge_unique_text(
            [
                self._task_display_title(item)
                for item in tasks
                if str(item.status or "").strip().lower() == "done"
            ]
        )
        lines = [
            "Continue execution for this repo-bound objective.",
            "The previous plan reached terminal task states without all required delivery evidence.",
            "Do actual repository work now and close the missing evidence gaps instead of stopping at analysis or planning.",
        ]
        if repo_id:
            lines.append(f"Repo: {repo_id}")
        if objective:
            lines.append(f"Objective: {objective[:300]}")
        if completed_titles:
            lines.append("Use the completed plan outputs as input:")
            for title in completed_titles[:6]:
                lines.append(f"- {title}")
        lines.extend(
            [
                "",
                "Missing evidence to close in this follow-up:",
            ]
        )
        for item in missing_evidence:
            if item == "repo_output":
                lines.append("- make code changes in the bound repo and push the worker branch")
            elif item == "verification_results":
                lines.append("- run verification commands and include their output")
            elif item == "runtime_evidence":
                lines.append("- start the changed workflow or application and capture runtime evidence")
            elif item == "preview_url":
                lines.append(
                    "- publish a dev/preview URL; if the app exposes a local dev server, report `preview_port: <port>`"
                )
            elif item == "pull_request_url":
                lines.append("- open a pull request from the pushed branch and report the URL")
            elif item == "ci_status":
                lines.append("- report CI or status-check state for the branch or PR")
            elif item == "traceability_summary":
                lines.append("- map the delivered artifacts back to the request or acceptance criteria")
        lines.extend(
            [
                "",
                "Required evidence before reporting done:",
                "- changed files summary",
                "- verification results from commands or CI",
                "- pushed branch name and PR URL when a PR is opened",
                "",
                "If blocked, report the exact missing dependency instead of claiming completion.",
            ]
        )
        return "\n".join(lines).strip()

    def _plan_validation_evidence_detected(self, tasks: List[TaskRecord]) -> bool:
        for task in tasks:
            if str(task.status or "").strip().lower() != "done":
                continue
            if not (self._task_requires_verification(task) or str(task.assigned_role or "").strip().lower() == "verify"):
                continue
            if str(task.result_text or "").strip():
                return True
        return False

    def _plan_traceability_evidence_detected(self, tasks: List[TaskRecord]) -> bool:
        for task in tasks:
            if str(task.status or "").strip().lower() != "done":
                continue
            if not self._task_requires_traceability(task):
                continue
            if TRACEABILITY_RESULT_RE.search(str(task.result_text or "")):
                return True
        return False

    def _missing_plan_evidence(
        self,
        *,
        tasks: List[TaskRecord],
        required_evidence: Dict[str, Any],
        repo_evidence: Dict[str, Any],
    ) -> List[str]:
        missing: List[str] = []
        if bool(required_evidence.get("requires_repo_output")) and not bool(
            repo_evidence.get("repo_push_evidence_detected")
        ):
            missing.append("repo_output")
        if bool(required_evidence.get("requires_verification")) and not self._plan_validation_evidence_detected(tasks):
            missing.append("verification_results")
        if bool(required_evidence.get("requires_runtime_evidence")) and not bool(
            repo_evidence.get("runtime_evidence_detected")
        ):
            missing.append("runtime_evidence")
        if bool(required_evidence.get("requires_deployment_evidence")) and not bool(
            repo_evidence.get("deployment_evidence_detected")
        ):
            missing.append("preview_url")
        if bool(required_evidence.get("require_pull_request")) and not bool(
            repo_evidence.get("pull_request_evidence_detected")
        ):
            missing.append("pull_request_url")
        if bool(required_evidence.get("requires_ci_evidence")) and not bool(
            repo_evidence.get("ci_evidence_detected")
        ):
            missing.append("ci_status")
        if bool(required_evidence.get("requires_traceability")) and not self._plan_traceability_evidence_detected(tasks):
            missing.append("traceability_summary")
        return missing

    def _dispatch_plan_follow_up(
        self,
        *,
        topic_scope_id: str,
        plan_revision_id: str,
        session: WorkerSessionRecord | Any,
        metadata: Dict[str, Any],
        signature: str,
        plan_summary: str,
        plan_objective: str,
        tasks: List[TaskRecord],
        required_evidence: Dict[str, Any],
        missing_evidence: List[str],
    ) -> None:
        if not self.plan_follow_up_enabled or self.plan_follow_up_max_attempts <= 0:
            return
        existing = metadata.get("plan_completion_followups")
        followups = dict(existing) if isinstance(existing, dict) else {}
        state = dict(followups.get(plan_revision_id) or {})
        attempt_count = max(0, int(state.get("attempt_count") or 0))
        if state.get("last_signature") == signature:
            return
        if attempt_count >= self.plan_follow_up_max_attempts:
            self.store.append_supervisor_event(
                topic_scope_id=topic_scope_id,
                session_id=session.session_id,
                kind="completion.follow_up",
                role="assistant",
                content_md="\n".join(
                    [
                        "### Completion follow-up blocked",
                        "",
                        f"- Plan: `{plan_revision_id}`",
                        f"- Reason: maximum automatic follow-up attempts reached (`{self.plan_follow_up_max_attempts}`)",
                    ]
                ).strip(),
                payload={
                    "plan_revision_id": plan_revision_id,
                    "outcome": "max_attempts_reached",
                    "attempt_count": attempt_count,
                },
                author_id="supervisor",
                author_name="Supervisor",
            )
            state["last_signature"] = signature
            state["last_outcome"] = "max_attempts_reached"
            state["updated_at"] = self.store.now_iso()
            followups[plan_revision_id] = state
            metadata["plan_completion_followups"] = followups
            self.store.update_supervisor_session(session_id=session.session_id, metadata=metadata)
            return

        source_task = self._select_follow_up_source_task(tasks)
        if source_task is None:
            return
        repo_id = next((str(item.repo_id or "").strip() for item in tasks if str(item.repo_id or "").strip()), "")
        instruction = self._build_plan_follow_up_instruction(
            repo_id=repo_id,
            plan_summary=plan_summary,
            plan_objective=plan_objective,
            tasks=tasks,
            missing_evidence=missing_evidence,
        )
        follow_up_options = dict(source_task.options or {})
        contract = (
            dict(follow_up_options.get("task_contract"))
            if isinstance(follow_up_options.get("task_contract"), dict)
            else {}
        )
        contract["delivery_type"] = "implementation"
        contract["requires_repo_output"] = True
        contract["requires_verification"] = True
        contract["required_artifacts"] = merge_unique_text(
            list(contract.get("required_artifacts") or [])
            + ["code_changes", "verification_results", "branch_or_pr"]
        )
        if bool(required_evidence.get("requires_runtime_evidence")):
            contract["requires_runtime_evidence"] = True
            contract["required_artifacts"] = merge_unique_text(
                list(contract.get("required_artifacts") or []) + ["runtime_evidence"]
            )
        if bool(required_evidence.get("requires_deployment_evidence")):
            contract["requires_deployment_evidence"] = True
            contract["required_artifacts"] = merge_unique_text(
                list(contract.get("required_artifacts") or []) + ["preview_url"]
            )
        if bool(required_evidence.get("prefer_pull_request")):
            contract["prefer_pull_request"] = True
        if bool(required_evidence.get("require_pull_request")):
            contract["require_pull_request"] = True
            contract["required_artifacts"] = merge_unique_text(
                list(contract.get("required_artifacts") or []) + ["pull_request_url"]
            )
        if bool(required_evidence.get("requires_ci_evidence")):
            contract["requires_ci_evidence"] = True
            contract["required_artifacts"] = merge_unique_text(
                list(contract.get("required_artifacts") or []) + ["ci_status"]
            )
        if bool(required_evidence.get("requires_traceability")):
            contract["requires_traceability"] = True
            contract["required_artifacts"] = merge_unique_text(
                list(contract.get("required_artifacts") or []) + ["traceability_summary"]
            )
        contract["done_when"] = merge_unique_text(
            list(contract.get("done_when") or [])
            + [
                "repository changes are made in the bound repo",
                "verification evidence is captured from commands or CI",
                "a pushed branch or PR URL is available before completion",
            ]
        )
        follow_up_options.update(
            {
                "task_contract": contract,
                "completion_follow_up_for_plan_id": plan_revision_id,
                "completion_follow_up_reason": ",".join(missing_evidence) or "missing_delivery_evidence",
                "retry_of_task_id": source_task.task_id,
                "required_backend_capability": "executable",
                "requires_executable_backend": True,
                "requires_repo_output": True,
                "requires_verification": True,
            }
        )
        if bool(required_evidence.get("requires_runtime_evidence")):
            follow_up_options["requires_runtime_evidence"] = True
        if bool(required_evidence.get("requires_deployment_evidence")):
            follow_up_options["requires_deployment_evidence"] = True
            follow_up_options["preview_required"] = True
            follow_up_options["require_preview"] = True
        if bool(required_evidence.get("prefer_pull_request")):
            follow_up_options["prefer_pull_request"] = True
        if bool(required_evidence.get("require_pull_request")):
            follow_up_options["require_pull_request"] = True
        if bool(required_evidence.get("requires_ci_evidence")):
            follow_up_options["requires_ci_evidence"] = True
        if bool(required_evidence.get("requires_traceability")):
            follow_up_options["requires_traceability"] = True
        provider, selected_options, failure = self._select_follow_up_provider(
            provider_hint=source_task.provider,
            instruction=instruction,
            assigned_role=source_task.assigned_role or "",
            options=follow_up_options,
        )
        if not provider:
            self.store.append_supervisor_event(
                topic_scope_id=topic_scope_id,
                session_id=session.session_id,
                kind="completion.follow_up",
                role="assistant",
                content_md="\n".join(
                    [
                        "### Completion follow-up blocked",
                        "",
                        f"- Plan: `{plan_revision_id}`",
                        "- Reason: no executable worker backend is configured for repo-bound follow-up work.",
                    ]
                ).strip(),
                payload={
                    "plan_revision_id": plan_revision_id,
                    "outcome": "blocked_no_backend",
                    **(failure or {}),
                },
                author_id="supervisor",
                author_name="Supervisor",
            )
            state["last_signature"] = signature
            state["last_outcome"] = "blocked_no_backend"
            state["updated_at"] = self.store.now_iso()
            followups[plan_revision_id] = state
            metadata["plan_completion_followups"] = followups
            self.store.update_supervisor_session(session_id=session.session_id, metadata=metadata)
            return

        spawned = self.store.create_task(
            user_id=source_task.user_id,
            repo_id=source_task.repo_id,
            repo_url=source_task.repo_url,
            provider=provider,
            instruction=augment_instruction_with_task_contract(
                instruction=instruction,
                assigned_role=source_task.assigned_role or "writer",
                options=selected_options,
            ),
            zulip_thread_ref=source_task.zulip_thread_ref,
            options=selected_options,
            topic_scope_id=source_task.topic_scope_id,
            assigned_worker=source_task.assigned_worker,
            assigned_role=source_task.assigned_role or "writer",
            assigned_by="supervisor",
            directive_id=source_task.directive_id,
            plan_revision_id=source_task.plan_revision_id,
        )
        self.store.append_event(
            source_task.task_id,
            level="info",
            event_type="plan_completion_follow_up_spawned",
            message=f"Plan completion follow-up spawned as {spawned.task_id}",
            data={"plan_revision_id": plan_revision_id, "spawned_task_id": spawned.task_id},
        )
        self.store.append_supervisor_event(
            topic_scope_id=topic_scope_id,
            session_id=session.session_id,
            kind="completion.follow_up",
            role="assistant",
            content_md="\n".join(
                [
                    "### Completion follow-up dispatched",
                    "",
                    f"- Plan: `{plan_revision_id}`",
                    f"- Spawned task: `{spawned.task_id}`",
                    f"- Provider: `{provider}`",
                    f"- Missing evidence: `{', '.join(missing_evidence) if missing_evidence else 'unknown'}`",
                    "- Reason: the previous plan completed without all required delivery evidence, so execution is continuing.",
                ]
            ).strip(),
            payload={
                    "plan_revision_id": plan_revision_id,
                    "outcome": "dispatched",
                    "spawned_task_id": spawned.task_id,
                    "provider": provider,
                    "missing_evidence": missing_evidence,
                },
                author_id="supervisor",
                author_name="Supervisor",
            )
        state["attempt_count"] = attempt_count + 1
        state["last_signature"] = signature
        state["last_outcome"] = "dispatched"
        state["last_spawned_task_id"] = spawned.task_id
        state["updated_at"] = self.store.now_iso()
        followups[plan_revision_id] = state
        metadata["plan_completion_followups"] = followups
        self.store.update_supervisor_session(session_id=session.session_id, metadata=metadata)
        self.wake()

    @staticmethod
    def _task_display_title(task: TaskRecord) -> str:
        title = derive_task_title(task.instruction, task.options if isinstance(task.options, dict) else {})
        return " ".join(str(title or task.task_id).split()).strip()[:160]

    def _render_plan_completion_assessment(
        self,
        *,
        plan_id: str,
        plan_summary: str,
        plan_objective: str,
        tasks: List[TaskRecord],
        repo_evidence: Dict[str, Any],
        required_evidence: Dict[str, Any],
        implementation_expected: bool,
        follow_up_required: bool,
        missing_evidence: List[str],
    ) -> Tuple[str, Dict[str, Any]]:
        counts: Dict[str, int] = {}
        for item in tasks:
            counts[item.status] = counts.get(item.status, 0) + 1
        count_parts = [f"`{status}` {count}" for status, count in sorted(counts.items())]

        lines = [
            "### Supervisor completion assessment",
            "",
            f"- Plan: `{plan_id}`",
            f"- Tasks: {' | '.join(count_parts) if count_parts else '`0`'}",
        ]
        repo_id = next((str(item.repo_id or "").strip() for item in tasks if str(item.repo_id or "").strip()), "")
        if repo_id:
            lines.append(f"- Repo: `{repo_id}`")
        if plan_objective:
            lines.append(f"- Objective: {plan_objective[:220]}")
        elif plan_summary:
            lines.append(f"- Summary: {plan_summary[:220]}")

        lines.extend(["", "**Task outcomes:**"])
        for item in tasks:
            lines.append(f"- `{item.task_id}` `{item.status}` {self._task_display_title(item)}")

        lines.extend(["", "**Repo output evidence:**"])
        pr_urls = [str(value).strip() for value in (repo_evidence.get("pr_urls") or []) if str(value).strip()]
        pr_statuses = [
            entry
            for entry in (repo_evidence.get("pr_statuses") or [])
            if isinstance(entry, dict)
        ]
        remote_branches = [
            entry
            for entry in (repo_evidence.get("remote_branches") or [])
            if isinstance(entry, dict)
        ]
        preview_urls = [
            str(value).strip()
            for value in (repo_evidence.get("preview_urls") or [])
            if str(value).strip()
        ]
        if pr_urls:
            lines.append(f"- Pull requests: {', '.join(f'`{value}`' for value in pr_urls[:4])}")
        if pr_statuses:
            status_labels = []
            for entry in pr_statuses[:4]:
                pr_url = str(entry.get("pr_url") or "").strip()
                ci_status = str(entry.get("ci_status") or "").strip() or "none"
                review_status = str(entry.get("review_status") or "").strip() or "none"
                mergeability = str(entry.get("mergeability") or "").strip() or "unknown"
                label = f"`{pr_url}` ci=`{ci_status}` review=`{review_status}` mergeability=`{mergeability}`"
                status_labels.append(label)
            lines.append(f"- PR status: {', '.join(status_labels)}")
        if remote_branches:
            branch_labels: List[str] = []
            for entry in remote_branches[:4]:
                branch_name = str(entry.get("branch_name") or "").strip()
                head_sha = str(entry.get("head_sha") or "").strip()
                label = f"`{branch_name}`" if branch_name else "`unknown`"
                if head_sha:
                    label = f"{label} ({head_sha[:12]})"
                branch_labels.append(label)
            branch_text = ", ".join(
                branch_labels
            )
            lines.append(f"- Remote branches: {branch_text}")
        if preview_urls:
            lines.append(f"- Previews: {', '.join(f'`{value}`' for value in preview_urls[:4])}")
        if not pr_urls and not remote_branches and not preview_urls:
            lines.append("- No PR URL, pushed worker branch, or preview URL was detected.")

        required_artifacts = [
            str(value).strip()
            for value in (required_evidence.get("required_artifacts") or [])
            if str(value).strip()
        ]
        evidence_classes = [
            str(value).strip()
            for value in (required_evidence.get("evidence_classes") or [])
            if str(value).strip()
        ]
        if required_artifacts or evidence_classes:
            lines.extend(["", "**Required evidence contract:**"])
            if evidence_classes:
                lines.append(f"- Evidence classes: {', '.join(f'`{value}`' for value in evidence_classes)}")
            if required_artifacts:
                lines.append(f"- Required artifacts: {', '.join(f'`{value}`' for value in required_artifacts)}")
        if missing_evidence:
            lines.extend(["", "**Missing evidence:**"])
            for item in missing_evidence:
                lines.append(f"- `{item}`")

        if follow_up_required:
            outcome = "follow_up_required"
            if implementation_expected:
                assessment = (
                    "The dispatched plan reached terminal task states, but at least one required evidence class "
                    "is still missing. The overall objective should not be treated as complete yet."
                )
            else:
                assessment = (
                    "The dispatched plan reached terminal task states, but at least one task failed or did not "
                    "produce usable delivery evidence. Human review or follow-up work is still required."
                )
        else:
            outcome = "completed"
            assessment = (
                "The dispatched plan reached terminal task states and produced delivery evidence consistent "
                "with the plan objective."
            )

        lines.extend(["", "**Assessment:**", assessment])
        payload = {
            "plan_revision_id": plan_id,
            "repo_id": repo_id,
            "task_count": len(tasks),
            "task_counts": counts,
            "implementation_expected": implementation_expected,
            "follow_up_required": follow_up_required,
            "required_evidence": required_evidence,
            "missing_evidence": missing_evidence,
            "repo_output_evidence": repo_evidence,
            "outcome": outcome,
        }
        return "\n".join(lines).strip(), payload

    def _emit_plan_completion_assessment(self, *, topic_scope_id: str, plan_revision_id: str) -> None:
        all_plan_tasks = [
            item
            for item in self.store.list_tasks_for_topic(topic_scope_id, limit=500)
            if str(item.plan_revision_id or "").strip() == plan_revision_id
        ]
        if not all_plan_tasks:
            return
        tasks = self._effective_plan_tasks(all_plan_tasks)
        if any(not self._is_terminal_task_status(item.status) for item in tasks):
            return

        session = self._supervisor_session_for_plan(
            topic_scope_id=topic_scope_id,
            plan_revision_id=plan_revision_id,
        )
        if session is None:
            return
        metadata = dict(session.metadata if isinstance(session.metadata, dict) else {})
        existing = metadata.get("plan_completion_assessments")
        assessments = dict(existing) if isinstance(existing, dict) else {}
        signature = self._plan_completion_signature(tasks)
        existing_entry = assessments.get(plan_revision_id) if isinstance(assessments.get(plan_revision_id), dict) else {}
        if existing_entry.get("signature") == signature:
            return

        plan = self.store.get_plan_revision(plan_revision_id)
        plan_summary = str(plan.summary or "").strip() if plan is not None else ""
        plan_objective = str(plan.objective or "").strip() if plan is not None else ""
        objective_source = " ".join(
            value
            for value in [plan_objective, plan_summary]
            if value
        ).strip()
        implementation_expected = bool(IMPLEMENTATION_HINT_RE.search(objective_source)) or any(
            self._task_requires_repo_output(item) for item in tasks
        )
        required_evidence = self._plan_required_evidence(
            tasks,
            plan_summary=plan_summary,
            plan_objective=plan_objective,
        )
        repo_evidence = self._collect_plan_repo_evidence(
            tasks,
            plan_summary=plan_summary,
            plan_objective=plan_objective,
            required_evidence=required_evidence,
        )
        missing_evidence = self._missing_plan_evidence(
            tasks=tasks,
            required_evidence=required_evidence,
            repo_evidence=repo_evidence,
        )
        all_done = all(str(item.status or "").strip().lower() == "done" for item in tasks)
        follow_up_required = not all_done or bool(missing_evidence)

        content_md, payload = self._render_plan_completion_assessment(
            plan_id=plan_revision_id,
            plan_summary=plan_summary,
            plan_objective=plan_objective,
            tasks=sorted(tasks, key=lambda item: str(item.created_at or "")),
            repo_evidence=repo_evidence,
            required_evidence=required_evidence,
            implementation_expected=implementation_expected,
            follow_up_required=follow_up_required,
            missing_evidence=missing_evidence,
        )
        self.store.append_supervisor_event(
            topic_scope_id=topic_scope_id,
            session_id=session.session_id,
            kind="completion.review",
            role="assistant",
            content_md=content_md,
            payload=payload,
            author_id="supervisor",
            author_name="Supervisor",
        )
        assessments[plan_revision_id] = {
            "signature": signature,
            "follow_up_required": follow_up_required,
            "outcome": payload.get("outcome"),
            "missing_evidence": list(missing_evidence),
            "required_evidence": required_evidence,
            "updated_at": self.store.now_iso(),
        }
        metadata["plan_completion_assessments"] = assessments
        self.store.update_supervisor_session(session_id=session.session_id, metadata=metadata)
        if follow_up_required and implementation_expected:
            self._dispatch_plan_follow_up(
                topic_scope_id=topic_scope_id,
                plan_revision_id=plan_revision_id,
                session=session,
                metadata=metadata,
                signature=signature,
                plan_summary=plan_summary,
                plan_objective=plan_objective,
                tasks=sorted(tasks, key=lambda item: str(item.created_at or "")),
                required_evidence=required_evidence,
                missing_evidence=missing_evidence,
            )

    def _emit_plan_completion_assessments(self) -> None:
        terminal_tasks = self.store.list_tasks_by_status(
            statuses=["done", "failed", "canceled"],
            limit=2000,
        )
        candidates = {
            (str(task.topic_scope_id or "").strip(), str(task.plan_revision_id or "").strip())
            for task in terminal_tasks
            if str(task.topic_scope_id or "").strip() and str(task.plan_revision_id or "").strip()
        }
        for topic_scope_id, plan_revision_id in sorted(candidates):
            self._emit_plan_completion_assessment(
                topic_scope_id=topic_scope_id,
                plan_revision_id=plan_revision_id,
            )

    def _evaluate_task_health(self) -> None:
        monitored = self.store.list_tasks_by_status(statuses=["running", "at_risk"], limit=500)
        if not monitored:
            return

        for task in monitored:
            if task.worker_id and task.worker_id != self.worker_id:
                continue

            age_seconds = self._iso_age_seconds(task.updated_at)
            if self.auto_stall_detect_enabled and age_seconds >= self.auto_stall_seconds:
                reason = (
                    f"no meaningful event progress beyond threshold "
                    f"({int(age_seconds)}s >= {int(self.auto_stall_seconds)}s)"
                )
                if task.status == "running":
                    self._mark_task_at_risk(
                        task,
                        reason=reason,
                        event_type="task_auto_at_risk_stalled",
                        data={
                            "updated_age_seconds": int(age_seconds),
                            "threshold_seconds": int(self.auto_stall_seconds),
                        },
                    )
                    continue
                if (
                    task.status == "at_risk"
                    and age_seconds >= self.auto_pause_after_at_risk_seconds
                ):
                    self._pause_at_risk_task(
                        task,
                        reason=(
                            "paused by supervisor policy after sustained at_risk stall "
                            f"({int(age_seconds)}s)"
                        ),
                        event_type="task_auto_paused_stalled",
                        data={
                            "updated_age_seconds": int(age_seconds),
                            "pause_threshold_seconds": int(self.auto_pause_after_at_risk_seconds),
                        },
                    )
                    continue

            if not self.auto_loop_detect_enabled:
                continue

            recent_events = self.store.list_events(task.task_id, after_id=0, limit=24)
            if len(recent_events) < self.auto_loop_repeat_threshold:
                continue
            tail = recent_events[-self.auto_loop_repeat_threshold :]
            if not all(self._event_is_failure(item) for item in tail):
                continue

            fingerprints = [self._event_failure_fingerprint(item) for item in tail]
            if len(set(fingerprints)) != 1:
                continue

            if task.status == "running":
                self._mark_task_at_risk(
                    task,
                    reason="repeated failure pattern detected; supervisor marked at_risk",
                    event_type="task_auto_at_risk_looping",
                    data={
                        "repeat_threshold": self.auto_loop_repeat_threshold,
                        "fingerprint": fingerprints[0],
                    },
                )
                continue

            if task.status == "at_risk":
                self._pause_at_risk_task(
                    task,
                    reason="paused by supervisor policy after repeated failure pattern",
                    event_type="task_auto_paused_looping",
                    data={
                        "repeat_threshold": self.auto_loop_repeat_threshold,
                        "fingerprint": fingerprints[0],
                    },
                )

    def _recover_orphaned_running_tasks(self) -> None:
        if not self.orphan_running_recovery_enabled:
            return

        running = self.store.list_tasks_by_status(statuses=["running"], limit=500)
        if not running:
            return

        with self._task_threads_lock:
            active_thread_ids = set(self._task_threads.keys())

        for task in running:
            if task.task_id in active_thread_ids:
                continue
            if task.worker_id and task.worker_id != self.worker_id:
                continue
            age_seconds = self._iso_age_seconds(task.updated_at)
            if age_seconds < self.orphan_running_recovery_seconds:
                continue

            updated = self.store.set_task_status(
                task_id=task.task_id,
                status="paused",
                blocked_reason="recovered after coordinator restart; manual resume required",
                clear_cancel_requested=False,
            )
            if updated is None:
                continue
            self.store.append_event(
                task.task_id,
                level="warning",
                event_type="task_recovered_orphaned_running",
                message="Recovered orphaned running task into paused state",
                data={
                    "worker_id": task.worker_id,
                    "age_seconds": int(age_seconds),
                },
            )
            if self.lifecycle_manager is not None:
                self.lifecycle_manager.sync_from_task(
                    updated,
                    event_type="task_recovered_orphaned_running",
                    trigger="task.stalled",
                )

    def _dispatch_queued_tasks(self) -> None:
        if self._active_task_count() >= self.max_parallel_tasks:
            return

        queued = self.store.list_queued_tasks(limit=200)
        for task in queued:
            if self._stop.is_set():
                return
            if self._active_task_count() >= self.max_parallel_tasks:
                return

            try:
                dependencies_ok, pending_deps = self.store.dependencies_satisfied(task)
                if not dependencies_ok:
                    pending_text = ", ".join(pending_deps[:20])
                    blocked = self.store.set_task_status(
                        task_id=task.task_id,
                        status="blocked_dependency",
                        blocked_reason=(
                            f"waiting for dependencies: {pending_text}"
                            if pending_text
                            else "waiting for dependencies"
                        ),
                        clear_cancel_requested=False,
                    )
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="task_blocked_dependency",
                        message="Task blocked until dependency tasks are done",
                        data={"pending_dependencies": pending_deps},
                    )
                    if self.lifecycle_manager is not None and blocked is not None:
                        self.lifecycle_manager.sync_from_task(
                            blocked,
                            event_type="task_blocked_dependency",
                            apply_reactions=False,
                        )
                    continue

                if self.approval_blocking_enabled and self._task_requires_approval(task) and not task.approved:
                    blocked = self.store.set_task_status(
                        task_id=task.task_id,
                        status="blocked_approval",
                        blocked_reason="awaiting human approval",
                        clear_cancel_requested=False,
                    )
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="task_blocked_approval",
                        message="Task blocked pending human approval",
                        data={
                            "approval_required": True,
                            "approved": bool(task.approved),
                        },
                    )
                    if self.lifecycle_manager is not None and blocked is not None:
                        self.lifecycle_manager.sync_from_task(
                            blocked,
                            event_type="task_blocked_approval",
                            trigger="approval.required",
                        )
                    continue

                claim_conflicts = self.store.find_claim_conflicts(task)
                if claim_conflicts.get("conflict"):
                    stalled = self.store.set_task_status(
                        task_id=task.task_id,
                        status="stalled",
                        blocked_reason="claim_conflict: conflicting file/area claims",
                        clear_cancel_requested=False,
                    )
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="task_stalled_claim_conflict",
                        message="Task stalled due to conflicting file/area claims",
                        data=claim_conflicts,
                    )
                    if self.lifecycle_manager is not None and stalled is not None:
                        self.lifecycle_manager.sync_from_task(
                            stalled,
                            event_type="task_stalled_claim_conflict",
                            trigger="task.stalled",
                        )
                    continue

                mapping = self._ensure_workspace_mapping(task)
                if not mapping.workspace_id:
                    raise RuntimeError("workspace mapping exists but has empty workspace_id")

                running_for_workspace = self.store.count_running_tasks_for_workspace(mapping.workspace_id)
                if running_for_workspace >= self.per_workspace_concurrency:
                    continue

                branch_name = self._branch_name(task)
                worktree_path = self._worktree_path(task)
                container_name = self._task_container_name(task)
                claimed = self.store.claim_task(
                    task_id=task.task_id,
                    worker_id=self.worker_id,
                    workspace_id=mapping.workspace_id,
                    workspace_name=mapping.workspace_name,
                    branch_name=branch_name,
                    worktree_path=worktree_path,
                    container_name=container_name,
                    container_runtime=self.task_container_runtime,
                )
                if not claimed:
                    continue
                claimed_task = self.store.get_task(task.task_id)

                self.store.append_event(
                    task.task_id,
                    level="info",
                    event_type="task_claimed",
                    message="Task claimed by coordinator",
                    data={
                        "worker_id": self.worker_id,
                        "workspace_id": mapping.workspace_id,
                        "workspace_name": mapping.workspace_name,
                        "branch_name": branch_name,
                        "worktree_path": worktree_path,
                        "container_name": container_name,
                        "container_runtime": self.task_container_runtime,
                        "workspace_scope": self.workspace_scope,
                    },
                )
                if self.lifecycle_manager is not None and claimed_task is not None:
                    self.lifecycle_manager.sync_from_task(
                        claimed_task,
                        event_type="lifecycle.session.spawned",
                        trigger="task.started",
                    )
                self.store.append_event(
                    task.task_id,
                    level="info",
                    event_type="worktree.created",
                    message=f"Worktree prepared: {worktree_path}",
                    data={
                        "branch_name": branch_name,
                        "worktree_path": worktree_path,
                        "workspace_id": mapping.workspace_id,
                    },
                )
                self.store.append_event(
                    task.task_id,
                    level="info",
                    event_type="container.created",
                    message=f"Task container created: {container_name}",
                    data={
                        "container_name": container_name,
                        "container_runtime": self.task_container_runtime,
                        "workspace_id": mapping.workspace_id,
                    },
                )

                thread = threading.Thread(
                    target=self._run_task,
                    args=(task.task_id,),
                    name=f"task-{task.task_id}",
                    daemon=True,
                )
                with self._task_threads_lock:
                    self._task_threads[task.task_id] = thread
                thread.start()
            except Exception as exc:
                logging.exception("failed dispatching task %s: %s", task.task_id, exc)
                self.store.append_event(
                    task.task_id,
                    level="error",
                    event_type="task_dispatch_error",
                    message=str(exc),
                )
                failed = self.store.finish_task(
                    task_id=task.task_id,
                    status="failed",
                    error_text=str(exc),
                )
                if self.lifecycle_manager is not None and failed is not None:
                    self.lifecycle_manager.sync_from_task(
                        failed,
                        event_type="task_dispatch_error",
                        trigger="task.failed",
                    )

    def _ensure_workspace_mapping(self, task: TaskRecord):
        mapping_user_id = self._workspace_mapping_user_id(task)
        mapping = self.store.get_workspace_mapping(mapping_user_id, task.repo_id)

        workspace_owner = self._workspace_owner_for_task(task)
        workspace_name = self._workspace_name(task)

        if mapping is None:
            mapping = self.store.upsert_workspace_mapping(
                user_id=mapping_user_id,
                repo_id=task.repo_id,
                repo_url=task.repo_url,
                workspace_name=workspace_name,
                workspace_owner=workspace_owner,
                workspace_id=None,
            )
        elif mapping.workspace_owner != workspace_owner or mapping.workspace_name != workspace_name:
            mapping = self.store.upsert_workspace_mapping(
                user_id=mapping_user_id,
                repo_id=task.repo_id,
                repo_url=task.repo_url,
                workspace_name=workspace_name,
                workspace_owner=workspace_owner,
                workspace_id=mapping.workspace_id,
            )

        if mapping.workspace_id:
            return mapping

        if self.execution_backend == "local":
            updated = self.store.set_workspace_identity(
                user_id=mapping_user_id,
                repo_id=task.repo_id,
                workspace_id=self._local_workspace_id(task),
            )
            if updated is None:
                raise RuntimeError("failed to assign local workspace identity")
            return updated

        if self.coder is None:
            raise RuntimeError("coder integration is disabled; set CODER_API_TOKEN and CODER_BASE_URL")
        if not self.template_id:
            raise RuntimeError("CODER_TEMPLATE_ID is required to create workspaces")

        existing = self.coder.find_workspace_by_name(
            owner=mapping.workspace_owner,
            workspace_name=mapping.workspace_name,
        )
        workspace: Dict[str, Any]
        if existing is not None:
            workspace = existing
        else:
            create_overrides = {}
            raw_overrides = os.getenv("CODER_CREATE_WORKSPACE_OVERRIDES_JSON", "").strip()
            if raw_overrides:
                try:
                    parsed = json.loads(raw_overrides)
                    if isinstance(parsed, dict):
                        create_overrides = parsed
                except Exception:
                    logging.warning("invalid CODER_CREATE_WORKSPACE_OVERRIDES_JSON; ignoring")

            workspace = self.coder.create_workspace(
                owner=mapping.workspace_owner,
                workspace_name=mapping.workspace_name,
                template_id=self.template_id,
                template_version_id=self.template_version_id or None,
                repo_url=task.repo_url,
                parameter_values={
                    "repo_id": task.repo_id,
                    "repo_url": task.repo_url or "",
                    "workspace_owner": mapping.workspace_owner,
                },
                create_overrides=create_overrides,
            )

        workspace_id = str(workspace.get("id") or workspace.get("workspace_id") or "").strip()
        if not workspace_id:
            # Fallback: use name identifier accepted by many Coder APIs.
            workspace_id = mapping.workspace_name

        updated = self.store.set_workspace_identity(
            user_id=mapping_user_id,
            repo_id=task.repo_id,
            workspace_id=workspace_id,
        )
        if updated is None:
            raise RuntimeError("failed to update workspace mapping identity")
        return updated

    def _ensure_workspace_running(self, task: TaskRecord) -> Dict[str, Any]:
        if self.execution_backend == "local":
            workspace_id = str(task.workspace_id or "").strip() or self._local_workspace_id(task)
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="workspace_ready",
                message="Local execution backend is ready",
                data={"workspace_id": workspace_id, "execution_backend": "local"},
            )
            return {"workspace_id": workspace_id, "backend": "local"}
        if self.coder is None:
            raise RuntimeError("coder integration is disabled")
        workspace_id = str(task.workspace_id or "").strip()
        if not workspace_id:
            raise RuntimeError("task has no workspace_id")

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="workspace_start_requested",
            message="Ensuring workspace is running",
            data={"workspace_id": workspace_id},
        )

        workspace = self.coder.get_workspace(workspace_id)
        if not self.coder.workspace_ready(workspace):
            self.coder.start_workspace(workspace_id)
            workspace = self.coder.wait_workspace_ready(workspace_id)

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="workspace_ready",
            message="Workspace is ready",
            data={"workspace_id": workspace_id},
        )
        return workspace

    def _local_repo_root(self, task: TaskRecord) -> Path:
        return self.local_work_root / self._slug(task.repo_id)

    def _local_mirror_path(self, task: TaskRecord) -> Path:
        return self._local_repo_root(task) / "mirror.git"

    def _local_repo_lock(self, task: TaskRecord) -> threading.Lock:
        repo_key = self._slug(task.repo_id)
        with self._local_repo_locks_lock:
            lock = self._local_repo_locks.get(repo_key)
            if lock is None:
                lock = threading.Lock()
                self._local_repo_locks[repo_key] = lock
        return lock

    def _task_git_http_auth(self, task: TaskRecord) -> Tuple[str, str]:
        repo_url = str(task.repo_url or "").strip()
        if not repo_url:
            return "", ""
        parsed = urlparse(repo_url)
        host = str(parsed.netloc or "").strip().lower()
        if not host:
            return "", ""
        forgejo_host = str(urlparse(self.forgejo_api_base_url).netloc or "").strip().lower()
        github_host = str(urlparse(self.github_api_base_url).netloc or "github.com").strip().lower()
        if forgejo_host and host == forgejo_host and self.forgejo_api_key:
            login = str(os.getenv("FORGEJO_USERNAME", "")).strip()
            if not login:
                try:
                    response = self._openai_http.get(
                        f"{self.forgejo_api_base_url.rstrip('/')}/user",
                        headers=self._forgejo_headers(self.forgejo_api_key),
                        timeout=self.scm_request_timeout_seconds,
                    )
                    if response.status_code < 400:
                        payload = response.json() if response.content else {}
                        login = str(payload.get("login") or "").strip()
                except Exception:
                    login = ""
            return login or "oauth2", self.forgejo_api_key
        if host == github_host and self.github_api_key:
            return "x-access-token", self.github_api_key
        return "", ""

    def _ensure_git_askpass_script(self) -> Path:
        script_dir = self.local_work_root / ".auth"
        script_dir.mkdir(parents=True, exist_ok=True)
        script_path = script_dir / "git-askpass.sh"
        if not script_path.exists():
            script_path.write_text(
                "#!/bin/sh\n"
                "case \"$1\" in\n"
                "  *Username*) printf '%s' \"${MERIDIAN_GIT_HTTP_USERNAME:-}\" ;;\n"
                "  *) printf '%s' \"${MERIDIAN_GIT_HTTP_PASSWORD:-}\" ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            script_path.chmod(0o700)
        return script_path

    def _git_command_env(self, task: TaskRecord) -> Dict[str, str]:
        env = dict(os.environ)
        username, password = self._task_git_http_auth(task)
        if username and password:
            askpass = self._ensure_git_askpass_script()
            env["GIT_TERMINAL_PROMPT"] = "0"
            env["GIT_ASKPASS"] = str(askpass)
            env["MERIDIAN_GIT_HTTP_USERNAME"] = username
            env["MERIDIAN_GIT_HTTP_PASSWORD"] = password
        actor_email = str(task.user_id or "").strip() or "worker@meridian.local"
        env.setdefault("GIT_AUTHOR_NAME", "Meridian Worker")
        env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
        env.setdefault("GIT_AUTHOR_EMAIL", actor_email)
        env.setdefault("GIT_COMMITTER_EMAIL", actor_email)
        return env

    def _run_git_for_task(
        self,
        task: TaskRecord,
        args: List[str],
        *,
        cwd: Optional[Path] = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd is not None else None,
            env=self._git_command_env(task),
            text=True,
            capture_output=True,
            timeout=max(30.0, self.scm_request_timeout_seconds * 10),
        )
        if check and completed.returncode != 0:
            stderr = (completed.stderr or completed.stdout or "git command failed").strip()
            raise RuntimeError(f"git command failed ({' '.join(['git', *args])}): {stderr}")
        return completed

    def _default_branch_for_task(self, task: TaskRecord, mirror_path: Path) -> str:
        candidates: List[str] = []
        try:
            completed = self._run_git_for_task(
                task,
                ["--git-dir", str(mirror_path), "symbolic-ref", "HEAD"],
            )
            head_ref = str(completed.stdout or "").strip()
            if head_ref.startswith("refs/heads/"):
                candidates.append(head_ref.removeprefix("refs/heads/"))
        except Exception:
            pass
        try:
            completed = self._run_git_for_task(
                task,
                ["ls-remote", "--symref", str(task.repo_url or ""), "HEAD"],
            )
            for line in str(completed.stdout or "").splitlines():
                line = line.strip()
                if line.startswith("ref: refs/heads/") and line.endswith("\tHEAD"):
                    branch = line[len("ref: refs/heads/") :].split("\t", 1)[0].strip()
                    if branch:
                        candidates.append(branch)
        except Exception:
            pass
        try:
            completed = self._run_git_for_task(
                task,
                [
                    "--git-dir",
                    str(mirror_path),
                    "for-each-ref",
                    "--format=%(refname:short)",
                    "refs/heads",
                ],
            )
            for line in str(completed.stdout or "").splitlines():
                branch = line.strip()
                if branch:
                    candidates.append(branch)
        except Exception:
            pass
        candidates.extend(["upstream-main", "main", "master"])
        for branch in merge_unique_text(candidates):
            probe = self._run_git_for_task(
                task,
                ["--git-dir", str(mirror_path), "rev-parse", f"refs/heads/{branch}"],
                check=False,
            )
            if probe.returncode == 0:
                return branch
        head_probe = self._run_git_for_task(
            task,
            ["--git-dir", str(mirror_path), "rev-parse", "--verify", "HEAD"],
            check=False,
        )
        if head_probe.returncode == 0:
            return "HEAD"
        return "HEAD"

    def _reset_local_mirror(self, task: TaskRecord, mirror_path: Path) -> None:
        repo_url = str(task.repo_url or "").strip()
        if not repo_url:
            raise RuntimeError("task repo_url is required for local execution")
        if mirror_path.exists():
            shutil.rmtree(mirror_path, ignore_errors=True)
        mirror_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_git_for_task(task, ["clone", "--mirror", repo_url, str(mirror_path)])

    def _ensure_local_worktree(self, task: TaskRecord) -> Path:
        repo_url = str(task.repo_url or "").strip()
        if not repo_url:
            raise RuntimeError("task repo_url is required for local execution")

        with self._local_repo_lock(task):
            repo_root = self._local_repo_root(task)
            repo_root.mkdir(parents=True, exist_ok=True)
            mirror_path = self._local_mirror_path(task)
            if not mirror_path.exists():
                self._reset_local_mirror(task, mirror_path)
            else:
                mirror_probe = self._run_git_for_task(
                    task,
                    ["--git-dir", str(mirror_path), "rev-parse", "--is-bare-repository"],
                    check=False,
                )
                if mirror_probe.returncode != 0 or str(mirror_probe.stdout or "").strip().lower() != "true":
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="workspace_mirror_refresh",
                        message="Refreshing invalid local git mirror",
                        data={"mirror_path": str(mirror_path)},
                    )
                    self._reset_local_mirror(task, mirror_path)
                else:
                    try:
                        self._run_git_for_task(
                            task,
                            ["--git-dir", str(mirror_path), "remote", "set-url", "origin", repo_url],
                        )
                        self._run_git_for_task(
                            task,
                            [
                                "--git-dir",
                                str(mirror_path),
                                "fetch",
                                "--update-head-ok",
                                "--prune",
                                "--tags",
                                "origin",
                            ],
                        )
                    except RuntimeError:
                        self.store.append_event(
                            task.task_id,
                            level="warning",
                            event_type="workspace_mirror_refresh",
                            message="Refreshing local git mirror after fetch failure",
                            data={"mirror_path": str(mirror_path)},
                        )
                        self._reset_local_mirror(task, mirror_path)

            worktree_path = Path(str(task.worktree_path or "").strip() or self._worktree_path(task))
            branch_name = str(task.branch_name or "").strip()
            if not branch_name:
                raise RuntimeError("task branch_name is required for local execution")
            base_ref = self._default_branch_for_task(task, mirror_path)
            if base_ref != "HEAD":
                self._run_git_for_task(
                    task,
                    ["--git-dir", str(mirror_path), "symbolic-ref", "HEAD", f"refs/heads/{base_ref}"],
                    check=False,
                )

            self._run_git_for_task(
                task,
                ["--git-dir", str(mirror_path), "worktree", "prune"],
                check=False,
            )
            self._run_git_for_task(
                task,
                ["--git-dir", str(mirror_path), "worktree", "remove", "--force", str(worktree_path)],
                check=False,
            )
            if worktree_path.exists():
                shutil.rmtree(worktree_path)
            worktree_path.parent.mkdir(parents=True, exist_ok=True)
            worktree_add_args = [
                "--git-dir",
                str(mirror_path),
                "worktree",
                "add",
                "--force",
                "-B",
                branch_name,
                str(worktree_path),
                base_ref,
            ]
            try:
                self._run_git_for_task(task, worktree_add_args)
            except RuntimeError as exc:
                error_text = str(exc)
                invalid_ref_markers = (
                    "invalid reference: HEAD",
                    "not a valid object name: 'HEAD'",
                )
                if not any(marker in error_text for marker in invalid_ref_markers):
                    raise
                self.store.append_event(
                    task.task_id,
                    level="warning",
                    event_type="workspace_mirror_refresh",
                    message="Refreshing local git mirror after invalid HEAD reference",
                    data={"mirror_path": str(mirror_path), "error": error_text},
                )
                self._reset_local_mirror(task, mirror_path)
                base_ref = self._default_branch_for_task(task, mirror_path)
                if base_ref == "HEAD":
                    raise RuntimeError(
                        "local mirror could not resolve a default branch after refresh"
                    ) from exc
                self._run_git_for_task(
                    task,
                    ["--git-dir", str(mirror_path), "symbolic-ref", "HEAD", f"refs/heads/{base_ref}"],
                    check=False,
                )
                self._run_git_for_task(task, worktree_add_args[:-1] + [base_ref])
        self._run_git_for_task(task, ["config", "user.name", "Meridian Worker"], cwd=worktree_path)
        self._run_git_for_task(
            task,
            ["config", "user.email", str(task.user_id or "worker@meridian.local")],
            cwd=worktree_path,
        )
        self._run_git_for_task(
            task,
            ["config", "remote.origin.mirror", "false"],
            cwd=worktree_path,
        )
        return worktree_path

    def _ensure_local_scratch_workspace(self, task: TaskRecord) -> Path:
        workspace_path = Path(str(task.worktree_path or "").strip() or self._worktree_path(task))
        workspace_path.mkdir(parents=True, exist_ok=True)
        git_dir = workspace_path / ".git"
        branch_name = str(task.branch_name or "").strip() or self._branch_name(task)
        if not git_dir.exists():
            init_probe = self._run_git_for_task(
                task,
                ["init", "-b", branch_name],
                cwd=workspace_path,
                check=False,
            )
            if init_probe.returncode != 0:
                self._run_git_for_task(task, ["init"], cwd=workspace_path)
                self._run_git_for_task(task, ["checkout", "-B", branch_name], cwd=workspace_path)
        else:
            current_branch = self._run_git_for_task(
                task,
                ["rev-parse", "--abbrev-ref", "HEAD"],
                cwd=workspace_path,
                check=False,
            )
            if current_branch.returncode != 0 or str(current_branch.stdout or "").strip() != branch_name:
                self._run_git_for_task(task, ["checkout", "-B", branch_name], cwd=workspace_path)
        self._run_git_for_task(task, ["config", "user.name", "Meridian Worker"], cwd=workspace_path)
        self._run_git_for_task(
            task,
            ["config", "user.email", str(task.user_id or "worker@meridian.local")],
            cwd=workspace_path,
        )
        return workspace_path

    def _run_task(self, task_id: str) -> None:
        task = self.store.get_task(task_id)
        if task is None:
            return
        if self.lifecycle_manager is not None:
            self.lifecycle_manager.sync_from_task(
                task,
                event_type="task_thread_started",
                trigger="task.started",
            )

        if self.task_notifications_enabled:
            self.notifier.send_task_update(
                thread_ref=task.zulip_thread_ref,
                task_id=task.task_id,
                status="running",
                body="Task started in Coder workspace.",
            )

        self.monitor_manager.progress(
            task_id=task.task_id,
            phase="execution.start",
            message="Task execution started",
            data={"execution_backend": self.session_manager.backend},
        )

        session_handle: Optional[Dict[str, Any]] = None
        try:
            workspace = self._ensure_workspace_running(task)

            task = self.store.get_task(task_id)
            if task is None:
                return
            if task.cancel_requested:
                pending = self._followup_pending(task)
                if pending:
                    options = dict(task.options or {})
                    options.pop("followup_pending", None)
                    self.store.clear_cancel_requested(task_id=task_id, options=options)
                else:
                    canceled = self.store.finish_task(
                        task_id=task_id,
                        status="canceled",
                        result_text="Task canceled before execution",
                    )
                    if self.lifecycle_manager is not None and canceled is not None:
                        self.lifecycle_manager.sync_from_task(
                            canceled,
                            event_type="task_canceled_before_execution",
                            apply_reactions=False,
                        )
                    return

            self.store.append_event(
                task.task_id,
                level="info",
                event_type="container.started",
                message="Task container started",
                data={
                    "container_name": task.container_name,
                    "container_runtime": task.container_runtime or self.task_container_runtime,
                    "workspace_id": task.workspace_id,
                    "worktree_path": task.worktree_path,
                },
            )

            session_handle = self.session_manager.start(task)
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="session.started",
                message="Execution session started",
                data=session_handle,
            )
            self.monitor_manager.progress(
                task_id=task.task_id,
                phase="execution.running",
                message="Execution session is running",
                data={"backend": self.session_manager.backend},
            )

            result = self._execute_task(task)
            latest_after_exec = self.store.get_task(task.task_id)
            if latest_after_exec is not None:
                pending = self._followup_pending(latest_after_exec)
                if pending and latest_after_exec.cancel_requested:
                    options = dict(latest_after_exec.options or {})
                    options.pop("followup_pending", None)
                    requeued = self.store.requeue_task(
                        task_id=task.task_id,
                        instruction=latest_after_exec.instruction,
                        options=options,
                    )
                    self.store.append_event(
                        task.task_id,
                        level="info",
                        event_type="task_requeued",
                        message="Task interrupted and re-queued with follow-up guidance",
                        data={"followup_pending": pending},
                    )
                    if self.task_notifications_enabled and requeued is not None:
                        self.notifier.send_task_update(
                            thread_ref=requeued.zulip_thread_ref,
                            task_id=requeued.task_id,
                            status="queued",
                            body="Task interrupted; continuing with latest guidance.",
                        )
                    if self.lifecycle_manager is not None and requeued is not None:
                        self.lifecycle_manager.sync_from_task(
                            requeued,
                            event_type="task_requeued_followup",
                            apply_reactions=False,
                        )
                    self.wake()
                    return
            if latest_after_exec is not None and latest_after_exec.status == "canceled":
                self.store.append_event(
                    task.task_id,
                    level="info",
                    event_type="task_canceled",
                    message="Task execution stopped due to cancel request",
                )
                if self.task_notifications_enabled:
                    self.notifier.send_task_update(
                        thread_ref=latest_after_exec.zulip_thread_ref,
                        task_id=latest_after_exec.task_id,
                        status="canceled",
                        body="Task canceled by user.",
                    )
                if self.lifecycle_manager is not None:
                    self.lifecycle_manager.sync_from_task(
                        latest_after_exec,
                        event_type="task_canceled",
                        apply_reactions=False,
                    )
                return
            if latest_after_exec is not None and latest_after_exec.status == "blocked_information":
                self.store.append_event(
                    task.task_id,
                    level="warning",
                    event_type="task_blocked_information",
                    message="Task paused pending clarification",
                )
                if self.task_notifications_enabled:
                    self.notifier.send_task_update(
                        thread_ref=latest_after_exec.zulip_thread_ref,
                        task_id=latest_after_exec.task_id,
                        status="blocked_information",
                        body="Task is waiting for clarification.",
                    )
                if self.lifecycle_manager is not None:
                    self.lifecycle_manager.sync_from_task(
                        latest_after_exec,
                        event_type="task_blocked_information",
                        trigger="needs_clarification",
                    )
                return

            final_summary = result.summary
            preview_url = None
            preview_failed = False
            preview_enforced = self._preview_enforced_for_task(task)
            if preview_enforced and result.preview_port is None:
                missing_preview_msg = (
                    "Preview evidence is required for this task, but no `preview_port` was reported."
                )
                self.store.append_event(
                    task.task_id,
                    level="warning",
                    event_type="preview_missing",
                    message=missing_preview_msg,
                )
                preview_failed = True
                final_summary = "\n".join(
                    [
                        final_summary.strip(),
                        "",
                        missing_preview_msg,
                        "Start the changed app in the workspace and report `preview_port: <port>` so the controller can publish a preview URL.",
                    ]
                ).strip()
            if result.preview_port and task.workspace_id and self.coder is not None:
                try:
                    preview_agent_name = self.coder.first_workspace_agent_name(task.workspace_id)
                    port_listening = self._wait_for_workspace_port(
                        task=task,
                        workspace_id=task.workspace_id,
                        port=result.preview_port,
                        agent_name=preview_agent_name,
                    )
                    if not port_listening:
                        self.store.mark_task_preview(
                            task_id=task.task_id,
                            preview_port=result.preview_port,
                            preview_url=None,
                        )
                        not_listening_msg = (
                            f"Preview not published: no process is listening on port {result.preview_port} yet."
                        )
                        self.store.append_event(
                            task.task_id,
                            level="warning",
                            event_type="preview_not_listening",
                            message=not_listening_msg,
                            data={
                                "preview_port": result.preview_port,
                                "workspace_id": task.workspace_id,
                                "agent_name": preview_agent_name,
                            },
                        )
                        preview_failed = True
                        final_summary = "\n".join(
                            [
                                final_summary.strip(),
                                "",
                                not_listening_msg,
                                "Start the app inside the workspace and rerun to publish a live preview URL.",
                            ]
                        ).strip()
                    else:
                        share = self.coder.upsert_port_share(
                            task.workspace_id,
                            port=result.preview_port,
                            share_level="authenticated",
                            protocol="http",
                            agent_name=preview_agent_name,
                        )
                        preview_url = self.coder.parse_share_url(share)
                        if not preview_url:
                            owner_name = str(workspace.get("owner_name") or "").strip()
                            workspace_name = str(
                                task.workspace_name or workspace.get("name") or ""
                            ).strip()
                            share_agent = str(share.get("agent_name") or "").strip() or None
                            share_protocol = (
                                str(share.get("protocol") or "http").strip().lower() or "http"
                            )
                            if owner_name and workspace_name:
                                preview_url = self.coder.build_workspace_port_url(
                                    owner_name=owner_name,
                                    workspace_name=workspace_name,
                                    port=result.preview_port,
                                    agent_name=share_agent,
                                    protocol=share_protocol,
                                )
                        self.store.mark_task_preview(
                            task_id=task.task_id,
                            preview_port=result.preview_port,
                            preview_url=preview_url,
                        )
                        self.store.append_event(
                            task.task_id,
                            level="info",
                            event_type="preview_ready",
                            message="Authenticated preview URL created",
                            data={
                                "preview_port": result.preview_port,
                                "preview_url": preview_url,
                            },
                        )
                except Exception as exc:
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="preview_share_error",
                        message=str(exc),
                        data={"preview_port": result.preview_port},
                    )
                    preview_failed = True

            if preview_failed:
                if preview_enforced and self.lifecycle_manager is not None:
                    current_for_reaction = self.store.get_task(task.task_id)
                    if current_for_reaction is not None:
                        self.lifecycle_manager.sync_from_task(
                            current_for_reaction,
                            event_type="preview_failed",
                            trigger="preview.failed",
                        )
                    latest_after_preview = self.store.get_task(task.task_id)
                    if latest_after_preview is not None and latest_after_preview.status != "running":
                        self.monitor_manager.progress(
                            task_id=task.task_id,
                            phase="execution.preview_failed",
                            message="Preview failure reaction changed task lifecycle state",
                            data={"status": latest_after_preview.status},
                            level="warning",
                        )
                        return
                else:
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="preview_failed_non_blocking",
                        message="Preview publish failed; continuing because preview is optional for this task.",
                        data={"task_requires_preview": preview_enforced},
                    )

            task = self.store.finish_task(
                task_id=task.task_id,
                status="done",
                result_text=final_summary,
            )
            if task is None:
                return
            self.monitor_manager.evidence(task=task, summary=final_summary)
            self.monitor_manager.progress(
                task_id=task.task_id,
                phase="execution.completed",
                message="Task execution completed",
                data={"preview_failed": preview_failed, "preview_url": preview_url},
            )

            if self.task_notifications_enabled:
                self.notifier.send_task_update(
                    thread_ref=task.zulip_thread_ref,
                    task_id=task.task_id,
                    status="done",
                    body=final_summary,
                    preview_url=task.preview_url,
                )
            if self.lifecycle_manager is not None:
                self.lifecycle_manager.sync_from_task(
                    task,
                    event_type="task_completed",
                    trigger="task.completed",
                )
        except Exception as exc:
            logging.exception("task %s failed: %s", task.task_id, exc)
            self.monitor_manager.progress(
                task_id=task.task_id,
                phase="execution.failed",
                message="Task execution failed",
                data={"error": str(exc)[:1000]},
                level="error",
            )
            self.store.append_event(
                task.task_id,
                level="error",
                event_type="task_failed",
                message=str(exc),
            )
            failed = self.store.finish_task(
                task_id=task.task_id,
                status="failed",
                error_text=str(exc),
            )
            if self.task_notifications_enabled:
                self.notifier.send_task_update(
                    thread_ref=(failed.zulip_thread_ref if failed else task.zulip_thread_ref),
                    task_id=task.task_id,
                    status="failed",
                    body=str(exc),
                )
            if self.lifecycle_manager is not None and failed is not None:
                self.lifecycle_manager.sync_from_task(
                    failed,
                    event_type="task_failed",
                    trigger="task.failed",
                )
        finally:
            if session_handle is not None:
                self.session_manager.terminate(task)
                self.store.append_event(
                    task.task_id,
                    level="info",
                    event_type="session.terminated",
                    message="Execution session terminated",
                    data={"backend": self.session_manager.backend},
                )

    def _execute_task(self, task: TaskRecord) -> ExecutionResult:
        self.hook_manager.before(
            task_id=task.task_id,
            hook="command_execution",
            data={"backend": self.session_manager.backend},
        )
        try:
            result = self.session_manager.send(
                task,
                run_stub=self._execute_stub,
                run_local=self._execute_local,
            )
            self.hook_manager.after(
                task_id=task.task_id,
                hook="command_execution",
                data={
                    "backend": self.session_manager.backend,
                    "preview_port": result.preview_port,
                },
            )
            return result
        except RuntimeError as exc:
            if self.session_manager.backend == "runner":
                self.store.append_event(
                    task.task_id,
                    level="error",
                    event_type="runner_backend_unavailable",
                    message=(
                        "runner backend transport is not configured; "
                        "set EXECUTION_BACKEND=local or implement runner transport"
                    ),
                )
            self.hook_manager.error(
                task_id=task.task_id,
                hook="command_execution",
                error=str(exc),
                data={"backend": self.session_manager.backend},
            )
            raise
        except Exception as exc:
            self.hook_manager.error(
                task_id=task.task_id,
                hook="command_execution",
                error=str(exc),
                data={"backend": self.session_manager.backend},
            )
            raise

    def _wait_for_workspace_port(
        self,
        *,
        task: TaskRecord,
        workspace_id: str,
        port: int,
        agent_name: Optional[str],
    ) -> bool:
        if self.coder is None:
            return False

        if self.preview_port_wait_seconds <= 0:
            return self.coder.workspace_port_is_listening(
                workspace_id=workspace_id,
                port=port,
                agent_name=agent_name,
            )

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="preview_waiting_for_port",
            message=f"Waiting for workspace app to listen on port {port}",
            data={
                "workspace_id": workspace_id,
                "preview_port": port,
                "agent_name": agent_name,
                "wait_seconds": self.preview_port_wait_seconds,
            },
        )
        deadline = time.monotonic() + self.preview_port_wait_seconds
        while True:
            if self.coder.workspace_port_is_listening(
                workspace_id=workspace_id,
                port=port,
                agent_name=agent_name,
            ):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(self.preview_port_poll_seconds)

    def _check_cancel_requested(self, task_id: str) -> bool:
        task = self.store.get_task(task_id)
        return bool(task and task.cancel_requested)

    @staticmethod
    def _followup_pending(task: TaskRecord) -> Optional[Dict[str, Any]]:
        options = task.options if isinstance(task.options, dict) else {}
        pending = options.get("followup_pending")
        return pending if isinstance(pending, dict) else None

    def _resolve_provider_api_key(
        self,
        *,
        task: TaskRecord,
        provider: str,
    ) -> Tuple[str, str]:
        secret, auth_mode, credential_source = self._resolve_provider_secret(
            task=task,
            provider=provider,
        )
        if auth_mode == "api_key":
            api_key = str(secret.get("api_key") or "").strip()
            if api_key:
                return api_key, credential_source
        if auth_mode == "oauth":
            access_token = str(secret.get("access_token") or "").strip()
            if access_token:
                return access_token, credential_source
        return "", ""

    def _resolve_provider_secret(
        self,
        *,
        task: TaskRecord,
        provider: str,
    ) -> Tuple[Dict[str, Any], str, str]:
        provider_id = normalize_provider_id(provider)
        credential = self.store.get_provider_credential(
            user_id=(task.user_id or "").strip().lower(),
            provider=provider_id,
            include_revoked=False,
        )
        if credential is not None:
            secret = dict(credential.secret or {})
            if credential.auth_mode == "api_key":
                api_key = str(secret.get("api_key") or "").strip()
                if api_key:
                    secret["api_key"] = api_key
                    return secret, "api_key", "user.api_key"
            if credential.auth_mode == "oauth":
                access_token = str(secret.get("access_token") or "").strip()
                if access_token:
                    secret["access_token"] = access_token
                    return secret, "oauth", "user.oauth"

        env_map = {
            "codex": self.openai_api_key,
            "opencode": self.opencode_api_key or self.opencode_fireworks_api_key,
            "claude_code": self.claude_code_api_key,
        }
        fallback = str(env_map.get(provider_id) or "").strip()
        if fallback:
            return {"api_key": fallback}, "api_key", "env"
        return {}, "", ""

    @staticmethod
    def _task_model_override(task: TaskRecord) -> str:
        options = task.options if isinstance(task.options, dict) else {}
        for key in ("model", "provider_model", "runtime_model"):
            value = str(options.get(key) or "").strip()
            if value:
                return value
        return ""

    @staticmethod
    def _command_has_model_flag(tokens: List[str]) -> bool:
        for token in tokens:
            if token in {"-m", "--model"}:
                return True
            if token.startswith("--model=") or token.startswith("-m="):
                return True
        return False

    @staticmethod
    def _inject_provider_model_flag(
        *,
        command: str,
        provider: str,
        model: str,
    ) -> str:
        model_name = str(model or "").strip()
        if not model_name:
            return command
        try:
            tokens = shlex.split(command, posix=True)
        except Exception:
            return command
        if not tokens or TaskCoordinator._command_has_model_flag(tokens):
            return command

        index = 0
        if tokens[0] == "env":
            index = 1
            while index < len(tokens) and "=" in tokens[index] and not tokens[index].startswith("-"):
                index += 1
        while index < len(tokens):
            token = tokens[index].strip()
            if not token:
                index += 1
                continue
            if "=" in token and not token.startswith("-"):
                index += 1
                continue
            break
        if index >= len(tokens):
            return command

        entrypoint = Path(tokens[index]).name
        provider_id = normalize_provider_id(provider)
        if provider_id == "codex" and entrypoint == "codex":
            insert_at = index + 1
            if insert_at >= len(tokens) or tokens[insert_at].startswith("-"):
                return command
            insert_at += 1
            tokens[insert_at:insert_at] = ["-m", model_name]
            return shlex.join(tokens)
        if provider_id == "claude_code" and entrypoint == "claude":
            tokens[index + 1 : index + 1] = ["--model", model_name]
            return shlex.join(tokens)
        if provider_id == "opencode" and entrypoint == "opencode":
            tokens[index + 1 : index + 1] = ["--model", model_name]
            return shlex.join(tokens)
        return command

    def _codex_cli_home(self, task: TaskRecord) -> Path:
        return self.local_work_root / ".auth" / "codex" / task.task_id

    def _write_codex_auth_json(self, task: TaskRecord, secret: Dict[str, Any]) -> Path:
        access_token = str(secret.get("access_token") or "").strip()
        if not access_token:
            raise RuntimeError("codex oauth credentials are missing access_token")

        auth_home = self._codex_cli_home(task)
        auth_home.mkdir(parents=True, exist_ok=True)

        tokens: Dict[str, str] = {"access_token": access_token}
        for key in ("refresh_token", "id_token", "account_id"):
            value = str(secret.get(key) or "").strip()
            if value:
                tokens[key] = value

        auth_payload = {
            "auth_mode": "chatgpt",
            "last_refresh": datetime.now(timezone.utc).isoformat(),
            "tokens": tokens,
        }

        auth_path = auth_home / "auth.json"
        tmp_path = auth_home / "auth.json.tmp"
        tmp_path.write_text(json.dumps(auth_payload, ensure_ascii=True), encoding="utf-8")
        tmp_path.chmod(0o600)
        tmp_path.replace(auth_path)
        auth_path.chmod(0o600)
        auth_home.chmod(0o700)
        return auth_path

    def _provider_command_env(
        self,
        *,
        task: TaskRecord,
        provider: str,
    ) -> Tuple[Dict[str, str], str]:
        provider_id = normalize_provider_id(provider)
        env = dict(os.environ)
        secret, auth_mode, credential_source = self._resolve_provider_secret(
            task=task,
            provider=provider_id,
        )
        model_override = self._task_model_override(task)
        env["MERIDIAN_PROVIDER_ID"] = provider_id
        if auth_mode:
            env["MERIDIAN_PROVIDER_AUTH_MODE"] = auth_mode
        if provider_id == "codex" and auth_mode == "oauth":
            auth_path = self._write_codex_auth_json(task, secret)
            env["CODEX_HOME"] = str(auth_path.parent)
            env.pop("OPENAI_API_KEY", None)
            env.pop("OPENAI_BASE_URL", None)
        else:
            token, _ = self._resolve_provider_api_key(task=task, provider=provider_id)
            if token:
                if provider_id == "codex":
                    env["OPENAI_API_KEY"] = token
                elif provider_id == "opencode":
                    env["OPENCODE_API_KEY"] = token
                elif provider_id == "claude_code":
                    env["CLAUDE_CODE_API_KEY"] = token
                    env["ANTHROPIC_API_KEY"] = token
        if model_override:
            env["MERIDIAN_PROVIDER_MODEL"] = model_override
            if provider_id == "codex":
                env["CODEX_MODEL"] = model_override
            elif provider_id == "claude_code":
                env["CLAUDE_CODE_MODEL"] = model_override
                env["ANTHROPIC_MODEL"] = model_override
            elif provider_id == "opencode":
                env["OPENCODE_MODEL"] = model_override
        if credential_source:
            env["MERIDIAN_PROVIDER_CREDENTIAL_SOURCE"] = credential_source
        return env, credential_source

    def _ensure_provider_cli_auth(
        self,
        *,
        task: TaskRecord,
        provider: str,
        env: Dict[str, str],
    ) -> None:
        provider_id = normalize_provider_id(provider)
        if provider_id != "codex":
            return
        command_template = (
            self.provider_commands.get(provider_id)
            or self.provider_commands.get(provider)
            or self.provider_commands.get("default")
            or ""
        )
        if _command_template_entrypoint(command_template) != "codex":
            return

        auth_mode = str(env.get("MERIDIAN_PROVIDER_AUTH_MODE") or "").strip().lower()
        if auth_mode == "oauth":
            codex_home = str(env.get("CODEX_HOME") or "").strip()
            auth_path = Path(codex_home) / "auth.json" if codex_home else Path()
            if not codex_home or not auth_path.exists():
                raise RuntimeError("codex oauth bootstrap failed: CODEX_HOME/auth.json is missing")
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="provider_cli_auth",
                message="Prepared task-scoped Codex ChatGPT OAuth session",
                data={
                    "credential_source": env.get("MERIDIAN_PROVIDER_CREDENTIAL_SOURCE") or "unknown",
                },
            )
            return

        token = str(env.get("OPENAI_API_KEY") or "").strip()
        if not token:
            raise RuntimeError("codex CLI requires OPENAI_API_KEY for login bootstrap")

        token_fingerprint = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self._provider_cli_auth_lock:
            if self._provider_cli_auth_state.get(provider_id) == token_fingerprint:
                return

        login = subprocess.run(
            ["bash", "-lc", "printenv OPENAI_API_KEY | codex login --with-api-key"],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=90,
        )
        if login.returncode != 0:
            output = "\n".join(
                line.rstrip("\n")
                for line in (login.stdout or "").splitlines()[-20:]
                if line.strip()
            ).strip()
            if output:
                raise RuntimeError(f"codex CLI login failed: {output}")
            raise RuntimeError("codex CLI login failed")

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="provider_cli_auth",
            message="Bootstrapped codex CLI login from configured API key",
        )
        with self._provider_cli_auth_lock:
            self._provider_cli_auth_state[provider_id] = token_fingerprint

    def _execute_stub(self, task: TaskRecord) -> ExecutionResult:
        steps = [
            "Provisioning isolated git worktree",
            f"Running provider adapter: {task.provider}",
            "Collecting structured output",
        ]
        for step in steps:
            if self._check_cancel_requested(task.task_id):
                current = self.store.get_task(task.task_id)
                if current is not None and current.status == "blocked_information":
                    return ExecutionResult(summary="Task blocked pending clarification")
                if current is not None and self._followup_pending(current):
                    self.store.append_event(
                        task.task_id,
                        level="info",
                        event_type="task_interrupt_requested",
                        message="Cancel requested to apply follow-up guidance",
                    )
                    return ExecutionResult(summary="Task interrupted; continuing with latest guidance.")
                self.store.finish_task(
                    task_id=task.task_id,
                    status="canceled",
                    result_text="Task canceled while running",
                )
                return ExecutionResult(summary="Task canceled by user")
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="task_progress",
                message=step,
            )
            time.sleep(0.7)

        preview_port = self._extract_preview_port(task.instruction)
        summary = (
            "Stub execution completed. Switch EXECUTION_BACKEND=local to run actual provider commands."
        )
        return ExecutionResult(summary=summary, preview_port=preview_port)

    def _execute_local(self, task: TaskRecord) -> ExecutionResult:
        provider_id = normalize_provider_id(task.provider)
        backend_profile = provider_backend_profile(
            provider=provider_id,
            execution_backend=self.execution_backend,
            provider_commands=self.provider_commands,
            codex_api_enabled=self.codex_api_enabled,
            opencode_api_enabled=self.opencode_api_enabled,
        )
        require_executable = task_requires_executable_backend(
            instruction=task.instruction,
            assigned_role=task.assigned_role or "",
            options=task.options if isinstance(task.options, dict) else {},
        )
        requested_mode = str(
            (task.options or {}).get("worker_execution_mode")
            if isinstance(task.options, dict)
            else ""
        ).strip().lower()
        if require_executable and not backend_profile.get("supports_execution"):
            raise RuntimeError(
                f"provider '{provider_id}' is configured as text-only ({backend_profile.get('default_mode')}) "
                "and cannot satisfy an implementation task that requires repo execution"
            )
        use_command_mode = bool(backend_profile.get("supports_execution")) and (
            require_executable or requested_mode == "command"
        )
        if not use_command_mode:
            if provider_id == "codex" and self.codex_api_enabled:
                _, auth_mode, _ = self._resolve_provider_secret(task=task, provider=provider_id)
                if auth_mode != "oauth":
                    return self._execute_codex_api(task)
            if provider_id == "opencode" and self.opencode_api_enabled:
                return self._execute_opencode_api(task)

        command_template = (
            self.provider_commands.get(provider_id)
            or self.provider_commands.get(task.provider)
            or self.provider_commands.get("default")
        )
        if not command_template:
            raise RuntimeError(
                f"no local command configured for provider '{task.provider}'"
            )

        repo_url = str(task.repo_url or "").strip()
        if repo_url:
            worktree_path = self._ensure_local_worktree(task)
        else:
            worktree_path = self._ensure_local_scratch_workspace(task)

        command = command_template.format(
            task_id=task.task_id,
            repo_id=task.repo_id,
            repo_url=task.repo_url or "",
            instruction=task.instruction,
            quoted_instruction=shlex.quote(task.instruction),
            branch_name=task.branch_name or "",
            worktree_path=str(worktree_path),
            user_id=task.user_id,
        )
        model_override = self._task_model_override(task)
        if model_override:
            command = self._inject_provider_model_flag(
                command=command,
                provider=provider_id,
                model=model_override,
            )
        command_env, credential_source = self._provider_command_env(task=task, provider=provider_id)
        command_env.update(self._git_command_env(task))
        self._ensure_provider_cli_auth(task=task, provider=provider_id, env=command_env)

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="provider_command",
            message="Executing provider command",
            data={
                "command": command,
                "provider": provider_id,
                "model": model_override or "",
                "credential_source": credential_source or "none",
            },
        )

        process = subprocess.Popen(
            ["bash", "-lc", command],
            cwd=str(worktree_path),
            env=command_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        preview_port: Optional[int] = None
        output_lines = []
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.rstrip("\n")
            if not line:
                continue
            output_lines.append(line)
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="provider_stdout",
                message=line[:4000],
            )
            if preview_port is None:
                preview_port = self._extract_preview_port(line)

            if self._check_cancel_requested(task.task_id):
                process.terminate()
                try:
                    process.wait(timeout=8)
                except Exception:
                    process.kill()
                current = self.store.get_task(task.task_id)
                if current is not None and current.status == "blocked_information":
                    return ExecutionResult(summary="Task blocked pending clarification")
                if current is not None and self._followup_pending(current):
                    self.store.append_event(
                        task.task_id,
                        level="info",
                        event_type="task_interrupt_requested",
                        message="Cancel requested to apply follow-up guidance",
                    )
                    return ExecutionResult(summary="Task interrupted; continuing with latest guidance.")
                self.store.finish_task(
                    task_id=task.task_id,
                    status="canceled",
                    result_text="Task canceled by user",
                )
                return ExecutionResult(summary="Task canceled by user")

        rc = process.wait()
        if rc != 0:
            output_excerpt = "\n".join(output_lines[-20:]).strip()
            if output_excerpt:
                raise RuntimeError(
                    f"provider command exited with code {rc}: {output_excerpt}"
                )
            raise RuntimeError(f"provider command exited with code {rc}")

        summary_text = "\n".join(output_lines[-20:]).strip()
        if not summary_text:
            summary_text = "Provider command completed successfully."

        if preview_port is None:
            preview_port = self._extract_preview_port(task.instruction)

        return ExecutionResult(summary=summary_text, preview_port=preview_port)

    @staticmethod
    def _extract_response_text(payload: Dict[str, Any]) -> str:
        output = payload.get("output")
        if not isinstance(output, list):
            return ""
        chunks = []
        for item in output:
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if str(part.get("type") or "") != "output_text":
                    continue
                text = str(part.get("text") or "")
                if text:
                    chunks.append(text)
        return "\n".join(chunks).strip()

    @staticmethod
    def _iter_sse_events(response: requests.Response) -> Iterator[Tuple[str, str]]:
        event_name = ""
        data_lines: List[str] = []
        for raw_line in response.iter_lines(decode_unicode=True):
            if raw_line is None:
                continue
            line = raw_line.rstrip("\r")
            if line == "":
                if data_lines:
                    yield event_name, "\n".join(data_lines)
                event_name = ""
                data_lines = []
                continue
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                event_name = line[len("event:") :].strip()
                continue
            if line.startswith("data:"):
                data_lines.append(line[len("data:") :].lstrip())
        if data_lines:
            yield event_name, "\n".join(data_lines)

    @staticmethod
    def _extract_stream_text(event_type: str, payload: Dict[str, Any]) -> Tuple[str, str]:
        event_key = (event_type or str(payload.get("type") or "")).strip().lower()

        if "reasoning" in event_key:
            delta_value = payload.get("delta")
            if isinstance(delta_value, str) and delta_value:
                return "thinking", delta_value
            text = str(payload.get("text") or "")
            if text:
                return "thinking", text

        if "output_text" in event_key or event_key.endswith(".delta"):
            delta_value = payload.get("delta")
            if isinstance(delta_value, str) and delta_value:
                return "assistant", delta_value
            if isinstance(delta_value, dict):
                text = str(
                    delta_value.get("text")
                    or delta_value.get("output_text")
                    or delta_value.get("delta")
                    or ""
                )
                if text:
                    return "assistant", text

        for key in ("output_text", "text", "delta"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                channel = "thinking" if "reasoning" in event_key else "assistant"
                return channel, value
            if isinstance(value, dict):
                nested = str(
                    value.get("text")
                    or value.get("output_text")
                    or value.get("delta")
                    or ""
                )
                if nested:
                    channel = "thinking" if "reasoning" in event_key else "assistant"
                    return channel, nested
        return "", ""

    @staticmethod
    def _dedupe_stream_chunk(existing: str, incoming: str) -> str:
        next_chunk = incoming or ""
        if not next_chunk:
            return ""
        if not existing:
            return next_chunk
        if next_chunk in existing or existing.endswith(next_chunk):
            return ""

        overlap_limit = min(len(existing), len(next_chunk), 2000)
        for size in range(overlap_limit, 0, -1):
            if existing[-size:] == next_chunk[:size]:
                next_chunk = next_chunk[size:]
                break
        if not next_chunk:
            return ""

        # Some streaming providers emit cumulative snapshots mid-stream.
        # Trim repeated tail content if we detect a long overlap with already
        # emitted text.
        if len(existing) >= 120 and len(next_chunk) >= 120:
            max_offset = len(next_chunk) - 80
            for offset in range(20, max_offset + 1):
                probe = next_chunk[offset : offset + 80]
                if probe and probe in existing:
                    next_chunk = next_chunk[:offset]
                    break

        return next_chunk

    @staticmethod
    def _extract_tool_event_message(event_type: str, payload: Dict[str, Any]) -> str:
        event_key = (event_type or str(payload.get("type") or "")).strip().lower()
        if "tool" not in event_key and "function_call" not in event_key:
            return ""

        item = payload.get("item")
        item_obj = item if isinstance(item, dict) else {}
        name = str(
            payload.get("name")
            or payload.get("tool_name")
            or item_obj.get("name")
            or item_obj.get("tool_name")
            or item_obj.get("call_id")
            or "tool_call"
        ).strip()
        args_obj = (
            payload.get("arguments")
            or item_obj.get("arguments")
            or payload.get("input")
            or item_obj.get("input")
            or ""
        )
        if isinstance(args_obj, (dict, list)):
            args = json.dumps(args_obj, ensure_ascii=False)
        else:
            args = str(args_obj or "").strip()
        args = args[:1200]
        if args:
            return f"{name}: {args}"
        return name

    def _execute_codex_api(self, task: TaskRecord) -> ExecutionResult:
        _, auth_mode, _ = self._resolve_provider_secret(
            task=task,
            provider="codex",
        )
        if auth_mode == "oauth":
            raise RuntimeError(
                "Codex OAuth credentials require CLI execution. Disable CODEX_API_ENABLED or use the local Codex command backend."
            )
        api_key, credential_source = self._resolve_provider_api_key(task=task, provider="codex")
        if not api_key:
            raise RuntimeError(
                "Codex credentials are missing. Connect provider auth or set OPENAI_API_KEY."
            )
        model = self._task_model_override(task) or self.codex_model

        prompt = "\n".join(
            [
                "Task context:",
                f"- task_id: {task.task_id}",
                f"- user_id: {task.user_id}",
                f"- repo_id: {task.repo_id}",
                f"- repo_url: {task.repo_url or '(not provided)'}",
                f"- worktree_path: {task.worktree_path or '(not set)'}",
                "",
                "Instruction:",
                task.instruction,
                "",
                "Output requirements:",
                "- Return a concise execution-style summary.",
                "- If a preview app should be opened, include an explicit 'PORT: <number>' marker.",
                "- Include branch/worktree guidance when relevant.",
            ]
        )

        request_body: Dict[str, Any] = {
            "model": model,
            "stream": True,
            "reasoning": {"effort": self.codex_reasoning_effort},
            "max_output_tokens": self.codex_max_output_tokens,
            "input": [
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "You are Codex inside Meridian Coder Orchestrator. "
                                "Respond with practical, implementation-ready output."
                            ),
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": prompt}],
                },
            ],
        }

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="provider_request",
            message=f"Calling OpenAI Responses API model={model}",
            data={"model": model, "credential_source": credential_source or "unknown"},
        )

        response = self._openai_http.post(
            f"{self.openai_base_url}/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            data=json.dumps(request_body),
            timeout=self.codex_timeout_seconds,
            stream=True,
        )
        if response.status_code >= 400:
            snippet = (response.text or "")[:1000]
            raise RuntimeError(
                f"OpenAI Responses API error status={response.status_code} body={snippet}"
            )

        assistant_text_parts: List[str] = []
        assistant_buffer = ""
        thinking_buffer = ""
        assistant_stream_text = ""
        thinking_stream_text = ""
        last_payload: Dict[str, Any] = {}

        def flush_buffer(kind: str, *, force: bool = False) -> None:
            nonlocal assistant_buffer, thinking_buffer
            source_buffer = assistant_buffer if kind == "assistant" else thinking_buffer
            event_type = "provider_stdout" if kind == "assistant" else "provider_thinking"
            while True:
                if "\n" in source_buffer:
                    piece, source_buffer = source_buffer.split("\n", 1)
                    message = piece.strip()
                    if message:
                        self.store.append_event(
                            task.task_id,
                            level="info",
                            event_type=event_type,
                            message=message[:4000],
                        )
                    continue
                if not force and len(source_buffer) < 220:
                    break
                if force and not source_buffer.strip():
                    break
                piece = source_buffer[:220] if len(source_buffer) > 220 else source_buffer
                source_buffer = source_buffer[len(piece) :]
                message = piece.strip()
                if message:
                    self.store.append_event(
                        task.task_id,
                        level="info",
                        event_type=event_type,
                        message=message[:4000],
                    )
                if not force and len(source_buffer) < 220 and "\n" not in source_buffer:
                    break

            if kind == "assistant":
                assistant_buffer = source_buffer
            else:
                thinking_buffer = source_buffer

        try:
            for event_name, data_text in self._iter_sse_events(response):
                if self._check_cancel_requested(task.task_id):
                    current = self.store.get_task(task.task_id)
                    if current is not None and current.status == "blocked_information":
                        return ExecutionResult(summary="Task blocked pending clarification")
                    if current is not None and self._followup_pending(current):
                        self.store.append_event(
                            task.task_id,
                            level="info",
                            event_type="task_interrupt_requested",
                            message="Cancel requested to apply follow-up guidance",
                        )
                        return ExecutionResult(summary="Task interrupted; continuing with latest guidance.")
                    self.store.finish_task(
                        task_id=task.task_id,
                        status="canceled",
                        result_text="Task canceled by user",
                    )
                    return ExecutionResult(summary="Task canceled by user")

                payload_text = (data_text or "").strip()
                if not payload_text:
                    continue
                if payload_text == "[DONE]":
                    break

                try:
                    payload_data = json.loads(payload_text)
                except Exception:
                    payload_data = {}
                if isinstance(payload_data, dict):
                    last_payload = payload_data
                else:
                    payload_data = {}

                event_type = (
                    (event_name or str(payload_data.get("type") or "")).strip().lower()
                )
                if event_type in {"response.error", "error"}:
                    detail = str(
                        payload_data.get("message")
                        or payload_data.get("error")
                        or payload_text
                    ).strip()
                    raise RuntimeError(detail or "OpenAI Responses API stream returned an error")

                tool_message = self._extract_tool_event_message(event_type, payload_data)
                if tool_message:
                    self.store.append_event(
                        task.task_id,
                        level="info",
                        event_type="provider_command",
                        message=tool_message[:4000],
                        data={"stream_event_type": event_type},
                    )
                    continue

                channel, text_chunk = self._extract_stream_text(event_type, payload_data)
                clean_chunk = text_chunk.replace("\r", "")
                if not clean_chunk:
                    continue

                if channel == "thinking":
                    deduped_chunk = self._dedupe_stream_chunk(thinking_stream_text, clean_chunk)
                    if not deduped_chunk:
                        continue
                    thinking_stream_text = f"{thinking_stream_text}{deduped_chunk}"
                    thinking_buffer = f"{thinking_buffer}{deduped_chunk}"
                    flush_buffer("thinking", force=False)
                else:
                    deduped_chunk = self._dedupe_stream_chunk(assistant_stream_text, clean_chunk)
                    if not deduped_chunk:
                        continue
                    assistant_stream_text = f"{assistant_stream_text}{deduped_chunk}"
                    assistant_text_parts.append(deduped_chunk)
                    assistant_buffer = f"{assistant_buffer}{deduped_chunk}"
                    flush_buffer("assistant", force=False)

        finally:
            response.close()

        flush_buffer("assistant", force=True)
        flush_buffer("thinking", force=True)

        summary_text = "".join(assistant_text_parts).strip()
        if not summary_text and last_payload:
            summary_text = self._extract_response_text(last_payload)
        if not summary_text:
            summary_text = "Codex completed, but returned an empty text payload."
        self.store.append_event(
            task.task_id,
            level="info",
            event_type="provider_complete",
            message="OpenAI Responses API stream completed",
        )

        preview_port = self._extract_preview_port(summary_text)
        return ExecutionResult(summary=summary_text, preview_port=preview_port)

    @staticmethod
    def _extract_chat_completions_chunk(payload: Dict[str, Any]) -> Tuple[str, str]:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            return "", ""
        first = choices[0] if isinstance(choices[0], dict) else {}
        delta = first.get("delta")
        if not isinstance(delta, dict):
            delta = {}
        assistant = str(delta.get("content") or "")
        thinking = str(delta.get("reasoning_content") or delta.get("reasoning") or "")

        if not assistant:
            message = first.get("message")
            if isinstance(message, dict):
                assistant = str(message.get("content") or "")
        return assistant.replace("\r", ""), thinking.replace("\r", "")

    def _execute_opencode_api(self, task: TaskRecord) -> ExecutionResult:
        api_key, credential_source = self._resolve_provider_api_key(task=task, provider="opencode")
        if not api_key:
            raise RuntimeError(
                "OpenCode credentials are missing. Connect provider auth or set OPENCODE_API_KEY."
            )
        model = self._task_model_override(task) or self.opencode_model

        prompt = "\n".join(
            [
                "Task context:",
                f"- task_id: {task.task_id}",
                f"- user_id: {task.user_id}",
                f"- repo_id: {task.repo_id}",
                f"- repo_url: {task.repo_url or '(not provided)'}",
                f"- worktree_path: {task.worktree_path or '(not set)'}",
                "",
                "Instruction:",
                task.instruction,
                "",
                "Output requirements:",
                "- Return a concise execution summary with concrete next actions.",
                "- If a preview app should be opened, include an explicit 'PORT: <number>' marker.",
                "- Mention branch/worktree context when relevant.",
            ]
        )
        request_body: Dict[str, Any] = {
            "model": model,
            "stream": True,
            "temperature": self.opencode_temperature,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are OpenCode running in Meridian Coder Orchestrator. "
                        "Respond with implementation-focused output only."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
        }

        self.store.append_event(
            task.task_id,
            level="info",
            event_type="provider_request",
            message=f"Calling OpenCode Chat Completions model={model}",
            data={
                "model": model,
                "provider": "opencode",
                "credential_source": credential_source or "unknown",
            },
        )
        response = self._openai_http.post(
            f"{self.opencode_api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            data=json.dumps(request_body),
            timeout=self.opencode_timeout_seconds,
            stream=True,
        )
        if response.status_code >= 400:
            snippet = (response.text or "")[:1000]
            raise RuntimeError(
                f"OpenCode API error status={response.status_code} body={snippet}"
            )

        assistant_parts: List[str] = []
        assistant_buffer = ""
        thinking_buffer = ""
        assistant_stream_text = ""
        thinking_stream_text = ""
        last_payload: Dict[str, Any] = {}

        def flush_buffer(kind: str, *, force: bool = False) -> None:
            nonlocal assistant_buffer, thinking_buffer
            source_buffer = assistant_buffer if kind == "assistant" else thinking_buffer
            event_type = "provider_stdout" if kind == "assistant" else "provider_thinking"
            while True:
                if "\n" in source_buffer:
                    piece, source_buffer = source_buffer.split("\n", 1)
                    message = piece.strip()
                    if message:
                        self.store.append_event(
                            task.task_id,
                            level="info",
                            event_type=event_type,
                            message=message[:4000],
                        )
                    continue
                if not force and len(source_buffer) < 220:
                    break
                if force and not source_buffer.strip():
                    break
                piece = source_buffer[:220] if len(source_buffer) > 220 else source_buffer
                source_buffer = source_buffer[len(piece) :]
                message = piece.strip()
                if message:
                    self.store.append_event(
                        task.task_id,
                        level="info",
                        event_type=event_type,
                        message=message[:4000],
                    )
                if not force and len(source_buffer) < 220 and "\n" not in source_buffer:
                    break
            if kind == "assistant":
                assistant_buffer = source_buffer
            else:
                thinking_buffer = source_buffer

        try:
            for _, data_text in self._iter_sse_events(response):
                if self._check_cancel_requested(task.task_id):
                    current = self.store.get_task(task.task_id)
                    if current is not None and current.status == "blocked_information":
                        return ExecutionResult(summary="Task blocked pending clarification")
                    if current is not None and self._followup_pending(current):
                        self.store.append_event(
                            task.task_id,
                            level="info",
                            event_type="task_interrupt_requested",
                            message="Cancel requested to apply follow-up guidance",
                        )
                        return ExecutionResult(summary="Task interrupted; continuing with latest guidance.")
                    self.store.finish_task(
                        task_id=task.task_id,
                        status="canceled",
                        result_text="Task canceled by user",
                    )
                    return ExecutionResult(summary="Task canceled by user")

                payload_text = (data_text or "").strip()
                if not payload_text:
                    continue
                if payload_text == "[DONE]":
                    break
                try:
                    payload_data = json.loads(payload_text)
                except Exception:
                    payload_data = {}
                if isinstance(payload_data, dict):
                    last_payload = payload_data
                else:
                    payload_data = {}

                err = payload_data.get("error")
                if err:
                    raise RuntimeError(str(err))

                assistant_chunk, thinking_chunk = self._extract_chat_completions_chunk(payload_data)

                if thinking_chunk:
                    deduped = self._dedupe_stream_chunk(thinking_stream_text, thinking_chunk)
                    if deduped:
                        thinking_stream_text = f"{thinking_stream_text}{deduped}"
                        thinking_buffer = f"{thinking_buffer}{deduped}"
                        flush_buffer("thinking", force=False)

                if assistant_chunk:
                    deduped = self._dedupe_stream_chunk(assistant_stream_text, assistant_chunk)
                    if deduped:
                        assistant_stream_text = f"{assistant_stream_text}{deduped}"
                        assistant_parts.append(deduped)
                        assistant_buffer = f"{assistant_buffer}{deduped}"
                        flush_buffer("assistant", force=False)
        finally:
            response.close()

        flush_buffer("assistant", force=True)
        flush_buffer("thinking", force=True)

        summary_text = "".join(assistant_parts).strip()
        if not summary_text:
            choices = last_payload.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0] if isinstance(choices[0], dict) else {}
                message = first.get("message")
                if isinstance(message, dict):
                    summary_text = str(message.get("content") or "").strip()
        if not summary_text:
            summary_text = "OpenCode completed, but returned an empty text payload."
        self.store.append_event(
            task.task_id,
            level="info",
            event_type="provider_complete",
            message="OpenCode stream completed",
            data={"model": self.opencode_model},
        )
        preview_port = self._extract_preview_port(summary_text)
        return ExecutionResult(summary=summary_text, preview_port=preview_port)

    def _preview_enforced_for_task(self, task: TaskRecord) -> bool:
        options = task.options if isinstance(task.options, dict) else {}
        for key in ("require_preview", "preview_required", "expect_preview"):
            value = options.get(key)
            if isinstance(value, bool) and value:
                return True
            if isinstance(value, str) and value.strip().lower() in {"1", "true", "yes", "on"}:
                return True
        if options.get("preview_port") is not None:
            try:
                port_value = int(options.get("preview_port"))
            except Exception:
                port_value = 0
            if 1 <= port_value <= 65535:
                return True
        contract = self._task_contract(task)
        if (
            str(contract.get("requires_deployment_evidence") or "").strip().lower() in {"1", "true", "yes", "on"}
            or "preview_url"
            in {
                str(item).strip().lower()
                for item in (contract.get("required_artifacts") or [])
                if str(item).strip()
            }
        ):
            return True
        # Explicit marker in the user instruction is an enforceable preview request.
        return self._extract_preview_port(str(task.instruction or "")) is not None

    def _extract_preview_port(self, text: str) -> Optional[int]:
        if not text:
            return None
        match = PORT_HINT_RE.search(text)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 65535:
                return value
        match = JSON_PREVIEW_PORT_RE.search(text)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 65535:
                return value
        return None

    @staticmethod
    def _extract_pr_url(text: str) -> Optional[str]:
        if not text:
            return None
        match = PR_URL_RE.search(text)
        if not match:
            return None
        return str(match.group(0)).rstrip(").,;!?\"'`")

    def _detect_pr_url_for_task(self, task: TaskRecord) -> Optional[str]:
        session = self.store.get_worker_session_by_task_id(task.task_id)
        if session is not None:
            pr_url = str(session.pr_url or "").strip()
            if pr_url:
                return pr_url
        candidates = [
            task.result_text or "",
            task.error_text or "",
            task.blocked_reason or "",
            task.instruction or "",
        ]
        for text in candidates:
            pr_url = self._extract_pr_url(str(text or ""))
            if pr_url:
                return pr_url

        try:
            events = self.store.list_events(
                task.task_id,
                after_id=0,
                limit=120,
                event_types=["provider_stdout", "provider_command", "task_completed"],
            )
        except Exception:
            return None

        for event in reversed(events):
            pr_url = self._extract_pr_url(str(event.get("message") or ""))
            if pr_url:
                return pr_url
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            for value in data.values():
                if isinstance(value, str):
                    pr_url = self._extract_pr_url(value)
                    if pr_url:
                        return pr_url
        return None

    def _parse_pr_locator(self, pr_url: str) -> Optional[Dict[str, Any]]:
        parsed = urlparse(pr_url)
        if parsed.scheme not in {"http", "https"}:
            return None
        host = str(parsed.netloc or "").strip().lower()
        if not host:
            return None

        parts = [segment for segment in parsed.path.split("/") if segment]
        number = ""
        owner = ""
        repo = ""
        for idx, segment in enumerate(parts):
            name = segment.lower()
            if name not in {"pull", "pulls", "merge_requests"}:
                continue
            if idx < 2 or idx + 1 >= len(parts):
                continue
            owner = parts[idx - 2]
            repo = parts[idx - 1]
            number = parts[idx + 1]
            break
        if not owner or not repo or not number.isdigit():
            return None

        provider = "github" if host.endswith("github.com") else "forgejo"
        if provider == "github":
            api_base = self.github_api_base_url
        else:
            api_base = self.forgejo_api_base_url or f"{parsed.scheme}://{host}/api/v1"

        return {
            "provider": provider,
            "host": host,
            "owner": owner,
            "repo": repo,
            "number": int(number),
            "api_base": api_base.rstrip("/"),
        }

    def _resolve_integration_token(self, *, task: TaskRecord, provider: str) -> str:
        integration = "github" if provider == "github" else "forgejo"
        credential = self.store.get_integration_credential(
            user_id=(task.user_id or "").strip().lower(),
            integration=integration,
            include_revoked=False,
        )
        if credential is not None:
            secret = credential.secret if isinstance(credential.secret, dict) else {}
            for key in ("access_token", "api_key", "token"):
                token = str(secret.get(key) or "").strip()
                if token:
                    return token
        if integration == "github":
            return self.github_api_key
        return self.forgejo_api_key

    def _github_headers(self, token: str) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "meridian-coder-orchestrator",
        }
        clean = (token or "").strip()
        if clean:
            headers["Authorization"] = f"Bearer {clean}"
        return headers

    def _forgejo_headers(self, token: str) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "meridian-coder-orchestrator",
        }
        clean = (token or "").strip()
        if clean:
            headers["Authorization"] = f"token {clean}"
        return headers

    @staticmethod
    def _ci_from_check_conclusions(
        *,
        statuses: List[str],
        conclusions: List[str],
    ) -> str:
        waiting = {"queued", "pending", "in_progress", "waiting", "requested"}
        failing = {"failure", "failed", "timed_out", "cancelled", "action_required", "stale"}
        passing = {"success", "passed", "neutral", "skipped"}

        if any(item in waiting for item in statuses):
            return "pending"
        if any(item in failing for item in conclusions):
            return "failing"
        if any(item in passing for item in conclusions):
            return "passing"
        return "none"

    @staticmethod
    def _review_from_states(states: List[str]) -> str:
        normalized = [item.lower() for item in states if item]
        if any(item in {"changes_requested", "request_changes"} for item in normalized):
            return "changes_requested"
        if any(item in {"approved", "approve"} for item in normalized):
            return "approved"
        if normalized:
            return "pending"
        return "none"

    def _probe_github_pull(
        self,
        *,
        task: TaskRecord,
        locator: Dict[str, Any],
        pr_url: str,
        token: str,
    ) -> Optional[SCMProbeResult]:
        base = str(locator.get("api_base") or "").rstrip("/")
        owner = str(locator.get("owner") or "")
        repo = str(locator.get("repo") or "")
        number = int(locator.get("number") or 0)
        if not base or not owner or not repo or number <= 0:
            return None

        headers = self._github_headers(token)
        pull_resp = self._openai_http.get(
            f"{base}/repos/{owner}/{repo}/pulls/{number}",
            headers=headers,
            timeout=self.scm_request_timeout_seconds,
        )
        if pull_resp.status_code >= 400:
            return None
        pull_data = pull_resp.json() if pull_resp.content else {}

        state_raw = str(pull_data.get("state") or "").strip().lower()
        merged_at = str(pull_data.get("merged_at") or "").strip()
        if merged_at:
            pr_state = "merged"
        elif state_raw == "open":
            pr_state = "open"
        elif state_raw:
            pr_state = "closed"
        else:
            pr_state = "open"

        mergeable_value = pull_data.get("mergeable")
        mergeable_state = str(pull_data.get("mergeable_state") or "").strip().lower()
        if pr_state == "merged":
            mergeability = "merged"
        elif mergeable_value is True and mergeable_state not in {"dirty", "blocked"}:
            mergeability = "mergeable"
        elif mergeable_value is False or mergeable_state in {"dirty", "blocked", "behind"}:
            mergeability = "blocked"
        else:
            mergeability = "unknown"

        ci_status = "none"
        head = pull_data.get("head") if isinstance(pull_data.get("head"), dict) else {}
        head_sha = str(head.get("sha") or "").strip()
        if head_sha:
            checks_resp = self._openai_http.get(
                f"{base}/repos/{owner}/{repo}/commits/{head_sha}/check-runs",
                params={"per_page": 100},
                headers=headers,
                timeout=self.scm_request_timeout_seconds,
            )
            if checks_resp.status_code < 400:
                payload = checks_resp.json() if checks_resp.content else {}
                checks = payload.get("check_runs") if isinstance(payload, dict) else []
                statuses: List[str] = []
                conclusions: List[str] = []
                if isinstance(checks, list):
                    for item in checks:
                        if not isinstance(item, dict):
                            continue
                        statuses.append(str(item.get("status") or "").strip().lower())
                        conclusions.append(str(item.get("conclusion") or "").strip().lower())
                ci_status = self._ci_from_check_conclusions(statuses=statuses, conclusions=conclusions)

            if ci_status == "none":
                status_resp = self._openai_http.get(
                    f"{base}/repos/{owner}/{repo}/commits/{head_sha}/status",
                    headers=headers,
                    timeout=self.scm_request_timeout_seconds,
                )
                if status_resp.status_code < 400:
                    payload = status_resp.json() if status_resp.content else {}
                    state = str(payload.get("state") or "").strip().lower()
                    if state in {"success", "passing"}:
                        ci_status = "passing"
                    elif state in {"pending"}:
                        ci_status = "pending"
                    elif state in {"failure", "failed", "error"}:
                        ci_status = "failing"

        review_status = "none"
        reviews_resp = self._openai_http.get(
            f"{base}/repos/{owner}/{repo}/pulls/{number}/reviews",
            params={"per_page": 100},
            headers=headers,
            timeout=self.scm_request_timeout_seconds,
        )
        if reviews_resp.status_code < 400:
            payload = reviews_resp.json() if reviews_resp.content else []
            states: List[str] = []
            if isinstance(payload, list):
                for item in payload:
                    if not isinstance(item, dict):
                        continue
                    states.append(str(item.get("state") or "").strip())
            review_status = self._review_from_states(states)

        return SCMProbeResult(
            pr_url=pr_url,
            provider="github",
            pr_state=pr_state,
            ci_status=ci_status,
            review_status=review_status,
            mergeability=mergeability,
            source_host=str(locator.get("host") or ""),
        )

    def _probe_forgejo_pull(
        self,
        *,
        task: TaskRecord,
        locator: Dict[str, Any],
        pr_url: str,
        token: str,
    ) -> Optional[SCMProbeResult]:
        base = str(locator.get("api_base") or "").rstrip("/")
        owner = str(locator.get("owner") or "")
        repo = str(locator.get("repo") or "")
        number = int(locator.get("number") or 0)
        if not base or not owner or not repo or number <= 0:
            return None

        headers = self._forgejo_headers(token)
        pull_resp = self._openai_http.get(
            f"{base}/repos/{owner}/{repo}/pulls/{number}",
            headers=headers,
            timeout=self.scm_request_timeout_seconds,
        )
        if pull_resp.status_code >= 400:
            return None
        pull_data = pull_resp.json() if pull_resp.content else {}

        merged_flag = bool(pull_data.get("merged"))
        state_raw = str(pull_data.get("state") or "").strip().lower()
        if merged_flag:
            pr_state = "merged"
        elif state_raw == "open":
            pr_state = "open"
        elif state_raw:
            pr_state = "closed"
        else:
            pr_state = "open"

        if pr_state == "merged":
            mergeability = "merged"
        else:
            mergeable = pull_data.get("mergeable")
            if mergeable is True:
                mergeability = "mergeable"
            elif mergeable is False:
                mergeability = "blocked"
            else:
                mergeability = "unknown"

        ci_status = "none"
        head = pull_data.get("head") if isinstance(pull_data.get("head"), dict) else {}
        head_sha = str(head.get("sha") or "").strip()
        if head_sha:
            status_resp = self._openai_http.get(
                f"{base}/repos/{owner}/{repo}/commits/{head_sha}/status",
                headers=headers,
                timeout=self.scm_request_timeout_seconds,
            )
            if status_resp.status_code < 400:
                payload = status_resp.json() if status_resp.content else {}
                state = str(payload.get("state") or "").strip().lower()
                if state in {"success", "passing"}:
                    ci_status = "passing"
                elif state in {"pending"}:
                    ci_status = "pending"
                elif state in {"failure", "failed", "error"}:
                    ci_status = "failing"

        review_status = "none"
        reviews_resp = self._openai_http.get(
            f"{base}/repos/{owner}/{repo}/pulls/{number}/reviews",
            params={"per_page": 100},
            headers=headers,
            timeout=self.scm_request_timeout_seconds,
        )
        if reviews_resp.status_code < 400:
            payload = reviews_resp.json() if reviews_resp.content else []
            states: List[str] = []
            if isinstance(payload, list):
                for item in payload:
                    if not isinstance(item, dict):
                        continue
                    states.append(str(item.get("state") or "").strip())
            review_status = self._review_from_states(states)

        return SCMProbeResult(
            pr_url=pr_url,
            provider="forgejo",
            pr_state=pr_state,
            ci_status=ci_status,
            review_status=review_status,
            mergeability=mergeability,
            source_host=str(locator.get("host") or ""),
        )

    def _probe_pr_status(self, *, task: TaskRecord, pr_url: str) -> Optional[SCMProbeResult]:
        locator = self._parse_pr_locator(pr_url)
        if locator is None:
            return None
        provider = str(locator.get("provider") or "").strip().lower()
        token = self._resolve_integration_token(task=task, provider=provider)
        try:
            if provider == "github":
                return self._probe_github_pull(task=task, locator=locator, pr_url=pr_url, token=token)
            if provider == "forgejo":
                return self._probe_forgejo_pull(task=task, locator=locator, pr_url=pr_url, token=token)
        except Exception as exc:
            logging.debug(
                "scm probe failed task=%s pr_url=%s err=%s",
                task.task_id,
                pr_url,
                exc,
            )
        return None

    @staticmethod
    def _derive_worker_lifecycle_state(
        *,
        task: TaskRecord,
        probe: Optional[SCMProbeResult],
        pr_url: Optional[str] = None,
    ) -> Tuple[str, str]:
        status = str(task.status or "").strip().lower()
        if status == "failed":
            return "errored", "exited"
        if status == "canceled":
            return "killed", "exited"
        if status == "done":
            return "done", "exited"
        if status in {"blocked_information"}:
            return "needs_input", "waiting_input"
        if status in {"blocked_dependency", "blocked_approval", "stalled", "at_risk", "paused"}:
            return "stuck", "blocked"
        if status == "queued":
            return "spawning", "ready"

        if probe is not None:
            if probe.pr_state == "merged":
                return "merged", "exited"
            if probe.pr_state == "closed":
                return "killed", "exited"
            if probe.ci_status == "failing":
                return "ci_failed", "active"
            if probe.review_status == "changes_requested":
                return "changes_requested", "active"
            if probe.review_status == "approved":
                if probe.ci_status in {"passing", "none"} and probe.mergeability == "mergeable":
                    return "mergeable", "ready"
                return "approved", "ready"
            if probe.review_status == "pending":
                return "review_pending", "active"
            if probe.pr_state == "open":
                return "pr_open", "active"

        if status == "running":
            if str(pr_url or "").strip():
                return "pr_open", "active"
            return "working", "active"
        return "queued", "ready"

    def _reconcile_worker_session_lifecycle(self) -> None:
        active_statuses = [
            "queued",
            "running",
            "blocked",
            "waiting_input",
            "paused",
            "spawning",
            "working",
            "pr_open",
            "ci_failed",
            "review_pending",
            "changes_requested",
            "approved",
            "mergeable",
            "needs_input",
            "stuck",
        ]
        sessions = self.store.list_worker_sessions(statuses=active_statuses, limit=800)
        if not sessions:
            return

        for session in sessions:
            task = self.store.get_task(session.task_id)
            if task is None:
                continue

            detected_pr_url = session.pr_url or self._detect_pr_url_for_task(task)
            probe = self._probe_pr_status(task=task, pr_url=detected_pr_url) if detected_pr_url else None
            next_pr_url = probe.pr_url if probe is not None else detected_pr_url
            next_ci = probe.ci_status if probe is not None else session.ci_status
            next_review = probe.review_status if probe is not None else session.review_status
            next_mergeability = probe.mergeability if probe is not None else session.mergeability
            target_status, target_activity = self._derive_worker_lifecycle_state(
                task=task,
                probe=probe,
                pr_url=next_pr_url,
            )

            changed = (
                session.status != target_status
                or session.activity != target_activity
                or (session.pr_url or "") != (next_pr_url or "")
                or (session.ci_status or "") != (next_ci or "")
                or (session.review_status or "") != (next_review or "")
                or (session.mergeability or "") != (next_mergeability or "")
            )
            if not changed:
                continue

            updated = self.store.update_worker_session(
                worker_session_id=session.worker_session_id,
                status=target_status,
                activity=target_activity,
                pr_url=next_pr_url,
                ci_status=next_ci,
                review_status=next_review,
                mergeability=next_mergeability,
                last_event_type="lifecycle.session.reconciled",
                last_event_ts=self.store.now_iso(),
                metadata_patch={
                    "last_scm_reconcile_provider": (probe.provider if probe else ""),
                    "last_scm_reconcile_host": (probe.source_host if probe else ""),
                },
            )
            if updated is None:
                continue

            details = []
            if next_pr_url:
                details.append(f"pr={next_pr_url}")
            if next_ci:
                details.append(f"ci={next_ci}")
            if next_review:
                details.append(f"review={next_review}")
            if next_mergeability:
                details.append(f"mergeability={next_mergeability}")
            suffix = f" ({', '.join(details)})" if details else ""
            self.store.append_event(
                task.task_id,
                level="info",
                event_type="worker_session_reconciled",
                message=f"Worker session lifecycle: {session.status} -> {target_status}{suffix}",
                data={
                    "worker_session_id": session.worker_session_id,
                    "from_status": session.status,
                    "to_status": target_status,
                    "from_activity": session.activity,
                    "to_activity": target_activity,
                    "pr_url": next_pr_url,
                    "ci_status": next_ci,
                    "review_status": next_review,
                    "mergeability": next_mergeability,
                },
            )

    def _extend_workspace_deadlines_for_running_tasks(self) -> None:
        if self.coder is None or self.execution_backend == "local":
            return
        workspace_ids = self.store.list_running_workspace_ids()
        if not workspace_ids:
            return

        deadline_iso = self.coder.future_deadline_iso(self.keepalive_window_hours)
        for workspace_id in workspace_ids:
            if self._is_local_workspace_id(workspace_id):
                continue
            try:
                self.coder.extend_workspace(workspace_id, deadline_iso=deadline_iso)
            except Exception as exc:
                logging.warning(
                    "workspace keepalive extend failed workspace_id=%s err=%s",
                    workspace_id,
                    exc,
                )
                running = self.store.list_running_tasks_for_workspace(workspace_id)
                for task in running:
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="workspace_keepalive_error",
                        message=str(exc),
                        data={"workspace_id": workspace_id},
                    )

    def _reconcile_port_share_policy(self) -> None:
        if self.coder is None or self.execution_backend == "local":
            return
        mappings = self.store.list_workspace_mappings()
        for mapping in mappings:
            workspace_id = str(mapping.workspace_id or "").strip()
            if not workspace_id or self._is_local_workspace_id(workspace_id):
                continue
            try:
                changed = self.coder.enforce_authenticated_port_shares(workspace_id)
                if changed <= 0:
                    continue
                running = self.store.list_running_tasks_for_workspace(workspace_id)
                for task in running:
                    self.store.append_event(
                        task.task_id,
                        level="warning",
                        event_type="port_share_policy_reconciled",
                        message=f"Downgraded {changed} public share(s) to authenticated",
                        data={"workspace_id": workspace_id, "downgraded": changed},
                    )
            except Exception as exc:
                logging.warning(
                    "port-share reconciliation failed workspace_id=%s err=%s",
                    workspace_id,
                    exc,
                )

    def prestart_workspace(self, *, user_id: str, repo_id: str, repo_url: Optional[str]) -> Dict[str, Any]:
        dummy_task = TaskRecord(
            task_id="prestart-dummy",
            user_id=user_id,
            repo_id=repo_id,
            repo_url=repo_url,
            provider="codex",
            instruction="prestart",
            zulip_thread_ref={},
            options={},
            topic_scope_id="repo-prestart",
            status="queued",
            cancel_requested=False,
            workspace_id=None,
            workspace_name=None,
            branch_name=None,
            worktree_path=None,
            container_name=None,
            container_runtime=None,
            preview_port=None,
            preview_url=None,
            created_at="",
            updated_at="",
            started_at=None,
            finished_at=None,
            worker_id=None,
            assigned_worker=None,
            assigned_role=None,
            assigned_by=None,
            directive_id=None,
            plan_revision_id=None,
            result_text=None,
            error_text=None,
            blocked_reason=None,
            clarification_questions=[],
            clarification_requested=False,
            approved=False,
        )
        mapping = self._ensure_workspace_mapping(dummy_task)
        workspace_id = str(mapping.workspace_id or "").strip()
        if not workspace_id:
            raise RuntimeError("prestart mapping has no workspace_id")
        if self.coder is None:
            raise RuntimeError("coder integration is disabled")

        self.coder.start_workspace(workspace_id)
        workspace = self.coder.wait_workspace_ready(workspace_id)
        return {
            "workspace_id": workspace_id,
            "workspace_name": mapping.workspace_name,
            "workspace_owner": mapping.workspace_owner,
            "status": str(
                (workspace.get("latest_build") or {}).get("status")
                or workspace.get("status")
                or "unknown"
            ),
        }

    def stop_workspace_if_idle(self, workspace_id: str) -> bool:
        if self.coder is None:
            raise RuntimeError("coder integration is disabled")
        running = self.store.count_running_tasks_for_workspace(workspace_id)
        if running > 0:
            return False
        self.coder.stop_workspace(workspace_id)
        return True
