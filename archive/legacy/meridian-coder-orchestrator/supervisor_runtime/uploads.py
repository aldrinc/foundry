"""Upload handling adapted from DeerFlow's uploads middleware."""

from __future__ import annotations

import base64
import binascii
import mimetypes
from pathlib import Path
from typing import Any

from .paths import TopicRuntimePaths

_TEXT_EXTENSIONS = {
    ".csv",
    ".json",
    ".log",
    ".md",
    ".py",
    ".rst",
    ".txt",
    ".yaml",
    ".yml",
}
_VIRTUAL_UPLOAD_PREFIX = "/mnt/user-data/uploads"


def _safe_filename(raw: Any) -> str:
    filename = Path(str(raw or "")).name
    if not filename or filename in {".", ".."}:
        return ""
    return filename


def _size_label(size_bytes: int) -> str:
    size = max(0, int(size_bytes))
    size_kb = size / 1024
    if size_kb < 1024:
        return f"{size_kb:.1f} KB"
    return f"{size_kb / 1024:.1f} MB"


def _read_preview(path: Path, *, max_chars: int = 600) -> str:
    if path.suffix.lower() not in _TEXT_EXTENSIONS:
        return ""
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return ""
    compact = text.strip()
    if not compact:
        return ""
    if len(compact) > max_chars:
        compact = compact[:max_chars].rstrip() + "..."
    return compact


def materialize_uploaded_files(
    paths: TopicRuntimePaths,
    raw_files: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Persist uploaded files into the topic runtime uploads directory."""
    persisted: list[dict[str, Any]] = []
    for item in raw_files or []:
        if not isinstance(item, dict):
            continue
        filename = _safe_filename(item.get("filename"))
        if not filename:
            continue
        target = paths.uploads_path / filename
        content_base64 = str(item.get("content_base64") or item.get("content_b64") or "").strip()
        if content_base64:
            try:
                data = base64.b64decode(content_base64, validate=True)
            except (ValueError, binascii.Error):
                continue
            target.write_bytes(data)
        elif not target.exists():
            continue

        stat = target.stat()
        media_type = str(item.get("media_type") or item.get("mime_type") or "").strip()
        if not media_type:
            media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        persisted.append(
            {
                "filename": target.name,
                "size": int(stat.st_size),
                "path": f"{_VIRTUAL_UPLOAD_PREFIX}/{target.name}",
                "extension": target.suffix,
                "media_type": media_type,
                "status": str(item.get("status") or "available").strip() or "available",
                "preview": _read_preview(target),
            }
        )
    return persisted


def list_uploaded_files(
    paths: TopicRuntimePaths,
    *,
    exclude_filenames: set[str] | None = None,
) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    excluded = {str(item).strip() for item in (exclude_filenames or set()) if str(item).strip()}
    if not paths.uploads_path.exists():
        return files
    for file_path in sorted(paths.uploads_path.iterdir()):
        if not file_path.is_file() or file_path.name in excluded:
            continue
        stat = file_path.stat()
        files.append(
            {
                "filename": file_path.name,
                "size": int(stat.st_size),
                "path": f"{_VIRTUAL_UPLOAD_PREFIX}/{file_path.name}",
                "extension": file_path.suffix,
                "media_type": mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
                "status": "available",
                "preview": _read_preview(file_path),
            }
        )
    return files


def build_uploads_prompt_context(
    *,
    new_files: list[dict[str, Any]],
    historical_files: list[dict[str, Any]],
) -> str:
    if not new_files and not historical_files:
        return ""

    lines = ["<uploaded_files>", "Topic runtime uploads available to this turn:", ""]
    if new_files:
        lines.append("New files attached in this message:")
        lines.append("")
        for item in new_files:
            lines.append(f"- {item['filename']} ({_size_label(int(item.get('size') or 0))})")
            lines.append(f"  Path: {item['path']}")
            if str(item.get("media_type") or "").strip():
                lines.append(f"  Media type: {item['media_type']}")
            preview = str(item.get("preview") or "").strip()
            if preview:
                lines.append(f"  Preview: {preview}")
            lines.append("")
    else:
        lines.extend(["New files attached in this message:", "", "(empty)", ""])

    if historical_files:
        lines.append("Files already present in the topic runtime:")
        lines.append("")
        for item in historical_files:
            lines.append(f"- {item['filename']} ({_size_label(int(item.get('size') or 0))})")
            lines.append(f"  Path: {item['path']}")
            preview = str(item.get("preview") or "").strip()
            if preview:
                lines.append(f"  Preview: {preview}")
            lines.append("")

    lines.append("Use the file names, virtual paths, and previews when reasoning about uploaded artifacts.")
    lines.append("</uploaded_files>")
    return "\n".join(lines)
