"""Plan and todo runtime middleware adapted from DeerFlow's todo/runtime layering."""

from __future__ import annotations

from typing import Any

from ..thread_state import TopicRuntimeInterrupt, TopicRuntimeState


class PlanMiddleware:
    name = "plan"

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        active_plan = payload.get("active_plan") if isinstance(payload.get("active_plan"), dict) else {}
        latest_plan = payload.get("latest_plan") if isinstance(payload.get("latest_plan"), dict) else {}
        plan = active_plan or latest_plan
        execution_steps = [item for item in (plan.get("execution_steps") or []) if isinstance(item, dict)]
        clarification_questions = [
            str(item).strip()
            for item in (plan.get("unknowns") or [])
            if str(item).strip()
        ]
        state["plan"] = {
            "active_plan": active_plan,
            "latest_plan": latest_plan,
            "plan_revision_id": str(plan.get("plan_revision_id") or "").strip() or None,
            "has_plan": bool(plan),
            "execution_steps": execution_steps,
            "has_actionable_steps": any(str(item.get("instruction") or "").strip() for item in execution_steps),
            "clarification_questions": clarification_questions,
            "approval_points": [
                str(item).strip()
                for item in (plan.get("approval_points") or [])
                if str(item).strip()
            ],
            "todos": [
                {
                    "step_id": str(item.get("step_id") or item.get("id") or "").strip(),
                    "title": str(item.get("title") or item.get("task_title") or "").strip(),
                    "assigned_role": str(item.get("assigned_role") or item.get("kind") or "").strip(),
                    "depends_on": [
                        str(dep).strip()
                        for dep in (item.get("depends_on") or [])
                        if str(dep).strip()
                    ],
                }
                for item in execution_steps
            ],
        }

        approval_granted = bool(payload.get("approval_granted"))
        approval_required = bool(state["plan"].get("has_actionable_steps")) and not bool(payload.get("has_tasks"))
        interrupt: TopicRuntimeInterrupt | None = None
        if approval_required and not approval_granted:
            interrupt = {
                "kind": "approval",
                "status": "blocked",
                "reason": "approval_required",
                "detail": "Explicit approval is required before execution can start.",
                "action": "grant_approval",
                "source": "runtime",
            }
            state["interrupts"] = [*state.get("interrupts", []), interrupt]
            state["execution_blockers"] = [*state.get("execution_blockers", []), "approval_required"]
        state["approvals"] = {
            "required": approval_required,
            "granted": approval_granted,
            "status": "granted" if approval_granted else "required" if approval_required else "not_required",
            "interrupt": interrupt,
        }
