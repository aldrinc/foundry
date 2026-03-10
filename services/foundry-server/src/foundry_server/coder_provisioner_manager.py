from __future__ import annotations

import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from .coder_client import CoderClient
from .config import AppConfig


class CoderProvisionerManagerError(RuntimeError):
    pass


class CoderProvisionerManagerConfigurationError(CoderProvisionerManagerError):
    pass


@dataclass(frozen=True)
class CoderProvisionerManager:
    coder_client: CoderClient
    container_name: str
    internal_service_url: str
    container_prefix: str
    key_dir: Path
    cache_dir: Path
    startup_timeout_seconds: int

    @classmethod
    def from_config(cls, config: AppConfig) -> CoderProvisionerManager:
        if not config.coder_api_token or not config.coder_url:
            raise CoderProvisionerManagerConfigurationError(
                "Foundry Coder is not configured for provisioner management."
            )

        internal_service_url = _container_internal_url(
            config.coder_internal_url,
            config.coder_container_name,
        )

        return cls(
            coder_client=CoderClient.from_config(config),
            container_name=config.coder_container_name,
            internal_service_url=internal_service_url,
            container_prefix=config.coder_provisioner_container_prefix,
            key_dir=Path(config.coder_provisioner_key_dir),
            cache_dir=Path(config.coder_provisioner_cache_dir),
            startup_timeout_seconds=config.coder_provisioner_startup_timeout_seconds,
        )

    def ensure_organization_provisioner(
        self,
        *,
        organization_id: str,
        organization_name: str,
    ) -> None:
        if self._has_connected_daemon(organization_id):
            return

        container = self._container_name(organization_name)
        key_path = self.key_dir / f"{organization_name}.key"
        cache_path = self.cache_dir / organization_name

        self.key_dir.mkdir(parents=True, exist_ok=True)
        cache_path.mkdir(parents=True, exist_ok=True)

        provisioner_key = key_path.read_text(encoding="utf-8").strip() if key_path.is_file() else ""
        if not provisioner_key:
            provisioner_key = self._create_provisioner_key(
                organization_id=organization_id,
                organization_name=organization_name,
            )
            key_path.write_text(f"{provisioner_key}\n", encoding="utf-8")
            key_path.chmod(0o600)

        if self._container_running(container):
            if self._wait_for_daemon(organization_id):
                return
            self._run(["docker", "rm", "-f", container], check=False)

        if self._container_exists(container):
            self._run(["docker", "rm", "-f", container], check=False)

        image_name, network_name = self._inspect_coder_container()
        self._run(
            [
                "docker",
                "run",
                "-d",
                "--restart",
                "unless-stopped",
                "--name",
                container,
                "--network",
                network_name,
                "--entrypoint",
                "/opt/coder",
                "-e",
                f"CODER_URL={self.internal_service_url}",
                "-e",
                f"CODER_PROVISIONER_DAEMON_KEY={provisioner_key}",
                "-e",
                f"CODER_CACHE_DIRECTORY=/home/coder/.cache/coder/{organization_name}",
                "-v",
                f"{cache_path}:/home/coder/.cache/coder/{organization_name}",
                image_name,
                "provisionerd",
                "start",
            ]
        )

        if not self._wait_for_daemon(organization_id):
            raise CoderProvisionerManagerError(
                "Provisioner daemon did not register with Coder in time."
            )

    def _create_provisioner_key(
        self,
        *,
        organization_id: str,
        organization_name: str,
    ) -> str:
        key_name = f"foundry-{organization_name}-{int(time.time())}"
        response = self.coder_client.create_provisioner_key(
            organization_id,
            name=key_name,
            tags={
                "scope": "organization",
                "owner": "",
            },
        )
        provisioner_key = str(response.get("key", "")).strip()
        if not provisioner_key:
            raise CoderProvisionerManagerError(
                "Coder did not return a provisioner key."
            )
        return provisioner_key

    def _has_connected_daemon(self, organization_id: str) -> bool:
        daemon_sets = self.coder_client.list_provisioner_key_daemons(organization_id)
        return any(item["daemons"] for item in daemon_sets)

    def _wait_for_daemon(self, organization_id: str) -> bool:
        deadline = time.monotonic() + self.startup_timeout_seconds
        while time.monotonic() < deadline:
            if self._has_connected_daemon(organization_id):
                return True
            time.sleep(1)
        return False

    def _container_name(self, organization_name: str) -> str:
        safe_name = re.sub(r"[^a-z0-9_.-]+", "-", organization_name.lower()).strip("-")
        return f"{self.container_prefix}-{safe_name}"

    def _inspect_coder_container(self) -> tuple[str, str]:
        result = self._run(["docker", "inspect", self.container_name])
        payload = json.loads(result.stdout)
        if not payload or not isinstance(payload[0], dict):
            raise CoderProvisionerManagerError(
                f"Unexpected docker inspect output for {self.container_name}."
            )
        container_info = payload[0]
        image_name = str(container_info.get("Config", {}).get("Image", "")).strip()
        networks = container_info.get("NetworkSettings", {}).get("Networks", {})
        if not image_name or not isinstance(networks, dict) or not networks:
            raise CoderProvisionerManagerError(
                f"Could not determine Coder image or network for {self.container_name}."
            )
        network_name = str(next(iter(networks.keys())))
        return image_name, network_name

    def _container_exists(self, container_name: str) -> bool:
        result = self._run(
            ["docker", "inspect", container_name],
            check=False,
        )
        return result.returncode == 0

    def _container_running(self, container_name: str) -> bool:
        result = self._run(
            [
                "docker",
                "inspect",
                "-f",
                "{{.State.Running}}",
                container_name,
            ],
            check=False,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"

    def _run(self, command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        if check and result.returncode != 0:
            stderr = result.stderr.strip()
            stdout = result.stdout.strip()
            detail = stderr or stdout or "command failed without output"
            raise CoderProvisionerManagerError(detail)
        return result


def _container_internal_url(raw_url: str, container_name: str) -> str:
    parsed = urlparse(raw_url)
    scheme = parsed.scheme or "http"
    port = parsed.port
    if port is None:
        if scheme == "https":
            port = 443
        else:
            port = 80
    return f"{scheme}://{container_name}:{port}"
