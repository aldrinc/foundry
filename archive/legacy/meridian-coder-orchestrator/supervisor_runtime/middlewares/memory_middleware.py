"""Memory projection middleware for topic runtime state."""

from __future__ import annotations

from ..thread_state import TopicRuntimeState


class MemoryMiddleware:
    name = "memory"

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        state["memory"] = {
            "summary": str(payload.get("memory_summary") or "").strip(),
            "highlights": [
                str(item).strip()
                for item in (payload.get("memory_highlights") or [])
                if str(item).strip()
            ],
        }
