#!/usr/bin/env python3
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


TASK_STATUS_SET = {
    "queued",
    "running",
    "paused",
    "stalled",
    "blocked_approval",
    "blocked_dependency",
    "blocked_information",
    "at_risk",
    "done",
    "failed",
    "canceled",
}

REACTION_TRIGGER_SET = {
    "task.started",
    "task.stalled",
    "approval.required",
    "preview.failed",
    "needs_clarification",
    "task.completed",
    "task.failed",
}

REACTION_ACTION_SET = {
    "redirect",
    "spawn_helper",
    "pause",
    "terminate_replan",
    "notify_human",
}


def _to_int(value: Any, default: int, *, min_value: int = 0) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(min_value, parsed)


def _to_float(value: Any, default: float, *, min_value: float = 0.0) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return max(min_value, parsed)


def _to_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on", "y"}:
        return True
    if text in {"0", "false", "no", "off", "n"}:
        return False
    return default


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _apply_legacy_env_overrides(data: Dict[str, Any]) -> Dict[str, Any]:
    reactions = data.get("reactions")
    if not isinstance(reactions, list):
        return data

    def _set_max_attempts(trigger: str, action: str, env_name: str) -> None:
        raw = os.getenv(env_name)
        if raw is None:
            return
        value = _to_int(raw, 0, min_value=0)
        for item in reactions:
            if not isinstance(item, dict):
                continue
            if str(item.get("trigger") or "").strip().lower() != trigger:
                continue
            if str(item.get("action") or "").strip().lower() != action:
                continue
            item["max_attempts"] = value

    _set_max_attempts("task.failed", "spawn_helper", "LIFECYCLE_REACTION_FAILED_RETRIES")
    _set_max_attempts("task.stalled", "spawn_helper", "LIFECYCLE_REACTION_STUCK_RETRIES")
    _set_max_attempts("needs_clarification", "spawn_helper", "LIFECYCLE_REACTION_NEEDS_INPUT_RETRIES")

    completed_notify_raw = os.getenv("LIFECYCLE_REACTION_NOTIFY_ON_COMPLETED")
    if completed_notify_raw is not None:
        completed_notify = _to_bool(completed_notify_raw, True)
        for item in reactions:
            if not isinstance(item, dict):
                continue
            if str(item.get("trigger") or "").strip().lower() == "task.completed":
                item["enabled"] = completed_notify

    return data


def _default_policy_dict() -> Dict[str, Any]:
    return {
        "lifecycle": {
            "strict_transitions": True,
            "max_retries": 1,
            "retry_backoff_seconds": 5.0,
            "max_backoff_seconds": 60.0,
            "circuit_breaker_failures": 3,
            "circuit_breaker_cooldown_seconds": 120.0,
            "allowed_transitions": {
                "queued": [
                    "running",
                    "paused",
                    "stalled",
                    "blocked_approval",
                    "blocked_dependency",
                    "blocked_information",
                    "at_risk",
                    "canceled",
                    "failed",
                    "done",
                ],
                "running": [
                    "queued",
                    "paused",
                    "stalled",
                    "blocked_information",
                    "blocked_approval",
                    "at_risk",
                    "done",
                    "failed",
                    "canceled",
                ],
                "paused": ["queued", "running", "blocked_information", "failed", "canceled"],
                "stalled": ["queued", "paused", "at_risk", "failed", "canceled"],
                "blocked_approval": ["queued", "paused", "failed", "canceled"],
                "blocked_dependency": ["queued", "paused", "failed", "canceled"],
                "blocked_information": ["queued", "paused", "failed", "canceled"],
                "at_risk": ["queued", "paused", "done", "failed", "canceled"],
                "done": ["queued"],
                "failed": ["queued"],
                "canceled": ["queued"],
            },
        },
        "reactions": [
            {
                "name": "task-stalled-spawn-helper",
                "trigger": "task.stalled",
                "action": "spawn_helper",
                "priority": 100,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "task-stalled-notify",
                "trigger": "task.stalled",
                "action": "notify_human",
                "priority": 90,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "task-failed-spawn-helper",
                "trigger": "task.failed",
                "action": "spawn_helper",
                "priority": 100,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "task-failed-notify",
                "trigger": "task.failed",
                "action": "notify_human",
                "priority": 90,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "approval-required-pause",
                "trigger": "approval.required",
                "action": "pause",
                "priority": 100,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "preview-failed-terminate-replan",
                "trigger": "preview.failed",
                "action": "terminate_replan",
                "priority": 100,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "needs-clarification-pause",
                "trigger": "needs_clarification",
                "action": "pause",
                "priority": 100,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "task-completed-notify",
                "trigger": "task.completed",
                "action": "notify_human",
                "priority": 80,
                "max_attempts": 1,
                "enabled": True,
            },
            {
                "name": "task-started-redirect",
                "trigger": "task.started",
                "action": "redirect",
                "priority": 10,
                "max_attempts": 0,
                "enabled": False,
            },
        ],
        "monitoring": {
            "emit_progress_events": True,
            "emit_evidence_events": True,
            "evidence_cost_basis": "elapsed_seconds",
        },
    }


