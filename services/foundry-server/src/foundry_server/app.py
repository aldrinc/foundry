from __future__ import annotations

import json
import hmac
import sqlite3
import uuid

from fastapi import Body
from fastapi import FastAPI
from fastapi import Header, HTTPException, Request

from .config import AppConfig, load_config
from .decisions import LAUNCH_DECISIONS
from .domain import (
    AgentDefinition,
    GitHubInstallation,
    Organization,
    OrganizationMembership,
    OrganizationRole,
    OrganizationRuntimeSettings,
    OrganizationWorkspacePool,
    RuntimeCredentialOwnership,
    RuntimeHealth,
    RuntimeProvider,
    RuntimeProviderCredential,
)
from .github_app import GitHubAppClient, GitHubAppConfigurationError, GitHubAppRequestError
from .store import FoundryStore


def create_app(config: AppConfig | None = None) -> FastAPI:
    server_config = config or load_config()

    app = FastAPI(
        title="Foundry Server",
        version="0.1.0",
        summary="Product-facing Foundry server scaffold.",
    )
    app.state.config = server_config
    app.state.store = FoundryStore(server_config.database_path)
    app.state.store.migrate()

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

    def get_store() -> FoundryStore:
        return app.state.store

    def require_organization(organization_id: str) -> Organization:
        organization = get_store().get_organization(organization_id)
        if organization is None:
            raise HTTPException(status_code=404, detail=f"Organization not found: {organization_id}")
        return organization

    def default_runtime_settings(organization_id: str) -> OrganizationRuntimeSettings:
        return OrganizationRuntimeSettings(
            organization_id=organization_id,
            health=RuntimeHealth.UNCONFIGURED,
            default_provider=RuntimeProvider.CODEX,
            default_model="",
            credentials=tuple(
                RuntimeProviderCredential(
                    provider=provider,
                    ownership=RuntimeCredentialOwnership.ORGANIZATION,
                    configured=False,
                )
                for provider in RuntimeProvider
            ),
        )

    def default_workspace_pool(organization_id: str) -> OrganizationWorkspacePool:
        return OrganizationWorkspacePool(
            organization_id=organization_id,
            pool_size=server_config.organization_workspace_pool_size,
            max_concurrent_tasks=server_config.organization_workspace_max_concurrency,
        )

    def serialize_organization(organization: Organization) -> dict[str, object]:
        return {
            "organization_id": organization.organization_id,
            "slug": organization.slug,
            "display_name": organization.display_name,
            "created_by_user_id": organization.created_by_user_id,
            "support_email": organization.support_email,
            "self_host_mode": organization.self_host_mode,
        }

    def serialize_membership(membership: OrganizationMembership) -> dict[str, object]:
        return {
            "organization_id": membership.organization_id,
            "user_id": membership.user_id,
            "roles": [role.value for role in membership.roles],
            "invited_by_user_id": membership.invited_by_user_id,
        }

    def serialize_runtime_settings(settings: OrganizationRuntimeSettings) -> dict[str, object]:
        return {
            "organization_id": settings.organization_id,
            "health": settings.health.value,
            "default_provider": settings.default_provider.value,
            "default_model": settings.default_model,
            "credentials": [
                {
                    "provider": credential.provider.value,
                    "ownership": credential.ownership.value,
                    "configured": credential.configured,
                    "label": credential.label,
                }
                for credential in settings.credentials
            ],
            "agents": [
                {
                    "agent_id": agent.agent_id,
                    "display_name": agent.display_name,
                    "purpose": agent.purpose,
                    "enabled": agent.enabled,
                    "provider_override": agent.provider_override.value if agent.provider_override else None,
                    "model_override": agent.model_override,
                }
                for agent in settings.agents
            ],
        }

    def serialize_workspace_pool(pool: OrganizationWorkspacePool) -> dict[str, object]:
        return {
            "organization_id": pool.organization_id,
            "tenancy": pool.tenancy.value,
            "topology": pool.topology.value,
            "checkout_strategy": pool.checkout_strategy.value,
            "pool_size": pool.pool_size,
            "max_concurrent_tasks": pool.max_concurrent_tasks,
            "repo_mirrors": [
                {
                    "organization_id": mirror.organization_id,
                    "repository_full_name": mirror.repository_full_name,
                    "mirror_path": mirror.mirror_path,
                    "default_branch": mirror.default_branch,
                }
                for mirror in pool.repo_mirrors
            ],
        }

    def serialize_github_installation(installation: GitHubInstallation | None) -> dict[str, object] | None:
        if installation is None:
            return None
        return {
            "organization_id": installation.organization_id,
            "installation_id": installation.installation_id,
            "account_login": installation.account_login,
            "account_type": installation.account_type,
        }

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
                "Bind GitHub App installations to persisted organizations.",
                "Migrate orchestration and workspace policy from the internal service.",
                "Deploy a Foundry-owned Coder control plane on Terraform-managed infrastructure.",
            ],
        }

    @app.get("/api/v1/organizations")
    def list_organizations() -> list[dict[str, object]]:
        return [serialize_organization(item) for item in get_store().list_organizations()]

    @app.post("/api/v1/organizations")
    def create_organization(payload: dict[str, object] = Body(default_factory=dict)) -> dict[str, object]:
        slug = str(payload.get("slug", "")).strip()
        display_name = str(payload.get("display_name", "")).strip()
        created_by_user_id = str(payload.get("created_by_user_id", "")).strip()
        owner_user_id = str(payload.get("owner_user_id", created_by_user_id)).strip()
        support_email = str(payload.get("support_email", server_config.support_email)).strip()
        if not slug or not display_name or not created_by_user_id or not owner_user_id:
            raise HTTPException(
                status_code=400,
                detail="slug, display_name, created_by_user_id, and owner_user_id are required.",
            )

        organization = Organization(
            organization_id=str(payload.get("organization_id", uuid.uuid4())),
            slug=slug,
            display_name=display_name,
            created_by_user_id=created_by_user_id,
            support_email=support_email,
            self_host_mode=bool(payload.get("self_host_mode", False)),
        )
        membership = OrganizationMembership(
            organization_id=organization.organization_id,
            user_id=owner_user_id,
            roles=(
                OrganizationRole.OWNER,
                OrganizationRole.ADMIN,
                OrganizationRole.BILLING_ADMIN,
                OrganizationRole.RUNTIME_ADMIN,
            ),
        )
        runtime_settings = default_runtime_settings(organization.organization_id)
        workspace_pool = default_workspace_pool(organization.organization_id)

        try:
            get_store().create_organization(
                organization=organization,
                owner_membership=membership,
                runtime_settings=runtime_settings,
                workspace_pool=workspace_pool,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Organization slug already exists.") from exc

        return {
            "organization": serialize_organization(organization),
            "owner_membership": serialize_membership(membership),
            "runtime_settings": serialize_runtime_settings(runtime_settings),
            "workspace_pool": serialize_workspace_pool(workspace_pool),
        }

    @app.get("/api/v1/organizations/{organization_id}")
    def organization_detail(organization_id: str) -> dict[str, object]:
        organization = require_organization(organization_id)
        memberships = get_store().list_memberships(organization_id)
        runtime_settings = get_store().get_runtime_settings(organization_id)
        workspace_pool = get_store().get_workspace_pool(organization_id)
        github_installation = get_store().get_github_installation(organization_id)
        return {
            "organization": serialize_organization(organization),
            "memberships": [serialize_membership(item) for item in memberships],
            "runtime_settings": serialize_runtime_settings(runtime_settings) if runtime_settings else None,
            "workspace_pool": serialize_workspace_pool(workspace_pool) if workspace_pool else None,
            "github_installation": serialize_github_installation(github_installation),
        }

    @app.get("/api/v1/organizations/{organization_id}/runtime")
    def organization_runtime_settings(organization_id: str) -> dict[str, object]:
        require_organization(organization_id)
        runtime_settings = get_store().get_runtime_settings(organization_id)
        if runtime_settings is None:
            raise HTTPException(status_code=404, detail="Runtime settings not found.")
        return serialize_runtime_settings(runtime_settings)

    @app.put("/api/v1/organizations/{organization_id}/runtime")
    def update_organization_runtime_settings(
        organization_id: str,
        payload: dict[str, object] = Body(default_factory=dict),
    ) -> dict[str, object]:
        require_organization(organization_id)
        credentials = tuple(
            RuntimeProviderCredential(
                provider=RuntimeProvider(str(item["provider"])),
                ownership=RuntimeCredentialOwnership(str(item.get("ownership", RuntimeCredentialOwnership.ORGANIZATION.value))),
                configured=bool(item.get("configured", False)),
                label=str(item.get("label", "")),
            )
            for item in payload.get("credentials", [])
        )
        agents = tuple(
            AgentDefinition(
                agent_id=str(item["agent_id"]),
                display_name=str(item["display_name"]),
                purpose=str(item["purpose"]),
                enabled=bool(item.get("enabled", True)),
                provider_override=(
                    RuntimeProvider(str(item["provider_override"]))
                    if item.get("provider_override")
                    else None
                ),
                model_override=item.get("model_override"),
            )
            for item in payload.get("agents", [])
        )
        runtime_settings = OrganizationRuntimeSettings(
            organization_id=organization_id,
            health=RuntimeHealth(str(payload.get("health", RuntimeHealth.UNCONFIGURED.value))),
            default_provider=RuntimeProvider(
                str(payload.get("default_provider", RuntimeProvider.CODEX.value))
            ),
            default_model=str(payload.get("default_model", "")),
            credentials=credentials,
            agents=agents,
        )
        get_store().put_runtime_settings(runtime_settings)
        return serialize_runtime_settings(runtime_settings)

    @app.get("/api/v1/organizations/{organization_id}/workspace-pool")
    def organization_workspace_pool(organization_id: str) -> dict[str, object]:
        require_organization(organization_id)
        workspace_pool = get_store().get_workspace_pool(organization_id)
        if workspace_pool is None:
            raise HTTPException(status_code=404, detail="Workspace pool not found.")
        return serialize_workspace_pool(workspace_pool)

    @app.put("/api/v1/organizations/{organization_id}/workspace-pool")
    def update_organization_workspace_pool(
        organization_id: str,
        payload: dict[str, object] = Body(default_factory=dict),
    ) -> dict[str, object]:
        require_organization(organization_id)
        current = get_store().get_workspace_pool(organization_id) or default_workspace_pool(organization_id)
        workspace_pool = OrganizationWorkspacePool(
            organization_id=organization_id,
            pool_size=int(payload.get("pool_size", current.pool_size)),
            max_concurrent_tasks=int(
                payload.get("max_concurrent_tasks", current.max_concurrent_tasks)
            ),
            repo_mirrors=current.repo_mirrors,
        )
        get_store().put_workspace_pool(workspace_pool)
        return serialize_workspace_pool(workspace_pool)

    @app.get("/api/v1/organizations/{organization_id}/github/installation")
    def organization_github_installation(organization_id: str) -> dict[str, object] | None:
        require_organization(organization_id)
        return serialize_github_installation(get_store().get_github_installation(organization_id))

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

    @app.post("/api/v1/organizations/{organization_id}/github/installations/{installation_id}/bind")
    def bind_github_installation(
        organization_id: str,
        installation_id: str,
    ) -> dict[str, object]:
        require_organization(organization_id)
        client = require_github_app_client()
        try:
            installations = client.list_installations()
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        match = next(
            (
                item
                for item in installations
                if str(item.get("id", "")) == installation_id
            ),
            None,
        )
        if match is None:
            raise HTTPException(
                status_code=404,
                detail=f"GitHub App installation not found: {installation_id}",
            )

        installation = GitHubInstallation(
            organization_id=organization_id,
            installation_id=installation_id,
            account_login=str(match.get("account_login", "")),
            account_type=str(match.get("account_type", "")),
        )
        get_store().bind_github_installation(installation)
        return serialize_github_installation(installation) or {}

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
