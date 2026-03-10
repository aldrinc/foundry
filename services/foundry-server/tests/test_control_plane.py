from __future__ import annotations

import json
import re
import socketserver
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.app import create_app  # noqa: E402
from foundry_server.config import load_config  # noqa: E402


class _ControlPlaneGitHubApiHandler(BaseHTTPRequestHandler):
    def _write_json(self, payload: dict[str, object] | list[dict[str, object]]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/app":
            self._write_json(
                {
                    "id": 3048941,
                    "slug": "foundry-chat",
                    "name": "Foundry Chat",
                    "html_url": "https://github.com/apps/foundry-chat",
                }
            )
            return

        if self.path == "/app/installations":
            self._write_json(
                [
                    {
                        "id": 115185467,
                        "repository_selection": "selected",
                        "account": {"login": "aldrinc", "type": "User"},
                    }
                ]
            )
            return

        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class _ControlPlaneCoreApiHandler(BaseHTTPRequestHandler):
    tenant_members: dict[str, list[dict[str, object]]] = {}

    def _write_json(self, payload: dict[str, object] | list[dict[str, object]]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")

        if self.path == "/api/v1/foundry/cloud/tenants/provision":
            realm_subdomain = str(payload["realm_subdomain"])
            owner_email = str(payload["owner_email"])
            owner_name = str(payload["owner_full_name"])
            members = self.tenant_members.setdefault(realm_subdomain, [])
            if not any(item["email"] == owner_email for item in members):
                members.append({"email": owner_email, "full_name": owner_name, "role": payload["role"]})
            self._write_json(
                {
                    "result": "success",
                    "realm": {
                        "id": 1,
                        "string_id": realm_subdomain,
                        "name": payload["realm_name"],
                        "url": f"https://{realm_subdomain}.core-dev.foundry.test",
                    },
                    "owner": {
                        "user_id": 10,
                        "email": owner_email,
                        "full_name": owner_name,
                        "role": payload["role"],
                    },
                    "realm_created": True,
                    "owner_created": True,
                }
            )
            return

        if self.path.startswith("/api/v1/foundry/cloud/tenants/") and self.path.endswith("/members/sync"):
            realm_subdomain = self.path.split("/")[6]
            email = str(payload["email"])
            members = self.tenant_members.setdefault(realm_subdomain, [])
            if not any(item["email"] == email for item in members):
                members.append(
                    {"email": email, "full_name": payload["full_name"], "role": payload["role"]}
                )
            self._write_json(
                {
                    "result": "success",
                    "member": {
                        "user_id": len(members),
                        "email": email,
                        "full_name": payload["full_name"],
                        "role": payload["role"],
                    },
                    "created": True,
                    "realm": {
                        "id": 1,
                        "string_id": realm_subdomain,
                        "url": f"https://{realm_subdomain}.core-dev.foundry.test",
                    },
                }
            )
            return

        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class _ControlPlaneCoderApiHandler(BaseHTTPRequestHandler):
    organizations: list[dict[str, object]] = [
        {
            "id": "org-default",
            "name": "coder",
            "display_name": "Coder",
            "description": "Builtin default organization.",
            "is_default": True,
        }
    ]
    create_status_code = 403
    create_error_message = "Multiple Organizations is a Premium feature. Contact sales!"

    def _write_json(self, payload: dict[str, object] | list[dict[str, object]]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/v2/buildinfo":
            self._write_json(
                {
                    "version": "v2.31.3+test",
                    "dashboard_url": "https://coder-dev.foundry.test",
                    "external_url": "https://github.com/coder/coder/commit/test",
                    "telemetry": False,
                    "workspace_proxy": False,
                    "agent_api_version": "1.0",
                    "provisioner_api_version": "1.15",
                    "deployment_id": "deployment-test",
                }
            )
            return

        if self.path == "/api/v2/templates":
            self._write_json(
                [
                    {
                        "id": "template-1",
                        "name": "foundry-hetzner-workspace",
                        "display_name": "",
                        "active_version_id": "version-1",
                        "created_by_name": "foundryadmin",
                        "active_user_count": 1,
                        "deprecated": False,
                        "deleted": False,
                    }
                ]
            )
            return

        if self.path == "/api/v2/workspaces?q=":
            self._write_json(
                {
                    "workspaces": [
                        {
                            "id": "workspace-1",
                            "name": "foundry-owned-smoke",
                            "owner_name": "foundryadmin",
                            "organization_name": "coder",
                            "template_name": "foundry-hetzner-workspace",
                            "health": {"healthy": True},
                            "outdated": False,
                            "last_used_at": "2026-03-09T20:57:07.148301Z",
                            "latest_build": {
                                "status": "running",
                                "transition": "start",
                            },
                        }
                    ]
                }
            )
            return

        if self.path == "/api/v2/users/me/organizations":
            self._write_json(self.organizations)
            return

        self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/v2/organizations":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if self.create_status_code == 201:
                created = {
                    "id": f"org-{payload.get('name', 'created')}",
                    "name": str(payload.get("name", "")),
                    "display_name": str(payload.get("display_name", "")),
                    "description": str(payload.get("description", "")),
                    "is_default": False,
                }
                self.organizations.append(created)
                encoded = json.dumps(created).encode("utf-8")
                self.send_response(201)
            else:
                encoded = json.dumps({"message": self.create_error_message}).encode("utf-8")
                self.send_response(self.create_status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
            return

        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class _ThreadingControlPlaneGitHubApiServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class _ThreadingControlPlaneCoreApiServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class _ThreadingControlPlaneCoderApiServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class ControlPlaneTests(unittest.TestCase):
    def _write_private_key(self) -> Path:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        encoded = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        handle = tempfile.NamedTemporaryFile("wb", delete=False)
        handle.write(encoded)
        handle.flush()
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        return Path(handle.name)

    def _create_client(self) -> TestClient:
        private_key_path = self._write_private_key()
        database_handle = tempfile.NamedTemporaryFile("wb", delete=False)
        database_handle.close()
        self.addCleanup(lambda: Path(database_handle.name).unlink(missing_ok=True))
        _ControlPlaneCoreApiHandler.tenant_members = {}
        _ControlPlaneCoderApiHandler.organizations = [
            {
                "id": "org-default",
                "name": "coder",
                "display_name": "Coder",
                "description": "Builtin default organization.",
                "is_default": True,
            }
        ]
        _ControlPlaneCoderApiHandler.create_status_code = 403
        _ControlPlaneCoderApiHandler.create_error_message = (
            "Multiple Organizations is a Premium feature. Contact sales!"
        )

        server = _ThreadingControlPlaneGitHubApiServer(
            ("127.0.0.1", 0),
            _ControlPlaneGitHubApiHandler,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        self.addCleanup(lambda: thread.join(timeout=5))

        core_server = _ThreadingControlPlaneCoreApiServer(
            ("127.0.0.1", 0),
            _ControlPlaneCoreApiHandler,
        )
        core_thread = threading.Thread(target=core_server.serve_forever, daemon=True)
        core_thread.start()
        self.addCleanup(core_server.shutdown)
        self.addCleanup(core_server.server_close)
        self.addCleanup(lambda: core_thread.join(timeout=5))

        coder_server = _ThreadingControlPlaneCoderApiServer(
            ("127.0.0.1", 0),
            _ControlPlaneCoderApiHandler,
        )
        coder_thread = threading.Thread(target=coder_server.serve_forever, daemon=True)
        coder_thread.start()
        self.addCleanup(coder_server.shutdown)
        self.addCleanup(coder_server.server_close)
        self.addCleanup(lambda: coder_thread.join(timeout=5))

        config = load_config(
            {
                "FOUNDRY_DATABASE_PATH": database_handle.name,
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "platform-admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_CORE_URL": f"http://127.0.0.1:{core_server.server_address[1]}",
                "FOUNDRY_CORE_BOOTSTRAP_SECRET": "core-bootstrap-secret",
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
                "FOUNDRY_GITHUB_API_URL": f"http://127.0.0.1:{server.server_address[1]}",
                "FOUNDRY_CODER_URL": f"http://127.0.0.1:{coder_server.server_address[1]}",
                "FOUNDRY_CODER_API_TOKEN": "coder-test-token",
                "FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET": "bootstrap-secret",
            }
        )
        return TestClient(create_app(config))

    def test_create_organization_initializes_defaults(self) -> None:
        with self._create_client() as client:
            response = client.post(
                "/api/v1/organizations",
                json={
                    "slug": "acme",
                    "display_name": "Acme",
                    "created_by_user_id": "user-1",
                },
            )
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["organization"]["slug"], "acme")
            self.assertEqual(payload["owner_membership"]["roles"][0], "owner")
            self.assertEqual(payload["runtime_settings"]["health"], "unconfigured")
            self.assertEqual(payload["workspace_pool"]["pool_size"], 4)

            list_response = client.get("/api/v1/organizations")
            self.assertEqual(list_response.status_code, 200)
            self.assertEqual(list_response.json()[0]["slug"], "acme")

    def test_signup_provisions_core_binding_and_records_coder_block(self) -> None:
        with self._create_client() as client:
            signup_response = client.post(
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

            detail_response = client.get(f"/api/v1/cloud/organizations/{organization_id}")
            self.assertEqual(detail_response.status_code, 200)
            payload = detail_response.json()
            self.assertEqual(payload["core_binding"]["status"], "ready")
            self.assertEqual(
                payload["core_binding"]["realm_url"],
                "https://acme.core-dev.foundry.test",
            )
            self.assertEqual(payload["coder_binding"]["status"], "blocked")
            self.assertIn("Premium feature", payload["coder_binding"]["detail"])

    def test_signup_provisions_coder_binding_when_coder_allows_org_creation(self) -> None:
        with self._create_client() as client:
            _ControlPlaneCoderApiHandler.create_status_code = 201
            signup_response = client.post(
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

            detail_response = client.get(f"/api/v1/cloud/organizations/{organization_id}")
            self.assertEqual(detail_response.status_code, 200)
            payload = detail_response.json()
            self.assertEqual(payload["coder_binding"]["status"], "ready")
            self.assertEqual(payload["coder_binding"]["name"], "acme")
            self.assertEqual(payload["coder_binding"]["display_name"], "Acme")
            self.assertEqual(payload["coder_binding"]["detail"], "Coder organization provisioned.")

    def test_runtime_settings_round_trip(self) -> None:
        with self._create_client() as client:
            create_response = client.post(
                "/api/v1/organizations",
                json={
                    "slug": "foundry",
                    "display_name": "Foundry",
                    "created_by_user_id": "user-1",
                },
            )
            organization_id = create_response.json()["organization"]["organization_id"]

            update_response = client.put(
                f"/api/v1/organizations/{organization_id}/runtime",
                json={
                    "health": "ready",
                    "default_provider": "codex",
                    "default_model": "gpt-5",
                    "credentials": [
                        {
                            "provider": "codex",
                            "ownership": "organization",
                            "configured": True,
                            "label": "Shared org key",
                        }
                    ],
                    "agents": [
                        {
                            "agent_id": "reviewer",
                            "display_name": "Reviewer",
                            "purpose": "Review code",
                            "enabled": True,
                            "provider_override": "codex",
                            "model_override": "gpt-5",
                        }
                    ],
                },
            )
            self.assertEqual(update_response.status_code, 200)
            runtime_payload = update_response.json()
            self.assertEqual(runtime_payload["health"], "ready")
            self.assertEqual(runtime_payload["credentials"][0]["configured"], True)
            self.assertEqual(runtime_payload["agents"][0]["agent_id"], "reviewer")

            detail_response = client.get(f"/api/v1/organizations/{organization_id}")
            self.assertEqual(detail_response.status_code, 200)
            self.assertEqual(
                detail_response.json()["runtime_settings"]["default_model"],
                "gpt-5",
            )

    def test_bind_github_installation_to_organization(self) -> None:
        with self._create_client() as client:
            create_response = client.post(
                "/api/v1/organizations",
                json={
                    "slug": "aldrinc",
                    "display_name": "Aldrinc",
                    "created_by_user_id": "user-1",
                },
            )
            organization_id = create_response.json()["organization"]["organization_id"]

            bind_response = client.post(
                f"/api/v1/organizations/{organization_id}/github/installations/115185467/bind"
            )
            self.assertEqual(bind_response.status_code, 200)
            self.assertEqual(bind_response.json()["account_login"], "aldrinc")

            installation_response = client.get(
                f"/api/v1/organizations/{organization_id}/github/installation"
            )
            self.assertEqual(installation_response.status_code, 200)
            self.assertEqual(installation_response.json()["installation_id"], "115185467")

    def test_invitation_acceptance_syncs_member_to_core_realm(self) -> None:
        with self._create_client() as client:
            signup_response = client.post(
                "/signup",
                data={
                    "display_name": "Owner",
                    "email": "owner@example.com",
                    "password": "owner-password",
                    "organization_name": "Acme",
                    "organization_slug": "acme-team",
                },
                follow_redirects=False,
            )
            organization_id = signup_response.headers["location"].rsplit("/", 1)[-1]

            invitation_response = client.post(
                f"/cloud/organizations/{organization_id}/invitations",
                data={"email": "teammate@example.com", "role": "member"},
            )
            self.assertEqual(invitation_response.status_code, 200)
            invitation_match = re.search(
                r"https?://[^\"']+/cloud/invitations/([A-Za-z0-9_-]+)",
                invitation_response.text,
            )
            self.assertIsNotNone(invitation_match)
            token = invitation_match.group(1)

            accept_response = client.post(
                f"/cloud/invitations/{token}/accept",
                data={
                    "display_name": "Teammate",
                    "password": "teammate-password",
                },
                follow_redirects=False,
            )
            self.assertEqual(accept_response.status_code, 303)
            self.assertTrue(
                any(
                    item["email"] == "teammate@example.com"
                    for item in _ControlPlaneCoreApiHandler.tenant_members["acme-team"]
                )
            )

    def test_coder_status_and_inventory_endpoints(self) -> None:
        with self._create_client() as client:
            status_response = client.get("/api/v1/coder/status")
            self.assertEqual(status_response.status_code, 200)
            self.assertEqual(status_response.json()["build"]["version"], "v2.31.3+test")
            self.assertEqual(status_response.json()["template_count"], 1)
            self.assertEqual(status_response.json()["healthy_workspace_count"], 1)

            templates_response = client.get("/api/v1/coder/templates")
            self.assertEqual(templates_response.status_code, 200)
            self.assertEqual(templates_response.json()[0]["name"], "foundry-hetzner-workspace")

            workspaces_response = client.get("/api/v1/coder/workspaces")
            self.assertEqual(workspaces_response.status_code, 200)
            self.assertEqual(workspaces_response.json()[0]["name"], "foundry-owned-smoke")


if __name__ == "__main__":
    unittest.main()
