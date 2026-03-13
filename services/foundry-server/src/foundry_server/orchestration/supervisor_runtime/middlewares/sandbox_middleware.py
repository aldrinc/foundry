"""Sandbox projection middleware adapted from DeerFlow's sandbox middleware."""

from __future__ import annotations

from typing import Any

from ..thread_state import TopicRuntimeState


class SandboxMiddleware:
    name = "sandbox"

    def __init__(self, lazy_init: bool = True) -> None:
        self._lazy_init = lazy_init

    @staticmethod
    def _active_worker_session(payload: dict[str, Any]) -> dict[str, Any]:
        worker_sessions = [
            item for item in (payload.get("worker_sessions") or []) if isinstance(item, dict)
        ]
        active_statuses = {
            "running",
            "working",
            "spawning",
            "pr_open",
            "review_pending",
            "approved",
            "mergeable",
            "merged",
            "cleanup",
        }
        for item in worker_sessions:
            if str(item.get("status") or "").strip().lower() in active_statuses:
                return item
        return worker_sessions[0] if worker_sessions else {}

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        topic_data = state.get("topic_data") if isinstance(state.get("topic_data"), dict) else {}
        active_worker = self._active_worker_session(payload)
        worker_backends = [
            item for item in (payload.get("worker_backends") or []) if isinstance(item, dict)
        ]
        runtime_handle = (
            active_worker.get("runtime_handle")
            if isinstance(active_worker.get("runtime_handle"), dict)
            else {}
        )
        provider = str(active_worker.get("provider") or payload.get("sandbox_provider") or "").strip()
        state["sandbox"] = {
            "status": "ready" if str(topic_data.get("workspace_path") or "").strip() else "unavailable",
            "available": bool(str(topic_data.get("workspace_path") or "").strip()),
            "lazy_init": self._lazy_init,
            "provider": provider or "topic_runtime",
            "workspace_path": str(topic_data.get("workspace_path") or "").strip(),
            "uploads_path": str(topic_data.get("uploads_path") or "").strip(),
            "outputs_path": str(topic_data.get("outputs_path") or "").strip(),
            "checkpoints_path": str(topic_data.get("checkpoints_path") or "").strip(),
            "worktree_path": str(active_worker.get("worktree_path") or "").strip() or None,
            "container_runtime": str(active_worker.get("container_runtime") or "").strip() or None,
            "runtime_handle": dict(runtime_handle),
            "execution_backend_ready": any(bool(item.get("supports_execution")) for item in worker_backends),
        }