@dataclass(frozen=True)
class LifecyclePolicy:
    strict_transitions: bool
    max_retries: int
    retry_backoff_seconds: float
    max_backoff_seconds: float
    circuit_breaker_failures: int
    circuit_breaker_cooldown_seconds: float
    allowed_transitions: Dict[str, List[str]]

    def can_transition(self, current_status: str, next_status: str) -> bool:
        current = str(current_status or "").strip().lower()
        target = str(next_status or "").strip().lower()
        if not current or not target:
            return False
        if current == target:
            return True
        allowed = self.allowed_transitions.get(current, [])
        return target in allowed


@dataclass(frozen=True)
class ReactionRulePolicy:
    name: str
    trigger: str
    action: str
    priority: int
    max_attempts: int
    enabled: bool = True
    conditions: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MonitoringPolicy:
    emit_progress_events: bool
    emit_evidence_events: bool
    evidence_cost_basis: str


@dataclass(frozen=True)
class OrchestratorPolicy:
    source_path: str
    lifecycle: LifecyclePolicy
    reactions: List[ReactionRulePolicy]
    monitoring: MonitoringPolicy


def _sanitize_transitions(raw: Any) -> Dict[str, List[str]]:
    defaults = _default_policy_dict()["lifecycle"]["allowed_transitions"]
    source = raw if isinstance(raw, dict) else {}
    cleaned: Dict[str, List[str]] = {}

    for status in TASK_STATUS_SET:
        target_raw = source.get(status, defaults.get(status, []))
        targets = target_raw if isinstance(target_raw, list) else defaults.get(status, [])
        normalized: List[str] = []
        for item in targets:
            target = str(item or "").strip().lower()
            if target in TASK_STATUS_SET and target not in normalized:
                normalized.append(target)
        if normalized:
            cleaned[status] = normalized

    return cleaned


