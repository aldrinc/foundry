"""Topic runtime builder with DeerFlow-style middleware composition."""

from __future__ import annotations

from typing import Any

from .middlewares import (
    AttachmentResolutionMiddleware,
    CapabilityMiddleware,
    ClarificationMiddleware,
    EvidenceMiddleware,
    MemoryMiddleware,
    PlanMiddleware,
    SandboxMiddleware,
    ThreadDataMiddleware,
    UploadsMiddleware,
)
from .thread_state import TopicRuntimeState, new_topic_runtime_state


def build_topic_runtime_state(
    *,
    topic_scope_id: str,
    session_id: str = "",
    input_payload: dict[str, Any] | None = None,
) -> TopicRuntimeState:
    state = new_topic_runtime_state(
        topic_scope_id=topic_scope_id,
        session_id=session_id,
        input_payload=input_payload,
    )
    middlewares = [
        ThreadDataMiddleware(),
        UploadsMiddleware(),
        AttachmentResolutionMiddleware(),
        SandboxMiddleware(),
        MemoryMiddleware(),
        PlanMiddleware(),
        CapabilityMiddleware(),
        ClarificationMiddleware(),
        EvidenceMiddleware(),
    ]
    state["metadata"] = {
        **(state.get("metadata") if isinstance(state.get("metadata"), dict) else {}),
        "middleware_chain": [middleware.name for middleware in middlewares],
    }
    for middleware in middlewares:
        middleware.apply(state)
    state.pop("input", None)
    return state
