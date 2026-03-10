from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum
from typing import Mapping

from .decisions import LAUNCH_DECISIONS


class DeploymentEnvironment(StrEnum):
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"


class AuthProvider(StrEnum):
    OIDC = "oidc"
    LOCAL_PASSWORD = "local_password"


class WorkspaceTopology(StrEnum):
    ORGANIZATION_POOLED = "organization_pooled"


def _env_bool(env: Mapping[str, str], key: str, default: bool) -> bool:
    raw = env.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "y"}


def _env_int(env: Mapping[str, str], key: str, default: int) -> int:
    raw = env.get(key)
    if raw is None or not raw.strip():
        return default
    return int(raw)


@dataclass(frozen=True)
class AppConfig:
    environment: DeploymentEnvironment
    host: str
    port: int
    public_base_url: str
    api_base_url: str
    support_email: str
    database_path: str
    self_host_mode: bool
    auth_provider: AuthProvider
    oidc_issuer_url: str
    oidc_audience: str
    oidc_client_id: str
    bootstrap_admin_email: str
    bootstrap_admin_password: str
    bootstrap_admin_password_present: bool
    core_url: str
    core_bootstrap_secret: str
    core_bootstrap_secret_present: bool
    github_app_name: str
    github_api_url: str
    github_app_id: str
    github_client_id: str
    github_app_private_key_path: str
    github_app_private_key_present: bool
    github_webhook_secret: str
    github_webhook_secret_present: bool
    coder_url: str
    coder_api_token: str
    coder_api_token_present: bool
    coder_container_name: str
    coder_template_name: str
    coder_template_source_dir: str
    coder_internal_url: str
    coder_provisioner_container_prefix: str
    coder_provisioner_key_dir: str
    coder_provisioner_cache_dir: str
    coder_provisioner_startup_timeout_seconds: int
    hcloud_token: str
    hcloud_token_present: bool
    workspace_private_network_id: str
    workspace_firewall_ids: str
    workspace_ssh_key_ids: str
    workspace_bootstrap_secret: str
    workspace_bootstrap_secret_present: bool
    stripe_secret_key_present: bool
    stripe_webhook_secret_present: bool
    workspace_topology: WorkspaceTopology
    organization_workspace_pool_size: int
    organization_workspace_max_concurrency: int
    session_max_age_days: int

    def public_summary(self) -> dict[str, object]:
        return {
            "environment": self.environment.value,
            "host": self.host,
            "port": self.port,
            "public_base_url": self.public_base_url,
            "api_base_url": self.api_base_url,
            "support_email": self.support_email,
            "self_host_mode": self.self_host_mode,
            "auth_provider": self.auth_provider.value,
            "oidc_configured": bool(
                self.oidc_issuer_url and self.oidc_audience and self.oidc_client_id
            ),
            "bootstrap_admin_email": self.bootstrap_admin_email,
            "bootstrap_admin_password_present": self.bootstrap_admin_password_present,
            "core_url": self.core_url,
            "core_bootstrap_secret_present": self.core_bootstrap_secret_present,
            "github_app_name": self.github_app_name,
            "github_api_url": self.github_api_url,
            "github_app_configured": bool(
                self.github_app_id
                and self.github_client_id
                and self.github_app_private_key_present
            ),
            "github_app_private_key_present": self.github_app_private_key_present,
            "github_webhook_secret_present": self.github_webhook_secret_present,
            "coder_url": self.coder_url,
            "coder_configured": bool(self.coder_url and self.coder_api_token_present),
            "coder_api_token_present": self.coder_api_token_present,
            "coder_container_name": self.coder_container_name,
            "coder_template_name": self.coder_template_name,
            "coder_template_source_dir": self.coder_template_source_dir,
            "coder_internal_url": self.coder_internal_url,
            "coder_provisioner_container_prefix": self.coder_provisioner_container_prefix,
            "coder_provisioner_key_dir": self.coder_provisioner_key_dir,
            "coder_provisioner_cache_dir": self.coder_provisioner_cache_dir,
            "coder_provisioner_startup_timeout_seconds": self.coder_provisioner_startup_timeout_seconds,
            "hcloud_token_present": self.hcloud_token_present,
            "workspace_private_network_id": self.workspace_private_network_id,
            "workspace_firewall_ids": self.workspace_firewall_ids,
            "workspace_ssh_key_ids": self.workspace_ssh_key_ids,
            "workspace_bootstrap_secret_present": self.workspace_bootstrap_secret_present,
            "stripe_configured": self.stripe_secret_key_present,
            "stripe_webhook_secret_present": self.stripe_webhook_secret_present,
            "workspace_topology": self.workspace_topology.value,
            "organization_workspace_pool_size": self.organization_workspace_pool_size,
            "organization_workspace_max_concurrency": self.organization_workspace_max_concurrency,
            "session_max_age_days": self.session_max_age_days,
        }


