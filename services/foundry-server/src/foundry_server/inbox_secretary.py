from __future__ import annotations

import json
import hashlib
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from .config import AppConfig


class InboxSecretaryError(RuntimeError):
    pass


class InboxSecretaryConfigurationError(InboxSecretaryError):
    pass


class InboxSecretaryRequestError(InboxSecretaryError):
    pass


TEXT_MIME_PREFIXES = (
    "text/",
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/yaml",
    "application/x-yaml",
)
TEXT_EXTENSIONS = (
    ".md",
    ".markdown",
    ".txt",
    ".log",
    ".json",
    ".yaml",
    ".yml",
    ".csv",
    ".tsv",
    ".vtt",
    ".srt",
)
MAX_RECENT_MESSAGES = 120
MAX_CANDIDATES = 12
MAX_CONVERSATION_MESSAGES = 40
MAX_EXTERNAL_TEXT_CHARS = 8000
MAX_TOOL_ITERATIONS = 8
PROMPT_VERSION = "priority-inbox-secretary-v1"


SYSTEM_PROMPT = """
You are Foundry's priority inbox secretary for one specific user.

Work like a strong executive secretary:
- review the user's real work context
- pull more context with tools when needed
- surface only what appears important
- keep wording tight
- separate uncertain items into an explicit unclear list
- cite every surfaced claim

Rules:
1. Do not invent details that are not supported by tool results or attached documents.
2. Prefer explicit asks, blockers, decisions, follow-ups, and likely next steps.
3. If ownership or importance is unclear, keep the item in unclear rather than overstating it.
4. Keep chat replies short. The card snapshot is the main durable output.
5. Always call publish_priority_snapshot before ending a review turn.
6. Every snapshot item must include packet ids and citation ids.
7. If earlier feedback says an item is done, waiting, or not mine, take that into account.
8. Ask a brief clarifying question only when the ambiguity materially changes the outcome.
""".strip()


def normalize_scope_key(org_key: str, user_email: str) -> str:
    return f"{org_key.strip().lower()}::{user_email.strip().lower()}"


def collapse_whitespace(value: str) -> str:
    return " ".join(value.split())


def truncate_text(value: str, limit: int) -> str:
    normalized = collapse_whitespace(value)
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(0, limit - 3)].rstrip() + "..."


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_secretary_timestamp(value: str) -> int:
    normalized = str(value or "").strip()
    if not normalized:
        return 0
    try:
        return int(datetime.fromisoformat(normalized.replace("Z", "+00:00")).timestamp())
    except Exception:
        return 0


def secretary_item_key(item: dict[str, Any]) -> str:
    return str(item.get("external_key", "")).strip()


def secretary_conversation_key(item: dict[str, Any]) -> str:
    return str(item.get("conversation_key", "")).strip()


def secretary_evidence_key(item: dict[str, Any]) -> str:
    return str(item.get("evidence_key", "")).strip()


def feedback_matches_item(item: dict[str, Any], entry: dict[str, Any]) -> bool:
    item_key = secretary_item_key(item)
    conversation_key = secretary_conversation_key(item)
    evidence_key = secretary_evidence_key(item)
    entry_item_key = str(entry.get("item_key", "")).strip()
    entry_conversation_key = str(entry.get("conversation_key", "")).strip()
    entry_evidence_key = str(entry.get("evidence_key", "")).strip()

    if item_key and entry_item_key and entry_item_key == item_key:
        return True

    if evidence_key and entry_evidence_key and entry_evidence_key == evidence_key:
        return True

    # Legacy feedback targeted entire conversations because surfaced items reused the
    # conversation key as the item key. Keep supporting those historical records only
    # for legacy conversation-keyed items. New item-specific feedback should not spill
    # over to every other task in the same thread.
    if item_key and conversation_key and item_key == conversation_key:
        return bool(
            (entry_item_key and entry_item_key == conversation_key)
            or (entry_conversation_key and entry_conversation_key == conversation_key)
        )

    if not item_key and conversation_key:
        return bool(
            (entry_item_key and entry_item_key == conversation_key)
            or (entry_conversation_key and entry_conversation_key == conversation_key)
        )

    return False


