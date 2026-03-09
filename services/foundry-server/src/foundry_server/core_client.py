from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .config import AppConfig


class FoundryCoreClientError(RuntimeError):
    pass


class FoundryCoreConfigurationError(FoundryCoreClientError):
    pass


class FoundryCoreRequestError(FoundryCoreClientError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class FoundryCoreClient:
    base_url: str
    bootstrap_secret: str

    @classmethod
    def from_config(cls, config: AppConfig) -> FoundryCoreClient:
        missing = []
        if not config.core_url:
            missing.append("FOUNDRY_CORE_URL")
        if not config.core_bootstrap_secret:
            missing.append("FOUNDRY_CORE_BOOTSTRAP_SECRET")
        if missing:
            raise FoundryCoreConfigurationError(
                "Foundry core provisioning is not configured. Missing: " + ", ".join(missing)
            )
        return cls(
            base_url=config.core_url.rstrip("/"),
            bootstrap_secret=config.core_bootstrap_secret,
        )

    def provision_realm(
        self,
        *,
        organization_id: str,
        realm_subdomain: str,
        realm_name: str,
        owner_email: str,
        owner_full_name: str,
        owner_password: str | None,
        role: str = "owner",
    ) -> dict[str, object]:
        payload = {
            "organization_id": organization_id,
            "realm_subdomain": realm_subdomain,
            "realm_name": realm_name,
            "owner_email": owner_email,
            "owner_full_name": owner_full_name,
            "owner_password": owner_password or "",
            "role": role,
        }
        return self._request_dict("POST", "/api/v1/foundry/cloud/tenants/provision", payload)

    def sync_member(
        self,
        *,
        realm_subdomain: str,
        email: str,
        full_name: str,
        password: str | None,
        role: str,
    ) -> dict[str, object]:
        payload = {
            "email": email,
            "full_name": full_name,
            "password": password or "",
            "role": role,
        }
        return self._request_dict(
            "POST",
            f"/api/v1/foundry/cloud/tenants/{realm_subdomain}/members/sync",
            payload,
        )

    def _request_dict(self, method: str, path: str, payload: dict[str, object]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Foundry-Core-Bootstrap-Secret": self.bootstrap_secret,
        }
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            response = client.request(method, url, headers=headers, json=payload)

        if response.status_code >= 400:
            detail = response.text.strip() or "Foundry core request failed."
            try:
                body = response.json()
            except ValueError:
                body = None
            if isinstance(body, dict):
                detail = str(body.get("msg") or body.get("message") or body.get("detail") or detail)
            raise FoundryCoreRequestError(response.status_code, detail)

        data = response.json()
        if not isinstance(data, dict):
            raise FoundryCoreRequestError(
                502,
                f"Unexpected Foundry core response shape from {path}.",
            )
        return data
