"""Clarification interrupt middleware adapted from DeerFlow's clarification middleware."""

from __future__ import annotations

from ..thread_state import TopicRuntimeInterrupt, TopicRuntimeState


class ClarificationMiddleware:
    name = "clarification"

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        questions = [
            str(item).strip()
            for item in (state.get("plan", {}).get("clarification_questions") or [])
            if str(item).strip()
        ]
        task_questions = [
            str(item).strip()
            for item in (payload.get("task_clarification_questions") or [])
            if str(item).strip()
        ]
        all_questions = [*questions, *task_questions]
        interrupt: TopicRuntimeInterrupt | None = None
        if all_questions:
            interrupt = {
                "kind": "clarification",
                "status": "blocked",
                "reason": "clarification_required",
                "detail": all_questions[0],
                "action": "resolve_clarification",
                "source": "runtime",
            }
            state["interrupts"] = [*state.get("interrupts", []), interrupt]
            state["execution_blockers"] = [*state.get("execution_blockers", []), "clarification_required"]
        state["clarifications"] = {
            "required": bool(all_questions),
            "questions": all_questions,
            "status": "blocked" if all_questions else "clear",
            "interrupt": interrupt,
        }
