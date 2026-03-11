#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from foundry_server.config import AppConfig, load_config
from foundry_server.core_client import (  # noqa: E402
    FoundryCoreClient,
    FoundryCoreConfigurationError,
    FoundryCoreRequestError,
)
from foundry_server.domain import (  # noqa: E402
    AgentDefinition,
    CoreRealmBinding,
    Organization,
    OrganizationMembership,
    OrganizationRole,
    OrganizationRuntimeSettings,
    OrganizationWorkspacePool,
    PlatformUser,
    ProvisioningStatus,
    RepoMirror,
    RuntimeCredentialOwnership,
    RuntimeHealth,
    RuntimeProvider,
    RuntimeProviderCredential,
)
from foundry_server.local_auth import (  # noqa: E402
    generate_password_salt,
    hash_password,
    normalize_email,
)
from foundry_server.store import FoundryStore  # noqa: E402


@dataclass(frozen=True)
class DemoMember:
    email: str
    display_name: str
    title: str
    roles: tuple[OrganizationRole, ...]


TEAM: tuple[DemoMember, ...] = (
    DemoMember(
        email="maya@foundry.dev",
        display_name="Maya Chen",
        title="Product lead and tenant owner",
        roles=(
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.BILLING_ADMIN,
            OrganizationRole.RUNTIME_ADMIN,
        ),
    ),
    DemoMember(
        email="niko@foundry.dev",
        display_name="Niko Alvarez",
        title="Infrastructure and runtime engineer",
        roles=(OrganizationRole.ADMIN, OrganizationRole.RUNTIME_ADMIN),
    ),
    DemoMember(
        email="sara@foundry.dev",
        display_name="Sara Park",
        title="Desktop and client engineer",
        roles=(OrganizationRole.ADMIN,),
    ),
    DemoMember(
        email="leo@foundry.dev",
        display_name="Leo Brooks",
        title="Agents and platform engineer",
        roles=(OrganizationRole.MEMBER,),
    ),
    DemoMember(
        email="ivy@foundry.dev",
        display_name="Ivy Nguyen",
        title="Design systems and docs engineer",
        roles=(OrganizationRole.MEMBER,),
    ),
)


def stable_id(kind: str, value: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"foundry-demo:{kind}:{value}"))


def primary_role(roles: tuple[OrganizationRole, ...]) -> str:
    if OrganizationRole.OWNER in roles:
        return OrganizationRole.OWNER.value
    if OrganizationRole.ADMIN in roles:
        return OrganizationRole.ADMIN.value
    if OrganizationRole.RUNTIME_ADMIN in roles:
        return OrganizationRole.RUNTIME_ADMIN.value
    if OrganizationRole.BILLING_ADMIN in roles:
        return OrganizationRole.BILLING_ADMIN.value
    return OrganizationRole.MEMBER.value


def upsert_demo_user(store: FoundryStore, member: DemoMember, password: str) -> PlatformUser:
    email = normalize_email(member.email)
    existing = store.get_user_by_email(email)
    salt = existing.password_salt if existing and existing.password_salt else generate_password_salt()
    user = PlatformUser(
        user_id=existing.user_id if existing else stable_id("user", email),
        email=email,
        display_name=member.display_name,
        password_salt=salt,
        password_hash=hash_password(password, salt),
        is_platform_admin=False,
        active=True,
    )
    store.upsert_user(user)
    return user


def ensure_organization(
    store: FoundryStore,
    *,
    slug: str,
    display_name: str,
    support_email: str,
    owner: PlatformUser,
) -> Organization:
    existing = store.get_organization_by_slug(slug)
    if existing is not None:
        return existing

    organization = Organization(
        organization_id=stable_id("organization", slug),
        slug=slug,
        display_name=display_name,
        created_by_user_id=owner.user_id,
        support_email=support_email,
    )
    store.create_organization(
        organization=organization,
        owner_membership=OrganizationMembership(
            organization_id=organization.organization_id,
            user_id=owner.user_id,
            roles=TEAM[0].roles,
        ),
        runtime_settings=OrganizationRuntimeSettings(
            organization_id=organization.organization_id,
            health=RuntimeHealth.UNCONFIGURED,
            default_provider=RuntimeProvider.CODEX,
            default_model="",
        ),
        workspace_pool=OrganizationWorkspacePool(organization_id=organization.organization_id),
    )
    return organization


