"""Topic memory and summarization adapted from DeerFlow's memory middleware."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from pathlib import Path

from .paths import TopicRuntimePaths, get_runtime_paths

_UPLOAD_BLOCK_RE = re.compile(r"<uploaded_files>[\s\S]*?</uploaded_files>\n*", re.IGNORECASE)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate(text: str, limit: int) -> str:
    compact = " ".join(str(text or "").split()).strip()
    if len(compact) <= limit:
        return compact
    return compact[:limit].rstrip() + "..."


def _clean_user_text(text: str) -> str:
    return _UPLOAD_BLOCK_RE.sub("", str(text or "")).strip()


def _memory_paths(paths: TopicRuntimePaths, session_id: str | None) -> tuple[Path, Path]:
    if not str(session_id or "").strip():
        return paths.memory_path, paths.summary_path
    session_paths = get_runtime_paths().ensure_session_dirs(paths.topic_scope_id, str(session_id or "").strip())
    return session_paths.memory_path, session_paths.summary_path


def _turn_for_memory(user_text: str, assistant_text: str) -> dict[str, str] | None:
    clean_user = _clean_user_text(user_text)
    clean_assistant = str(assistant_text or "").strip()
    if not clean_user or not clean_assistant:
        return None
    return {
        "user": _truncate(clean_user, 400),
        "assistant": _truncate(clean_assistant, 600),
    }


def load_memory_state(paths: TopicRuntimePaths, *, session_id: str | None = None) -> dict[str, Any]:
    memory_path, _summary_path = _memory_paths(paths, session_id)
    if not memory_path.exists():
        return {
            "topic_scope_id": paths.topic_scope_id,
            "session_id": str(session_id or "").strip(),
            "summary": "",
            "highlights": [],
            "recent_turns": [],
            "uploaded_files": [],
            "last_updated_at": "",
        }
    try:
        raw = json.loads(memory_path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "topic_scope_id": paths.topic_scope_id,
            "session_id": str(session_id or "").strip(),
            "summary": "",
            "highlights": [],
            "recent_turns": [],
            "uploaded_files": [],
            "last_updated_at": "",
        }
    return raw if isinstance(raw, dict) else {}


def _assistant_state_label(assistant_payload: dict[str, Any]) -> str:
    if bool((assistant_payload or {}).get("execution_blocked")):
        return "execution:blocked"
    if bool((assistant_payload or {}).get("execution_requested")):
        return "execution:requested"
    response_kind = str((assistant_payload or {}).get("response_kind") or "").strip().lower()
    if response_kind:
        return response_kind
    return ""


def _build_highlights(
    *,
    user_text: str,
    assistant_text: str,
    assistant_payload: dict[str, Any],
    transcript_count: int,
    uploaded_files: list[dict[str, Any]],
    prior_turns: list[dict[str, Any]],
) -> list[str]:
    highlights: list[str] = []
    if user_text:
        highlights.append(f"Latest user request: {_truncate(user_text, 220)}")
    state_label = _assistant_state_label(assistant_payload)
    if state_label:
        highlights.append(f"Latest supervisor state: {state_label}")
    if assistant_text:
        highlights.append(f"Latest supervisor reply: {_truncate(assistant_text, 220)}")
    if transcript_count:
        highlights.append(f"Attached topic transcript messages this turn: {int(transcript_count)}")
    if uploaded_files:
        filenames = ", ".join(item["filename"] for item in uploaded_files[:6] if str(item.get("filename") or "").strip())
        if filenames:
            highlights.append(f"Topic runtime uploads available: {filenames}")
    if prior_turns:
        previous = prior_turns[-1]
        if isinstance(previous, dict):
            prev_user = _truncate(str(previous.get("user") or ""), 180)
            if prev_user:
                highlights.append(f"Previous user request: {prev_user}")
    return highlights[:6]


def update_memory_state(
    *,
    paths: TopicRuntimePaths,
    session_id: str | None = None,
    user_text: str,
    assistant_text: str,
    assistant_payload: dict[str, Any],
    transcript_count: int,
    uploaded_files: list[dict[str, Any]],
) -> dict[str, Any]:
    state = load_memory_state(paths, session_id=session_id)
    memory_path, summary_path = _memory_paths(paths, session_id)
    recent_turns = [item for item in (state.get("recent_turns") or []) if isinstance(item, dict)]
    turn = _turn_for_memory(user_text, assistant_text)
    if turn is not None:
        turn["ts"] = _utc_now()
        turn["mode"] = _assistant_state_label(assistant_payload)
        recent_turns.append(turn)
    recent_turns = recent_turns[-6:]

    clean_user = _clean_user_text(user_text)
    highlights = _build_highlights(
        user_text=clean_user,
        assistant_text=assistant_text,
        assistant_payload=assistant_payload,
        transcript_count=transcript_count,
        uploaded_files=uploaded_files,
        prior_turns=recent_turns[:-1] if turn is not None else recent_turns,
    )
    summary = " ".join(highlights).strip()

    next_state = {
        "topic_scope_id": paths.topic_scope_id,
        "session_id": str(session_id or "").strip(),
        "summary": summary,
        "highlights": highlights,
        "recent_turns": recent_turns,
        "uploaded_files": [
            {
                "filename": str(item.get("filename") or "").strip(),
                "path": str(item.get("path") or "").strip(),
                "media_type": str(item.get("media_type") or "").strip(),
            }
            for item in uploaded_files
            if isinstance(item, dict) and str(item.get("filename") or "").strip()
        ],
        "last_updated_at": _utc_now(),
    }
    memory_path.write_text(
        json.dumps(next_state, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    lines = ["# Topic Summary", ""]
    if summary:
        lines.extend([summary, ""])
    if highlights:
        lines.append("## Highlights")
        lines.append("")
        for item in highlights:
            lines.append(f"- {item}")
        lines.append("")
    if recent_turns:
        lines.append("## Recent Turns")
        lines.append("")
        for item in recent_turns[-4:]:
            user_value = _truncate(str(item.get("user") or ""), 180)
            assistant_value = _truncate(str(item.get("assistant") or ""), 220)
            mode = str(item.get("mode") or "").strip()
            lines.append(f"- user: {user_value}")
            if mode:
                lines.append(f"  mode: {mode}")
            lines.append(f"  assistant: {assistant_value}")
        lines.append("")
    summary_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return next_state


def build_memory_prompt_context(paths: TopicRuntimePaths, *, session_id: str | None = None) -> str:
    state = load_memory_state(paths, session_id=session_id)
    summary = str(state.get("summary") or "").strip()
    highlights = [str(item).strip() for item in (state.get("highlights") or []) if str(item).strip()]
    if not summary and not highlights:
        return ""
    lines = ["Topic runtime memory:"]
    if summary:
        lines.append(f"- Summary: {summary}")
    for item in highlights[:4]:
        lines.append(f"- {item}")
    return "\n".join(lines)
