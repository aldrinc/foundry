from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import AppConfig


class CoderTemplatePublisherError(RuntimeError):
    pass


class CoderTemplatePublisherConfigurationError(CoderTemplatePublisherError):
    pass


@dataclass(frozen=True)
class CoderTemplatePublisher:
    container_name: str
    template_name: str
    template_source_dir: str
    coder_internal_url: str
    coder_api_token: str
    hcloud_token: str
    workspace_bootstrap_secret: str
    server_url: str
    workspace_private_network_id: str
    workspace_firewall_ids: str
    workspace_ssh_key_ids: str
    command_timeout_seconds: int = 300

    @classmethod
    def from_config(cls, config: AppConfig) -> CoderTemplatePublisher:
        missing: list[str] = []
        if not config.coder_api_token:
            missing.append("FOUNDRY_CODER_API_TOKEN")
        if not config.hcloud_token:
            missing.append("FOUNDRY_HCLOUD_TOKEN")
        if not config.workspace_bootstrap_secret:
            missing.append("FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET")
        if missing:
            raise CoderTemplatePublisherConfigurationError(
                "Missing template publish config: " + ", ".join(missing)
            )

        source_dir = Path(config.coder_template_source_dir)
        if not source_dir.is_dir():
            raise CoderTemplatePublisherConfigurationError(
                f"Template source directory not found: {source_dir}"
            )

        return cls(
            container_name=config.coder_container_name,
            template_name=config.coder_template_name,
            template_source_dir=str(source_dir),
            coder_internal_url=config.coder_internal_url,
            coder_api_token=config.coder_api_token,
            hcloud_token=config.hcloud_token,
            workspace_bootstrap_secret=config.workspace_bootstrap_secret,
            server_url=config.public_base_url.rstrip("/"),
            workspace_private_network_id=config.workspace_private_network_id,
            workspace_firewall_ids=config.workspace_firewall_ids,
            workspace_ssh_key_ids=config.workspace_ssh_key_ids,
        )

    def publish_to_organization(self, organization_name: str) -> None:
        container_template_dir = f"/tmp/{self.template_name}"

        self._run(
            [
                "docker",
                "exec",
                "-u",
                "0",
                self.container_name,
                "rm",
                "-rf",
                container_template_dir,
            ],
            check=False,
        )
        self._run(
            [
                "docker",
                "cp",
                self.template_source_dir,
                f"{self.container_name}:{container_template_dir}",
            ]
        )
        self._run(
            [
                "docker",
                "exec",
                self.container_name,
                "mkdir",
                "-p",
                "/tmp/codercli",
            ]
        )
        self._run(
            [
                "docker",
                "exec",
                "-e",
                "HOME=/tmp/codercli",
                self.container_name,
                "/opt/coder",
                "login",
                self.coder_internal_url,
                "--token",
                self.coder_api_token,
                "--use-token-as-session",
            ]
        )

        push_command = [
            "docker",
            "exec",
            "-e",
            "HOME=/tmp/codercli",
            self.container_name,
            "/opt/coder",
            "templates",
            "push",
            self.template_name,
            "--org",
            organization_name,
            "--directory",
            container_template_dir,
            "--ignore-lockfile",
            "--yes",
            "--message",
            "Publish Foundry-owned Coder template",
            "--variable",
            f"hcloud_token={self.hcloud_token}",
            "--variable",
            f"foundry_server_url={self.server_url}",
            "--variable",
            f"workspace_bootstrap_secret={self.workspace_bootstrap_secret}",
        ]

        if self.workspace_private_network_id:
            push_command.extend(
                [
                    "--variable",
                    f"private_network_id={self.workspace_private_network_id}",
                ]
            )
        if self.workspace_firewall_ids:
            push_command.extend(
                [
                    "--variable",
                    f"firewall_ids={_terraform_list_literal(self.workspace_firewall_ids)}",
                ]
            )
        if self.workspace_ssh_key_ids:
            push_command.extend(
                [
                    "--variable",
                    f"ssh_key_ids={_terraform_list_literal(self.workspace_ssh_key_ids)}",
                ]
            )

        self._run(push_command)

    def _run(self, command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self.command_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise CoderTemplatePublisherError(
                f"Command timed out after {self.command_timeout_seconds}s: {' '.join(command)}"
            ) from exc
        if result.returncode != 0 and check:
            stderr = result.stderr.strip()
            stdout = result.stdout.strip()
            detail = stderr or stdout or "command failed without output"
            raise CoderTemplatePublisherError(detail)
        return result


def _terraform_list_literal(raw_value: str) -> str:
    values = [item.strip() for item in raw_value.split(",") if item.strip()]
    if not values:
        return "[]"
    normalized: list[int | str] = []
    for value in values:
        if value.isdigit():
            normalized.append(int(value))
        else:
            normalized.append(value)
    return json.dumps(normalized)
