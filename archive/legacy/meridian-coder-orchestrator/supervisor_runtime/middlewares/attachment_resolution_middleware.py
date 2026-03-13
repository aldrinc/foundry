"""Attachment resolution middleware for topic runtime state."""

from __future__ import annotations

from typing import Any

from ..thread_state import TopicRuntimeAttachment, TopicRuntimeState


class AttachmentResolutionMiddleware:
    name = "attachment_resolution"

    @staticmethod
    def _normalized_repo_attachment(raw: dict[str, Any], *, selected_repo_id: str) -> TopicRuntimeAttachment | None:
        repo_id = str(raw.get("repo_id") or raw.get("id") or "").strip()
        if not repo_id:
            return None
        return {
            "attachment_id": repo_id,
            "kind": "repo",
            "source": str(raw.get("source") or "attachment").strip() or "attachment",
            "confidence": str(raw.get("confidence") or "medium").strip() or "medium",
            "label": str(raw.get("label") or repo_id).strip() or repo_id,
            "selected": bool(selected_repo_id and repo_id == selected_repo_id),
            "repo_id": repo_id,
            "repo_url": str(raw.get("repo_url") or raw.get("url") or "").strip(),
            "metadata": dict(raw.get("metadata") or {}) if isinstance(raw.get("metadata"), dict) else {},
        }

    def apply(self, state: TopicRuntimeState) -> None:
        payload = state.get("input") if isinstance(state.get("input"), dict) else {}
        selected_repo_id = str(payload.get("selected_repo_id") or "").strip()
        repo_candidates = [item for item in (payload.get("repo_attachments") or []) if isinstance(item, dict)]
        repo_attachments: list[TopicRuntimeAttachment] = []
        selected_repo: TopicRuntimeAttachment | None = None
        for item in repo_candidates:
            attachment = self._normalized_repo_attachment(item, selected_repo_id=selected_repo_id)
            if attachment is None:
                continue
            repo_attachments.append(attachment)
            if attachment.get("selected"):
                selected_repo = attachment
        state["attachments"] = {
            "repos": repo_attachments,
            "apps": [item for item in (payload.get("app_attachments") or []) if isinstance(item, dict)],
            "contexts": [item for item in (payload.get("context_attachments") or []) if isinstance(item, dict)],
            "selected_repo": selected_repo,
        }
