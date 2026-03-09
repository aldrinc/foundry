from __future__ import annotations

import json
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


class _ThreadingControlPlaneGitHubApiServer(socketserver.ThreadingTCPServer):
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

        server = _ThreadingControlPlaneGitHubApiServer(
            ("127.0.0.1", 0),
            _ControlPlaneGitHubApiHandler,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        self.addCleanup(lambda: thread.join(timeout=5))

        config = load_config(
            {
                "FOUNDRY_DATABASE_PATH": database_handle.name,
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
                "FOUNDRY_GITHUB_API_URL": f"http://127.0.0.1:{server.server_address[1]}",
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


if __name__ == "__main__":
    unittest.main()
