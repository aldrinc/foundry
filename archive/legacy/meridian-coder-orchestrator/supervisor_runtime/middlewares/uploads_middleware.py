"""Uploads runtime middleware adapted from DeerFlow's uploads middleware."""

from __future__ import annotations

from ..thread_state import TopicRuntimeState


class UploadsMiddleware:
    name = "uploads"

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        uploads = [item for item in (payload.get("uploads") or []) if isinstance(item, dict)]
        new_uploads = [item for item in (payload.get("new_uploads") or []) if isinstance(item, dict)]
        state["uploads"] = uploads
        state["new_uploads"] = new_uploads