def latest_feedback_for_item(
    item: dict[str, Any],
    feedback: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not secretary_item_key(item) and not secretary_conversation_key(item):
        return None

    latest_entry: dict[str, Any] | None = None
    latest_timestamp = -1
    for entry in feedback:
        if not isinstance(entry, dict):
            continue
        if not feedback_matches_item(item, entry):
            continue
        timestamp = parse_secretary_timestamp(str(entry.get("created_at", "")))
        if latest_entry is None or timestamp >= latest_timestamp:
            latest_entry = entry
            latest_timestamp = timestamp
    return latest_entry


def latest_item_evidence_timestamp(item: dict[str, Any]) -> int:
    latest_timestamp = 0
    raw_citations = item.get("citations", [])
    if not isinstance(raw_citations, list):
        return 0
    for citation in raw_citations:
        if not isinstance(citation, dict):
            continue
        try:
            latest_timestamp = max(latest_timestamp, int(citation.get("timestamp", 0) or 0))
        except Exception:
            continue
    return latest_timestamp


def build_snapshot_external_key(
    conversation_key: str,
    title: str,
    citations: list[dict[str, Any]],
) -> str:
    evidence_key = build_snapshot_evidence_key(conversation_key, citations=citations, fallback_title=title)
    normalized_title = collapse_whitespace(title).lower()
    basis = json.dumps(
        {
            "evidence_key": evidence_key,
            "title": normalized_title,
        },
        ensure_ascii=True,
        sort_keys=True,
    )
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]
    return f"{conversation_key}#{digest}"


def build_snapshot_evidence_key(
    conversation_key: str,
    *,
    citations: list[dict[str, Any]],
    fallback_title: str,
) -> str:
    citation_anchors: list[str] = []
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        message_id = citation.get("message_id")
        if message_id is not None:
            citation_anchors.append(f"message:{message_id}")
            continue
        source_url = str(citation.get("source_url", "")).strip()
        if source_url:
            citation_anchors.append(f"url:{source_url}")

    basis = json.dumps(
        {
            "conversation_key": conversation_key,
            "anchors": sorted(set(citation_anchors)),
            "fallback_title": collapse_whitespace(fallback_title).lower() if not citation_anchors else "",
        },
        ensure_ascii=True,
        sort_keys=True,
    )
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]
    return f"{conversation_key}@{digest}"


def merge_feedback_reason(existing_reason: str, feedback_reason: str) -> str:
    existing = str(existing_reason or "").strip()
    addition = str(feedback_reason or "").strip()
    if not addition:
        return existing
    if addition in existing:
        return existing
    if not existing:
        return addition
    return f"{addition} {existing}"


