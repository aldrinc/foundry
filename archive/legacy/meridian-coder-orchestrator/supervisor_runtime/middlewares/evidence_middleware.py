"""Evidence projection middleware for topic runtime state."""

from __future__ import annotations

from typing import Any

from ..thread_state import TopicRuntimeState


class EvidenceMiddleware:
    name = "evidence"

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        tasks = [item for item in (payload.get("tasks") or []) if isinstance(item, dict)]
        worker_sessions = [
            item for item in (payload.get("worker_sessions") or []) if isinstance(item, dict)
        ]
        previews = [item for item in (payload.get("previews") or []) if isinstance(item, dict)]
        artifacts = [item for item in (payload.get("artifacts") or []) if isinstance(item, dict)]

        active_workers = 0
        blocked_workers = 0
        queued_workers = 0
        for item in worker_sessions:
            status = str(item.get("status") or "").strip().lower()
            activity = str(item.get("activity") or "").strip().lower()
            if status in {"running", "working", "spawning", "pr_open", "review_pending", "approved", "mergeable", "merged", "cleanup"}:
                active_workers += 1
            elif status in {"waiting_input", "needs_input", "blocked", "stuck", "errored"} or activity in {"waiting_input", "blocked"}:
                blocked_workers += 1
            elif status == "queued" or activity == "ready":
                queued_workers += 1

        phase = "idle"
        phase_reason = "no active runtime evidence"
        if blocked_workers > 0:
            phase = "blocked"
            phase_reason = "worker runtime is blocked or waiting for input"
        elif active_workers > 0:
            phase = "executing"
            phase_reason = "live worker-session activity is present"
        elif queued_workers > 0 or tasks:
            phase = "queued"
            phase_reason = "tasks were accepted but no live worker activity is present yet"
        elif state.get("clarifications", {}).get("required"):
            phase = "clarification_required"
            phase_reason = "execution is interrupted pending clarification"
        elif state.get("approvals", {}).get("required") and not state.get("approvals", {}).get("granted"):
            phase = "approval_required"
            phase_reason = "execution requires explicit approval"

        state["tasks"] = tasks
        state["worker_sessions"] = worker_sessions
        state["previews"] = previews
        state["artifacts"] = artifacts
        state["deployments"] = [item for item in (payload.get("deployments") or []) if isinstance(item, dict)]
        state["evidence"] = {
            "task_count": len(tasks),
            "worker_session_count": len(worker_sessions),
            "active_worker_sessions": active_workers,
            "blocked_worker_sessions": blocked_workers,
            "queued_worker_sessions": queued_workers,
            "preview_count": len(previews),
            "artifact_count": len(artifacts),
            "has_live_worker_activity": active_workers > 0,
        }
        state["phase"] = phase
        state["phase_reason"] = phase_reason
