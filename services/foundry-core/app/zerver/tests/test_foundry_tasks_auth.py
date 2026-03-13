from __future__ import annotations

import base64
import os
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test.client import RequestFactory

from zerver.lib.test_classes import ZulipTestCase
from zerver.views.foundry_tasks import (
    _orchestrator_token,
    _orchestrator_url,
    _provider_oauth_redirect_uri,
    _rewrite_supervisor_upload_links,
    _supervisor_uploaded_files,
)


def make_inbox_assistant_session() -> dict[str, object]:
    return {
        "session_id": "session-1",
        "scope_key": "https://chat.example.com::hamlet@example.com",
        "realm_url": "https://chat.example.com",
        "user_email": "hamlet@example.com",
        "turns": [],
        "snapshot": None,
        "feedback": [],
        "configured": True,
        "last_run": None,
    }


class FoundryTasksAuthCompatibilityTest(ZulipTestCase):
    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "",
            "MERIDIAN_CODER_ORCHESTRATOR_URL": "",
            "FOUNDRY_URL": "",
            "FOUNDRY_SERVER_URL": "",
        },
        clear=False,
    )
    def test_json_foundry_provider_auth_graceful_without_orchestrator(self) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/providers/auth",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertFalse(payload["configured"])
        self.assertEqual(payload["providers"], [])

    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "",
            "MERIDIAN_CODER_ORCHESTRATOR_URL": "",
            "FOUNDRY_URL": "",
            "FOUNDRY_SERVER_URL": "",
        },
        clear=False,
    )
    def test_json_foundry_topic_sidebar_graceful_without_orchestrator(self) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/sidebar",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertFalse(payload["configured"])
        self.assertEqual(payload["sidebar"]["task_count"], 0)
        self.assertEqual(payload["sidebar"]["tasks"], [])

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={
            "topic_scope_id": "stream_id:1:topic:devlive",
            "task_count": 1,
            "counts": {"running": 1},
            "tasks": [
                {
                    "task_id": "task_123",
                    "title": "Recon task",
                    "assigned_role": "writer",
                    "status": "working",
                    "artifacts": [],
                    "blockers": [],
                }
            ],
        },
    )
    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "http://orchestrator.internal:8090",
        },
        clear=False,
    )
    def test_json_foundry_topic_sidebar_preserves_top_level_payload(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/sidebar",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["task_count"], 1)
        self.assertEqual(len(payload["tasks"]), 1)
        self.assertEqual(payload["tasks"][0]["task_id"], "task_123")
        self.assertEqual(payload["sidebar"]["task_count"], 1)
        self.assertEqual(payload["sidebar"]["tasks"][0]["task_id"], "task_123")
        self.assertEqual(payload["raw"]["task_count"], 1)
        self.assertEqual(payload["raw"]["tasks"][0]["task_id"], "task_123")
        self.assertEqual(mock_request.call_count, 1)

    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "",
            "MERIDIAN_CODER_ORCHESTRATOR_URL": "",
            "FOUNDRY_URL": "",
            "FOUNDRY_SERVER_URL": "",
        },
        clear=False,
    )
    def test_json_foundry_topic_supervisor_runtime_graceful_without_orchestrator(self) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/runtime",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertFalse(payload["configured"])
        self.assertEqual(payload["runtime"]["topic_scope_id"], "stream_id:1:topic:devlive")
        self.assertEqual(payload["runtime"]["upload_count"], 0)
        self.assertEqual(payload["runtime"]["checkpoint_count"], 0)

    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={"providers": []})
    def test_json_foundry_provider_auth_accepts_api_auth(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/providers/auth",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["providers"], [])

    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={"providers": []})
    def test_json_meridian_provider_auth_accepts_api_auth(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/meridian/providers/auth",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["providers"], [])

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={"authorize_url": "https://auth.example.com"},
    )
    def test_json_foundry_provider_oauth_start_defaults_redirect_uri(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_post(
            "/json/foundry/providers/oauth/start",
            {"provider": "codex"},
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        self.assert_json_success(result)
        self.assertEqual(
            mock_request.call_args.kwargs["payload"]["redirect_uri"],
            f"{user.realm.url}/json/foundry/providers/oauth/callback",
        )

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={"authorize_url": "https://auth.example.com"},
    )
    def test_json_foundry_provider_oauth_start_preserves_explicit_redirect_uri(
        self,
        mock_request: object,
    ) -> None:
        user = self.example_user("hamlet")
        result = self.client_post(
            "/json/foundry/providers/oauth/start",
            {
                "provider": "codex",
                "redirect_uri": "https://foundry.example.com/json/foundry/providers/oauth/callback",
            },
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        self.assert_json_success(result)
        self.assertEqual(
            mock_request.call_args.kwargs["payload"]["redirect_uri"],
            "https://foundry.example.com/json/foundry/providers/oauth/callback",
        )

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={"credential": {"auth_mode": "oauth", "status": "active"}},
    )
    def test_json_foundry_provider_connect_forwards_full_oauth_token_set(
        self,
        mock_request: object,
    ) -> None:
        user = self.example_user("hamlet")
        result = self.client_post(
            "/json/foundry/providers/connect",
            {
                "provider": "codex",
                "auth_mode": "oauth",
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "id_token": "id-token",
                "account_id": "acct_123",
            },
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        self.assert_json_success(result)
        forwarded = mock_request.call_args.kwargs["payload"]
        self.assertEqual(forwarded["access_token"], "access-token")
        self.assertEqual(forwarded["refresh_token"], "refresh-token")
        self.assertEqual(forwarded["id_token"], "id-token")
        self.assertEqual(forwarded["account_id"], "acct_123")

    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "",
            "MERIDIAN_CODER_ORCHESTRATOR_URL": "http://legacy-orchestrator.internal:8090/",
            "FOUNDRY_URL": "",
            "FOUNDRY_SERVER_URL": "",
        },
        clear=False,
    )
    def test_orchestrator_url_falls_back_to_legacy_meridian_env(self) -> None:
        self.assertEqual(_orchestrator_url(), "http://legacy-orchestrator.internal:8090")

    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "",
            "MERIDIAN_CODER_ORCHESTRATOR_URL": "",
            "FOUNDRY_URL": "",
            "FOUNDRY_SERVER_URL": "https://server-dev.foundry.test",
        },
        clear=False,
    )
    def test_orchestrator_url_falls_back_to_foundry_server_mount(self) -> None:
        self.assertEqual(_orchestrator_url(), "https://server-dev.foundry.test/api/v1/meridian")

    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_TOKEN": "",
            "FOUNDRY_TOKEN": "legacy-shared-token",
        },
        clear=False,
    )
    def test_orchestrator_token_falls_back_to_legacy_foundry_token(self) -> None:
        self.assertEqual(_orchestrator_token(), "legacy-shared-token")

    def test_provider_oauth_redirect_uri_prefers_https_for_public_hosts(self) -> None:
        request = RequestFactory().post(
            "/json/foundry/providers/oauth/start",
            HTTP_HOST="foundry-labs.zulip-dev-live.5.161.60.86.sslip.io",
        )

        self.assertEqual(
            _provider_oauth_redirect_uri(request, None),
            "https://foundry-labs.zulip-dev-live.5.161.60.86.sslip.io/json/foundry/providers/oauth/callback",
        )

    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={"providers": []})
    def test_api_v1_meridian_provider_auth_alias_exists(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/api/v1/meridian/providers/auth",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["providers"], [])

    @patch(
        "zerver.views.foundry_tasks._foundry_server_request",
        return_value=make_inbox_assistant_session(),
    )
    def test_json_foundry_inbox_assistant_session_accepts_api_auth(
        self, mock_request: object
    ) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/inbox/assistant/session",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["session_id"], "session-1")
        _, forwarded_path = mock_request.call_args.args[:2]
        self.assertEqual(forwarded_path, "/api/v1/desktop/inbox-secretary/session")
        forwarded_payload = mock_request.call_args.kwargs["payload"]
        self.assertEqual(forwarded_payload["org_key"], user.realm.url.rstrip("/"))
        self.assertEqual(forwarded_payload["realm_url"], user.realm.url.rstrip("/"))
        self.assertEqual(
            forwarded_payload["user_email"],
            (user.delivery_email or user.email).strip().lower(),
        )

    @patch(
        "zerver.views.foundry_tasks._foundry_server_request",
        return_value=make_inbox_assistant_session(),
    )
    def test_json_foundry_inbox_assistant_chat_forwards_authenticated_user_context(
        self, mock_request: object
    ) -> None:
        user = self.example_user("hamlet")
        result = self.client_post(
            "/json/foundry/inbox/assistant/chat",
            {"api_key": "test-api-key", "message": "What needs my attention?", "current_user_id": user.id},
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["session_id"], "session-1")
        _, forwarded_path = mock_request.call_args.args[:2]
        self.assertEqual(forwarded_path, "/api/v1/desktop/inbox-secretary/chat")
        forwarded_payload = mock_request.call_args.kwargs["payload"]
        self.assertEqual(forwarded_payload["api_key"], "test-api-key")
        self.assertEqual(forwarded_payload["message"], "What needs my attention?")
        self.assertEqual(forwarded_payload["current_user_id"], user.id)
        self.assertEqual(
            forwarded_payload["user_email"],
            (user.delivery_email or user.email).strip().lower(),
        )

    @patch(
        "zerver.views.foundry_tasks._foundry_server_request",
        return_value=make_inbox_assistant_session(),
    )
    def test_json_foundry_inbox_assistant_feedback_forwards_note_and_action(
        self, mock_request: object
    ) -> None:
        user = self.example_user("hamlet")
        result = self.client_post(
            "/json/foundry/inbox/assistant/feedback",
            {
                "item_key": "stream:1/topic:infra",
                "conversation_key": "stream:1/topic:infra",
                "action": "Waiting",
                "note": "Still blocked on review.",
            },
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["session_id"], "session-1")
        _, forwarded_path = mock_request.call_args.args[:2]
        self.assertEqual(forwarded_path, "/api/v1/desktop/inbox-secretary/feedback")
        forwarded_payload = mock_request.call_args.kwargs["payload"]
        self.assertEqual(forwarded_payload["item_key"], "stream:1/topic:infra")
        self.assertEqual(forwarded_payload["conversation_key"], "stream:1/topic:infra")
        self.assertEqual(forwarded_payload["action"], "waiting")
        self.assertEqual(forwarded_payload["note"], "Still blocked on review.")

    @patch(
        "zerver.views.foundry_tasks.upload_message_attachment_from_request",
        return_value=("/user_uploads/2/ab/plan.md", "plan.md"),
    )
    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={})
    def test_json_foundry_supervisor_message_appends_uploaded_file_links(
        self, mock_request: object, mock_upload: object
    ) -> None:
        user = self.example_user("hamlet")
        file = SimpleUploadedFile("plan.md", b"# Review plan\n", content_type="text/markdown")
        result = self.client_post(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/message",
            {"message": "Please review this plan", "files": file},
            content_type="multipart/form-data",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(len(payload["uploaded_files"]), 1)
        uploaded_url = payload["uploaded_files"][0]["url"]
        self.assertEqual(payload["uploaded_files"][0]["filename"], "plan.md")
        self.assertTrue(uploaded_url.startswith(f"{user.realm.url}/user_uploads/temporary/"))
        self.assertTrue(uploaded_url.endswith("/plan.md"))
        self.assertEqual(mock_upload.call_count, 1)
        _, request_path = mock_request.call_args.args[:2]
        self.assertEqual(request_path, "/api/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/message")
        forwarded_payload = mock_request.call_args.kwargs["payload"]
        self.assertEqual(
            forwarded_payload["message"],
            f"Please review this plan\n\nAttached files:\n- [plan.md]({uploaded_url})",
        )
        self.assertEqual(len(forwarded_payload["uploaded_files"]), 1)
        forwarded_file = forwarded_payload["uploaded_files"][0]
        self.assertEqual(forwarded_file["filename"], "plan.md")
        self.assertEqual(forwarded_file["size"], len(b"# Review plan\n"))
        self.assertEqual(forwarded_file["media_type"], "text/markdown")
        self.assertEqual(
            base64.b64decode(forwarded_file["content_base64"]),
            b"# Review plan\n",
        )

    @patch(
        "zerver.views.foundry_tasks.upload_message_attachment_from_request",
        return_value=("/user_uploads/2/cd/trace.txt", "trace.txt"),
    )
    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={})
    def test_json_foundry_supervisor_message_accepts_attachment_only(
        self, mock_request: object, mock_upload: object
    ) -> None:
        user = self.example_user("hamlet")
        file = SimpleUploadedFile("trace.txt", b"swing3_rejected\n")
        result = self.client_post(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/message",
            {"message": "", "files": file},
            content_type="multipart/form-data",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(len(payload["uploaded_files"]), 1)
        uploaded_url = payload["uploaded_files"][0]["url"]
        self.assertEqual(payload["uploaded_files"][0]["filename"], "trace.txt")
        self.assertTrue(uploaded_url.startswith(f"{user.realm.url}/user_uploads/temporary/"))
        self.assertTrue(uploaded_url.endswith("/trace.txt"))
        self.assertEqual(mock_upload.call_count, 1)
        forwarded_payload = mock_request.call_args.kwargs["payload"]
        self.assertEqual(
            forwarded_payload["message"],
            f"Attached files:\n- [trace.txt]({uploaded_url})",
        )
        self.assertEqual(len(forwarded_payload["uploaded_files"]), 1)
        forwarded_file = forwarded_payload["uploaded_files"][0]
        self.assertEqual(forwarded_file["filename"], "trace.txt")
        self.assertEqual(forwarded_file["size"], len(b"swing3_rejected\n"))
        self.assertEqual(forwarded_file["media_type"], "text/plain")
        self.assertEqual(
            base64.b64decode(forwarded_file["content_base64"]),
            b"swing3_rejected\n",
        )

    @patch(
        "zerver.views.foundry_tasks.upload_message_attachment_from_request",
        side_effect=[
            ("/user_uploads/2/aa/first.txt", "first.txt"),
            ("/user_uploads/2/bb/second.txt", "second.txt"),
        ],
    )
    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={})
    def test_json_foundry_supervisor_message_handles_multiple_files_under_one_field(
        self, mock_request: object, mock_upload: object
    ) -> None:
        user = self.example_user("hamlet")
        first = SimpleUploadedFile("first.txt", b"alpha\n")
        second = SimpleUploadedFile("second.txt", b"beta\n")
        request = RequestFactory().post(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/message",
            {"message": "Check both traces", "files": [first, second]},
        )
        uploaded_files = _supervisor_uploaded_files(request, user)
        self.assertEqual(len(uploaded_files), 2)
        self.assertEqual(uploaded_files[0]["filename"], "first.txt")
        self.assertEqual(uploaded_files[1]["filename"], "second.txt")
        self.assertTrue(uploaded_files[0]["url"].startswith(f"{user.realm.url}/user_uploads/temporary/"))
        self.assertTrue(uploaded_files[0]["url"].endswith("/first.txt"))
        self.assertTrue(uploaded_files[1]["url"].startswith(f"{user.realm.url}/user_uploads/temporary/"))
        self.assertTrue(uploaded_files[1]["url"].endswith("/second.txt"))
        self.assertEqual(base64.b64decode(uploaded_files[0]["content_base64"]), b"alpha\n")
        self.assertEqual(base64.b64decode(uploaded_files[1]["content_base64"]), b"beta\n")
        self.assertEqual(mock_upload.call_count, 2)
        mock_request.assert_not_called()

    def test_rewrite_supervisor_upload_links_replaces_same_realm_user_upload_urls(self) -> None:
        user = self.example_user("hamlet")
        message = (
            "Please inspect "
            f"[trace]({user.realm.url}/user_uploads/2/aa/trace.txt) "
            "and /user_uploads/2/bb/screenshot.png "
            "but keep https://example.com/user_uploads/2/cc/ignore.txt unchanged."
        )

        rewritten = _rewrite_supervisor_upload_links(message, user)

        self.assertIn("[trace](", rewritten)
        self.assertIn(f"{user.realm.url}/user_uploads/temporary/", rewritten)
        self.assertIn("/trace.txt)", rewritten)
        self.assertIn("/screenshot.png", rewritten)
        self.assertIn("https://example.com/user_uploads/2/cc/ignore.txt", rewritten)
        self.assertNotIn(f"{user.realm.url}/user_uploads/2/aa/trace.txt", rewritten)
        self.assertNotIn("/user_uploads/2/bb/screenshot.png", rewritten)

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={
            "session": {"session_id": "sup_123", "topic_scope_id": "stream_id:1:topic:devlive", "status": "active"},
            "sessions": [
                {"session_id": "sup_123", "topic_scope_id": "stream_id:1:topic:devlive", "status": "active"},
                {"session_id": "sup_456", "topic_scope_id": "stream_id:1:topic:devlive", "status": "idle"},
            ],
            "events": [],
            "next_after_id": 3,
            "task_summary": {
                "active_plan_revision_id": "plan_1",
                "filtered_plan_revision_id": "plan_1",
                "tasks": [{"task_id": "task_1", "title": "Validate flow", "assigned_role": "read_only", "status": "running"}],
            },
        },
    )
    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "http://orchestrator.internal:8090",
        },
        clear=False,
    )
    def test_json_foundry_supervisor_session_exposes_task_summary_top_level(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/session",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["task_summary"]["active_plan_revision_id"], "plan_1")
        self.assertEqual(payload["task_summary"]["tasks"][0]["task_id"], "task_1")
        self.assertEqual(len(payload["sessions"]), 2)

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={
            "session": {"session_id": "sup_456", "topic_scope_id": "stream_id:1:topic:devlive", "status": "active"},
            "sessions": [
                {"session_id": "sup_123", "topic_scope_id": "stream_id:1:topic:devlive", "status": "idle"},
                {"session_id": "sup_456", "topic_scope_id": "stream_id:1:topic:devlive", "status": "active"},
            ],
            "events": [],
            "next_after_id": 7,
            "task_summary": {
                "active_plan_revision_id": None,
                "filtered_plan_revision_id": None,
                "tasks": [],
            },
        },
    )
    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "http://orchestrator.internal:8090",
        },
        clear=False,
    )
    def test_json_foundry_supervisor_session_forwards_session_id(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/session",
            {"session_id": "sup_456"},
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["session"]["session_id"], "sup_456")
        self.assertEqual(payload["sessions"][1]["session_id"], "sup_456")
        self.assertEqual(
            mock_request.call_args.kwargs["params"],
            {"after_id": 0, "limit": 200, "session_id": "sup_456"},
        )

    @patch(
        "zerver.views.foundry_tasks._orchestrator_request",
        return_value={
            "runtime": {
                "topic_scope_id": "stream_id:1:topic:devlive",
                "workspace_path": "/tmp/foundry/runtime/stream_id_1_topic_devlive",
                "uploads_path": "/tmp/foundry/runtime/stream_id_1_topic_devlive/uploads",
                "outputs_path": "/tmp/foundry/runtime/stream_id_1_topic_devlive/outputs",
                "checkpoints_path": "/tmp/foundry/runtime/stream_id_1_topic_devlive/checkpoints",
                "memory_summary": "Recent work summary",
                "memory_highlights": ["spec drafted", "two read_only tasks running"],
                "uploads": [],
                "new_uploads": [],
                "upload_count": 0,
                "checkpoint_count": 2,
                "last_request_checkpoint": "/tmp/foundry/runtime/request.json",
                "last_response_checkpoint": "/tmp/foundry/runtime/response.json",
            }
        },
    )
    @patch.dict(
        os.environ,
        {
            "FOUNDRY_CODER_ORCHESTRATOR_URL": "http://orchestrator.internal:8090",
        },
        clear=False,
    )
    def test_json_foundry_topic_supervisor_runtime_proxies_runtime_payload(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/runtime",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(
            mock_request.call_args.args[:2],
            ("GET", "/api/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/runtime"),
        )
        self.assertEqual(payload["runtime"]["topic_scope_id"], "stream_id:1:topic:devlive")
        self.assertEqual(payload["runtime"]["checkpoint_count"], 2)
        self.assertEqual(payload["runtime"]["memory_summary"], "Recent work summary")

    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={})
    def test_json_foundry_supervisor_message_forwards_session_selection(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_post(
            "/json/foundry/topics/stream_id%3A1%3Atopic%3Adevlive/supervisor/message",
            {
                "message": "Start a fresh review session",
                "session_create_mode": "manual",
                "session_title": "Review thread",
            },
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        self.assert_json_success(result)
        forwarded_payload = mock_request.call_args.kwargs["payload"]
        self.assertEqual(forwarded_payload["session_create_mode"], "manual")
        self.assertEqual(forwarded_payload["session_title"], "Review thread")
        self.assertIsNone(forwarded_payload["session_id"])