def apply_runtime_settings(store: FoundryStore, organization: Organization) -> None:
    settings = OrganizationRuntimeSettings(
        organization_id=organization.organization_id,
        health=RuntimeHealth.READY,
        default_provider=RuntimeProvider.CODEX,
        default_model="gpt-5-codex",
        credentials=(
            RuntimeProviderCredential(
                provider=RuntimeProvider.CODEX,
                ownership=RuntimeCredentialOwnership.ORGANIZATION,
                configured=True,
                label="Shared ChatGPT Codex workspace",
            ),
            RuntimeProviderCredential(
                provider=RuntimeProvider.CLAUDE_CODE,
                ownership=RuntimeCredentialOwnership.ORGANIZATION,
                configured=True,
                label="Review fallback",
            ),
            RuntimeProviderCredential(
                provider=RuntimeProvider.OPENCODE,
                ownership=RuntimeCredentialOwnership.ORGANIZATION,
                configured=False,
                label="Not configured for this demo",
            ),
        ),
        agents=(
            AgentDefinition(
                agent_id="spec-captain",
                display_name="Spec Captain",
                purpose="Turns stream decisions into crisp specs, acceptance criteria, and launch checklists.",
                model_override="gpt-5-codex",
            ),
            AgentDefinition(
                agent_id="runtime-chief",
                display_name="Runtime Chief",
                purpose="Diagnoses workspace, provider, and execution-path issues before they hit the team topic.",
                model_override="gpt-5-codex",
            ),
            AgentDefinition(
                agent_id="desktop-polish",
                display_name="Desktop Polish",
                purpose="Focuses on UX detail, visual fit, and app behavior before Foundry screenshots or releases.",
                model_override="gpt-5-codex",
            ),
            AgentDefinition(
                agent_id="release-review",
                display_name="Release Review",
                purpose="Reviews launch risk, edge cases, regressions, and operator readiness.",
                provider_override=RuntimeProvider.CLAUDE_CODE,
                model_override="claude-sonnet-4-6",
            ),
            AgentDefinition(
                agent_id="docs-ship",
                display_name="Docs Ship",
                purpose="Converts work into customer-facing docs, README updates, and announcement copy.",
                model_override="gpt-5-codex",
            ),
        ),
    )
    store.put_runtime_settings(settings)


def apply_workspace_pool(store: FoundryStore, organization: Organization, repository_full_name: str) -> None:
    owner, repo = repository_full_name.split("/", 1)
    pool = OrganizationWorkspacePool(
        organization_id=organization.organization_id,
        pool_size=6,
        max_concurrent_tasks=12,
        repo_mirrors=(
            RepoMirror(
                organization_id=organization.organization_id,
                repository_full_name=repository_full_name,
                mirror_path=f"/var/lib/foundry/workspace-mirrors/{organization.slug}/{owner}-{repo}.git",
                default_branch="main",
            ),
        ),
    )
    store.put_workspace_pool(pool)


