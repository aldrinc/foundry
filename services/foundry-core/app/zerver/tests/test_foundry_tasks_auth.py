from __future__ import annotations

from unittest.mock import patch

from zerver.lib.test_classes import ZulipTestCase


class FoundryTasksAuthCompatibilityTest(ZulipTestCase):
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

    @patch("zerver.views.foundry_tasks._orchestrator_request", return_value={"providers": []})
    def test_api_v1_meridian_provider_auth_alias_exists(self, mock_request: object) -> None:
        user = self.example_user("hamlet")
        result = self.client_get(
            "/api/v1/meridian/providers/auth",
            HTTP_AUTHORIZATION=self.encode_user(user),
        )

        payload = self.assert_json_success(result)
        self.assertEqual(payload["providers"], [])
