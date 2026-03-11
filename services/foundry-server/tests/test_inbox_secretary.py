from __future__ import annotations

import json
import shutil
import socketserver
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.app import create_app  # noqa: E402
from foundry_server.config import load_config  # noqa: E402
from foundry_server.inbox_secretary import (  # noqa: E402
    InboxSecretaryService,
    reconcile_snapshot_with_feedback,
)


class _InboxSecretaryApiHandler(BaseHTTPRequestHandler):
    anthropic_calls = 0
    transcript_requests = 0

    @classmethod
    def reset(cls) -> None:
        cls.anthropic_calls = 0
        cls.transcript_requests = 0

    def _read_body(self) -> str:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length).decode("utf-8") if length else ""

    def _read_json(self) -> dict[str, object]:
        raw = self._read_body()
        return json.loads(raw or "{}")

    def _write_json(self, payload: dict[str, object], *, status: int = 200) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _write_text(self, text: str, *, content_type: str = "text/plain") -> None:
        encoded = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _anthropic_response(self, payload: dict[str, object]) -> dict[str, object]:
        self.__class__.anthropic_calls += 1
        call_number = self.__class__.anthropic_calls
        messages = payload.get("messages", [])
        if not isinstance(messages, list):
            self.send_error(400)
            return {}

        if call_number == 1:
            return {
                "id": "msg_1",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_list_recent",
                        "name": "list_recent_conversations",
                        "input": {"limit": 4},
                    }
                ],
                "model": "claude-test",
                "stop_reason": "tool_use",
            }

        if call_number == 2:
            tool_payload = self._latest_tool_payload(messages)
            conversations = tool_payload.get("conversations", [])
            conversation_key = conversations[0]["conversation_key"]
            return {
                "id": "msg_2",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_get_messages",
                        "name": "get_conversation_messages",
                        "input": {
                            "conversation_key": conversation_key,
                            "max_messages": 12,
                        },
                    }
                ],
                "model": "claude-test",
                "stop_reason": "tool_use",
            }

        if call_number == 3:
            tool_payload = self._latest_tool_payload(messages)
            transcript_url = tool_payload["messages"][0]["links"][0]
            return {
                "id": "msg_3",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_get_attachment",
                        "name": "get_attachment_text",
                        "input": {
                            "url": transcript_url,
                            "max_chars": 3000,
                        },
                    }
                ],
                "model": "claude-test",
                "stop_reason": "tool_use",
            }

        if call_number == 4:
            conversation_result = self._tool_result_by_key(messages, "conversation")
            attachment_result = self._tool_result_by_key(messages, "url")
            conversation_key = conversation_result["conversation"]["conversation_key"]
            conversation_packet_id = conversation_result["packet_id"]
            attachment_packet_id = attachment_result["packet_id"]
            conversation_citation_id = conversation_result["citation_ids"][0]
            attachment_citation_id = attachment_result["citation_ids"][0]
            return {
                "id": "msg_4",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_publish",
                        "name": "publish_priority_snapshot",
                        "input": {
                            "priorities": [
                                {
                                    "external_key": "m1-ict-decision",
                                    "conversation_key": conversation_key,
                                    "title": "Decide on M1 ICT",
                                    "summary": "Owner asked for your approval after the cap recording review.",
                                    "why": "The next step is blocked until you decide.",
                                    "status": "needs_action",
                                    "confidence": "high",
                                    "source_packet_ids": [
                                        conversation_packet_id,
                                        attachment_packet_id,
                                    ],
                                    "citation_ids": [
                                        conversation_citation_id,
                                        attachment_citation_id,
                                    ],
                                }
                            ],
                            "unclear": [],
                            "run_notes": {
                                "reviewed_conversations": 1,
                                "reviewed_transcripts": 1,
                            },
                        },
                    }
                ],
                "model": "claude-test",
                "stop_reason": "tool_use",
            }

        return {
            "id": "msg_5",
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "1 likely priority surfaced. Nothing else looked strong enough to escalate.",
                }
            ],
            "model": "claude-test",
            "stop_reason": "end_turn",
        }

    def _latest_tool_payload(self, messages: list[dict[str, object]]) -> dict[str, object]:
        for message in reversed(messages):
            if message.get("role") != "user":
                continue
            content = message.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                payload = block.get("content", "{}")
                if isinstance(payload, str):
                    return json.loads(payload)
        raise AssertionError("Expected a tool_result payload.")

    def _tool_result_by_key(self, messages: list[dict[str, object]], key: str) -> dict[str, object]:
        for message in reversed(messages):
            if message.get("role") != "user":
                continue
            content = message.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                payload = block.get("content", "{}")
                if not isinstance(payload, str):
                    continue
                data = json.loads(payload)
                if key in data:
                    return data
        raise AssertionError(f"Expected tool_result containing key {key}.")

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/v1/register":
            self._read_body()
            self._write_json(
                {
                    "queue_id": "test-queue",
                    "realm_users": [
                        {
                            "user_id": 1,
                            "full_name": "Aldrin Clement",
                            "email": "ac@meridian.cv",
                        },
                        {
                            "user_id": 2,
                            "full_name": "Meridian Owner",
                            "email": "owner@meridian.cv",
                        },
                    ],
                    "subscriptions": [
                        {"stream_id": 5, "name": "mos-recordings"},
                    ],
                    "user_topics": [
                        {
                            "stream_id": 5,
                            "topic_name": "Cap Recording Summary",
                            "visibility_policy": 3,
                            "last_updated": 1741630080,
                        }
                    ],
                    "unread_msgs": {
                        "streams": [
                            {
                                "stream_id": 5,
                                "topic": "Cap Recording Summary",
                                "unread_message_ids": [101],
                            }
                        ],
                        "pms": [],
                        "huddles": [],
                    },
                }
            )
            return

        if self.path == "/v1/messages":
            payload = self._read_json()
            self._write_json(self._anthropic_response(payload))
            return

        self.send_error(404)

    def do_DELETE(self) -> None:  # noqa: N802
        if self.path == "/api/v1/events":
            self._write_json({"result": "success"})
            return
        self.send_error(404)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/messages":
            query = parse_qs(parsed.query)
            narrow = json.loads(query.get("narrow", ["[]"])[0])
            if not narrow:
                self._write_json(
                    {
                        "messages": [
                            {
                                "id": 101,
                                "type": "stream",
                                "stream_id": 5,
                                "subject": "Cap Recording Summary",
                                "display_recipient": "mos-recordings",
                                "sender_full_name": "Meridian Owner",
                                "sender_email": "owner@meridian.cv",
                                "timestamp": 1741630080,
                                "content": (
                                    "<p>Need Aldrin to approve M1 ICT by Wednesday. "
                                    'Transcript: <a href="/transcripts/m1-ict.txt">meeting transcript</a></p>'
                                ),
                            }
                        ]
                    }
                )
                return

            self._write_json(
                {
                    "messages": [
                        {
                            "id": 101,
                            "type": "stream",
                            "stream_id": 5,
                            "subject": "Cap Recording Summary",
                            "display_recipient": "mos-recordings",
                            "sender_full_name": "Meridian Owner",
                            "sender_email": "owner@meridian.cv",
                            "timestamp": 1741630080,
                            "content": (
                                "<p>Need Aldrin to approve M1 ICT by Wednesday. "
                                'Transcript: <a href="/transcripts/m1-ict.txt">meeting transcript</a></p>'
                            ),
                        },
                        {
                            "id": 102,
                            "type": "stream",
                            "stream_id": 5,
                            "subject": "Cap Recording Summary",
                            "display_recipient": "mos-recordings",
                            "sender_full_name": "Aldrin Clement",
                            "sender_email": "ac@meridian.cv",
                            "timestamp": 1741630180,
                            "content": "<p>I will review the recording today.</p>",
                        },
                    ]
                }
            )
            return

        if parsed.path == "/transcripts/m1-ict.txt":
            self.__class__.transcript_requests += 1
            self._write_text(
                "Decision needed: Aldrin should approve or reject the M1 ICT rollout after the meeting review."
            )
            return

        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class _ThreadingInboxSecretaryApiServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class InboxSecretaryTests(unittest.TestCase):
    def setUp(self) -> None:
        _InboxSecretaryApiHandler.reset()
        self.server = _ThreadingInboxSecretaryApiServer(("127.0.0.1", 0), _InboxSecretaryApiHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp_dir = tempfile.mkdtemp(prefix="foundry-server-inbox-secretary-")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_client(self) -> TestClient:
        base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        config = load_config(
            {
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "platform-admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_DATABASE_PATH": str(Path(self.temp_dir) / "foundry-server.sqlite3"),
                "FOUNDRY_ANTHROPIC_API_KEY": "anthropic-test-key",
                "FOUNDRY_ANTHROPIC_API_BASE_URL": base_url,
                "FOUNDRY_ANTHROPIC_MODEL": "claude-test",
            }
        )
        return TestClient(create_app(config))

    def test_secretary_routes_run_chat_loop_and_persist_feedback(self) -> None:
        request_payload = {
            "org_key": "meridian",
            "realm_url": f"http://127.0.0.1:{self.server.server_address[1]}",
            "user_email": "ac@meridian.cv",
        }

        with self._create_client() as client:
            session_response = client.post(
                "/api/v1/desktop/inbox-secretary/session",
                json=request_payload,
            )
            self.assertEqual(session_response.status_code, 200)
            self.assertTrue(session_response.json()["configured"])
            self.assertEqual(session_response.json()["turns"], [])
            self.assertIsNone(session_response.json()["snapshot"])

            chat_response = client.post(
                "/api/v1/desktop/inbox-secretary/chat",
                json={
                    **request_payload,
                    "api_key": "zulip-test-key",
                    "current_user_id": 1,
                    "message": "Review my Meridian work and surface what matters.",
                },
            )
            self.assertEqual(chat_response.status_code, 200)
            chat_payload = chat_response.json()
            self.assertEqual([turn["role"] for turn in chat_payload["turns"]], ["user", "assistant"])
            self.assertEqual(chat_payload["last_run"]["model"], "claude-test")
            self.assertEqual(
                [trace["tool_name"] for trace in chat_payload["last_run"]["tool_traces"]],
                [
                    "list_recent_conversations",
                    "get_conversation_messages",
                    "get_attachment_text",
                    "publish_priority_snapshot",
                ],
            )

            snapshot = chat_payload["snapshot"]
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot["run_notes"]["reviewed_transcripts"], 1)
            self.assertEqual(len(snapshot["priorities"]), 1)
            item = snapshot["priorities"][0]
            self.assertEqual(item["title"], "Decide on M1 ICT")
            self.assertEqual(item["summary"], "Owner asked for your approval after the cap recording review.")
            self.assertEqual(item["why"], "The next step is blocked until you decide.")
            self.assertEqual(item["status"], "needs_action")
            self.assertNotEqual(item["external_key"], item["conversation_key"])
            self.assertEqual(len(item["citations"]), 2)
            self.assertEqual(item["citations"][0]["message_id"], 101)
            self.assertEqual(item["citations"][1]["source_url"], request_payload["realm_url"] + "/transcripts/m1-ict.txt")
            self.assertEqual(_InboxSecretaryApiHandler.transcript_requests, 1)

            feedback_response = client.post(
                "/api/v1/desktop/inbox-secretary/feedback",
                json={
                    **request_payload,
                    "item_key": item["external_key"],
                    "conversation_key": item["conversation_key"],
                    "action": "done",
                    "note": "Handled after the review.",
                },
            )
            self.assertEqual(feedback_response.status_code, 200)
            feedback_payload = feedback_response.json()
            self.assertEqual(feedback_payload["snapshot"]["priorities"], [])
            self.assertEqual(len(feedback_payload["feedback"]), 1)
            self.assertEqual(feedback_payload["feedback"][0]["action"], "done")
            self.assertEqual(feedback_payload["feedback"][0]["conversation_key"], item["conversation_key"])
            self.assertTrue(feedback_payload["feedback"][0]["evidence_key"])
            self.assertEqual(feedback_payload["turns"][-2]["role"], "user")
            self.assertEqual(feedback_payload["turns"][-1]["role"], "assistant")

            persisted_session = client.post(
                "/api/v1/desktop/inbox-secretary/session",
                json=request_payload,
            )
            self.assertEqual(persisted_session.status_code, 200)
            persisted_payload = persisted_session.json()
            self.assertEqual(len(persisted_payload["feedback"]), 1)
            self.assertEqual(persisted_payload["last_run"]["assistant_reply"], chat_payload["last_run"]["assistant_reply"])

    def test_service_forces_publish_snapshot_after_text_only_turn(self) -> None:
        config = load_config(
            {
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "platform-admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_DATABASE_PATH": str(Path(self.temp_dir) / "forced-publish.sqlite3"),
                "FOUNDRY_ANTHROPIC_API_KEY": "anthropic-test-key",
                "FOUNDRY_ANTHROPIC_API_BASE_URL": "http://anthropic.invalid",
                "FOUNDRY_ANTHROPIC_MODEL": "claude-test",
            }
        )

        class _ForcedPublishService(InboxSecretaryService):
            def __init__(self, service_config):
                super().__init__(service_config)
                self.calls = 0

            def _call_anthropic(self, *, messages, tools, tool_choice=None):
                self.calls += 1
                if self.calls == 1:
                    assert tool_choice == {"type": "any"}
                    return {
                        "id": "msg_1",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "toolu_messages",
                                "name": "get_conversation_messages",
                                "input": {
                                    "conversation_key": "dm:1,2",
                                    "max_messages": 8,
                                },
                            }
                        ],
                        "model": "claude-test",
                        "stop_reason": "tool_use",
                    }
                if self.calls == 2:
                    assert tool_choice == {"type": "any"}
                    return {
                        "id": "msg_2",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": "I found one likely priority.",
                            }
                        ],
                        "model": "claude-test",
                        "stop_reason": "end_turn",
                    }
                if self.calls == 3:
                    assert tool_choice == {"type": "tool", "name": "publish_priority_snapshot"}
                    return {
                        "id": "msg_3",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "toolu_publish",
                                "name": "publish_priority_snapshot",
                                "input": {
                                    "priorities": [
                                        {
                                            "external_key": "dm:1,2",
                                            "conversation_key": "dm:1,2",
                                            "title": "Reply to Meridian Owner",
                                            "summary": "Owner asked for a status update.",
                                            "why": "There is a direct request waiting on you.",
                                            "status": "needs_action",
                                            "confidence": "high",
                                            "source_packet_ids": ["packet_1"],
                                            "citation_ids": ["citation_1"],
                                        }
                                    ],
                                    "unclear": [],
                                },
                            }
                        ],
                        "model": "claude-test",
                        "stop_reason": "tool_use",
                    }
                assert tool_choice is None
                return {
                    "id": "msg_4",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": "Updated your priority inbox.",
                        }
                    ],
                    "model": "claude-test",
                    "stop_reason": "end_turn",
                }

            def _execute_tool(
                self,
                *,
                runtime,
                realm_client,
                current_user_id,
                tool_name,
                tool_input,
            ):
                if tool_name == "get_conversation_messages":
                    conversation = {
                        "conversation_key": "dm:1,2",
                        "kind": "dm",
                        "label": "Meridian Owner",
                        "user_ids": [1, 2],
                        "narrow": "dm:1,2",
                    }
                    runtime.remember_conversation(conversation)
                    runtime.remember_packet(
                        {
                            "packet_id": "packet_1",
                            "conversation_key": "dm:1,2",
                            "kind": "dm",
                            "narrow": "dm:1,2",
                            "stream_id": None,
                            "stream_name": "",
                            "topic": "",
                            "user_ids": [1, 2],
                            "label": "Meridian Owner",
                        }
                    )
                    runtime.remember_citation(
                        {
                            "citation_id": "citation_1",
                            "message_id": 101,
                            "sender_name": "Meridian Owner",
                            "excerpt": "Can you send me a status update?",
                            "timestamp": 1741630080,
                            "source_url": "https://zulip.meridian.cv/#narrow/near/101",
                            "title": "Meridian Owner",
                        }
                    )
                    return {
                        "packet_id": "packet_1",
                        "conversation": conversation,
                        "messages": [
                            {
                                "message_id": 101,
                                "sender_name": "Meridian Owner",
                                "sender_email": "owner@meridian.cv",
                                "timestamp": 1741630080,
                                "text": "Can you send me a status update?",
                                "citation_id": "citation_1",
                                "links": [],
                            }
                        ],
                        "citation_ids": ["citation_1"],
                    }
                return super()._execute_tool(
                    runtime=runtime,
                    realm_client=realm_client,
                    current_user_id=current_user_id,
                    tool_name=tool_name,
                    tool_input=tool_input,
                )

        service = _ForcedPublishService(config)
        result = service.run_turn(
            realm_url="https://zulip.meridian.cv",
            user_email="ac@meridian.cv",
            api_key="zulip-test-key",
            current_user_id=1,
            prior_turns=[],
            feedback=[],
            message="Review my work.",
        )

        self.assertEqual(service.calls, 4)
        self.assertEqual(result["reply"], "Updated your priority inbox.")
        self.assertEqual(len(result["snapshot"]["priorities"]), 1)
        self.assertEqual(result["snapshot"]["priorities"][0]["title"], "Reply to Meridian Owner")

    def test_reconcile_snapshot_keeps_waiting_and_reopens_done_only_on_newer_evidence(self) -> None:
        snapshot = {
            "generated_at": "2026-03-10T17:00:00Z",
            "priorities": [
                {
                    "external_key": "temporal-fix",
                    "conversation_key": "dm:1,2",
                    "title": "Fix Temporal workflow",
                    "summary": "Prod is still broken.",
                    "why": "Needs your action.",
                    "status": "needs_action",
                    "confidence": "high",
                    "source_packet_ids": ["packet_1"],
                    "citation_ids": ["citation_1"],
                    "citations": [
                        {
                            "citation_id": "citation_1",
                            "message_id": 101,
                            "sender_name": "Auggie Clement",
                            "excerpt": "The workflow is still broken.",
                            "timestamp": 1773161400,
                            "source_url": "https://zulip.meridian.cv/#narrow/near/101",
                            "title": "Auggie Clement",
                        }
                    ],
                }
            ],
            "unclear": [],
        }

        waiting_snapshot = reconcile_snapshot_with_feedback(
            snapshot,
            [
                {
                    "feedback_id": "feedback_waiting",
                    "item_key": "temporal-fix",
                    "conversation_key": "dm:1,2",
                    "action": "waiting",
                    "note": "",
                    "created_at": "2026-03-10T17:10:00Z",
                }
            ],
        )
        self.assertEqual(waiting_snapshot["priorities"][0]["status"], "waiting")
        self.assertIn("waiting", waiting_snapshot["priorities"][0]["why"].lower())

        closed_snapshot = reconcile_snapshot_with_feedback(
            snapshot,
            [
                {
                    "feedback_id": "feedback_done",
                    "item_key": "temporal-fix",
                    "conversation_key": "dm:1,2",
                    "action": "done",
                    "note": "",
                    "created_at": "2026-03-10T17:10:00Z",
                }
            ],
        )
        self.assertEqual(closed_snapshot["priorities"], [])

        reopened_snapshot = reconcile_snapshot_with_feedback(
            {
                **snapshot,
                "priorities": [
                    {
                        **snapshot["priorities"][0],
                        "citations": [
                            {
                                **snapshot["priorities"][0]["citations"][0],
                                "timestamp": 1773166200,
                            }
                        ],
                    }
                ],
            },
            [
                {
                    "feedback_id": "feedback_done",
                    "item_key": "temporal-fix",
                    "conversation_key": "dm:1,2",
                    "action": "done",
                    "note": "",
                    "created_at": "2026-03-10T17:10:00Z",
                }
            ],
        )
        self.assertEqual(len(reopened_snapshot["priorities"]), 1)
        self.assertIn("resurfaced", reopened_snapshot["priorities"][0]["why"].lower())

    def test_reconcile_snapshot_feedback_targets_one_item_within_same_conversation(self) -> None:
        snapshot = {
            "generated_at": "2026-03-10T17:00:00Z",
            "priorities": [
                {
                    "external_key": "dm:11#task-a",
                    "evidence_key": "dm:11@citation-1707",
                    "conversation_key": "dm:11",
                    "title": "Reply to Auggie",
                    "summary": "He asked if freestyle is pushed.",
                    "why": "He is blocked on your answer.",
                    "status": "needs_action",
                    "confidence": "high",
                    "source_packet_ids": ["packet_1"],
                    "citation_ids": ["citation_1"],
                    "citations": [
                        {
                            "citation_id": "citation_1",
                            "message_id": 1707,
                            "sender_name": "Auggie Clement",
                            "excerpt": "did you push freestyle to git",
                            "timestamp": 1773174217,
                            "source_url": "https://zulip.meridian.cv/#narrow/near/1707",
                            "title": "Auggie Clement",
                        }
                    ],
                },
                {
                    "external_key": "dm:11#task-b",
                    "evidence_key": "dm:11@citation-1608",
                    "conversation_key": "dm:11",
                    "title": "Review shopify-fixes candidate",
                    "summary": "Auggie left a candidate fix.",
                    "why": "Need a decision before the next run.",
                    "status": "needs_action",
                    "confidence": "medium",
                    "source_packet_ids": ["packet_1"],
                    "citation_ids": ["citation_2"],
                    "citations": [
                        {
                            "citation_id": "citation_2",
                            "message_id": 1608,
                            "sender_name": "Auggie Clement",
                            "excerpt": "I have a potential fix in shopify-fixes repo",
                            "timestamp": 1773032617,
                            "source_url": "https://zulip.meridian.cv/#narrow/near/1608",
                            "title": "Auggie Clement",
                        }
                    ],
                },
            ],
            "unclear": [],
        }

        reconciled = reconcile_snapshot_with_feedback(
            snapshot,
            [
                {
                    "feedback_id": "feedback_done",
                    "item_key": "dm:11#task-a",
                    "conversation_key": "dm:11",
                    "action": "done",
                    "note": "",
                    "created_at": "2026-03-11T17:10:00Z",
                }
            ],
        )

        self.assertEqual(len(reconciled["priorities"]), 1)
        self.assertEqual(reconciled["priorities"][0]["external_key"], "dm:11#task-b")

    def test_reconcile_snapshot_uses_evidence_key_to_keep_reworded_item_closed(self) -> None:
        snapshot = {
            "generated_at": "2026-03-11T01:00:00Z",
            "priorities": [
                {
                    "external_key": "dm:11#new-key",
                    "evidence_key": "dm:11@same-evidence",
                    "conversation_key": "dm:11",
                    "title": "Reply to Auggie: confirm freestyle is pushed to git",
                    "summary": "Direct question still looks open.",
                    "why": "Auggie asked directly.",
                    "status": "needs_action",
                    "confidence": "medium",
                    "source_packet_ids": ["packet_1"],
                    "citation_ids": ["citation_1"],
                    "citations": [
                        {
                            "citation_id": "citation_1",
                            "message_id": 1707,
                            "sender_name": "Auggie Clement",
                            "excerpt": "did you push freestyle to git - is it up to date",
                            "timestamp": 1773174217,
                            "source_url": "https://zulip.meridian.cv/#narrow/near/1707",
                            "title": "Auggie Clement",
                        }
                    ],
                }
            ],
            "unclear": [],
        }

        reconciled = reconcile_snapshot_with_feedback(
            snapshot,
            [
                {
                    "feedback_id": "feedback_done",
                    "item_key": "dm:11#old-key",
                    "conversation_key": "dm:11",
                    "evidence_key": "dm:11@same-evidence",
                    "action": "done",
                    "note": "",
                    "created_at": "2026-03-11T17:10:00Z",
                }
            ],
        )

        self.assertEqual(reconciled["priorities"], [])


if __name__ == "__main__":
    unittest.main()
