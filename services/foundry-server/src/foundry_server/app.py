from __future__ import annotations

import json
import hashlib
import hmac
import sqlite3
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

from fastapi import Body
from fastapi import FastAPI
from fastapi import Form, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from .coder_client import CoderClient, CoderConfigurationError, CoderRequestError
from .coder_provisioner_manager import (
    CoderProvisionerManager,
    CoderProvisionerManagerConfigurationError,
    CoderProvisionerManagerError,
)
from .coder_template_publisher import (
    CoderTemplatePublisher,
    CoderTemplatePublisherConfigurationError,
    CoderTemplatePublisherError,
)
from .config import AppConfig, load_config
from .core_client import (
    FoundryCoreClient,
    FoundryCoreConfigurationError,
    FoundryCoreRequestError,
)
from .decisions import LAUNCH_DECISIONS
from .domain import (
    AgentDefinition,
    CoderOrganizationBinding,
    CoreRealmBinding,
    GitHubInstallation,
    OrganizationInvitation,
    Organization,
    OrganizationMembership,
    OrganizationRole,
    OrganizationRuntimeSettings,
    OrganizationWorkspacePool,
    PlatformUser,
    ProvisioningStatus,
    RuntimeCredentialOwnership,
    RuntimeHealth,
    RuntimeProvider,
    RuntimeProviderCredential,
    UserSession,
)
from .github_app import GitHubAppClient, GitHubAppConfigurationError, GitHubAppRequestError
from .inbox_secretary import (
    InboxSecretaryConfigurationError,
    InboxSecretaryRequestError,
    InboxSecretaryService,
    normalize_scope_key,
    reconcile_snapshot_with_feedback,
)
from .local_auth import (
    generate_password_salt,
    generate_session_token,
    hash_password,
    hash_token,
    normalize_email,
    verify_password,
)
from .store import FoundryStore


