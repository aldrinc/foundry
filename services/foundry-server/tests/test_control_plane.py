from __future__ import annotations

import json
import re
import os
import shutil
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
                        "account": {"login": "example-org", "type": "Organization"},
                    }
                ]
            )
            return

        self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class _ControlPlaneCoreApiHandler(BaseHTTPRequestHandler):
    tenant_members: dict[str, list[dict[str, object]]] = {}

    @staticmethod
    def _realm_payload(realm_subdomain: str, realm_name: str) -> dict[str, object]:
        if realm_subdomain == "__root__":
            return {
                "id": 1,
                "string_id": "",
                "name": realm_name,
                "url": "https://core-dev.foundry.test",
            }
        return {
            "id": 1,
            "string_id": realm_subdomain,
            "name": realm_name,
            "url": f"https://{realm_subdomain}.core-dev.foundry.test",
        }

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
                    "realm": self._realm_payload(realm_subdomain, str(payload["realm_name"])),
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
                    "realm": self._realm_payload(realm_subdomain, ""),
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
    published_templates_state_path = ""
    provisioners_state_path = ""

    @classmethod
    def _organization_by_id(cls, organization_id: str) -> dict[str, object] | None:
        return next(
            (item for item in cls.organizations if str(item["id"]) == organization_id),
            None,
        )

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

        match = re.fullmatch(
            r"/api/v2/organizations/([^/]+)/provisionerkeys/daemons",
            self.path,
        )
        if match is not None:
            organization_id = match.group(1)
            organization = self._organization_by_id(organization_id)
            if organization is None:
                self.send_error(404)
                return
            started = set()
            if self.provisioners_state_path:
                try:
                    started = set(
                        json.loads(Path(self.provisioners_state_path).read_text())
                    )
                except FileNotFoundError:
                    started = set()
            organization_name = str(organization["name"])
            daemons: list[dict[str, object]] = []
            if organization_name in started:
                daemons.append(
                    {
                        "id": f"daemon-{organization_name}",
                        "name": f"foundry-provisionerd-{organization_name}",
                    }
                )
            self._write_json(
                [
                    {
                        "key": {
                            "name": f"foundry-{organization_name}",
                            "tags": {
                                "scope": "organization",
                                "owner": "",
                            },
                        },
                        "daemons": daemons,
                    }
                ]
            )
            return

        match = re.fullmatch(
            r"/api/v2/organizations/([^/]+)/templates/([^/]+)",
            self.path,
        )
        if match is not None:
            organization_name, template_name = match.groups()
            published = set()
            if self.published_templates_state_path:
                try:
                    published = set(
                        json.loads(Path(self.published_templates_state_path).read_text())
                    )
                except FileNotFoundError:
                    published = set()
            if organization_name in published and template_name == "foundry-hetzner-workspace":
                self._write_json(
                    {
                        "id": f"template-{organization_name}",
                        "name": template_name,
                        "display_name": "",
                        "organization_id": f"org-{organization_name}",
                        "organization_name": organization_name,
                    }
                )
                return
            self.send_error(404)
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

        match = re.fullmatch(
            r"/api/v2/organizations/([^/]+)/provisionerkeys",
            self.path,
        )
        if match is not None:
            organization_id = match.group(1)
            if self._organization_by_id(organization_id) is None:
                self.send_error(404)
                return
            encoded = json.dumps({"key": f"pk-{organization_id}"}).encode("utf-8")
            self.send_response(201)
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

    def _create_client(self, *, core_realm_key_override: str = "") -> TestClient:
        private_key_path = self._write_private_key()
        database_handle = tempfile.NamedTemporaryFile("wb", delete=False)
        database_handle.close()
        self.addCleanup(lambda: Path(database_handle.name).unlink(missing_ok=True))
        template_dir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(template_dir, ignore_errors=True))
        (template_dir / "main.tf").write_text('terraform { required_version = ">= 1.8.0" }\n')
        published_templates_state = tempfile.NamedTemporaryFile("w", delete=False)
        published_templates_state.write("[]")
        published_templates_state.flush()
        published_templates_state.close()
        self.addCleanup(lambda: Path(published_templates_state.name).unlink(missing_ok=True))
        provisioners_state = tempfile.NamedTemporaryFile("w", delete=False)
        provisioners_state.write("[]")
        provisioners_state.flush()
        provisioners_state.close()
        self.addCleanup(lambda: Path(provisioners_state.name).unlink(missing_ok=True))
        fake_docker = Path(tempfile.mkdtemp()) / "docker"
        fake_docker.write_text(
            """#!/usr/bin/env python3
from pathlib import Path
import json
import os
import sys

args = sys.argv[1:]
if not args:
    raise SystemExit(1)

if args[0] == "inspect":
    if "-f" in args:
        target = args[-1]
        state_path = Path(os.environ["FAKE_CODER_PROVISIONERS"])
        provisioners = set(json.loads(state_path.read_text()))
        if target == "foundry-coder":
            print("true")
            raise SystemExit(0)
        if target in {f"foundry-provisionerd-{org}" for org in provisioners}:
            print("true")
            raise SystemExit(0)
        raise SystemExit(1)
    target = args[1]
    if target == "foundry-coder":
        payload = [
            {
                "Config": {"Image": "foundry-coder:dev"},
                "NetworkSettings": {"Networks": {"foundry-coder_default": {}}},
            }
        ]
        print(json.dumps(payload))
        raise SystemExit(0)
    state_path = Path(os.environ["FAKE_CODER_PROVISIONERS"])
    provisioners = set(json.loads(state_path.read_text()))
    if target in {f"foundry-provisionerd-{org}" for org in provisioners}:
        print(json.dumps([{"State": {"Running": True}}]))
        raise SystemExit(0)
    raise SystemExit(1)

if args[0] == "rm":
    target = args[-1]
    state_path = Path(os.environ["FAKE_CODER_PROVISIONERS"])
    provisioners = set(json.loads(state_path.read_text()))
    suffix = "foundry-provisionerd-"
    if target.startswith(suffix):
        provisioners.discard(target.removeprefix(suffix))
        state_path.write_text(json.dumps(sorted(provisioners)))
    raise SystemExit(0)

if args[0] == "run":
    state_path = Path(os.environ["FAKE_CODER_PROVISIONERS"])
    provisioners = set(json.loads(state_path.read_text()))
    org = ""
    for index, token in enumerate(args):
        if token in {"--org", "-O"} and index + 1 < len(args):
            org = args[index + 1]
            break
    if not org:
        for index, token in enumerate(args):
            if token == "--name" and index + 1 < len(args):
                name = args[index + 1]
                suffix = "foundry-provisionerd-"
                if name.startswith(suffix):
                    org = name.removeprefix(suffix)
                break
    if org:
        provisioners.add(org)
        state_path.write_text(json.dumps(sorted(provisioners)))
    print("fake-provisioner-container")
    raise SystemExit(0)

if args[0] == "cp":
    raise SystemExit(0)

if args[0] != "exec":
    raise SystemExit(0)

cursor = 1
while cursor < len(args) and args[cursor].startswith("-"):
    flag = args[cursor]
    cursor += 1
    if flag in {"-e", "-u"} and cursor < len(args):
        cursor += 1

if cursor >= len(args):
    raise SystemExit(0)

cursor += 1  # container name
command = args[cursor:]
if command[:3] == ["rm", "-rf", "/tmp/foundry-hetzner-workspace"]:
    raise SystemExit(0)
if command[:3] == ["mkdir", "-p", "/tmp/codercli"]:
    raise SystemExit(0)
if command[:2] == ["/opt/coder", "login"]:
    raise SystemExit(0)
if command[:3] == ["/opt/coder", "templates", "push"]:
    org = ""
    for index, token in enumerate(command):
        if token == "--org" and index + 1 < len(command):
            org = command[index + 1]
            break
    state_path = Path(os.environ["FAKE_CODER_PUBLISHED_TEMPLATES"])
    published = set(json.loads(state_path.read_text()))
    published.add(org)
    state_path.write_text(json.dumps(sorted(published)))
    raise SystemExit(0)

raise SystemExit(0)
"""
        )
        fake_docker.chmod(0o755)
        self.addCleanup(lambda: fake_docker.unlink(missing_ok=True))
        self.addCleanup(lambda: shutil.rmtree(fake_docker.parent, ignore_errors=True))
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
        _ControlPlaneCoderApiHandler.published_templates_state_path = published_templates_state.name
        _ControlPlaneCoderApiHandler.provisioners_state_path = provisioners_state.name

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
                "FOUNDRY_CORE_REALM_KEY_OVERRIDE": core_realm_key_override,
                "FOUNDRY_GITHUB_APP_ID": "3048941",
                "FOUNDRY_GITHUB_CLIENT_ID": "Iv23test",
                "FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH": str(private_key_path),
                "FOUNDRY_GITHUB_API_URL": f"http://127.0.0.1:{server.server_address[1]}",
                "FOUNDRY_CODER_URL": f"http://127.0.0.1:{coder_server.server_address[1]}",
                "FOUNDRY_CODER_API_TOKEN": "coder-test-token",
                "FOUNDRY_CODER_CONTAINER_NAME": "foundry-coder",
                "FOUNDRY_CODER_TEMPLATE_NAME": "foundry-hetzner-workspace",
                "FOUNDRY_CODER_TEMPLATE_SOURCE_DIR": str(template_dir),
                "FOUNDRY_CODER_INTERNAL_URL": "http://127.0.0.1:7080",
                "FOUNDRY_HCLOUD_TOKEN": "hcloud-test-token",
                "FOUNDRY_WORKSPACE_PRIVATE_NETWORK_ID": "network-1",
                "FOUNDRY_WORKSPACE_FIREWALL_IDS": "firewall-1",
                "FOUNDRY_WORKSPACE_SSH_KEY_IDS": "ssh-key-1",
                "FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET": "bootstrap-secret",
            }
        )
        original_path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{fake_docker.parent}:{original_path}"
        os.environ["FAKE_CODER_PUBLISHED_TEMPLATES"] = published_templates_state.name
        os.environ["FAKE_CODER_PROVISIONERS"] = provisioners_state.name
        self.addCleanup(lambda: os.environ.__setitem__("PATH", original_path))
        self.addCleanup(lambda: os.environ.pop("FAKE_CODER_PUBLISHED_TEMPLATES", None))
        self.addCleanup(lambda: os.environ.pop("FAKE_CODER_PROVISIONERS", None))
        return TestClient(create_app(config))

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

    def _signup_owner(
        self,
        client: TestClient,
        *,
        display_name: str = "Owner",
        email: str = "owner@example.com",
        password: str = "owner-password",
        organization_name: str = "Acme",
        organization_slug: str = "acme",
    ) -> str:
        signup_response = client.post(
            "/signup",
            data={
                "display_name": display_name,
                "email": email,
                "password": password,
                "organization_name": organization_name,
                "organization_slug": organization_slug,
            },
            follow_redirects=False,
        )
        self.assertEqual(signup_response.status_code, 303)
        return signup_response.headers["location"].rsplit("/", 1)[-1]

    def test_create_organization_initializes_defaults(self) -> None:
        with self._create_client() as client:
            self._login_admin(client)
            response = client.post(
                "/api/v1/organizations",
                json={
                    "slug": "acme",
                    "display_name": "Acme",
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

    def test_control_plane_api_requires_session(self) -> None:
        with self._create_client() as client:
            self.assertEqual(client.get("/api/v1/organizations").status_code, 401)
            self.assertEqual(client.get("/api/v1/coder/status").status_code, 401)

    def test_signup_provisions_core_binding_and_records_coder_block(self) -> None:
        with self._create_client() as client:
            organization_id = self._signup_owner(client)

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

    def test_signup_uses_core_realm_key_override(self) -> None:
        with self._create_client(core_realm_key_override="__root__") as client:
            organization_id = self._signup_owner(
                client,
                organization_name="Foundry Root",
                organization_slug="foundry-root",
            )

            detail_response = client.get(f"/api/v1/cloud/organizations/{organization_id}")
            self.assertEqual(detail_response.status_code, 200)
            payload = detail_response.json()
            self.assertEqual(payload["organization"]["slug"], "foundry-root")
            self.assertEqual(payload["core_binding"]["realm_subdomain"], "__root__")
            self.assertEqual(payload["core_binding"]["realm_url"], "https://core-dev.foundry.test")

    def test_signup_provisions_coder_binding_when_coder_allows_org_creation(self) -> None:
        with self._create_client() as client:
            _ControlPlaneCoderApiHandler.create_status_code = 201
            organization_id = self._signup_owner(client)

            detail_response = client.get(f"/api/v1/cloud/organizations/{organization_id}")
            self.assertEqual(detail_response.status_code, 200)
            payload = detail_response.json()
            self.assertEqual(payload["coder_binding"]["status"], "ready")
            self.assertEqual(payload["coder_binding"]["name"], "acme")
            self.assertEqual(payload["coder_binding"]["display_name"], "Acme")
            self.assertEqual(
                payload["coder_binding"]["detail"],
                "Coder organization, provisioner, and template ready.",
            )

    def test_runtime_settings_round_trip(self) -> None:
        with self._create_client() as client:
            organization_id = self._signup_owner(
                client,
                organization_name="Foundry",
                organization_slug="foundry",
            )

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
            organization_id = self._signup_owner(
                client,
                organization_name="Example Org",
                organization_slug="example-org",
                email="example-owner@example.com",
            )

            bind_response = client.post(
                f"/api/v1/organizations/{organization_id}/github/installations/115185467/bind"
            )
            self.assertEqual(bind_response.status_code, 200)
            self.assertEqual(bind_response.json()["account_login"], "example-org")

            installation_response = client.get(
                f"/api/v1/organizations/{organization_id}/github/installation"
            )
            self.assertEqual(installation_response.status_code, 200)
            self.assertEqual(installation_response.json()["installation_id"], "115185467")

    def test_invitation_acceptance_syncs_member_to_core_realm(self) -> None:
        with self._create_client() as client:
            organization_id = self._signup_owner(
                client,
                organization_slug="acme-team",
            )

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
            self._login_admin(client)
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