def _build_policy(*, source_path: str, data: Dict[str, Any]) -> OrchestratorPolicy:
    lifecycle_raw = data.get("lifecycle") if isinstance(data.get("lifecycle"), dict) else {}
    lifecycle = LifecyclePolicy(
        strict_transitions=_to_bool(lifecycle_raw.get("strict_transitions"), True),
        max_retries=_to_int(lifecycle_raw.get("max_retries"), 1, min_value=0),
        retry_backoff_seconds=_to_float(lifecycle_raw.get("retry_backoff_seconds"), 5.0, min_value=0.0),
        max_backoff_seconds=_to_float(lifecycle_raw.get("max_backoff_seconds"), 60.0, min_value=0.0),
        circuit_breaker_failures=_to_int(lifecycle_raw.get("circuit_breaker_failures"), 3, min_value=0),
        circuit_breaker_cooldown_seconds=_to_float(
            lifecycle_raw.get("circuit_breaker_cooldown_seconds"),
            120.0,
            min_value=0.0,
        ),
        allowed_transitions=_sanitize_transitions(lifecycle_raw.get("allowed_transitions")),
    )

    reactions: List[ReactionRulePolicy] = []
    reaction_items = data.get("reactions")
    if isinstance(reaction_items, list):
        for index, raw_item in enumerate(reaction_items):
            if not isinstance(raw_item, dict):
                continue
            name = str(raw_item.get("name") or f"reaction-{index + 1}").strip()
            trigger = str(raw_item.get("trigger") or "").strip().lower()
            action = str(raw_item.get("action") or "").strip().lower()
            if trigger not in REACTION_TRIGGER_SET:
                logging.warning(
                    "orchestrator policy ignored reaction %s: unsupported trigger %r",
                    name,
                    trigger,
                )
                continue
            if action not in REACTION_ACTION_SET:
                logging.warning(
                    "orchestrator policy ignored reaction %s: unsupported action %r",
                    name,
                    action,
                )
                continue
            reactions.append(
                ReactionRulePolicy(
                    name=name or f"reaction-{index + 1}",
                    trigger=trigger,
                    action=action,
                    priority=_to_int(raw_item.get("priority"), 100, min_value=0),
                    max_attempts=_to_int(raw_item.get("max_attempts"), 1, min_value=0),
                    enabled=_to_bool(raw_item.get("enabled"), True),
                    conditions=raw_item.get("conditions") if isinstance(raw_item.get("conditions"), dict) else {},
                )
            )

    if not reactions:
        default_items = _default_policy_dict().get("reactions") or []
        for index, item in enumerate(default_items):
            reactions.append(
                ReactionRulePolicy(
                    name=str(item.get("name") or f"reaction-{index + 1}"),
                    trigger=str(item.get("trigger") or "").strip().lower(),
                    action=str(item.get("action") or "").strip().lower(),
                    priority=_to_int(item.get("priority"), 100, min_value=0),
                    max_attempts=_to_int(item.get("max_attempts"), 1, min_value=0),
                    enabled=_to_bool(item.get("enabled"), True),
                    conditions=item.get("conditions") if isinstance(item.get("conditions"), dict) else {},
                )
            )

    monitoring_raw = data.get("monitoring") if isinstance(data.get("monitoring"), dict) else {}
    monitoring = MonitoringPolicy(
        emit_progress_events=_to_bool(monitoring_raw.get("emit_progress_events"), True),
        emit_evidence_events=_to_bool(monitoring_raw.get("emit_evidence_events"), True),
        evidence_cost_basis=str(monitoring_raw.get("evidence_cost_basis") or "elapsed_seconds").strip()
        or "elapsed_seconds",
    )

    return OrchestratorPolicy(
        source_path=source_path,
        lifecycle=lifecycle,
        reactions=reactions,
        monitoring=monitoring,
    )


def default_policy_path() -> Path:
    override = os.getenv("ORCHESTRATOR_POLICY_PATH", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (Path(__file__).resolve().parent / "orchestrator_policy.yaml").resolve()


def load_orchestrator_policy(path: Optional[str] = None) -> OrchestratorPolicy:
    defaults = _default_policy_dict()
    resolved = (
        Path(path).expanduser().resolve()
        if str(path or "").strip()
        else default_policy_path()
    )
    merged = dict(defaults)

    if resolved.exists():
        try:
            raw = resolved.read_text(encoding="utf-8")
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise ValueError("policy root must be an object")
            merged = _deep_merge(defaults, parsed)
        except Exception as exc:
            logging.warning(
                "failed to parse orchestrator policy %s (%s); using defaults",
                resolved,
                exc,
            )
    else:
        logging.warning(
            "orchestrator policy file not found at %s; using defaults",
            resolved,
        )

    merged = _apply_legacy_env_overrides(merged)
    policy = _build_policy(source_path=str(resolved), data=merged)
    logging.info(
        "loaded orchestrator policy from %s (reactions=%s strict_transitions=%s)",
        policy.source_path,
        len(policy.reactions),
        policy.lifecycle.strict_transitions,
    )
    return policy
