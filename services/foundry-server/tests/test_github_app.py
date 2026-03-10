from __future__ import annotations

import json
import hmac
import hashlib
import socketserver
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1] / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from foundry_server.app import create_app  # noqa: E402
from foundry_server.config import load_config  # noqa: E402
from foundry_server.github_app import GitHubAppClient  # noqa: E402


class _GitHubApiHandler(BaseHTTPRequestHandler):
    def _write_json(self, payload: dict[str, object]) -> None:
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
                    "slug": "foundry",
                    "name": "Foundry",
                    "html_url": "https://github.com/apps/foundry",
                }
            )
            return

        if self.path == "/app/installations":
            self._write_json(
                [
                    {
                        "id": 987654,
                        "repository_selection": "selected",
                        "account": {"login": "example-org", "type": "Organization"},
                    }
                ]
            )
            return

        if self.path == "/repos/example-org/foundry/installation":
            self._write_json(
                {
                    "id": 987654,
                    "repository_selection": "selected",
                    "permissions": {
                        "contents": "write",
                        "pull_requests": "write",
                        "workflows": "write",
                        "metadata": "read",
                    },
                    "account": {"login": "example-org", "type": "Organization"},
                }
            )
            return

        self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/app/installations/987654/access_tokens":
            self._write_json(
                {
                    "token": "ghs_fake",
                    "expires_at": "2026-03-10T00:00:00Z",
                    "permissions": {
                        "contents": "write",
                        "pull_requests": "write",
                        "workflows": "write",
                        "metadata": "read",
                    },
                    "repositories": [
                        {"full_name": "example-org/foundry", "private": True},
                    ],
                }
            )
            return

        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class _ThreadingGitHubApiServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class GitHubAppTests(unittest.TestCase):
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

    def _login_admin(self, client: TestClient) -> None:
        response = client.post(
            "/login",
            data={
                "email": "platform-admin@foundry.test",
                "password": "bootstrap-password",
            },
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)

    def test_app_jwt_contains_expected_claims(self) -> None:
        private_key_path = self._write_private_key()
        config = load_config(
            {
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "platform-admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
            }
        )

        client = GitHubAppClient.from_config_with_webhook_secret(config, webhook_secret="secret")
        token = client.create_app_jwt()
        claims = jwt.decode(token, options={"verify_signature": False})

        self.assertEqual(claims["iss"], "3048941")
        self.assertGreater(claims["exp"], claims["iat"])

    def test_webhook_signature_verification(self) -> None:
        private_key_path = self._write_private_key()
        config = load_config(
            {
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "platform-admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
            }
        )

        client = GitHubAppClient.from_config_with_webhook_secret(
            config,
            webhook_secret="super-secret",
        )
        payload = b'{"action":"opened"}'
        signature = "sha256=" + hmac.new(
            b"super-secret",
            payload,
            hashlib.sha256,
        ).hexdigest()

        self.assertTrue(client.verify_webhook(payload, signature))
        self.assertFalse(client.verify_webhook(payload, "sha256=bad"))

    def test_binding_endpoint_reports_installation(self) -> None:
        private_key_path = self._write_private_key()
        server = _ThreadingGitHubApiServer(("127.0.0.1", 0), _GitHubApiHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        self.addCleanup(lambda: thread.join(timeout=5))

        config = load_config(
            {
                "FOUNDRY_AUTH_PROVIDER": "local_password",
                "FOUNDRY_BOOTSTRAP_ADMIN_EMAIL": "platform-admin@foundry.test",
                "FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD": "bootstrap-password",
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
                "FOUNDRY_GITHUB_WEBHOOK_SECRET": "secret",
                "FOUNDRY_GITHUB_API_URL": f"http://127.0.0.1:{server.server_address[1]}",
            }
        )

        app = create_app(config)
        with TestClient(app) as client:
            self._login_admin(client)
            app_response = client.get("/api/v1/github/app")
            installations_response = client.get("/api/v1/github/installations")
            binding_response = client.get("/api/v1/github/repositories/example-org/foundry/binding")

        self.assertEqual(app_response.status_code, 200)
        self.assertEqual(app_response.json()["slug"], "foundry")
        self.assertEqual(installations_response.status_code, 200)
        self.assertEqual(installations_response.json()[0]["account_login"], "example-org")
        self.assertEqual(binding_response.status_code, 200)
        payload = binding_response.json()
        self.assertEqual(payload["repository"], "example-org/foundry")
        self.assertEqual(payload["installation"]["id"], 987654)
        self.assertEqual(payload["installation"]["account_login"], "example-org")
        self.assertEqual(payload["installation"]["permissions"]["contents"], "write")

    def test_clone_token_endpoint_requires_bootstrap_secret(self) -> None:
        private_key_path = self._write_private_key()
        server = _ThreadingGitHubApiServer(("127.0.0.1", 0), _GitHubApiHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        self.addCleanup(lambda: thread.join(timeout=5))

        config = load_config(
            {
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
                "FOUNDRY_GITHUB_API_URL": f"http://127.0.0.1:{server.server_address[1]}",
                "FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET": "bootstrap-secret",
            }
        )

        app = create_app(config)
        expected_token = hashlib.sha256(
            "bootstrap-secret:example-org/foundry".encode("utf-8")
        ).hexdigest()
        with TestClient(app) as client:
            unauthorized = client.post("/api/v1/github/repositories/example-org/foundry/clone-token")
            authorized = client.post(
                "/api/v1/github/repositories/example-org/foundry/clone-token",
                headers={"X-Foundry-Workspace-Bootstrap-Token": expected_token},
            )

        self.assertEqual(unauthorized.status_code, 401)
        self.assertEqual(authorized.status_code, 200)
        payload = authorized.json()
        self.assertEqual(payload["repository"], "example-org/foundry")
        self.assertEqual(payload["installation_id"], 987654)
        self.assertEqual(payload["permissions"]["contents"], "write")
        self.assertEqual(payload["token"], "ghs_fake")


if __name__ == "__main__":
    unittest.main()