def create_app(config: AppConfig | None = None) -> FastAPI:
    server_config = config or load_config()
    templates = Jinja2Templates(directory=str(Path(__file__).with_name("templates")))
    session_cookie_name = "foundry_session"

    app = FastAPI(
        title="Foundry Server",
        version="0.1.0",
        summary="Product-facing Foundry server scaffold.",
    )
    app.state.config = server_config
    app.state.store = FoundryStore(server_config.database_path)
    app.state.store.migrate()

    def ensure_bootstrap_admin() -> None:
        if server_config.auth_provider.value != "local_password":
            return
        email = normalize_email(server_config.bootstrap_admin_email)
        password = server_config.bootstrap_admin_password
        if not email or not password:
            return
        existing = app.state.store.get_user_by_email(email)
        user_id = existing.user_id if existing is not None else str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"foundry-bootstrap:{email}")
        )
        salt = generate_password_salt()
        app.state.store.upsert_user(
            PlatformUser(
                user_id=user_id,
                email=email,
                display_name="Foundry Platform Admin",
                password_salt=salt,
                password_hash=hash_password(password, salt),
                is_platform_admin=True,
            )
        )

    ensure_bootstrap_admin()

    def get_github_app_client() -> GitHubAppClient:
        client = getattr(app.state, "github_app_client", None)
        if client is None:
            client = GitHubAppClient.from_config_with_webhook_secret(
                server_config,
                webhook_secret=server_config.github_webhook_secret,
            )
            app.state.github_app_client = client
        return client

    def get_coder_client() -> CoderClient:
        client = getattr(app.state, "coder_client", None)
        if client is None:
            client = CoderClient.from_config(server_config)
            app.state.coder_client = client
        return client

    def get_coder_template_publisher() -> CoderTemplatePublisher:
        publisher = getattr(app.state, "coder_template_publisher", None)
        if publisher is None:
            publisher = CoderTemplatePublisher.from_config(server_config)
            app.state.coder_template_publisher = publisher
        return publisher

    def get_coder_provisioner_manager() -> CoderProvisionerManager:
        manager = getattr(app.state, "coder_provisioner_manager", None)
        if manager is None:
            manager = CoderProvisionerManager.from_config(server_config)
            app.state.coder_provisioner_manager = manager
        return manager

    def get_core_client() -> FoundryCoreClient:
        client = getattr(app.state, "core_client", None)
        if client is None:
            client = FoundryCoreClient.from_config(server_config)
            app.state.core_client = client
        return client

    def require_github_app_client() -> GitHubAppClient:
        try:
            return get_github_app_client()
        except GitHubAppConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    def require_coder_client() -> CoderClient:
        try:
            return get_coder_client()
        except CoderConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    def require_core_client() -> FoundryCoreClient:
        try:
            return get_core_client()
        except FoundryCoreConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    def get_inbox_secretary_service() -> InboxSecretaryService:
        service = getattr(app.state, "inbox_secretary_service", None)
        if service is None:
            service = InboxSecretaryService(server_config)
            app.state.inbox_secretary_service = service
        return service

    def require_inbox_secretary_service() -> InboxSecretaryService:
        try:
            return get_inbox_secretary_service()
        except InboxSecretaryConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    def get_store() -> FoundryStore:
        return app.state.store

    def utc_expiry(days: int) -> str:
        return (datetime.now(UTC) + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    def serialize_user(user: PlatformUser) -> dict[str, object]:
        return {
            "user_id": user.user_id,
            "email": user.email,
            "display_name": user.display_name,
            "is_platform_admin": user.is_platform_admin,
            "active": user.active,
        }

    def create_user_session(user: PlatformUser) -> str:
        token = generate_session_token()
        get_store().create_session(
            UserSession(
                session_id=str(uuid.uuid4()),
                user_id=user.user_id,
                token_hash=hash_token(token),
                expires_at=utc_expiry(server_config.session_max_age_days),
            )
        )
        get_store().touch_user_login(user.user_id)
        return token

    def current_user(request: Request) -> PlatformUser | None:
        token = request.cookies.get(session_cookie_name, "")
        if not token:
            return None
        session = get_store().get_session_by_token_hash(hash_token(token))
        if session is None:
            return None
        return get_store().get_user(session.user_id)

    def require_current_user(request: Request) -> PlatformUser:
        user = current_user(request)
        if user is None:
            raise HTTPException(status_code=401, detail="Authentication required.")
        return user

    def require_platform_admin(request: Request) -> PlatformUser:
        user = require_current_user(request)
        if not user.is_platform_admin:
            raise HTTPException(status_code=403, detail="Platform admin access required.")
        return user

    def html_redirect(target: str, *, session_token: str | None = None) -> RedirectResponse:
        response = RedirectResponse(target, status_code=303)
        if session_token is not None:
            response.set_cookie(
                key=session_cookie_name,
                value=session_token,
                httponly=True,
                secure=server_config.environment.value != "local",
                samesite="lax",
                max_age=server_config.session_max_age_days * 24 * 60 * 60,
            )
        return response

    def role_weight(role: OrganizationRole) -> int:
        weights = {
            OrganizationRole.MEMBER: 0,
            OrganizationRole.RUNTIME_ADMIN: 1,
            OrganizationRole.BILLING_ADMIN: 1,
            OrganizationRole.ADMIN: 2,
            OrganizationRole.OWNER: 3,
        }
        return weights[role]

    def allowed_organizations_for_user(user: PlatformUser) -> list[Organization]:
        if user.is_platform_admin:
            return get_store().list_organizations()
        return get_store().list_organizations_for_user(user.user_id)

    def require_org_access(user: PlatformUser, organization_id: str) -> OrganizationMembership | None:
        if user.is_platform_admin:
            return None
        membership = get_store().get_membership(organization_id, user.user_id)
        if membership is None:
            raise HTTPException(status_code=403, detail="Organization access denied.")
        return membership

    def require_org_role(
        user: PlatformUser,
        organization_id: str,
        minimum_role: OrganizationRole = OrganizationRole.ADMIN,
    ) -> OrganizationMembership | None:
        membership = require_org_access(user, organization_id)
        if membership is None:
            return None
        if max((role_weight(role) for role in membership.roles), default=0) < role_weight(minimum_role):
            raise HTTPException(status_code=403, detail="Organization admin access required.")
        return membership

    def require_org_request_access(
        request: Request,
        organization_id: str,
    ) -> tuple[PlatformUser, OrganizationMembership | None]:
        user = require_current_user(request)
        membership = require_org_access(user, organization_id)
        return user, membership

    def require_org_request_role(
        request: Request,
        organization_id: str,
        minimum_role: OrganizationRole = OrganizationRole.ADMIN,
    ) -> tuple[PlatformUser, OrganizationMembership | None]:
        user = require_current_user(request)
        membership = require_org_role(user, organization_id, minimum_role)
        return user, membership

    def serialize_member_record(membership: OrganizationMembership) -> dict[str, object]:
        user = get_store().get_user(membership.user_id)
        return {
            "organization_id": membership.organization_id,
            "user_id": membership.user_id,
            "roles": [role.value for role in membership.roles],
            "invited_by_user_id": membership.invited_by_user_id,
            "email": user.email if user is not None else "",
            "display_name": user.display_name if user is not None else membership.user_id,
            "is_platform_admin": user.is_platform_admin if user is not None else False,
        }

    def sort_memberships(
        memberships: list[OrganizationMembership],
    ) -> list[OrganizationMembership]:
        def membership_sort_key(membership: OrganizationMembership) -> tuple[int, str]:
            highest_role = max((role_weight(role) for role in membership.roles), default=0)
            user = get_store().get_user(membership.user_id)
            email = user.email if user is not None else membership.user_id
            return (-highest_role, email)

        return sorted(memberships, key=membership_sort_key)

    def serialize_invitation(invitation: OrganizationInvitation) -> dict[str, object]:
        return {
            "invitation_id": invitation.invitation_id,
            "organization_id": invitation.organization_id,
            "email": invitation.email,
            "roles": [role.value for role in invitation.roles],
            "invited_by_user_id": invitation.invited_by_user_id,
            "expires_at": invitation.expires_at,
            "accepted_by_user_id": invitation.accepted_by_user_id,
        }

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

    def serialize_core_binding(binding: CoreRealmBinding | None) -> dict[str, object] | None:
        if binding is None:
            return None
        return {
            "organization_id": binding.organization_id,
            "realm_subdomain": binding.realm_subdomain,
            "realm_url": binding.realm_url,
            "owner_email": binding.owner_email,
            "status": binding.status.value,
            "detail": binding.detail,
        }

    def serialize_coder_binding(
        binding: CoderOrganizationBinding | None,
    ) -> dict[str, object] | None:
        if binding is None:
            return None
        return {
            "organization_id": binding.organization_id,
            "coder_organization_id": binding.coder_organization_id,
            "name": binding.name,
            "display_name": binding.display_name,
            "template_name": binding.template_name,
            "status": binding.status.value,
            "detail": binding.detail,
        }

    def organization_primary_role(membership: OrganizationMembership | None) -> str:
        if membership is None:
            return OrganizationRole.OWNER.value
        highest = max(membership.roles, key=role_weight)
        return highest.value

    def core_realm_key_for_organization(organization: Organization) -> str:
        return server_config.core_realm_key_override or organization.slug

    def sync_core_binding(
        *,
        organization: Organization,
        owner: PlatformUser,
        password: str | None,
        membership: OrganizationMembership | None,
    ) -> CoreRealmBinding | None:
        if not server_config.core_url or not server_config.core_bootstrap_secret_present:
            return None
        current = get_store().get_core_realm_binding(organization.organization_id)
        target_realm_key = core_realm_key_for_organization(organization)
        if not password and current is None:
            binding = CoreRealmBinding(
                organization_id=organization.organization_id,
                realm_subdomain=target_realm_key,
                realm_url="",
                owner_email=owner.email,
                status=ProvisioningStatus.PENDING,
                detail="Owner password is required to bootstrap the initial tenant user.",
            )
            get_store().put_core_realm_binding(binding)
            return binding
        try:
            payload = require_core_client().provision_realm(
                organization_id=organization.organization_id,
                realm_subdomain=target_realm_key,
                realm_name=organization.display_name,
                owner_email=owner.email,
                owner_full_name=owner.display_name,
                owner_password=password,
                role=organization_primary_role(membership),
            )
        except FoundryCoreRequestError as exc:
            binding = CoreRealmBinding(
                organization_id=organization.organization_id,
                realm_subdomain=current.realm_subdomain if current else target_realm_key,
                realm_url=current.realm_url if current else "",
                owner_email=owner.email,
                status=ProvisioningStatus.ERROR,
                detail=exc.detail,
            )
            get_store().put_core_realm_binding(binding)
            return binding

        realm = payload.get("realm", {})
        if not isinstance(realm, dict):
            realm = {}
        binding = CoreRealmBinding(
            organization_id=organization.organization_id,
            realm_subdomain=str(realm.get("string_id", "")).strip() or target_realm_key,
            realm_url=str(realm.get("url", "")),
            owner_email=owner.email,
            status=ProvisioningStatus.READY,
            detail="Realm provisioned and owner synced.",
        )
        get_store().put_core_realm_binding(binding)
        return binding

    def sync_member_to_core(
        *,
        organization: Organization,
        user: PlatformUser,
        password: str,
        membership: OrganizationMembership | None,
    ) -> None:
        if not server_config.core_url or not server_config.core_bootstrap_secret_present:
            return
        binding = get_store().get_core_realm_binding(organization.organization_id)
        if binding is None or binding.status != ProvisioningStatus.READY:
            return
        try:
            require_core_client().sync_member(
                realm_subdomain=binding.realm_subdomain,
                email=user.email,
                full_name=user.display_name,
                password=password,
                role=organization_primary_role(membership),
            )
        except FoundryCoreRequestError:
            return

    def sync_coder_binding(organization: Organization) -> CoderOrganizationBinding | None:
        if not server_config.coder_url or not server_config.coder_api_token_present:
            return None
        try:
            client = require_coder_client()
            organizations = client.list_organizations()
        except CoderRequestError as exc:
            binding = CoderOrganizationBinding(
                organization_id=organization.organization_id,
                coder_organization_id="",
                name=organization.slug,
                display_name=organization.display_name,
                status=ProvisioningStatus.ERROR,
                detail=exc.detail,
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        existing = next(
            (item for item in organizations if item["name"] == organization.slug),
            None,
        )
        if existing is not None:
            binding = CoderOrganizationBinding(
                organization_id=organization.organization_id,
                coder_organization_id=str(existing["id"]),
                name=str(existing["name"]),
                display_name=str(existing["display_name"] or organization.display_name),
                status=ProvisioningStatus.PENDING,
                detail="Coder organization already exists.",
            )
        else:
            try:
                created = client.create_organization(organization.slug, organization.display_name)
                binding = CoderOrganizationBinding(
                    organization_id=organization.organization_id,
                    coder_organization_id=str(created["id"]),
                    name=str(created["name"]),
                    display_name=str(created["display_name"] or organization.display_name),
                    status=ProvisioningStatus.PENDING,
                    detail="Coder organization provisioned.",
                )
            except CoderRequestError as exc:
                status = ProvisioningStatus.BLOCKED if exc.status_code == 403 else ProvisioningStatus.ERROR
                binding = CoderOrganizationBinding(
                    organization_id=organization.organization_id,
                    coder_organization_id="",
                    name=organization.slug,
                    display_name=organization.display_name,
                    status=status,
                    detail=exc.detail,
                )
                get_store().put_coder_organization_binding(binding)
                return binding

        try:
            existing_daemons = client.list_provisioner_key_daemons(binding.coder_organization_id)
        except CoderRequestError as exc:
            binding = replace(
                binding,
                status=ProvisioningStatus.ERROR,
                detail=f"Coder organization ready, but provisioner lookup failed. {exc.detail}",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        if not any(item["daemons"] for item in existing_daemons):
            try:
                provisioner_manager = get_coder_provisioner_manager()
            except CoderProvisionerManagerConfigurationError as exc:
                binding = replace(
                    binding,
                    status=ProvisioningStatus.BLOCKED,
                    detail=f"Coder organization ready, but provisioner startup is not configured. {exc}",
                )
                get_store().put_coder_organization_binding(binding)
                return binding

            try:
                provisioner_manager.ensure_organization_provisioner(
                    organization_id=binding.coder_organization_id,
                    organization_name=binding.name,
                )
            except CoderProvisionerManagerError as exc:
                binding = replace(
                    binding,
                    status=ProvisioningStatus.ERROR,
                    detail=f"Coder organization ready, but provisioner startup failed. {exc}",
                )
                get_store().put_coder_organization_binding(binding)
                return binding

        try:
            existing_template = client.get_template(binding.name, binding.template_name)
        except CoderRequestError as exc:
            binding = replace(
                binding,
                status=ProvisioningStatus.ERROR,
                detail=f"Coder organization ready, but template lookup failed. {exc.detail}",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        if existing_template is not None:
            binding = replace(
                binding,
                status=ProvisioningStatus.READY,
                detail="Coder organization, provisioner, and template already exist.",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        try:
            publisher = get_coder_template_publisher()
        except CoderTemplatePublisherConfigurationError as exc:
            binding = replace(
                binding,
                status=ProvisioningStatus.BLOCKED,
                detail=f"Coder organization ready, but template publishing is not configured. {exc}",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        try:
            publisher.publish_to_organization(binding.name)
        except CoderTemplatePublisherError as exc:
            binding = replace(
                binding,
                status=ProvisioningStatus.ERROR,
                detail=f"Coder organization ready, but template publication failed. {exc}",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        try:
            existing_template = client.get_template(binding.name, binding.template_name)
        except CoderRequestError as exc:
            binding = replace(
                binding,
                status=ProvisioningStatus.ERROR,
                detail=f"Coder organization ready, but template verification failed. {exc.detail}",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        if existing_template is None:
            binding = replace(
                binding,
                status=ProvisioningStatus.ERROR,
                detail="Coder organization ready, but the managed template was not visible after publication.",
            )
            get_store().put_coder_organization_binding(binding)
            return binding

        binding = replace(
            binding,
            status=ProvisioningStatus.READY,
            detail="Coder organization, provisioner, and template ready.",
        )
        get_store().put_coder_organization_binding(binding)
        return binding

    def sync_organization_bindings(
        *,
        organization: Organization,
        owner: PlatformUser,
        password: str | None,
        membership: OrganizationMembership | None,
    ) -> tuple[CoreRealmBinding | None, CoderOrganizationBinding | None]:
        return (
            sync_core_binding(
                organization=organization,
                owner=owner,
                password=password,
                membership=membership,
            ),
            sync_coder_binding(organization),
        )

    def require_workspace_bootstrap_token(
        owner: str,
        repo: str,
        provided_token: str | None,
    ) -> None:
        expected_secret = server_config.workspace_bootstrap_secret
        if not expected_secret:
            raise HTTPException(
                status_code=503,
                detail="Workspace bootstrap secret is not configured.",
            )
        repo_identity = f"{owner.strip().lower()}/{repo.strip().lower()}"
        expected_token = hashlib.sha256(
            f"{expected_secret}:{repo_identity}".encode("utf-8")
        ).hexdigest()
        if not provided_token or not hmac.compare_digest(provided_token, expected_token):
            raise HTTPException(status_code=401, detail="Invalid workspace bootstrap token.")

    def require_local_password_auth() -> None:
        if server_config.auth_provider.value != "local_password":
            raise HTTPException(
                status_code=503,
                detail="Local password auth is not enabled for this environment.",
            )

    def coerce_required_text(payload: dict[str, object], key: str) -> str:
        value = payload.get(key)
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                return normalized
        raise HTTPException(status_code=400, detail=f"Missing required field: {key}")

    def coerce_optional_text(payload: dict[str, object], key: str) -> str:
        value = payload.get(key)
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()

    def coerce_optional_int(payload: dict[str, object], key: str) -> int | None:
        value = payload.get(key)
        if value is None or value == "":
            return None
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid integer field: {key}") from exc

    def secretary_timestamp() -> str:
        return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    def create_secretary_turn(role: str, text: str) -> dict[str, object]:
        return {
            "turn_id": str(uuid.uuid4()),
            "role": role,
            "text": text.strip(),
            "created_at": secretary_timestamp(),
        }

    def empty_secretary_session(*, scope_key: str, realm_url: str, user_email: str) -> dict[str, object]:
        return {
            "session_id": str(uuid.uuid4()),
            "scope_key": scope_key,
            "realm_url": realm_url,
            "user_email": user_email,
            "turns": [],
            "snapshot": None,
            "feedback": [],
        }

    def ensure_secretary_session(
        *,
        scope_key: str,
        realm_url: str,
        user_email: str,
    ) -> dict[str, object]:
        session = get_store().get_inbox_secretary_session(scope_key)
        if session is not None:
            return session
        session = empty_secretary_session(
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
        )
        get_store().put_inbox_secretary_session(
            session_id=str(session["session_id"]),
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
            turns=list(session["turns"]),
            snapshot=session["snapshot"],
            feedback=list(session["feedback"]),
        )
        return session

    def trim_secretary_history(items: list[dict[str, object]], *, limit: int) -> list[dict[str, object]]:
        if len(items) <= limit:
            return items
        return items[-limit:]

    def secretary_feedback_label(session: dict[str, object], *, item_key: str) -> str:
        item = secretary_snapshot_item(session, item_key=item_key)
        if item is None:
            return "item"
        title = str(item.get("title") or "").strip()
        return title or "item"

    def secretary_snapshot_item(session: dict[str, object], *, item_key: str) -> dict[str, object] | None:
        snapshot = session.get("snapshot")
        if not isinstance(snapshot, dict):
            return None
        for bucket in ("priorities", "unclear"):
            raw_items = snapshot.get(bucket, [])
            if not isinstance(raw_items, list):
                continue
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                candidate_keys = {
                    str(item.get("external_key") or "").strip(),
                    str(item.get("conversation_key") or "").strip(),
                }
                if item_key in candidate_keys:
                    return item
        return None

    def secretary_feedback_reply(action: str, *, label: str) -> str:
        if action == "done":
            return f"Recorded \"{label}\" as done. I’ll keep it closed unless newer evidence reopens it."
        if action == "waiting":
            return f"Recorded \"{label}\" as waiting. I’ll keep it in a waiting state until newer activity changes it."
        if action == "not_mine":
            return f"Recorded \"{label}\" as not yours. I won’t surface it again unless newer evidence makes it relevant."
        return f"Recorded feedback for \"{label}\"."

    def serialize_secretary_run(run: dict[str, object] | None) -> dict[str, object] | None:
        if run is None:
            return None
        raw_traces = run.get("tool_traces", [])
        tool_traces: list[dict[str, object]] = []
        if isinstance(raw_traces, list):
            for raw_trace in raw_traces:
                if not isinstance(raw_trace, dict):
                    continue
                tool_traces.append(
                    {
                        "tool_name": str(raw_trace.get("tool_name", "")),
                        "input": json.dumps(raw_trace.get("input", {}), ensure_ascii=True),
                        "result": json.dumps(raw_trace.get("result", {}), ensure_ascii=True),
                        "status": str(raw_trace.get("status", "")),
                        "duration_ms": int(raw_trace.get("duration_ms", 0) or 0),
                    }
                )
        return {
            "run_id": run["run_id"],
            "model": run["model"],
            "prompt_version": run["prompt_version"],
            "assistant_reply": run["assistant_reply"],
            "snapshot": run["snapshot"],
            "tool_traces": tool_traces,
            "created_at": run["created_at"],
        }

    def serialize_secretary_session(session: dict[str, object]) -> dict[str, object]:
        latest_run = get_store().get_latest_inbox_secretary_run(str(session["session_id"]))
        reconciled_snapshot = reconcile_snapshot_with_feedback(
            session["snapshot"] if isinstance(session["snapshot"], dict) else None,
            list(session["feedback"]) if isinstance(session.get("feedback"), list) else [],
        )
        return {
            "session_id": session["session_id"],
            "scope_key": session["scope_key"],
            "realm_url": session["realm_url"],
            "user_email": session["user_email"],
            "turns": session["turns"],
            "snapshot": reconciled_snapshot,
            "feedback": session["feedback"],
            "configured": server_config.anthropic_api_key_present,
            "last_run": serialize_secretary_run(latest_run),
        }

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": "foundry-server",
            "environment": server_config.environment.value,
            "self_host_mode": server_config.self_host_mode,
            "workspace_topology": server_config.workspace_topology.value,
        }

    @app.post("/api/v1/desktop/inbox-secretary/session")
    def inbox_secretary_session(payload: dict[str, object] = Body(...)) -> dict[str, object]:
        org_key = coerce_required_text(payload, "org_key")
        realm_url = coerce_required_text(payload, "realm_url")
        user_email = coerce_required_text(payload, "user_email")
        scope_key = normalize_scope_key(org_key, user_email)
        session = ensure_secretary_session(
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
        )
        return serialize_secretary_session(session)

    @app.post("/api/v1/desktop/inbox-secretary/chat")
    def inbox_secretary_chat(payload: dict[str, object] = Body(...)) -> dict[str, object]:
        org_key = coerce_required_text(payload, "org_key")
        realm_url = coerce_required_text(payload, "realm_url")
        user_email = coerce_required_text(payload, "user_email")
        api_key = coerce_required_text(payload, "api_key")
        message = coerce_required_text(payload, "message")
        current_user_id = coerce_optional_int(payload, "current_user_id")
        scope_key = normalize_scope_key(org_key, user_email)
        session = ensure_secretary_session(
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
        )

        try:
            result = require_inbox_secretary_service().run_turn(
                realm_url=realm_url,
                user_email=user_email,
                api_key=api_key,
                current_user_id=current_user_id,
                prior_turns=list(session["turns"]),
                feedback=list(session["feedback"]),
                message=message,
            )
        except InboxSecretaryRequestError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        turns = trim_secretary_history(
            list(session["turns"])
            + [
                create_secretary_turn("user", message),
                create_secretary_turn("assistant", str(result["reply"])),
            ],
            limit=40,
        )
        updated_session = {
            **session,
            "realm_url": realm_url,
            "user_email": user_email,
            "turns": turns,
            "snapshot": reconcile_snapshot_with_feedback(
                result["snapshot"] if isinstance(result["snapshot"], dict) else None,
                list(session["feedback"]),
            ),
            "feedback": list(session["feedback"]),
        }
        get_store().put_inbox_secretary_session(
            session_id=str(updated_session["session_id"]),
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
            turns=turns,
            snapshot=result["snapshot"] if isinstance(result["snapshot"], dict) else None,
            feedback=list(session["feedback"]),
        )
        get_store().create_inbox_secretary_run(
            run_id=str(uuid.uuid4()),
            session_id=str(updated_session["session_id"]),
            model=str(result["model"]),
            prompt_version=str(result["prompt_version"]),
            user_message=message,
            assistant_reply=str(result["reply"]),
            snapshot=result["snapshot"] if isinstance(result["snapshot"], dict) else None,
            tool_traces=list(result["tool_traces"]) if isinstance(result["tool_traces"], list) else [],
        )
        return serialize_secretary_session(updated_session)

    @app.post("/api/v1/desktop/inbox-secretary/feedback")
    def inbox_secretary_feedback(payload: dict[str, object] = Body(...)) -> dict[str, object]:
        org_key = coerce_required_text(payload, "org_key")
        realm_url = coerce_required_text(payload, "realm_url")
        user_email = coerce_required_text(payload, "user_email")
        item_key = coerce_required_text(payload, "item_key")
        conversation_key = coerce_optional_text(payload, "conversation_key")
        action = coerce_required_text(payload, "action").lower()
        note = coerce_optional_text(payload, "note")
        if action not in {"done", "not_mine", "waiting", "dismissed"}:
            raise HTTPException(status_code=400, detail=f"Unsupported feedback action: {action}")

        scope_key = normalize_scope_key(org_key, user_email)
        session = ensure_secretary_session(
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
        )
        existing_item = secretary_snapshot_item(session, item_key=item_key)
        item_label = secretary_feedback_label(session, item_key=item_key)
        feedback_entry = {
            "feedback_id": str(uuid.uuid4()),
            "item_key": item_key,
            "conversation_key": conversation_key or "",
            "evidence_key": (
                str(existing_item.get("evidence_key", "")).strip()
                if isinstance(existing_item, dict)
                else ""
            ),
            "action": action,
            "note": note,
            "created_at": secretary_timestamp(),
        }
        updated_feedback = trim_secretary_history(
            list(session["feedback"]) + [feedback_entry],
            limit=40,
        )
        updated_turns = trim_secretary_history(
            list(session["turns"])
            + [
                create_secretary_turn("user", f'Feedback: marked "{item_label}" as {action}.'),
                create_secretary_turn("assistant", secretary_feedback_reply(action, label=item_label)),
            ],
            limit=40,
        )
        updated_session = {
            **session,
            "realm_url": realm_url,
            "user_email": user_email,
            "turns": updated_turns,
            "feedback": updated_feedback,
            "snapshot": reconcile_snapshot_with_feedback(
                session["snapshot"] if isinstance(session["snapshot"], dict) else None,
                updated_feedback,
            ),
        }
        get_store().put_inbox_secretary_session(
            session_id=str(updated_session["session_id"]),
            scope_key=scope_key,
            realm_url=realm_url,
            user_email=user_email,
            turns=list(updated_session["turns"]),
            snapshot=updated_session["snapshot"] if isinstance(updated_session["snapshot"], dict) else None,
            feedback=list(updated_session["feedback"]),
        )
        return serialize_secretary_session(updated_session)

    @app.get("/api/v1/meta/launch-decisions")
    def launch_decisions(request: Request) -> dict[str, object]:
        require_platform_admin(request)
        return LAUNCH_DECISIONS.to_dict()

    @app.get("/api/v1/meta/bootstrap")
    def bootstrap_summary(request: Request) -> dict[str, object]:
        require_platform_admin(request)
        return {
            "service": "foundry-server",
            "config": server_config.admin_summary(),
            "launch_decisions": LAUNCH_DECISIONS.to_dict(),
            "next_steps": [
                "Add OIDC-backed hosted auth and self-host bootstrap auth.",
                "Bind GitHub App installations to persisted organizations.",
                "Migrate orchestration and workspace policy from the internal service.",
                "Drive the Foundry-owned Coder template and workspace lifecycle from this API.",
            ],
        }

    @app.get("/", response_class=HTMLResponse)
    def cloud_home(request: Request) -> RedirectResponse:
        user = current_user(request)
        if user is None:
            return RedirectResponse("/login", status_code=303)
        return RedirectResponse("/cloud", status_code=303)

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request, error: str = "") -> HTMLResponse:
        return templates.TemplateResponse(
            request,
            "login.html",
            {
                "request": request,
                "title": "Foundry Cloud Login",
                "error": error,
                "auth_provider": server_config.auth_provider.value,
            },
        )

    @app.post("/login", response_model=None)
    async def login_submit(
        request: Request,
        email: str = Form(...),
        password: str = Form(...),
    ) -> HTMLResponse | RedirectResponse:
        require_local_password_auth()
        normalized_email = normalize_email(email)
        user = get_store().get_user_by_email(normalized_email)
        if (
            user is None
            or not user.active
            or not user.password_salt
            or not user.password_hash
            or not verify_password(password, user.password_salt, user.password_hash)
        ):
            return templates.TemplateResponse(
                request,
                "login.html",
                {
                    "request": request,
                    "title": "Foundry Cloud Login",
                    "error": "Invalid email or password.",
                    "auth_provider": server_config.auth_provider.value,
                },
                status_code=400,
            )

        return html_redirect("/cloud", session_token=create_user_session(user))

    @app.post("/logout")
    def logout_submit(request: Request) -> RedirectResponse:
        token = request.cookies.get(session_cookie_name, "")
        if token:
            get_store().delete_session_by_token_hash(hash_token(token))
        response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(session_cookie_name)
        return response

    @app.get("/signup", response_class=HTMLResponse)
    def signup_page(request: Request, error: str = "") -> HTMLResponse:
        return templates.TemplateResponse(
            request,
            "signup.html",
            {
                "request": request,
                "title": "Create Foundry Organization",
                "error": error,
            },
        )

    @app.post("/signup", response_model=None)
    async def signup_submit(
        request: Request,
        display_name: str = Form(...),
        email: str = Form(...),
        password: str = Form(...),
        organization_name: str = Form(...),
        organization_slug: str = Form(...),
    ) -> HTMLResponse | RedirectResponse:
        require_local_password_auth()
        normalized_email = normalize_email(email)
        if get_store().get_user_by_email(normalized_email) is not None:
            return templates.TemplateResponse(
                request,
                "signup.html",
                {
                    "request": request,
                    "title": "Create Foundry Organization",
                    "error": "An account with that email already exists.",
                },
                status_code=400,
            )
        if get_store().get_organization_by_slug(organization_slug.strip()) is not None:
            return templates.TemplateResponse(
                request,
                "signup.html",
                {
                    "request": request,
                    "title": "Create Foundry Organization",
                    "error": "That organization slug is already in use.",
                },
                status_code=400,
            )

        user = PlatformUser(
            user_id=str(uuid.uuid4()),
            email=normalized_email,
            display_name=display_name.strip() or normalized_email,
            password_salt=generate_password_salt(),
            password_hash="",
        )
        user = PlatformUser(
            user_id=user.user_id,
            email=user.email,
            display_name=user.display_name,
            password_salt=user.password_salt,
            password_hash=hash_password(password, user.password_salt),
            is_platform_admin=False,
        )
        get_store().upsert_user(user)

        organization = Organization(
            organization_id=str(uuid.uuid4()),
            slug=organization_slug.strip(),
            display_name=organization_name.strip(),
            created_by_user_id=user.user_id,
            support_email=normalized_email,
        )
        membership = OrganizationMembership(
            organization_id=organization.organization_id,
            user_id=user.user_id,
            roles=(
                OrganizationRole.OWNER,
                OrganizationRole.ADMIN,
                OrganizationRole.BILLING_ADMIN,
                OrganizationRole.RUNTIME_ADMIN,
            ),
        )
        try:
            get_store().create_organization(
                organization=organization,
                owner_membership=membership,
                runtime_settings=default_runtime_settings(organization.organization_id),
                workspace_pool=default_workspace_pool(organization.organization_id),
            )
        except sqlite3.IntegrityError:
            return templates.TemplateResponse(
                request,
                "signup.html",
                {
                    "request": request,
                    "title": "Create Foundry Organization",
                    "error": "That organization slug is already in use.",
                },
                status_code=400,
            )

        sync_organization_bindings(
            organization=organization,
            owner=user,
            password=password,
            membership=membership,
        )
        return html_redirect(f"/cloud/organizations/{organization.organization_id}", session_token=create_user_session(user))

    @app.get("/cloud", response_class=HTMLResponse)
    def cloud_dashboard(request: Request) -> HTMLResponse:
        user = require_current_user(request)
        organizations = allowed_organizations_for_user(user)
        coder_status: dict[str, object] | None = None
        if user.is_platform_admin and server_config.coder_url and server_config.coder_api_token_present:
            try:
                coder_status = fetch_coder_status()
            except HTTPException:
                coder_status = None
        return templates.TemplateResponse(
            request,
            "dashboard.html",
            {
                "request": request,
                "title": "Foundry Cloud",
                "current_user": serialize_user(user),
                "organizations": [serialize_organization(item) for item in organizations],
                "is_platform_admin": user.is_platform_admin,
                "coder_status": coder_status,
            },
        )

    @app.post("/cloud/organizations", response_model=None)
    async def cloud_create_organization(
        request: Request,
        display_name: str = Form(...),
        slug: str = Form(...),
        support_email: str = Form(""),
        owner_password: str = Form(""),
    ) -> HTMLResponse | RedirectResponse:
        user = require_current_user(request)
        organization = Organization(
            organization_id=str(uuid.uuid4()),
            slug=slug.strip(),
            display_name=display_name.strip(),
            created_by_user_id=user.user_id,
            support_email=support_email.strip() or user.email,
        )
        if get_store().get_organization_by_slug(organization.slug) is not None:
            organizations = allowed_organizations_for_user(user)
            coder_status: dict[str, object] | None = None
            if server_config.coder_url and server_config.coder_api_token_present:
                try:
                    coder_status = coder_status_api()
                except HTTPException:
                    coder_status = None
            return templates.TemplateResponse(
                request,
                "dashboard.html",
                {
                    "request": request,
                    "title": "Foundry Cloud",
                    "current_user": serialize_user(user),
                    "organizations": [serialize_organization(item) for item in organizations],
                    "is_platform_admin": user.is_platform_admin,
                    "coder_status": coder_status,
                    "error": "That organization slug is already in use.",
                },
                status_code=409,
            )
        membership = OrganizationMembership(
            organization_id=organization.organization_id,
            user_id=user.user_id,
            roles=(
                OrganizationRole.OWNER,
                OrganizationRole.ADMIN,
                OrganizationRole.BILLING_ADMIN,
                OrganizationRole.RUNTIME_ADMIN,
            ),
        )
        get_store().create_organization(
            organization=organization,
            owner_membership=membership,
            runtime_settings=default_runtime_settings(organization.organization_id),
            workspace_pool=default_workspace_pool(organization.organization_id),
        )
        sync_organization_bindings(
            organization=organization,
            owner=user,
            password=owner_password.strip() or None,
            membership=membership,
        )
        return RedirectResponse(f"/cloud/organizations/{organization.organization_id}", status_code=303)

    @app.get("/cloud/organizations/{organization_id}", response_class=HTMLResponse)
    def cloud_organization_detail(request: Request, organization_id: str) -> HTMLResponse:
        user = require_current_user(request)
        organization = require_organization(organization_id)
        require_org_access(user, organization_id)
        memberships = get_store().list_memberships(organization_id)
        runtime_settings = get_store().get_runtime_settings(organization_id)
        workspace_pool = get_store().get_workspace_pool(organization_id)
        github_installation = get_store().get_github_installation(organization_id)
        core_binding = get_store().get_core_realm_binding(organization_id)
        coder_binding = get_store().get_coder_organization_binding(organization_id)
        invitations = get_store().list_invitations(organization_id)
        return templates.TemplateResponse(
            request,
            "organization_detail.html",
            {
                "request": request,
                "title": f"{organization.display_name} · Foundry Cloud",
                "current_user": serialize_user(user),
                "organization": serialize_organization(organization),
                "members": [
                    serialize_member_record(item)
                    for item in sort_memberships(memberships)
                ],
                "runtime_settings": serialize_runtime_settings(runtime_settings) if runtime_settings else None,
                "workspace_pool": serialize_workspace_pool(workspace_pool) if workspace_pool else None,
                "github_installation": serialize_github_installation(github_installation),
                "core_binding": serialize_core_binding(core_binding),
                "coder_binding": serialize_coder_binding(coder_binding),
                "invitations": [serialize_invitation(item) for item in invitations],
                "is_platform_admin": user.is_platform_admin,
            },
        )

    @app.post("/cloud/organizations/{organization_id}/provision", response_model=None)
    async def cloud_provision_organization(
        request: Request,
        organization_id: str,
        owner_password: str = Form(""),
    ) -> RedirectResponse:
        user = require_current_user(request)
        organization = require_organization(organization_id)
        membership = require_org_role(user, organization_id, OrganizationRole.ADMIN)
        sync_organization_bindings(
            organization=organization,
            owner=user,
            password=owner_password.strip() or None,
            membership=membership,
        )
        return RedirectResponse(f"/cloud/organizations/{organization_id}", status_code=303)

    @app.post(
        "/cloud/organizations/{organization_id}/invitations",
        response_class=HTMLResponse,
        response_model=None,
    )
    async def cloud_create_invitation(
        request: Request,
        organization_id: str,
        email: str = Form(...),
        role: str = Form(OrganizationRole.MEMBER.value),
    ) -> HTMLResponse:
        user = require_current_user(request)
        organization = require_organization(organization_id)
        require_org_role(user, organization_id, OrganizationRole.ADMIN)
        raw_token = generate_session_token()
        invitation = OrganizationInvitation(
            invitation_id=str(uuid.uuid4()),
            organization_id=organization_id,
            email=normalize_email(email),
            roles=(OrganizationRole(role),),
            invited_by_user_id=user.user_id,
            token_hash=hash_token(raw_token),
            expires_at=utc_expiry(7),
        )
        get_store().create_invitation(invitation)
        memberships = get_store().list_memberships(organization_id)
        runtime_settings = get_store().get_runtime_settings(organization_id)
        workspace_pool = get_store().get_workspace_pool(organization_id)
        github_installation = get_store().get_github_installation(organization_id)
        core_binding = get_store().get_core_realm_binding(organization_id)
        coder_binding = get_store().get_coder_organization_binding(organization_id)
        invitations = get_store().list_invitations(organization_id)
        return templates.TemplateResponse(
            request,
            "organization_detail.html",
            {
                "request": request,
                "title": f"{organization.display_name} · Foundry Cloud",
                "current_user": serialize_user(user),
                "organization": serialize_organization(organization),
                "members": [
                    serialize_member_record(item)
                    for item in sort_memberships(memberships)
                ],
                "runtime_settings": serialize_runtime_settings(runtime_settings) if runtime_settings else None,
                "workspace_pool": serialize_workspace_pool(workspace_pool) if workspace_pool else None,
                "github_installation": serialize_github_installation(github_installation),
                "core_binding": serialize_core_binding(core_binding),
                "coder_binding": serialize_coder_binding(coder_binding),
                "invitations": [serialize_invitation(item) for item in invitations],
                "invite_link": f"{server_config.public_base_url}/cloud/invitations/{raw_token}",
                "is_platform_admin": user.is_platform_admin,
            },
        )

    @app.get("/cloud/invitations/{token}", response_class=HTMLResponse)
    def cloud_invitation_page(request: Request, token: str) -> HTMLResponse:
        invitation = get_store().get_invitation_by_token_hash(hash_token(token))
        if invitation is None:
            raise HTTPException(status_code=404, detail="Invitation not found or expired.")
        organization = require_organization(invitation.organization_id)
        return templates.TemplateResponse(
            request,
            "accept_invitation.html",
            {
                "request": request,
                "title": f"Join {organization.display_name}",
                "organization": serialize_organization(organization),
                "invitation": serialize_invitation(invitation),
                "token": token,
            },
        )

    @app.post("/cloud/invitations/{token}/accept", response_model=None)
    async def cloud_accept_invitation(
        request: Request,
        token: str,
        display_name: str = Form(...),
        password: str = Form(...),
    ) -> HTMLResponse | RedirectResponse:
        require_local_password_auth()
        invitation = get_store().get_invitation_by_token_hash(hash_token(token))
        if invitation is None:
            raise HTTPException(status_code=404, detail="Invitation not found or expired.")

        user = get_store().get_user_by_email(invitation.email)
        if user is None:
            salt = generate_password_salt()
            user = PlatformUser(
                user_id=str(uuid.uuid4()),
                email=invitation.email,
                display_name=display_name.strip() or invitation.email,
                password_salt=salt,
                password_hash=hash_password(password, salt),
            )
            get_store().upsert_user(user)
        else:
            if not verify_password(password, user.password_salt, user.password_hash):
                organization = require_organization(invitation.organization_id)
                return templates.TemplateResponse(
                    request,
                    "accept_invitation.html",
                    {
                        "request": request,
                        "title": f"Join {organization.display_name}",
                        "organization": serialize_organization(organization),
                        "invitation": serialize_invitation(invitation),
                        "token": token,
                        "error": "That password does not match the existing account for this email.",
                    },
                    status_code=400,
                )

        get_store().add_membership(
            OrganizationMembership(
                organization_id=invitation.organization_id,
                user_id=user.user_id,
                roles=invitation.roles,
                invited_by_user_id=invitation.invited_by_user_id,
            )
        )
        get_store().accept_invitation(invitation.invitation_id, user.user_id)
        organization = require_organization(invitation.organization_id)
        sync_member_to_core(
            organization=organization,
            user=user,
            password=password,
            membership=get_store().get_membership(invitation.organization_id, user.user_id),
        )
        return html_redirect(f"/cloud/organizations/{invitation.organization_id}", session_token=create_user_session(user))

    @app.get("/api/v1/cloud/me")
    def cloud_me(request: Request) -> dict[str, object]:
        user = require_current_user(request)
        organizations = allowed_organizations_for_user(user)
        return {
            "user": serialize_user(user),
            "organizations": [serialize_organization(item) for item in organizations],
        }

    @app.get("/api/v1/cloud/organizations")
    def cloud_organizations_api(request: Request) -> list[dict[str, object]]:
        user = require_current_user(request)
        return [serialize_organization(item) for item in allowed_organizations_for_user(user)]

    @app.get("/api/v1/cloud/organizations/{organization_id}")
    def cloud_organization_api(request: Request, organization_id: str) -> dict[str, object]:
        user = require_current_user(request)
        organization = require_organization(organization_id)
        require_org_access(user, organization_id)
        return {
            "organization": serialize_organization(organization),
            "members": [
                serialize_member_record(item)
                for item in sort_memberships(get_store().list_memberships(organization_id))
            ],
            "runtime_settings": serialize_runtime_settings(get_store().get_runtime_settings(organization_id) or default_runtime_settings(organization_id)),
            "workspace_pool": serialize_workspace_pool(get_store().get_workspace_pool(organization_id) or default_workspace_pool(organization_id)),
            "github_installation": serialize_github_installation(get_store().get_github_installation(organization_id)),
            "core_binding": serialize_core_binding(get_store().get_core_realm_binding(organization_id)),
            "coder_binding": serialize_coder_binding(get_store().get_coder_organization_binding(organization_id)),
            "invitations": [serialize_invitation(item) for item in get_store().list_invitations(organization_id)],
        }

    @app.get("/api/v1/organizations")
    def list_organizations(request: Request) -> list[dict[str, object]]:
        user = require_current_user(request)
        return [serialize_organization(item) for item in allowed_organizations_for_user(user)]

    @app.post("/api/v1/organizations")
    def create_organization(
        request: Request,
        payload: dict[str, object] = Body(default_factory=dict),
    ) -> dict[str, object]:
        user = require_current_user(request)
        slug = str(payload.get("slug", "")).strip()
        display_name = str(payload.get("display_name", "")).strip()
        owner_user_id = user.user_id
        if user.is_platform_admin:
            requested_owner_user_id = str(payload.get("owner_user_id", user.user_id)).strip()
            if requested_owner_user_id:
                owner_user_id = requested_owner_user_id
        owner_user = get_store().get_user(owner_user_id)
        support_email = str(payload.get("support_email", user.email or server_config.support_email)).strip()
        if not slug or not display_name:
            raise HTTPException(
                status_code=400,
                detail="slug and display_name are required.",
            )
        if owner_user is None:
            raise HTTPException(status_code=404, detail=f"Owner user not found: {owner_user_id}")

        organization = Organization(
            organization_id=str(payload.get("organization_id", uuid.uuid4())),
            slug=slug,
            display_name=display_name,
            created_by_user_id=user.user_id,
            support_email=support_email,
            self_host_mode=bool(payload.get("self_host_mode", False)) if user.is_platform_admin else False,
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
    def organization_detail(request: Request, organization_id: str) -> dict[str, object]:
        user, _membership = require_org_request_access(request, organization_id)
        organization = require_organization(organization_id)
        memberships = (
            get_store().list_memberships(organization_id)
            if user.is_platform_admin or _membership is not None
            else []
        )
        runtime_settings = get_store().get_runtime_settings(organization_id)
        workspace_pool = get_store().get_workspace_pool(organization_id)
        github_installation = get_store().get_github_installation(organization_id)
        return {
            "organization": serialize_organization(organization),
            "memberships": [serialize_membership(item) for item in memberships],
            "runtime_settings": serialize_runtime_settings(runtime_settings) if runtime_settings else None,
            "workspace_pool": serialize_workspace_pool(workspace_pool) if workspace_pool else None,
            "github_installation": serialize_github_installation(github_installation),
            "core_binding": serialize_core_binding(get_store().get_core_realm_binding(organization_id)),
            "coder_binding": serialize_coder_binding(get_store().get_coder_organization_binding(organization_id)),
        }

    @app.get("/api/v1/organizations/{organization_id}/runtime")
    def organization_runtime_settings(request: Request, organization_id: str) -> dict[str, object]:
        require_org_request_access(request, organization_id)
        require_organization(organization_id)
        runtime_settings = get_store().get_runtime_settings(organization_id)
        if runtime_settings is None:
            raise HTTPException(status_code=404, detail="Runtime settings not found.")
        return serialize_runtime_settings(runtime_settings)

    @app.put("/api/v1/organizations/{organization_id}/runtime")
    def update_organization_runtime_settings(
        request: Request,
        organization_id: str,
        payload: dict[str, object] = Body(default_factory=dict),
    ) -> dict[str, object]:
        require_org_request_role(request, organization_id, OrganizationRole.RUNTIME_ADMIN)
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
    def organization_workspace_pool(request: Request, organization_id: str) -> dict[str, object]:
        require_org_request_access(request, organization_id)
        require_organization(organization_id)
        workspace_pool = get_store().get_workspace_pool(organization_id)
        if workspace_pool is None:
            raise HTTPException(status_code=404, detail="Workspace pool not found.")
        return serialize_workspace_pool(workspace_pool)

    @app.put("/api/v1/organizations/{organization_id}/workspace-pool")
    def update_organization_workspace_pool(
        request: Request,
        organization_id: str,
        payload: dict[str, object] = Body(default_factory=dict),
    ) -> dict[str, object]:
        require_org_request_role(request, organization_id, OrganizationRole.ADMIN)
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
    def organization_github_installation(
        request: Request,
        organization_id: str,
    ) -> dict[str, object] | None:
        require_org_request_access(request, organization_id)
        require_organization(organization_id)
        return serialize_github_installation(get_store().get_github_installation(organization_id))

    def fetch_github_app_summary() -> dict[str, object]:
        client = require_github_app_client()
        try:
            return client.describe_app()
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/v1/github/app")
    def github_app_summary(request: Request) -> dict[str, object]:
        require_platform_admin(request)
        return fetch_github_app_summary()

    def fetch_github_installations() -> list[dict[str, object]]:
        client = require_github_app_client()
        try:
            return client.list_installations()
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/v1/github/installations")
    def github_installations(request: Request) -> list[dict[str, object]]:
        require_platform_admin(request)
        return fetch_github_installations()

    def fetch_coder_status() -> dict[str, object]:
        client = require_coder_client()
        try:
            build_info = client.build_info()
            templates = client.list_templates()
            workspaces = client.list_workspaces()
        except CoderRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        return {
            "configured": True,
            "url": server_config.coder_url,
            "build": build_info,
            "template_count": len(templates),
            "workspace_count": len(workspaces),
            "healthy_workspace_count": sum(1 for item in workspaces if item["healthy"]),
        }

    @app.get("/api/v1/coder/status")
    def coder_status_api(request: Request) -> dict[str, object]:
        require_platform_admin(request)
        return fetch_coder_status()

    def fetch_coder_templates() -> list[dict[str, object]]:
        client = require_coder_client()
        try:
            return client.list_templates()
        except CoderRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/v1/coder/templates")
    def coder_templates(request: Request) -> list[dict[str, object]]:
        require_platform_admin(request)
        return fetch_coder_templates()

    def fetch_coder_workspaces() -> list[dict[str, object]]:
        client = require_coder_client()
        try:
            return client.list_workspaces()
        except CoderRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.get("/api/v1/coder/workspaces")
    def coder_workspaces(request: Request) -> list[dict[str, object]]:
        require_platform_admin(request)
        return fetch_coder_workspaces()

    @app.post("/api/v1/organizations/{organization_id}/github/installations/{installation_id}/bind")
    def bind_github_installation(
        request: Request,
        organization_id: str,
        installation_id: str,
    ) -> dict[str, object]:
        require_org_request_role(request, organization_id, OrganizationRole.ADMIN)
        require_organization(organization_id)
        installations = fetch_github_installations()

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
    def github_repository_binding(request: Request, owner: str, repo: str) -> dict[str, object]:
        require_platform_admin(request)
        client = require_github_app_client()
        try:
            return client.describe_repository_binding(owner, repo)
        except GitHubAppRequestError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    @app.post("/api/v1/github/repositories/{owner}/{repo}/clone-token")
    def github_repository_clone_token(
        owner: str,
        repo: str,
        x_foundry_workspace_bootstrap_token: str | None = Header(default=None),
    ) -> dict[str, object]:
        require_workspace_bootstrap_token(owner, repo, x_foundry_workspace_bootstrap_token)
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
