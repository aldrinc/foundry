#!/usr/bin/env python3
import json
import logging
import os
from typing import Any, Dict, Optional

import requests


class ZulipNotifier:
    def __init__(self) -> None:
        self.base_url = os.getenv("ZULIP_URL", "").rstrip("/")
        self.bot_email = os.getenv("ZULIP_BOT_EMAIL", "").strip().lower()
        self.bot_api_key = os.getenv("ZULIP_BOT_API_KEY", "").strip()
        self.verify_tls = os.getenv("VERIFY_TLS", "true").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.timeout_seconds = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "25"))
        self.http = requests.Session()
        self.http.verify = self.verify_tls

    def configured(self) -> bool:
        return bool(self.base_url and self.bot_email and self.bot_api_key)

    def _post(self, data: Dict[str, str]) -> None:
        if not self.configured():
            return
        try:
            response = self.http.post(
                f"{self.base_url}/api/v1/messages",
                auth=(self.bot_email, self.bot_api_key),
                data=data,
                timeout=self.timeout_seconds,
            )
            if response.status_code != 200:
                logging.warning(
                    "zulip post failed: status=%s body=%s",
                    response.status_code,
                    response.text[:1000],
                )
        except Exception as exc:
            logging.warning("zulip post exception: %s", exc)

    @staticmethod
    def _compact_text(value: str, *, limit: int = 260) -> str:
        text = " ".join((value or "").split())
        if len(text) <= limit:
            return text
        return f"{text[: limit - 1]}…"

    def send_task_update(
        self,
        *,
        thread_ref: Dict[str, Any],
        task_id: str,
        status: str,
        body: str,
        preview_url: Optional[str] = None,
    ) -> None:
        if not self.configured():
            return

        ref = thread_ref if isinstance(thread_ref, dict) else {}
        stream = str(ref.get("stream") or "").strip()
        topic = str(ref.get("topic") or "").strip()
        recipients = ref.get("to")
        pm_emails = ref.get("pm_emails")
        if isinstance(recipients, list):
            emails = [str(v).strip().lower() for v in recipients if str(v).strip()]
        elif isinstance(pm_emails, list):
            emails = [str(v).strip().lower() for v in pm_emails if str(v).strip()]
        else:
            emails = []

        status_label = (status or "unknown").strip().lower() or "unknown"
        lines = [f"**Agent task `{task_id}`** · `{status_label}`"]
        compact_body = self._compact_text(body.strip())
        if status_label in {"failed", "canceled"} and compact_body:
            lines.append(compact_body)
        elif status_label == "done" and compact_body:
            lines.append(compact_body)
        if preview_url:
            lines.append(f"Preview: {preview_url}")
        lines.append("Open the task row in the topic sidebar for the live stream and controls.")
        content = "\n\n".join([line for line in lines if line])

        if stream and topic:
            self._post(
                {
                    "type": "stream",
                    "to": stream,
                    "topic": topic,
                    "content": content,
                }
            )
            return

        if emails:
            self._post(
                {
                    "type": "private",
                    "to": json.dumps(emails),
                    "content": content,
                }
            )
