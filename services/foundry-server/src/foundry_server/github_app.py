from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import jwt

from .config import AppConfig


class GitHubAppError(RuntimeError):
    pass


class GitHubAppConfigurationError(GitHubAppError):
    pass


class GitHubAppRequestError(GitHubAppError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class GitHubAppClient:
    app_name: str
    app_id: str
    client_id: str
    api_url: str
    private_key_path: Path
    webhook_secret: str

    @classmethod
    def from_config(cls, config: AppConfig) -> GitHubAppClient:
        missing = []
        if not config.github_app_id:
            missing.append("FOUNDRY_GITHUB_APP_ID")
        if not config.github_client_id:
            missing.append("FOUNDRY_GITHUB_CLIENT_ID")
        if not config.github_app_private_key_path:
            missing.append("FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH")
        if missing:
            raise GitHubAppConfigurationError(
                "GitHub App is not configured. Missing: " + ", ".join(missing)
            )

        private_key_path = Path(config.github_app_private_key_path)
        if not private_key_path.is_file():
            raise GitHubAppConfigurationError(
                f"GitHub App private key file does not exist: {private_key_path}"
            )

        return cls(
            app_name=config.github_app_name,
            app_id=config.github_app_id,
            client_id=config.github_client_id,
            api_url=config.github_api_url.rstrip("/"),
            private_key_path=private_key_path,
            webhook_secret="",
        )

    @classmethod
    def from_config_with_webhook_secret(cls, config: AppConfig, webhook_secret: str) -> GitHubAppClient:
        client = cls.from_config(config)
        return cls(
            app_name=client.app_name,
            app_id=client.app_id,
            client_id=client.client_id,
            api_url=client.api_url,
            private_key_path=client.private_key_path,
            webhook_secret=webhook_secret,
        )

    def describe_app(self) -> dict[str, object]:
        app = self._request_dict("GET", "/app")
        return {
            "configured": True,
            "name": app.get("name", self.app_name),
            "slug": app.get("slug", ""),
            "app_id": self.app_id,
            "client_id": self.client_id,
            "html_url": app.get("html_url", ""),
            "webhook_secret_present": bool(self.webhook_secret),
        }

    def list_installations(self) -> list[dict[str, object]]:
        installations = self._request_list("GET", "/app/installations")
        return [
            {
                "id": installation.get("id", ""),
                "account_login": installation.get("account", {}).get("login", ""),
                "account_type": installation.get("account", {}).get("type", ""),
                "repository_selection": installation.get("repository_selection", ""),
            }
            for installation in installations
        ]

    def describe_repository_binding(self, owner: str, repo: str) -> dict[str, object]:
        app = self._request_dict("GET", "/app")
        try:
            installation = self._request_dict("GET", f"/repos/{owner}/{repo}/installation")
        except GitHubAppRequestError as exc:
            if exc.status_code == 404:
                raise GitHubAppRequestError(
                    404,
                    f"GitHub App is not installed for {owner}/{repo}.",
                ) from exc
            raise
        access_token = self._request_dict("POST", f"/app/installations/{installation['id']}/access_tokens")
        permissions = access_token.get("permissions") or installation.get("permissions") or {}
        repositories = access_token.get("repositories") or []
        return {
            "repository": f"{owner}/{repo}",
            "app": {
                "name": app.get("name", self.app_name),
                "slug": app.get("slug", ""),
                "app_id": self.app_id,
                "client_id": self.client_id,
            },
            "installation": {
                "id": installation["id"],
                "account_login": installation.get("account", {}).get("login", ""),
                "account_type": installation.get("account", {}).get("type", ""),
                "repository_selection": installation.get("repository_selection", ""),
                "permissions": permissions,
                "token_expires_at": access_token.get("expires_at", ""),
                "repository_count": len(repositories),
            },
        }

    def verify_webhook(self, payload: bytes, signature_header: str | None) -> bool:
        if not self.webhook_secret or not signature_header:
            return False

        expected = "sha256=" + hmac.new(
            self.webhook_secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header)

    def _request_payload(self, method: str, path: str) -> dict[str, Any] | list[dict[str, Any]]:
        url = f"{self.api_url}{path}"
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.create_app_jwt()}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        with httpx.Client(timeout=20.0) as client:
            response = client.request(method, url, headers=headers)

        if response.status_code >= 400:
            detail = response.text.strip() or "GitHub API request failed."
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict) and payload.get("message"):
                detail = str(payload["message"])
            raise GitHubAppRequestError(response.status_code, detail)

        data = response.json()
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and all(isinstance(item, dict) for item in data):
            return data
        raise GitHubAppRequestError(
            502,
            f"Unexpected GitHub API response shape from {path}.",
        )

    def _request_dict(self, method: str, path: str) -> dict[str, Any]:
        data = self._request_payload(method, path)
        if not isinstance(data, dict):
            raise GitHubAppRequestError(
                502,
                f"Unexpected GitHub API response shape from {path}.",
            )
        return data

    def _request_list(self, method: str, path: str) -> list[dict[str, Any]]:
        data = self._request_payload(method, path)
        if not isinstance(data, list):
            raise GitHubAppRequestError(
                502,
                f"Unexpected GitHub API response shape from {path}.",
            )
        return data

    def create_app_jwt(self) -> str:
        private_key = self.private_key_path.read_text(encoding="utf-8")
        now = datetime.now(UTC)
        return jwt.encode(
            {
                "iat": int((now - timedelta(seconds=60)).timestamp()),
                "exp": int((now + timedelta(minutes=9)).timestamp()),
                "iss": self.app_id,
            },
            private_key,
            algorithm="RS256",
        )