def provision_core_realm(
    *,
    config: AppConfig,
    store: FoundryStore,
    organization: Organization,
    owner: PlatformUser,
    owner_password: str,
    memberships: dict[str, OrganizationMembership],
    users: dict[str, PlatformUser],
) -> CoreRealmBinding:
    try:
        client = FoundryCoreClient.from_config(config)
    except FoundryCoreConfigurationError as exc:
        raise SystemExit(f"Foundry core provisioning is not configured: {exc}") from exc

    realm_subdomain = config.core_realm_key_override or organization.slug
    try:
        payload = client.provision_realm(
            organization_id=organization.organization_id,
            realm_subdomain=realm_subdomain,
            realm_name=organization.display_name,
            owner_email=owner.email,
            owner_full_name=owner.display_name,
            owner_password=owner_password,
            role=primary_role(memberships[owner.user_id].roles),
        )
    except FoundryCoreRequestError as exc:
        binding = CoreRealmBinding(
            organization_id=organization.organization_id,
            realm_subdomain=realm_subdomain,
            realm_url="",
            owner_email=owner.email,
            status=ProvisioningStatus.ERROR,
            detail=exc.detail,
        )
        store.put_core_realm_binding(binding)
        raise SystemExit(f"Failed to provision demo realm: {exc.detail}") from exc

    realm = payload.get("realm", {})
    if not isinstance(realm, dict):
        raise SystemExit("Foundry core returned an unexpected realm payload.")

    for user_id, user in users.items():
        membership = memberships[user_id]
        try:
            client.sync_member(
                realm_subdomain=str(realm.get("string_id") or realm_subdomain),
                email=user.email,
                full_name=user.display_name,
                password=owner_password,
                role=primary_role(membership.roles),
            )
        except FoundryCoreRequestError as exc:
            raise SystemExit(f"Failed to sync demo user {user.email}: {exc.detail}") from exc

    binding = CoreRealmBinding(
        organization_id=organization.organization_id,
        realm_subdomain=str(realm.get("string_id") or realm_subdomain),
        realm_url=str(realm.get("url") or ""),
        owner_email=owner.email,
        status=ProvisioningStatus.READY,
        detail="Demo company tenant provisioned and team members synced.",
    )
    store.put_core_realm_binding(binding)
    return binding


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed Foundry Server with a demo company that is building Foundry itself.",
    )
    parser.add_argument("--org-slug", default="foundry-labs")
    parser.add_argument("--org-name", default="Foundry Labs")
    parser.add_argument("--support-email", default="hello@foundry.dev")
    parser.add_argument("--repository", default="meridian/foundry")
    parser.add_argument("--password", default="FoundryDemo2026!")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config()
    store = FoundryStore(config.database_path)
    store.migrate()

    users: dict[str, PlatformUser] = {}
    for member in TEAM:
        user = upsert_demo_user(store, member, args.password)
        users[user.user_id] = user

    owner = next(user for user in users.values() if user.email == normalize_email(TEAM[0].email))
    organization = ensure_organization(
        store,
        slug=args.org_slug,
        display_name=args.org_name,
        support_email=args.support_email,
        owner=owner,
    )

    memberships: dict[str, OrganizationMembership] = {}
    for member in TEAM:
        user = next(user for user in users.values() if user.email == normalize_email(member.email))
        membership = OrganizationMembership(
            organization_id=organization.organization_id,
            user_id=user.user_id,
            roles=member.roles,
            invited_by_user_id=owner.user_id if user.user_id != owner.user_id else None,
        )
        store.add_membership(membership)
        memberships[user.user_id] = membership

    apply_runtime_settings(store, organization)
    apply_workspace_pool(store, organization, args.repository)
    binding = provision_core_realm(
        config=config,
        store=store,
        organization=organization,
        owner=owner,
        owner_password=args.password,
        memberships=memberships,
        users=users,
    )

    summary = {
        "organization_id": organization.organization_id,
        "organization_slug": organization.slug,
        "organization_name": organization.display_name,
        "realm_subdomain": binding.realm_subdomain,
        "realm_url": binding.realm_url,
        "default_password": args.password,
        "users": [
            {
                "email": normalize_email(member.email),
                "display_name": member.display_name,
                "title": member.title,
                "roles": [role.value for role in member.roles],
            }
            for member in TEAM
        ],
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except sqlite3.IntegrityError as exc:
        raise SystemExit(f"Failed to seed demo company: {exc}") from exc
