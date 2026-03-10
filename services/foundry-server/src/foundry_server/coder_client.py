from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .config import AppConfig


class CoderClientError(RuntimeError):
    pass


class CoderConfigurationError(CoderClientError):
    pass


class CoderRequestError(CoderClientError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class CoderClient:
    base_url: str
    api_token: str

    @classmethod
    def from_config(cls, config: AppConfig) -> CoderClient:
        missing = []
        if not config.coder_url:
            missing.append("FOUNDRY_CODER_URL")
        if not config.coder_api_token:
            missing.append("FOUNDRY_CODER_API_TOKEN")
        if missing:
            raise CoderConfigurationError(
                "Foundry Coder is not configured. Missing: " + ", ".join(missing)
            )
        return cls(
            base_url=config.coder_url.rstrip("/"),
            api_token=config.coder_api_token,
        )

    def build_info(self) -> dict[str, object]:
        payload = self._request_dict("GET", "/api/v2/buildinfo")
        return {
            "version": str(payload.get("version", "")),
            "dashboard_url": str(payload.get("dashboard_url", self.base_url)),
            "external_url": str(payload.get("external_url", "")),
            "telemetry": bool(payload.get("telemetry", False)),
            "workspace_proxy": bool(payload.get("workspace_proxy", False)),
            "agent_api_version": str(payload.get("agent_api_version", "")),
            "provisioner_api_version": str(payload.get("provisioner_api_version", "")),
            "deployment_id": str(payload.get("deployment_id", "")),
        }

    def list_templates(self) -> list[dict[str, object]]:
        payload = self._request_list("GET", "/api/v2/templates")
        return [
            {
                "id": str(item.get("id", "")),
                "name": str(item.get("name", "")),
                "display_name": str(item.get("display_name", "")),
                "active_version_id": str(item.get("active_version_id", "")),
                "created_by_name": str(item.get("created_by_name", "")),
                "active_user_count": int(item.get("active_user_count", 0)),
                "deprecated": bool(item.get("deprecated", False)),
                "deleted": bool(item.get("deleted", False)),
            }
            for item in payload
        ]

    def list_organizations(self) -> list[dict[str, object]]:
        payload = self._request_list("GET", "/api/v2/users/me/organizations")
        return [
            {
                "id": str(item.get("id", "")),
                "name": str(item.get("name", "")),
                "display_name": str(item.get("display_name", "")),
                "description": str(item.get("description", "")),
                "is_default": bool(item.get("is_default", False)),
            }
            for item in payload
        ]

    def create_organization(self, name: str, display_name: str) -> dict[str, object]:
        payload = self._request_dict(
            "POST",
            "/api/v2/organizations",
            json_payload={"name": name, "display_name": display_name},
        )
        return {
            "id": str(payload.get("id", "")),
            "name": str(payload.get("name", "")),
            "display_name": str(payload.get("display_name", "")),
            "description": str(payload.get("description", "")),
            "is_default": bool(payload.get("is_default", False)),
        }

    def get_template(
        self, organization_name: str, template_name: str
    ) -> dict[str, object] | None:
        try:
            payload = self._request_dict(
                "GET",
                f"/api/v2/organizations/{organization_name}/templates/{template_name}",
            )
        except CoderRequestError as exc:
            if exc.status_code == 404:
                return None
            raise
        return {
            "id": str(payload.get("id", "")),
            "name": str(payload.get("name", "")),
            "display_name": str(payload.get("display_name", "")),
            "organization_id": str(payload.get("organization_id", "")),
            "organization_name": str(payload.get("organization_name", organization_name)),
        }

    def create_provisioner_key(
        self,
        organization_id: str,
        *,
        name: str,
        tags: dict[str, str],
    ) -> dict[str, object]:
        payload = self._request_dict(
            "POST",
            f"/api/v2/organizations/{organization_id}/provisionerkeys",
            json_payload={
                "name": name,
                "tags": tags,
            },
        )
        return {
            "key": str(payload.get("key", "")),
        }

    def list_provisioner_key_daemons(
        self, organization_id: str
    ) -> list[dict[str, object]]:
        payload = self._request_list(
            "GET",
            f"/api/v2/organizations/{organization_id}/provisionerkeys/daemons",
        )
        return [
            {
                "key_name": str(item.get("key", {}).get("name", "")),
                "key_tags": {
                    str(key): str(value)
                    for key, value in item.get("key", {}).get("tags", {}).items()
                }
                if isinstance(item.get("key", {}).get("tags", {}), dict)
                else {},
                "daemons": [
                    {
                        "id": str(daemon.get("id", "")),
                        "name": str(daemon.get("name", "")),
                    }
                    for daemon in item.get("daemons", [])
                    if isinstance(daemon, dict)
                ],
            }
            for item in payload
        ]

    def list_workspaces(self) -> list[dict[str, object]]:
        payload = self._request_dict("GET", "/api/v2/workspaces?q=")
        workspaces = payload.get("workspaces", [])
        if not isinstance(workspaces, list):
            raise CoderRequestError(
                502,
                "Unexpected Coder API response shape from /api/v2/workspaces.",
            )
        return [
            {
                "id": str(item.get("id", "")),
                "name": str(item.get("name", "")),
                "owner_name": str(item.get("owner_name", "")),
                "organization_name": str(item.get("organization_name", "")),
                "template_name": str(item.get("template_name", "")),
                "status": str(item.get("latest_build", {}).get("status", "")),
                "transition": str(item.get("latest_build", {}).get("transition", "")),
                "healthy": bool(item.get("health", {}).get("healthy", False)),
                "outdated": bool(item.get("outdated", False)),
                "last_used_at": str(item.get("last_used_at", "")),
            }
            for item in workspaces
        ]

    def _request_payload(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, object] | None = None,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        url = f"{self.base_url}{path}"
        headers = {
            "Coder-Session-Token": self.api_token,
            "Accept": "application/json",
        }
        with httpx.Client(timeout=20.0) as client:
            response = client.request(method, url, headers=headers, json=json_payload)

        if response.status_code >= 400:
            detail = response.text.strip() or "Coder API request failed."
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict):
                message = payload.get("message") or payload.get("detail")
                if message:
                    detail = str(message)
            raise CoderRequestError(response.status_code, detail)

        data = response.json()
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and all(isinstance(item, dict) for item in data):
            return data
        raise CoderRequestError(
            502,
            f"Unexpected Coder API response shape from {path}.",
        )

    def _request_dict(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        data = self._request_payload(method, path, json_payload=json_payload)
        if not isinstance(data, dict):
            raise CoderRequestError(
                502,
                f"Unexpected Coder API response shape from {path}.",
            )
        return data

    def _request_list(self, method: str, path: str) -> list[dict[str, Any]]:
        data = self._request_payload(method, path)
        if not isinstance(data, list):
            raise CoderRequestError(
                502,
                f"Unexpected Coder API response shape from {path}.",
            )
        return data
