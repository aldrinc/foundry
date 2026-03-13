"""Checkpoint snapshots adapted from DeerFlow's checkpointer provider pattern."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import TopicRuntimePaths, get_runtime_paths


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def write_checkpoint(
    *,
    paths: TopicRuntimePaths,
    session_id: str | None = None,
    stage: str,
    payload: dict[str, Any],
) -> Path:
    safe_stage = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in str(stage or "checkpoint"))
    checkpoint_dir = paths.checkpoints_path
    if str(session_id or "").strip():
        checkpoint_dir = get_runtime_paths().ensure_session_dirs(
            paths.topic_scope_id,
            str(session_id or "").strip(),
        ).checkpoints_path
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    target = checkpoint_dir / f"{_timestamp()}-{safe_stage}.json"
    target.write_text(
        json.dumps(payload if isinstance(payload, dict) else {}, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return target


def list_checkpoints(
    paths: TopicRuntimePaths,
    *,
    session_id: str | None = None,
    limit: int = 20,
) -> list[Path]:
    checkpoint_dir = paths.checkpoints_path
    if str(session_id or "").strip():
        checkpoint_dir = get_runtime_paths().ensure_session_dirs(
            paths.topic_scope_id,
            str(session_id or "").strip(),
        ).checkpoints_path
    if not checkpoint_dir.exists():
        return []
    items = sorted(
        [item for item in checkpoint_dir.iterdir() if item.is_file() and item.suffix == ".json"],
        reverse=True,
    )
    return items[: max(1, int(limit))]


def checkpoint_to_dict(path: Path) -> dict[str, Any]:
    return {
        "name": path.name,
        "path": str(path),
        "size": int(path.stat().st_size),
        "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
    }
