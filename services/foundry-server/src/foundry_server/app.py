from __future__ import annotations

import json
import hmac

from fastapi import FastAPI
from fastapi import Header, HTTPException, Request

from .config import AppConfig, load_config
from .decisions import LAUNCH_DECISIONS
from .github_app import GitHubAppClient, GitHubAppConfigurationError, GitHubAppRequestError


def create_app(config: AppConfig | None = None) -> FastAPI:
    server_config = config or load_config()

    app = FastAPI(
        title="Foundry Server",
        version="0.1.0",
        summary="Product-facing Foundry server scaffold.",
    )
    app.state.config = server_config

    def get_github_app_client() -> GitHubAppClient:
        client = getattr(app.state, "github_app_client", None)
        if client is None:
            client = GitHubAppClient.from_config_with_webhook_secret(
                server_config,
                webhook_secret=server_config.github_webhook_secret,
            )
            app.state.github_app_client = client
        return client

    def require_github_app_client() -> GitHubAppClient:
        try:
            return get_github_app_client()
        except GitHubAppConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    def require_workspace_bootstrap_secret(
        provided_secret: str | None,
    ) -> None:
        expected_secret = server_config.workspace_bootstrap_secret
        if not expected_secret:
            raise HTTPException(
                status_code=503,
                detail="Workspace bootstrap secret is not configured.",
            )
        if not provided_secret or not hmac.compare_digest(provided_secret, expected_secret):
            raise HTTPException(status_code=401, detail="Invalid workspace bootstrap secret.")

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": "foundry-server",
            "environment": server_config.environment.value,
            "self_host_mode": server_config.self_host_mode,
            "workspace_topology": server_config.workspace_topology.value,
        }

    @app.get("/api/v1/meta/launch-decisions")
    def launch_decisions() -> dict[str, object]:
        return LAUNCH_DECISIONS.to_dict()

    @app.get("/api/v1/meta/bootstrap")
    def bootstrap_summary() -> dict[str, object]:
        return {
            "service": "foundry-server",
            "config": server_config.public_summary(),
            "launch_decisions": LAUNCH_DECISIONS.to_dict(),
            "next_steps": [
                "Add OIDC-backed hosted auth and self-host bootstrap auth.",
                "Add GitHub App installation and repository binding APIs.",
                "Add server-backed runtime and agent settings persistence.",
                "Migrate orchestration and workspace policy from the internal service.",
            ],
        }

    @app.get("/api/v1/github/app")
    def github_app_summary() -> dict[str, object]:
        client = require_github_app_client()
        try:
            return client.describe_app()
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/v1/github/installations")
    def github_installations() -> list[dict[str, object]]:
        client = require_github_app_client()
        try:
            return client.list_installations()
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/v1/github/repositories/{owner}/{repo}/binding")
    def github_repository_binding(owner: str, repo: str) -> dict[str, object]:
        client = require_github_app_client()
        try:
            return client.describe_repository_binding(owner, repo)
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.post("/api/v1/github/repositories/{owner}/{repo}/clone-token")
    def github_repository_clone_token(
        owner: str,
        repo: str,
        x_foundry_workspace_bootstrap_secret: str | None = Header(default=None),
    ) -> dict[str, object]:
        require_workspace_bootstrap_secret(x_foundry_workspace_bootstrap_secret)
        client = require_github_app_client()
        try:
            return client.create_repository_clone_token(owner, repo)
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.post("/api/v1/github/webhooks")
    async def github_webhook(
        request: Request,
        x_github_delivery: str | None = Header(default=None),
        x_github_event: str | None = Header(default=None),
        x_hub_signature_256: str | None = Header(default=None),
    ) -> dict[str, object]:
        client = require_github_app_client()
        payload = await request.body()
        if not client.webhook_secret:
            raise HTTPException(
                status_code=503,
                detail="GitHub webhook secret is not configured.",
            )
        if not client.verify_webhook(payload, x_hub_signature_256):
            raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature.")

        action = ""
        if payload:
            try:
                body = json.loads(payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                body = {}
            if isinstance(body, dict):
                action = str(body.get("action", ""))

        return {
            "accepted": True,
            "delivery_id": x_github_delivery or "",
            "event": x_github_event or "",
            "action": action,
        }

    return app


app = create_app()
