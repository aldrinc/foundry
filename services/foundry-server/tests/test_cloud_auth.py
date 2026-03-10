from __future__ import annotations

import re
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.app import create_app  # noqa: E402
from foundry_server.config import load_config  # noqa: E402


class CloudAuthTests(unittest.TestCase):
    def _create_client(self) -> TestClient:
        database_handle = tempfile.NamedTemporaryFile("wb", delete=False)
        database_handle.close()
        self.addCleanup(lambda: Path(database_handle.name).unlink(missing_ok=True))

        config = load_config(
            {
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_DATABASE_PATH": database_handle.name,
                "FOUNDRY_PUBLIC_BASE_URL": "https://server-dev.foundry.test",
                "FOUNDRY_API_BASE_URL": "https://server-dev.foundry.test",
            }
        )
        return TestClient(create_app(config))

    def _login_admin(self, client: TestClient) -> None:
        response = client.post(
            "/login",
            data={
                "email": "admin@foundry.test",
                "password": "bootstrap-password",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)

    def test_signup_creates_user_session_and_org(self) -> None:
        with self._create_client() as client:
            response = client.post(
                "/signup",
                data={
                    "display_name": "Alda",
                    "email": "alda@example.com",
                    "password": "topsecret",
                    "organization_name": "Acme",
                    "organization_slug": "acme",
                },
                follow_redirects=False,
            )
            self.assertEqual(response.status_code, 303)
            self.assertIn("foundry_session", response.cookies)

            me_response = client.get("/api/v1/cloud/me")
            self.assertEqual(me_response.status_code, 200)
            payload = me_response.json()
            self.assertEqual(payload["user"]["email"], "alda@example.com")
            self.assertEqual(payload["organizations"][0]["slug"], "acme")

    def test_bootstrap_admin_can_view_all_organizations(self) -> None:
        with self._create_client() as client:
            create_response = client.post(
                "/signup",
                data={
                    "display_name": "Owner",
                    "email": "owner@example.com",
                    "password": "owner-password",
                    "organization_name": "Foundry",
                    "organization_slug": "foundry",
                },
                follow_redirects=False,
            )
            self.assertEqual(create_response.status_code, 303)

            self._login_admin(client)

            dashboard_response = client.get("/cloud")
            self.assertEqual(dashboard_response.status_code, 200)
            self.assertIn("Foundry", dashboard_response.text)

    def test_authenticated_org_api_requires_real_owner(self) -> None:
        with self._create_client() as client:
            self._login_admin(client)
            create_response = client.post(
                "/api/v1/organizations",
                json={
                    "slug": "foundry",
                    "display_name": "Foundry",
                    "owner_user_id": "missing-user",
                },
            )
            self.assertEqual(create_response.status_code, 404)

    def test_invitation_acceptance_adds_member(self) -> None:
        with self._create_client() as owner_client:
            signup_response = owner_client.post(
                "/signup",
                data={
                    "display_name": "Owner",
                    "email": "owner@example.com",
                    "password": "owner-password",
                    "organization_name": "Acme",
                    "organization_slug": "acme",
                },
                follow_redirects=False,
            )
            self.assertEqual(signup_response.status_code, 303)
            organization_id = signup_response.headers["location"].rsplit("/", 1)[-1]

            invitation_response = owner_client.post(
                f"/cloud/organizations/{organization_id}/invitations",
                data={"email": "teammate@example.com", "role": "member"},
            )
            self.assertEqual(invitation_response.status_code, 200)
            match = re.search(r"/cloud/invitations/([^\"<]+)", invitation_response.text)
            self.assertIsNotNone(match)
            token = match.group(1)

            accept_response = owner_client.post(
                f"/cloud/invitations/{token}/accept",
                data={
                    "display_name": "Teammate",
                    "password": "teammate-password",
                },
                follow_redirects=False,
            )
            self.assertEqual(accept_response.status_code, 303)

            org_response = owner_client.get(f"/api/v1/cloud/organizations/{organization_id}")
            self.assertEqual(org_response.status_code, 200)
            members = org_response.json()["members"]
            self.assertEqual(len(members), 2)
            self.assertEqual(members[1]["email"], "teammate@example.com")


if __name__ == "__main__":
    unittest.main()
