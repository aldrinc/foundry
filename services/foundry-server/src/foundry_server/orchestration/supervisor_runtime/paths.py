"""Runtime path management adapted from DeerFlow's config.paths module."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9_-]+")


@dataclass(frozen=True)
class TopicRuntimePaths:
    topic_scope_id: str
    topic_storage_id: str
    topic_dir: Path
    user_data_dir: Path
    workspace_path: Path
    uploads_path: Path
    outputs_path: Path
    checkpoints_path: Path
    memory_path: Path
    summary_path: Path
    metadata_path: Path


@dataclass(frozen=True)
class SessionRuntimePaths:
    session_id: str
    session_storage_id: str
    session_dir: Path
    checkpoints_path: Path
    memory_path: Path
    summary_path: Path


class RuntimePaths:
    """Centralized runtime directories for per-topic supervisor state."""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        self._base_dir = Path(base_dir).resolve() if base_dir is not None else None

    @property
    def base_dir(self) -> Path:
        if self._base_dir is not None:
            return self._base_dir
        raw = os.getenv("SUPERVISOR_RUNTIME_DIR", "./data/supervisor-runtime").strip()
        return Path(raw).resolve()

    def topic_storage_id(self, topic_scope_id: str) -> str:
        scope = str(topic_scope_id or "").strip().lower()
        digest = hashlib.sha1(scope.encode("utf-8")).hexdigest()[:12]
        slug = _SAFE_SEGMENT_RE.sub("_", scope).strip("_")
        slug = slug[:72] if slug else "topic"
        return f"{slug}--{digest}"

    def topic_paths(self, topic_scope_id: str) -> TopicRuntimePaths:
        scope = str(topic_scope_id or "").strip().lower()
        if not scope:
            raise ValueError("topic_scope_id is required")
        storage_id = self.topic_storage_id(scope)
        topic_dir = self.base_dir / "topics" / storage_id
        user_data_dir = topic_dir / "user-data"
        return TopicRuntimePaths(
            topic_scope_id=scope,
            topic_storage_id=storage_id,
            topic_dir=topic_dir,
            user_data_dir=user_data_dir,
            workspace_path=user_data_dir / "workspace",
            uploads_path=user_data_dir / "uploads",
            outputs_path=user_data_dir / "outputs",
            checkpoints_path=topic_dir / "checkpoints",
            memory_path=topic_dir / "memory.json",
            summary_path=topic_dir / "summary.md",
            metadata_path=topic_dir / "topic.json",
        )

    def ensure_topic_dirs(self, topic_scope_id: str) -> TopicRuntimePaths:
        paths = self.topic_paths(topic_scope_id)
        for directory in (
            paths.workspace_path,
            paths.uploads_path,
            paths.outputs_path,
            paths.checkpoints_path,
        ):
            directory.mkdir(parents=True, exist_ok=True)
            try:
                directory.chmod(0o777)
            except Exception:
                pass

        if not paths.metadata_path.exists():
            payload = {
                "topic_scope_id": paths.topic_scope_id,
                "topic_storage_id": paths.topic_storage_id,
            }
            paths.metadata_path.write_text(
                json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
                encoding="utf-8",
            )
        if not paths.summary_path.exists():
            paths.summary_path.write_text("# Topic Summary\n\n", encoding="utf-8")
        return paths

    def session_storage_id(self, session_id: str) -> str:
        raw = str(session_id or "").strip().lower()
        if not raw:
            raise ValueError("session_id is required")
        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
        slug = _SAFE_SEGMENT_RE.sub("_", raw).strip("_")
        slug = slug[:48] if slug else "session"
        return f"{slug}--{digest}"

    def session_paths(self, topic_scope_id: str, session_id: str) -> SessionRuntimePaths:
        topic_paths = self.topic_paths(topic_scope_id)
        storage_id = self.session_storage_id(session_id)
        session_dir = topic_paths.topic_dir / "sessions" / storage_id
        return SessionRuntimePaths(
            session_id=str(session_id or "").strip(),
            session_storage_id=storage_id,
            session_dir=session_dir,
            checkpoints_path=session_dir / "checkpoints",
            memory_path=session_dir / "memory.json",
            summary_path=session_dir / "summary.md",
        )

    def ensure_session_dirs(self, topic_scope_id: str, session_id: str) -> SessionRuntimePaths:
        self.ensure_topic_dirs(topic_scope_id)
        paths = self.session_paths(topic_scope_id, session_id)
        for directory in (
            paths.session_dir,
            paths.checkpoints_path,
        ):
            directory.mkdir(parents=True, exist_ok=True)
            try:
                directory.chmod(0o777)
            except Exception:
                pass
        if not paths.summary_path.exists():
            paths.summary_path.write_text("# Session Summary\n\n", encoding="utf-8")
        return paths


_runtime_paths: RuntimePaths | None = None


def get_runtime_paths() -> RuntimePaths:
    global _runtime_paths
    if _runtime_paths is None:
        _runtime_paths = RuntimePaths()
    return _runtime_paths


def topic_runtime_to_dict(paths: TopicRuntimePaths) -> dict[str, str]:
    return {
        "topic_scope_id": paths.topic_scope_id,
        "topic_storage_id": paths.topic_storage_id,
        "topic_dir": str(paths.topic_dir),
        "workspace_path": str(paths.workspace_path),
        "uploads_path": str(paths.uploads_path),
        "outputs_path": str(paths.outputs_path),
        "checkpoints_path": str(paths.checkpoints_path),
        "memory_path": str(paths.memory_path),
        "summary_path": str(paths.summary_path),
        "metadata_path": str(paths.metadata_path),
    }


def session_runtime_to_dict(paths: SessionRuntimePaths) -> dict[str, str]:
    return {
        "session_id": paths.session_id,
        "session_storage_id": paths.session_storage_id,
        "session_dir": str(paths.session_dir),
        "checkpoints_path": str(paths.checkpoints_path),
        "memory_path": str(paths.memory_path),
        "summary_path": str(paths.summary_path),
    }
