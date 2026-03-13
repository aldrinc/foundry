"""Topic runtime path middleware adapted from DeerFlow's thread data middleware."""

from __future__ import annotations

from ..paths import get_runtime_paths, topic_runtime_to_dict
from ..thread_state import TopicRuntimeState


class ThreadDataMiddleware:
    name = "thread_data"

    def __init__(self, lazy_init: bool = False) -> None:
        self._paths = get_runtime_paths()
        self._lazy_init = lazy_init

    def _get_topic_paths(self, topic_scope_id: str) -> dict[str, str]:
        return topic_runtime_to_dict(self._paths.topic_paths(topic_scope_id))

    def _create_topic_directories(self, topic_scope_id: str) -> dict[str, str]:
        return topic_runtime_to_dict(self._paths.ensure_topic_dirs(topic_scope_id))

    def apply(self, state: TopicRuntimeState) -> None:
        scope = str(state.get("topic_scope_id") or "").strip().lower()
        if not scope:
            raise ValueError("topic_scope_id is required")
        state["topic_data"] = (
            self._get_topic_paths(scope)
            if self._lazy_init
            else self._create_topic_directories(scope)
        )