def reconcile_snapshot_item_with_feedback(
    item: dict[str, Any],
    feedback: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    latest_feedback = latest_feedback_for_item(item, feedback)
    if latest_feedback is None:
        return dict(item)

    action = str(latest_feedback.get("action", "")).strip().lower()
    feedback_timestamp = parse_secretary_timestamp(str(latest_feedback.get("created_at", "")))
    latest_evidence = latest_item_evidence_timestamp(item)
    has_newer_evidence = bool(feedback_timestamp and latest_evidence > feedback_timestamp)
    updated_item = dict(item)

    if action == "waiting":
        updated_item["status"] = "waiting"
        reason = (
            "Newer activity arrived after you marked this waiting."
            if has_newer_evidence
            else "Kept in waiting based on your feedback."
        )
        updated_item["why"] = merge_feedback_reason(str(updated_item.get("why", "")), reason)
        return updated_item

    if action in {"done", "dismissed", "not_mine"} and not has_newer_evidence:
        return None

    if action in {"done", "dismissed", "not_mine"} and has_newer_evidence:
        updated_item["why"] = merge_feedback_reason(
            str(updated_item.get("why", "")),
            "Resurfaced after newer activity following your feedback.",
        )
        return updated_item

    return updated_item


def reconcile_snapshot_with_feedback(
    snapshot: dict[str, Any] | None,
    feedback: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if snapshot is None:
        return None

    reconciled = dict(snapshot)
    for bucket in ("priorities", "unclear"):
        raw_items = snapshot.get(bucket, [])
        if not isinstance(raw_items, list):
            reconciled[bucket] = []
            continue

        reconciled_items: list[dict[str, Any]] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue
            reconciled_item = reconcile_snapshot_item_with_feedback(raw_item, feedback)
            if reconciled_item is not None:
                reconciled_items.append(reconciled_item)
        reconciled[bucket] = reconciled_items

    return reconciled


class _MessageHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.text_parts: list[str] = []
        self.links: list[str] = []
        self._in_ignorable = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style"}:
            self._in_ignorable = True
            return
        if normalized in {"br", "p", "div", "li", "blockquote", "ul", "ol"}:
            self.text_parts.append(" ")
        if normalized == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style"}:
            self._in_ignorable = False
        if normalized in {"p", "div", "li", "blockquote"}:
            self.text_parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._in_ignorable:
            self.text_parts.append(data)


def strip_html_and_links(value: str, base_url: str) -> tuple[str, list[str]]:
    parser = _MessageHtmlParser()
    parser.feed(value or "")
    parser.close()
    links: list[str] = []
    for link in parser.links:
        try:
            links.append(urljoin(base_url.rstrip("/") + "/", link))
        except Exception:
            continue
    return collapse_whitespace(unescape("".join(parser.text_parts))), links


def parse_title_from_html(value: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", value or "", flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return truncate_text(unescape(collapse_whitespace(match.group(1))), 180)


def is_text_url(url: str) -> bool:
    lowered = url.lower()
    return any(lowered.endswith(ext) for ext in TEXT_EXTENSIONS)


@dataclass
class ToolRuntimeContext:
    packet_index: int = 0
    citation_index: int = 0
    packets: dict[str, dict[str, Any]] = field(default_factory=dict)
    citations: dict[str, dict[str, Any]] = field(default_factory=dict)
    conversations: dict[str, dict[str, Any]] = field(default_factory=dict)
    traces: list[dict[str, Any]] = field(default_factory=list)
    latest_snapshot: dict[str, Any] | None = None

    def next_packet_id(self) -> str:
        self.packet_index += 1
        return f"packet_{self.packet_index}"

    def next_citation_id(self) -> str:
        self.citation_index += 1
        return f"citation_{self.citation_index}"

    def remember_conversation(self, conversation: dict[str, Any]) -> None:
        self.conversations[str(conversation["conversation_key"])] = dict(conversation)

    def remember_packet(self, packet: dict[str, Any]) -> None:
        self.packets[str(packet["packet_id"])] = dict(packet)

    def remember_citation(self, citation: dict[str, Any]) -> None:
        self.citations[str(citation["citation_id"])] = dict(citation)


class ZulipInboxClient:
    def __init__(self, *, realm_url: str, user_email: str, api_key: str) -> None:
        self.realm_url = realm_url.rstrip("/")
        self.user_email = user_email
        self.api_key = api_key

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        absolute_url: bool = False,
        authenticated: bool = True,
        timeout: float = 20.0,
    ) -> httpx.Response:
        url = path_or_url if absolute_url else f"{self.realm_url}{path_or_url}"
        auth = (self.user_email, self.api_key) if authenticated else None
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            response = client.request(method, url, params=params, data=data, auth=auth)
        response.raise_for_status()
        return response

    def register_snapshot(self) -> dict[str, Any]:
        event_types = json.dumps(["realm_user", "subscription", "user_topic"])
        fetch_event_types = json.dumps(
            ["subscription", "realm_user", "recent_private_conversations", "user_topic"]
        )
        response = self._request(
            "POST",
            "/api/v1/register",
            data={
                "apply_markdown": "true",
                "client_gravatar": "true",
                "event_types": event_types,
                "fetch_event_types": fetch_event_types,
            },
        )
        payload = response.json()
        queue_id = str(payload.get("queue_id", "")).strip()
        if queue_id:
            try:
                self._request("DELETE", "/api/v1/events", data={"queue_id": queue_id})
            except Exception:
                pass
        return payload

    def get_messages(
        self,
        narrow: list[dict[str, Any]],
        *,
        anchor: str = "newest",
        num_before: int = 40,
        num_after: int = 0,
    ) -> dict[str, Any]:
        response = self._request(
            "GET",
            "/api/v1/messages",
            params={
                "anchor": anchor,
                "num_before": str(num_before),
                "num_after": str(num_after),
                "apply_markdown": "true",
                "client_gravatar": "true",
                "narrow": json.dumps(narrow),
            },
        )
        return response.json()

    def fetch_link_text(self, url: str, *, max_chars: int = MAX_EXTERNAL_TEXT_CHARS) -> dict[str, str]:
        parsed_realm = urlparse(self.realm_url)
        parsed_url = urlparse(url)
        if parsed_url.scheme not in {"http", "https"}:
            raise InboxSecretaryRequestError(f"Unsupported URL scheme: {parsed_url.scheme or 'unknown'}")

        def effective_port(parsed: Any) -> int | None:
            if parsed.port is not None:
                return int(parsed.port)
            if parsed.scheme == "https":
                return 443
            if parsed.scheme == "http":
                return 80
            return None

        authenticated = (
            parsed_url.scheme == parsed_realm.scheme
            and parsed_url.hostname == parsed_realm.hostname
            and effective_port(parsed_url) == effective_port(parsed_realm)
        )
        response = self._request(
            "GET",
            url,
            absolute_url=True,
            authenticated=authenticated,
            timeout=25.0,
        )
        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if not (
            any(content_type.startswith(prefix) for prefix in TEXT_MIME_PREFIXES)
            or is_text_url(url)
            or content_type == ""
        ):
            raise InboxSecretaryRequestError(f"Unsupported non-text content type: {content_type or 'unknown'}")

        text = response.text
        title = ""
        if "<html" in text.lower():
            title = parse_title_from_html(text)
            text, _links = strip_html_and_links(text, url)
        else:
            text = collapse_whitespace(unescape(text))
        return {
            "url": url,
            "title": title or truncate_text(url, 120),
            "text": truncate_text(text, max_chars),
        }


def _build_dm_key(user_ids: list[int]) -> str:
    return "dm:" + ",".join(str(user_id) for user_id in sorted(user_ids))


def _build_stream_key(stream_id: int, topic: str) -> str:
    return f"stream:{stream_id}:{topic}"


def _build_narrow_from_conversation(conversation: dict[str, Any]) -> list[dict[str, Any]]:
    if conversation["kind"] == "stream":
        narrow: list[dict[str, Any]] = [{"operator": "stream", "operand": conversation["stream_name"] or str(conversation["stream_id"])}]
        if conversation.get("topic"):
            narrow.append({"operator": "topic", "operand": conversation["topic"]})
        return narrow
    return [{"operator": "dm", "operand": conversation["user_ids"]}]


def _build_narrow_string(conversation: dict[str, Any]) -> str:
    if conversation["kind"] == "stream":
        return f"stream:{conversation['stream_id']}/topic:{conversation['topic']}"
    return "dm:" + ",".join(str(user_id) for user_id in conversation["user_ids"])


def _parse_conversation_key(conversation_key: str) -> dict[str, Any]:
    if conversation_key.startswith("stream:"):
        _, stream_id, topic = conversation_key.split(":", 2)
        return {
            "conversation_key": conversation_key,
            "kind": "stream",
            "stream_id": int(stream_id),
            "topic": topic,
            "user_ids": [],
        }
    if conversation_key.startswith("dm:"):
        ids = [int(part) for part in conversation_key.split(":", 1)[1].split(",") if part]
        return {
            "conversation_key": conversation_key,
            "kind": "dm",
            "stream_id": None,
            "topic": "",
            "user_ids": ids,
        }
    raise InboxSecretaryRequestError(f"Unsupported conversation key: {conversation_key}")


def build_recent_conversations(
    client: ZulipInboxClient,
    *,
    current_user_id: int | None,
    limit: int = MAX_CANDIDATES,
) -> list[dict[str, Any]]:
    snapshot = client.register_snapshot()
    users_by_id = {
        int(user["user_id"]): {
            "full_name": str(user.get("full_name", "")).strip(),
            "email": str(user.get("email", "")).strip(),
        }
        for user in snapshot.get("realm_users", [])
    }
    streams_by_id = {
        int(subscription["stream_id"]): str(subscription.get("name", "")).strip()
        for subscription in snapshot.get("subscriptions", [])
    }

    unread_streams: dict[tuple[int, str], int] = {}
    for item in snapshot.get("unread_msgs", {}).get("streams", []):
        key = (int(item.get("stream_id", 0)), str(item.get("topic", "")).strip())
        unread_streams[key] = len(item.get("unread_message_ids", []))

    unread_dms: dict[str, int] = {}
    for item in snapshot.get("unread_msgs", {}).get("pms", []):
        other_user_id = item.get("other_user_id") or item.get("sender_id")
        if other_user_id is None:
            continue
        key = _build_dm_key([int(other_user_id)])
        unread_dms[key] = len(item.get("unread_message_ids", []))

    for item in snapshot.get("unread_msgs", {}).get("huddles", []):
        user_ids = [int(part) for part in str(item.get("user_ids_string", "")).split(",") if part]
        key = _build_dm_key(user_ids)
        unread_dms[key] = len(item.get("unread_message_ids", []))

    recent_messages = client.get_messages([], anchor="newest", num_before=MAX_RECENT_MESSAGES, num_after=0)
    conversations: dict[str, dict[str, Any]] = {}

    for message in reversed(recent_messages.get("messages", [])):
        message_type = str(message.get("type", ""))
        content_text, links = strip_html_and_links(str(message.get("content", "")), client.realm_url)
        excerpt = truncate_text(content_text, 200)
        if message_type == "stream":
            stream_id = message.get("stream_id")
            if stream_id is None:
                continue
            topic = collapse_whitespace(str(message.get("subject", "")).strip())
            if not topic:
                continue
            stream_id = int(stream_id)
            stream_name = ""
            display_recipient = message.get("display_recipient")
            if isinstance(display_recipient, str):
                stream_name = display_recipient
            if not stream_name:
                stream_name = streams_by_id.get(stream_id, str(stream_id))
            key = _build_stream_key(stream_id, topic)
            conversations[key] = {
                "conversation_key": key,
                "kind": "stream",
                "label": f"{stream_name} > {topic}",
                "stream_id": stream_id,
                "stream_name": stream_name,
                "topic": topic,
                "user_ids": [],
                "unread_count": unread_streams.get((stream_id, topic), 0),
                "last_message_id": int(message.get("id", 0)),
                "latest_excerpt": excerpt,
                "latest_links": links[:8],
            }
            continue

        recipients = message.get("display_recipient")
        if not isinstance(recipients, list):
            continue
        other_user_ids = sorted(
            int(user["id"])
            for user in recipients
            if int(user.get("id", 0)) and int(user.get("id", 0)) != current_user_id
        )
        if not other_user_ids:
            continue
        key = _build_dm_key(other_user_ids)
        label = ", ".join(
            truncate_text(
                users_by_id.get(user_id, {}).get("full_name")
                or str(next((user.get("full_name", "") for user in recipients if int(user.get("id", 0)) == user_id), "")),
                60,
            )
            for user_id in other_user_ids
        )
        conversations[key] = {
            "conversation_key": key,
            "kind": "dm",
            "label": label,
            "stream_id": None,
            "stream_name": "",
            "topic": "",
            "user_ids": other_user_ids,
            "unread_count": unread_dms.get(key, 0),
            "last_message_id": int(message.get("id", 0)),
            "latest_excerpt": excerpt,
            "latest_links": links[:8],
        }

    for user_topic in snapshot.get("user_topics", []):
        if int(user_topic.get("visibility_policy", 0)) != 3:
            continue
        stream_id = int(user_topic.get("stream_id", 0))
        topic = collapse_whitespace(str(user_topic.get("topic_name", "")).strip())
        if not stream_id or not topic:
            continue
        key = _build_stream_key(stream_id, topic)
        conversations.setdefault(
            key,
            {
                "conversation_key": key,
                "kind": "stream",
                "label": f"{streams_by_id.get(stream_id, stream_id)} > {topic}",
                "stream_id": stream_id,
                "stream_name": streams_by_id.get(stream_id, str(stream_id)),
                "topic": topic,
                "user_ids": [],
                "unread_count": unread_streams.get((stream_id, topic), 0),
                "last_message_id": int(user_topic.get("last_updated", 0)),
                "latest_excerpt": "",
                "latest_links": [],
            },
        )

    items = list(conversations.values())
    items.sort(
        key=lambda item: (
            item["unread_count"] > 0,
            item["kind"] == "dm",
            item["unread_count"],
            item["last_message_id"],
        ),
        reverse=True,
    )
    return items[: max(1, limit)]


class InboxSecretaryService:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        if not self.config.anthropic_api_key:
            raise InboxSecretaryConfigurationError(
                "Inbox secretary requires FOUNDRY_ANTHROPIC_API_KEY."
            )

    def _anthropic_headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.config.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _call_anthropic(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "model": self.config.anthropic_model,
            "max_tokens": 1800,
            "temperature": 0.2,
            "system": SYSTEM_PROMPT,
            "messages": messages,
            "tools": tools,
        }
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            response = client.post(
                f"{self.config.anthropic_api_base_url}/v1/messages",
                headers=self._anthropic_headers(),
                json=payload,
            )
        if response.status_code >= 400:
            raise InboxSecretaryRequestError(
                f"Anthropic request failed ({response.status_code}): {response.text}"
            )
        data = response.json()
        if not isinstance(data, dict):
            raise InboxSecretaryRequestError("Anthropic returned an unexpected response shape.")
        return data

    def _assistant_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "list_recent_conversations",
                "description": "List recent and unread conversations the user can access across streams and direct messages.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "limit": {"type": "integer"},
                    },
                    "required": [],
                    "additionalProperties": False,
                },
            },
            {
                "name": "get_conversation_messages",
                "description": "Fetch the recent transcript, links, and citation anchors for one conversation.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "conversation_key": {"type": "string"},
                        "max_messages": {"type": "integer"},
                    },
                    "required": ["conversation_key"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "get_link_context",
                "description": "Fetch and extract readable text from a linked document, page, or code review URL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string"},
                        "max_chars": {"type": "integer"},
                    },
                    "required": ["url"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "get_attachment_text",
                "description": "Fetch a text transcript or text attachment linked from a conversation.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string"},
                        "max_chars": {"type": "integer"},
                    },
                    "required": ["url"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "publish_priority_snapshot",
                "description": "Publish the current likely priorities and unclear items with citations.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "priorities": {
                            "type": "array",
                            "items": {"type": "object"},
                        },
                        "unclear": {
                            "type": "array",
                            "items": {"type": "object"},
                        },
                        "run_notes": {"type": "object"},
                    },
                    "required": ["priorities", "unclear"],
                    "additionalProperties": False,
                },
            },
        ]

    def _tool_list_recent_conversations(
        self,
        runtime: ToolRuntimeContext,
        realm_client: ZulipInboxClient,
        *,
        current_user_id: int | None,
        limit: int,
    ) -> dict[str, Any]:
        conversations = build_recent_conversations(
            realm_client,
            current_user_id=current_user_id,
            limit=limit,
        )
        for conversation in conversations:
            conversation["narrow"] = _build_narrow_string(conversation)
            runtime.remember_conversation(conversation)
        return {"conversations": conversations}

    def _tool_get_conversation_messages(
        self,
        runtime: ToolRuntimeContext,
        realm_client: ZulipInboxClient,
        *,
        conversation_key: str,
        max_messages: int,
    ) -> dict[str, Any]:
        conversation = runtime.conversations.get(conversation_key) or _parse_conversation_key(conversation_key)
        narrow = _build_narrow_from_conversation(conversation)
        response = realm_client.get_messages(
            narrow,
            anchor="newest",
            num_before=max(1, min(MAX_CONVERSATION_MESSAGES, max_messages)),
            num_after=0,
        )
        packet_id = runtime.next_packet_id()
        citation_ids: list[str] = []
        messages: list[dict[str, Any]] = []
        for message in response.get("messages", []):
            text, links = strip_html_and_links(str(message.get("content", "")), realm_client.realm_url)
            citation_id = runtime.next_citation_id()
            citation = {
                "citation_id": citation_id,
                "message_id": int(message.get("id", 0)),
                "sender_name": str(message.get("sender_full_name", "")).strip(),
                "excerpt": truncate_text(text, 240),
                "timestamp": int(message.get("timestamp", 0)),
                "source_url": f"{realm_client.realm_url}/#narrow/near/{int(message.get('id', 0))}",
                "title": truncate_text(conversation.get("label", conversation_key), 120),
            }
            runtime.remember_citation(citation)
            citation_ids.append(citation_id)
            messages.append(
                {
                    "message_id": int(message.get("id", 0)),
                    "sender_name": str(message.get("sender_full_name", "")).strip(),
                    "sender_email": str(message.get("sender_email", "")).strip(),
                    "timestamp": int(message.get("timestamp", 0)),
                    "text": truncate_text(text, 1600),
                    "citation_id": citation_id,
                    "links": links[:10],
                }
            )

        enriched = {
            **conversation,
            "packet_id": packet_id,
            "narrow": runtime.conversations.get(conversation_key, {}).get("narrow")
            or _build_narrow_string(conversation),
        }
        runtime.remember_conversation(enriched)
        runtime.remember_packet(
            {
                "packet_id": packet_id,
                "conversation_key": conversation_key,
                "kind": conversation["kind"],
                "narrow": enriched["narrow"],
                "stream_id": conversation.get("stream_id"),
                "stream_name": conversation.get("stream_name", ""),
                "topic": conversation.get("topic", ""),
                "user_ids": conversation.get("user_ids", []),
                "label": conversation.get("label", conversation_key),
            }
        )
        return {
            "packet_id": packet_id,
            "conversation": enriched,
            "messages": messages,
            "citation_ids": citation_ids,
        }

    def _tool_get_link_text(
        self,
        runtime: ToolRuntimeContext,
        realm_client: ZulipInboxClient,
        *,
        url: str,
        max_chars: int,
    ) -> dict[str, Any]:
        link = realm_client.fetch_link_text(url, max_chars=max_chars)
        packet_id = runtime.next_packet_id()
        citation_id = runtime.next_citation_id()
        citation = {
            "citation_id": citation_id,
            "message_id": None,
            "sender_name": "",
            "excerpt": truncate_text(link["text"], 240),
            "timestamp": 0,
            "source_url": link["url"],
            "title": truncate_text(link["title"], 120),
        }
        runtime.remember_citation(citation)
        runtime.remember_packet(
            {
                "packet_id": packet_id,
                "conversation_key": "",
                "kind": "link",
                "narrow": "",
                "stream_id": None,
                "stream_name": "",
                "topic": "",
                "user_ids": [],
                "label": link["title"],
            }
        )
        return {
            "packet_id": packet_id,
            "url": link["url"],
            "title": link["title"],
            "text": link["text"],
            "citation_ids": [citation_id],
        }

    def _parse_snapshot_item(self, runtime: ToolRuntimeContext, raw_item: dict[str, Any], *, default_status: str) -> dict[str, Any]:
        conversation_key = str(raw_item.get("conversation_key", "")).strip()
        if not conversation_key:
            raise InboxSecretaryRequestError("Snapshot item missing conversation_key.")
        packet_ids = [str(item) for item in raw_item.get("source_packet_ids", []) if str(item).strip()]
        citation_ids = [str(item) for item in raw_item.get("citation_ids", []) if str(item).strip()]
        if not packet_ids:
            raise InboxSecretaryRequestError("Snapshot item missing source_packet_ids.")
        if not citation_ids:
            raise InboxSecretaryRequestError("Snapshot item missing citation_ids.")
        for packet_id in packet_ids:
            if packet_id not in runtime.packets:
                raise InboxSecretaryRequestError(f"Unknown packet id in snapshot: {packet_id}")
        resolved_citations = []
        for citation_id in citation_ids:
            citation = runtime.citations.get(citation_id)
            if citation is None:
                raise InboxSecretaryRequestError(f"Unknown citation id in snapshot: {citation_id}")
            resolved_citations.append(citation)

        conversation = runtime.conversations.get(conversation_key) or _parse_conversation_key(conversation_key)
        narrow = runtime.conversations.get(conversation_key, {}).get("narrow") or _build_narrow_string(conversation)
        status = str(raw_item.get("status", default_status)).strip() or default_status
        title = truncate_text(str(raw_item.get("title", "")).strip(), 120)
        evidence_key = build_snapshot_evidence_key(
            conversation_key,
            citations=resolved_citations,
            fallback_title=title,
        )
        return {
            "external_key": build_snapshot_external_key(
                conversation_key,
                title=title,
                citations=resolved_citations,
            ),
            "evidence_key": evidence_key,
            "conversation_key": conversation_key,
            "narrow": narrow,
            "kind": conversation["kind"],
            "label": conversation.get("label", conversation_key),
            "stream_id": conversation.get("stream_id"),
            "stream_name": conversation.get("stream_name", ""),
            "topic": conversation.get("topic", ""),
            "user_ids": conversation.get("user_ids", []),
            "title": title,
            "summary": truncate_text(str(raw_item.get("summary", "")).strip(), 240),
            "why": truncate_text(str(raw_item.get("why", "")).strip(), 180),
            "status": status,
            "confidence": str(raw_item.get("confidence", "medium")).strip() or "medium",
            "source_packet_ids": packet_ids,
            "citation_ids": citation_ids,
            "citations": resolved_citations,
        }

    def _tool_publish_priority_snapshot(
        self,
        runtime: ToolRuntimeContext,
        *,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        priorities = [
            self._parse_snapshot_item(runtime, item, default_status="needs_action")
            for item in payload.get("priorities", [])
            if isinstance(item, dict)
        ]
        unclear = [
            self._parse_snapshot_item(runtime, item, default_status="unclear")
            for item in payload.get("unclear", [])
            if isinstance(item, dict)
        ]
        snapshot = {
            "generated_at": now_iso(),
            "priorities": priorities,
            "unclear": unclear,
            "run_notes": payload.get("run_notes", {}),
        }
        runtime.latest_snapshot = snapshot
        return {
            "ok": True,
            "priority_count": len(priorities),
            "unclear_count": len(unclear),
        }

    def _execute_tool(
        self,
        *,
        runtime: ToolRuntimeContext,
        realm_client: ZulipInboxClient,
        current_user_id: int | None,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> dict[str, Any]:
        if tool_name == "list_recent_conversations":
            return self._tool_list_recent_conversations(
                runtime,
                realm_client,
                current_user_id=current_user_id,
                limit=max(1, min(MAX_CANDIDATES, int(tool_input.get("limit", MAX_CANDIDATES)))),
            )
        if tool_name == "get_conversation_messages":
            return self._tool_get_conversation_messages(
                runtime,
                realm_client,
                conversation_key=str(tool_input.get("conversation_key", "")),
                max_messages=max(1, min(MAX_CONVERSATION_MESSAGES, int(tool_input.get("max_messages", MAX_CONVERSATION_MESSAGES)))),
            )
        if tool_name == "get_link_context":
            return self._tool_get_link_text(
                runtime,
                realm_client,
                url=str(tool_input.get("url", "")),
                max_chars=max(400, min(MAX_EXTERNAL_TEXT_CHARS, int(tool_input.get("max_chars", 4000)))),
            )
        if tool_name == "get_attachment_text":
            return self._tool_get_link_text(
                runtime,
                realm_client,
                url=str(tool_input.get("url", "")),
                max_chars=max(400, min(MAX_EXTERNAL_TEXT_CHARS, int(tool_input.get("max_chars", 6000)))),
            )
        if tool_name == "publish_priority_snapshot":
            return self._tool_publish_priority_snapshot(runtime, payload=tool_input)
        raise InboxSecretaryRequestError(f"Unsupported tool: {tool_name}")

    def run_turn(
        self,
        *,
        realm_url: str,
        user_email: str,
        api_key: str,
        current_user_id: int | None,
        prior_turns: list[dict[str, Any]],
        feedback: list[dict[str, Any]],
        message: str,
    ) -> dict[str, Any]:
        runtime = ToolRuntimeContext()
        realm_client = ZulipInboxClient(
            realm_url=realm_url,
            user_email=user_email,
            api_key=api_key,
        )

        messages: list[dict[str, Any]] = []
        for turn in prior_turns[-10:]:
            role = str(turn.get("role", "")).strip()
            text = str(turn.get("text", "")).strip()
            if role not in {"user", "assistant"} or not text:
                continue
            messages.append({"role": role, "content": [{"type": "text", "text": text}]})

        context_prefix = (
            "Current user context:\n"
            f"- realm_url: {realm_url}\n"
            f"- user_email: {user_email}\n"
            f"- current_time: {now_iso()}\n\n"
            "Recent feedback:\n"
            f"{json.dumps(feedback[-12:], ensure_ascii=True)}\n\n"
            "User request:\n"
        )
        messages.append(
            {
                "role": "user",
                "content": [{"type": "text", "text": context_prefix + message.strip()}],
            }
        )

        tools = self._assistant_tools()
        final_reply = ""
        reminded_to_publish_snapshot = False
        for _ in range(MAX_TOOL_ITERATIONS):
            tool_choice: dict[str, Any] | None = None
            if runtime.latest_snapshot is None:
                if reminded_to_publish_snapshot and runtime.packets and runtime.citations:
                    tool_choice = {"type": "tool", "name": "publish_priority_snapshot"}
                else:
                    tool_choice = {"type": "any"}

            response = self._call_anthropic(
                messages=messages,
                tools=tools,
                tool_choice=tool_choice,
            )
            content_blocks = response.get("content", [])
            assistant_message = {"role": "assistant", "content": content_blocks}
            messages.append(assistant_message)

            tool_results: list[dict[str, Any]] = []
            final_text_blocks: list[str] = []
            for block in content_blocks:
                if block.get("type") == "text":
                    text = str(block.get("text", "")).strip()
                    if text:
                        final_text_blocks.append(text)
                if block.get("type") != "tool_use":
                    continue
                start = time.perf_counter()
                tool_name = str(block.get("name", ""))
                tool_input = block.get("input", {})
                tool_use_id = str(block.get("id", ""))
                try:
                    result = self._execute_tool(
                        runtime=runtime,
                        realm_client=realm_client,
                        current_user_id=current_user_id,
                        tool_name=tool_name,
                        tool_input=tool_input if isinstance(tool_input, dict) else {},
                    )
                    status = "ok"
                    payload = json.dumps(result, ensure_ascii=True)
                except Exception as exc:
                    status = "error"
                    result = {"error": str(exc)}
                    payload = json.dumps(result, ensure_ascii=True)
                duration_ms = int((time.perf_counter() - start) * 1000)
                runtime.traces.append(
                    {
                        "tool_name": tool_name,
                        "input": tool_input,
                        "result": result,
                        "status": status,
                        "duration_ms": duration_ms,
                    }
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": payload,
                        **({"is_error": True} if status == "error" else {}),
                    }
                )

            if tool_results:
                messages.append({"role": "user", "content": tool_results})
                continue

            final_reply = " ".join(final_text_blocks).strip()
            if runtime.latest_snapshot is None:
                if reminded_to_publish_snapshot:
                    break
                reminded_to_publish_snapshot = True
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "You have not published the priority snapshot yet. "
                                    "Use the tools to inspect the user context as needed, then call "
                                    "publish_priority_snapshot before ending the turn. Keep the reply short."
                                ),
                            }
                        ],
                    }
                )
                continue
            break

        if runtime.latest_snapshot is None:
            raise InboxSecretaryRequestError("Claude did not publish a priority snapshot.")

        return {
            "reply": final_reply or "Updated your priority inbox.",
            "snapshot": runtime.latest_snapshot,
            "tool_traces": runtime.traces,
            "model": self.config.anthropic_model,
            "prompt_version": PROMPT_VERSION,
        }