def load_config(env: Mapping[str, str] | None = None) -> AppConfig:
    source = env if env is not None else os.environ
    return AppConfig(
        environment=DeploymentEnvironment(
            source.get("FOUNDRY_ENVIRONMENT", DeploymentEnvironment.LOCAL.value)
        ),
        host=source.get("FOUNDRY_HOST", "127.0.0.1"),
        port=_env_int(source, "FOUNDRY_PORT", 8090),
        public_base_url=source.get("FOUNDRY_PUBLIC_BASE_URL", "http://127.0.0.1:8090"),
        api_base_url=source.get("FOUNDRY_API_BASE_URL", "http://127.0.0.1:8090"),
        support_email=source.get("FOUNDRY_SUPPORT_EMAIL", "support@example.com"),
        database_path=source.get(
            "FOUNDRY_DATABASE_PATH",
            "./data/foundry-server.db",
        ),
        self_host_mode=_env_bool(source, "FOUNDRY_SELF_HOST_MODE", False),
        auth_provider=AuthProvider(
            source.get("FOUNDRY_AUTH_PROVIDER", AuthProvider.OIDC.value)
        ),
        oidc_issuer_url=source.get("FOUNDRY_OIDC_ISSUER_URL", ""),
        oidc_audience=source.get("FOUNDRY_OIDC_AUDIENCE", ""),
        oidc_client_id=source.get("FOUNDRY_OIDC_CLIENT_ID", ""),
        bootstrap_admin_email=source.get("FOUNDRY_BOOTSTRAP_ADMIN_EMAIL", ""),
        bootstrap_admin_password=source.get("FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD", ""),
        bootstrap_admin_password_present=bool(
            source.get("FOUNDRY_BOOTSTRAP_ADMIN_PASSWORD", "").strip()
        ),
        core_url=source.get("FOUNDRY_CORE_URL", "").rstrip("/"),
        core_bootstrap_secret=source.get("FOUNDRY_CORE_BOOTSTRAP_SECRET", ""),
        core_bootstrap_secret_present=bool(
            source.get("FOUNDRY_CORE_BOOTSTRAP_SECRET", "").strip()
        ),
        github_app_name=source.get("FOUNDRY_GITHUB_APP_NAME", "Foundry"),
        github_api_url=source.get("FOUNDRY_GITHUB_API_URL", "https://api.github.com"),
        github_app_id=source.get("FOUNDRY_GITHUB_APP_ID", ""),
        github_client_id=source.get("FOUNDRY_GITHUB_CLIENT_ID", ""),
        github_app_private_key_path=source.get("FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH", ""),
        github_app_private_key_present=bool(
            source.get("FOUNDRY_GITHUB_APP_PRIVATE_KEY_PATH", "").strip()
        ),
        github_webhook_secret=source.get("FOUNDRY_GITHUB_WEBHOOK_SECRET", ""),
        github_webhook_secret_present=bool(
            source.get("FOUNDRY_GITHUB_WEBHOOK_SECRET", "").strip()
        ),
        coder_url=source.get("FOUNDRY_CODER_URL", "").rstrip("/"),
        coder_api_token=source.get("FOUNDRY_CODER_API_TOKEN", ""),
        coder_api_token_present=bool(source.get("FOUNDRY_CODER_API_TOKEN", "").strip()),
        coder_container_name=source.get("FOUNDRY_CODER_CONTAINER_NAME", "foundry-coder"),
        coder_template_name=source.get(
            "FOUNDRY_CODER_TEMPLATE_NAME", "foundry-hetzner-workspace"
        ),
        coder_template_source_dir=source.get(
            "FOUNDRY_CODER_TEMPLATE_SOURCE_DIR",
            "/opt/foundry/coder-templates/foundry-hetzner-workspace",
        ),
        coder_internal_url=source.get(
            "FOUNDRY_CODER_INTERNAL_URL", "http://127.0.0.1:7080"
        ),
        coder_provisioner_container_prefix=source.get(
            "FOUNDRY_CODER_PROVISIONER_CONTAINER_PREFIX",
            "foundry-provisionerd",
        ),
        coder_provisioner_key_dir=source.get(
            "FOUNDRY_CODER_PROVISIONER_KEY_DIR",
            "./data/coder-provisioner-keys",
        ),
        coder_provisioner_cache_dir=source.get(
            "FOUNDRY_CODER_PROVISIONER_CACHE_DIR",
            "./data/coder-provisioner-cache",
        ),
        coder_provisioner_startup_timeout_seconds=_env_int(
            source, "FOUNDRY_CODER_PROVISIONER_STARTUP_TIMEOUT_SECONDS", 60
        ),
        hcloud_token=source.get("FOUNDRY_HCLOUD_TOKEN", ""),
        hcloud_token_present=bool(source.get("FOUNDRY_HCLOUD_TOKEN", "").strip()),
        workspace_private_network_id=source.get(
            "FOUNDRY_WORKSPACE_PRIVATE_NETWORK_ID", ""
        ),
        workspace_firewall_ids=source.get("FOUNDRY_WORKSPACE_FIREWALL_IDS", ""),
        workspace_ssh_key_ids=source.get("FOUNDRY_WORKSPACE_SSH_KEY_IDS", ""),
        workspace_bootstrap_secret=source.get("FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET", ""),
        workspace_bootstrap_secret_present=bool(
            source.get("FOUNDRY_WORKSPACE_BOOTSTRAP_SECRET", "").strip()
        ),
        stripe_secret_key_present=bool(
            source.get("FOUNDRY_STRIPE_SECRET_KEY", "").strip()
        ),
        stripe_webhook_secret_present=bool(
            source.get("FOUNDRY_STRIPE_WEBHOOK_SECRET", "").strip()
        ),
        workspace_topology=WorkspaceTopology(
            source.get(
                "FOUNDRY_WORKSPACE_TOPOLOGY",
                LAUNCH_DECISIONS.workspace_topology,
            )
        ),
        organization_workspace_pool_size=_env_int(
            source, "FOUNDRY_ORG_WORKSPACE_POOL_SIZE", 4
        ),
        organization_workspace_max_concurrency=_env_int(
            source, "FOUNDRY_ORG_WORKSPACE_MAX_CONCURRENCY", 20
        ),
        session_max_age_days=_env_int(source, "FOUNDRY_SESSION_MAX_AGE_DAYS", 14),
    )
