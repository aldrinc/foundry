"""Topic-scoped runtime state adapted from DeerFlow's thread state model."""

from __future__ import annotations

from typing import Any, NotRequired, TypedDict


def merge_unique_sequence(
    existing: list[Any] | None,
    new: list[Any] | None,
) -> list[Any]:
    if existing is None:
        return list(new or [])
    if new is None:
        return list(existing)
    merged: list[Any] = []
    seen: set[str] = set()
    for item in [*existing, *new]:
        marker = repr(item)
        if marker in seen:
            continue
        seen.add(marker)
        merged.append(item)
    return merged


class TopicRuntimePathsState(TypedDict):
    topic_scope_id: str
    topic_storage_id: str
    topic_dir: str
    workspace_path: str
    uploads_path: str
    outputs_path: str
    checkpoints_path: str
    memory_path: str
    summary_path: str
    metadata_path: str


class TopicRuntimeAttachment(TypedDict, total=False):
    attachment_id: str
    kind: str
    source: str
    confidence: str
    label: str
    selected: bool
    repo_id: str
    repo_url: str
    metadata: dict[str, Any]


class TopicRuntimeInterrupt(TypedDict, total=False):
    kind: str
    status: str
    reason: str
    detail: str
    action: str
    source: str


class TopicRuntimeState(TypedDict, total=False):
    topic_scope_id: str
    session_id: str
    topic_data: TopicRuntimePathsState
    sandbox: NotRequired[dict[str, Any] | None]
    uploads: list[dict[str, Any]]
    new_uploads: list[dict[str, Any]]
    artifacts: list[dict[str, Any]]
    attachments: dict[str, Any]
    approvals: dict[str, Any]
    clarifications: dict[str, Any]
    jobs: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    worker_sessions: list[dict[str, Any]]
    previews: list[dict[str, Any]]
    deployments: list[dict[str, Any]]
    memory: dict[str, Any]
    plan: dict[str, Any]
    capabilities: dict[str, Any]
    evidence: dict[str, Any]
    interrupts: list[TopicRuntimeInterrupt]
    phase: str
    phase_reason: str
    execution_blockers: list[str]
    metadata: dict[str, Any]
    input: dict[str, Any]


def new_topic_runtime_state(
    *,
    topic_scope_id: str,
    session_id: str = "",
    input_payload: dict[str, Any] | None = None,
) -> TopicRuntimeState:
    return {
        "topic_scope_id": str(topic_scope_id or "").strip().lower(),
        "session_id": str(session_id or "").strip(),
        "uploads": [],
        "new_uploads": [],
        "artifacts": [],
        "attachments": {"repos": [], "apps": [], "contexts": [], "selected_repo": None},
        "approvals": {"required": False, "granted": False, "status": "not_required"},
        "clarifications": {"required": False, "questions": [], "status": "clear", "interrupt": None},
        "jobs": [],
        "tasks": [],
        "worker_sessions": [],
        "previews": [],
        "deployments": [],
        "memory": {},
        "plan": {},
        "capabilities": {},
        "evidence": {},
        "interrupts": [],
        "phase": "idle",
        "phase_reason": "no active runtime evidence",
        "execution_blockers": [],
        "metadata": {},
        "input": dict(input_payload or {}),
    }
