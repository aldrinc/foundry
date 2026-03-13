"""Middleware interfaces for topic-scoped runtime state."""

from __future__ import annotations

from typing import Protocol

from ..thread_state import TopicRuntimeState


class TopicRuntimeMiddleware(Protocol):
    name: str

    def apply(self, state: TopicRuntimeState) -> None: ...
