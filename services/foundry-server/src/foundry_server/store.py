from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .domain import (
    AgentDefinition,
    GitHubInstallation,
    OrganizationInvitation,
    Organization,
    OrganizationMembership,
    OrganizationRole,
    OrganizationRuntimeSettings,
    OrganizationWorkspacePool,
    PlatformUser,
    RepoMirror,
    RuntimeCredentialOwnership,
    RuntimeHealth,
    RuntimeProvider,
    RuntimeProviderCredential,
    UserSession,
    WorkspaceTenancy,
    WorkspaceTopology,
    WorktreeCheckoutStrategy,
)


class FoundryStore:
    def __init__(self, database_path: str) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def migrate(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS organizations (
                    organization_id TEXT PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    created_by_user_id TEXT NOT NULL,
                    support_email TEXT NOT NULL,
                    self_host_mode INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS organization_memberships (
                    organization_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    roles_json TEXT NOT NULL,
                    invited_by_user_id TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (organization_id, user_id),
                    FOREIGN KEY (organization_id) REFERENCES organizations (organization_id)
                );

                CREATE TABLE IF NOT EXISTS organization_runtime_settings (
                    organization_id TEXT PRIMARY KEY,
                    health TEXT NOT NULL,
                    default_provider TEXT NOT NULL,
                    default_model TEXT NOT NULL,
                    credentials_json TEXT NOT NULL,
                    agents_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (organization_id) REFERENCES organizations (organization_id)
                );

                CREATE TABLE IF NOT EXISTS organization_workspace_pools (
                    organization_id TEXT PRIMARY KEY,
                    tenancy TEXT NOT NULL,
                    topology TEXT NOT NULL,
                    checkout_strategy TEXT NOT NULL,
                    pool_size INTEGER NOT NULL,
                    max_concurrent_tasks INTEGER NOT NULL,
                    repo_mirrors_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (organization_id) REFERENCES organizations (organization_id)
                );

                CREATE TABLE IF NOT EXISTS github_installations (
                    organization_id TEXT PRIMARY KEY,
                    installation_id TEXT NOT NULL,
                    account_login TEXT NOT NULL,
                    account_type TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (organization_id) REFERENCES organizations (organization_id)
                );

                CREATE TABLE IF NOT EXISTS platform_users (
                    user_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    password_salt TEXT NOT NULL DEFAULT '',
                    password_hash TEXT NOT NULL DEFAULT '',
                    is_platform_admin INTEGER NOT NULL DEFAULT 0,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_login_at TEXT
                );

                CREATE TABLE IF NOT EXISTS user_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES platform_users (user_id)
                );

                CREATE TABLE IF NOT EXISTS organization_invitations (
                    invitation_id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    email TEXT NOT NULL,
                    roles_json TEXT NOT NULL,
                    invited_by_user_id TEXT,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT NOT NULL,
                    accepted_at TEXT,
                    accepted_by_user_id TEXT,
                    FOREIGN KEY (organization_id) REFERENCES organizations (organization_id)
                );
                """
            )

    def list_organizations(self) -> list[Organization]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT organization_id, slug, display_name, created_by_user_id, support_email, self_host_mode
                FROM organizations
                ORDER BY created_at ASC, slug ASC
                """
            ).fetchall()
        return [self._organization_from_row(row) for row in rows]

    def list_organizations_for_user(self, user_id: str) -> list[Organization]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT o.organization_id, o.slug, o.display_name, o.created_by_user_id, o.support_email, o.self_host_mode
                FROM organizations AS o
                INNER JOIN organization_memberships AS m
                    ON o.organization_id = m.organization_id
                WHERE m.user_id = ?
                ORDER BY o.created_at ASC, o.slug ASC
                """,
                (user_id,),
            ).fetchall()
        return [self._organization_from_row(row) for row in rows]

    def get_organization(self, organization_id: str) -> Organization | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT organization_id, slug, display_name, created_by_user_id, support_email, self_host_mode
                FROM organizations
                WHERE organization_id = ?
                """,
                (organization_id,),
            ).fetchone()
        return self._organization_from_row(row) if row is not None else None

    def get_organization_by_slug(self, slug: str) -> Organization | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT organization_id, slug, display_name, created_by_user_id, support_email, self_host_mode
                FROM organizations
                WHERE slug = ?
                """,
                (slug,),
            ).fetchone()
        return self._organization_from_row(row) if row is not None else None

    def create_organization(
        self,
        organization: Organization,
        owner_membership: OrganizationMembership,
        runtime_settings: OrganizationRuntimeSettings,
        workspace_pool: OrganizationWorkspacePool,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO organizations (
                    organization_id,
                    slug,
                    display_name,
                    created_by_user_id,
                    support_email,
                    self_host_mode
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    organization.organization_id,
                    organization.slug,
                    organization.display_name,
                    organization.created_by_user_id,
                    organization.support_email,
                    int(organization.self_host_mode),
                ),
            )
            connection.execute(
                """
                INSERT INTO organization_memberships (
                    organization_id,
                    user_id,
                    roles_json,
                    invited_by_user_id
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    owner_membership.organization_id,
                    owner_membership.user_id,
                    json.dumps([role.value for role in owner_membership.roles]),
                    owner_membership.invited_by_user_id,
                ),
            )
            self._upsert_runtime_settings(connection, runtime_settings)
            self._upsert_workspace_pool(connection, workspace_pool)

    def add_membership(self, membership: OrganizationMembership) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO organization_memberships (
                    organization_id,
                    user_id,
                    roles_json,
                    invited_by_user_id
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT (organization_id, user_id) DO UPDATE SET
                    roles_json = excluded.roles_json,
                    invited_by_user_id = excluded.invited_by_user_id
                """,
                (
                    membership.organization_id,
                    membership.user_id,
                    json.dumps([role.value for role in membership.roles]),
                    membership.invited_by_user_id,
                ),
            )

    def list_memberships(self, organization_id: str) -> list[OrganizationMembership]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT organization_id, user_id, roles_json, invited_by_user_id
                FROM organization_memberships
                WHERE organization_id = ?
                ORDER BY created_at ASC, user_id ASC
                """,
                (organization_id,),
            ).fetchall()
        return [self._membership_from_row(row) for row in rows]

    def get_membership(self, organization_id: str, user_id: str) -> OrganizationMembership | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT organization_id, user_id, roles_json, invited_by_user_id
                FROM organization_memberships
                WHERE organization_id = ? AND user_id = ?
                """,
                (organization_id, user_id),
            ).fetchone()
        return self._membership_from_row(row) if row is not None else None

    def get_runtime_settings(self, organization_id: str) -> OrganizationRuntimeSettings | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT organization_id, health, default_provider, default_model, credentials_json, agents_json
                FROM organization_runtime_settings
                WHERE organization_id = ?
                """,
                (organization_id,),
            ).fetchone()
        return self._runtime_settings_from_row(row) if row is not None else None

    def put_runtime_settings(self, settings: OrganizationRuntimeSettings) -> None:
        with self._connect() as connection:
            self._upsert_runtime_settings(connection, settings)

    def get_workspace_pool(self, organization_id: str) -> OrganizationWorkspacePool | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT organization_id, tenancy, topology, checkout_strategy, pool_size, max_concurrent_tasks, repo_mirrors_json
                FROM organization_workspace_pools
                WHERE organization_id = ?
                """,
                (organization_id,),
            ).fetchone()
        return self._workspace_pool_from_row(row) if row is not None else None

    def put_workspace_pool(self, pool: OrganizationWorkspacePool) -> None:
        with self._connect() as connection:
            self._upsert_workspace_pool(connection, pool)

    def get_github_installation(self, organization_id: str) -> GitHubInstallation | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT organization_id, installation_id, account_login, account_type
                FROM github_installations
                WHERE organization_id = ?
                """,
                (organization_id,),
            ).fetchone()
        return self._github_installation_from_row(row) if row is not None else None

    def bind_github_installation(self, installation: GitHubInstallation) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO github_installations (
                    organization_id,
                    installation_id,
                    account_login,
                    account_type,
                    updated_at
                ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (organization_id) DO UPDATE SET
                    installation_id = excluded.installation_id,
                    account_login = excluded.account_login,
                    account_type = excluded.account_type,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    installation.organization_id,
                    installation.installation_id,
                    installation.account_login,
                    installation.account_type,
                ),
            )

    def get_user(self, user_id: str) -> PlatformUser | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT user_id, email, display_name, password_salt, password_hash, is_platform_admin, active
                FROM platform_users
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        return self._user_from_row(row) if row is not None else None

    def get_user_by_email(self, email: str) -> PlatformUser | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT user_id, email, display_name, password_salt, password_hash, is_platform_admin, active
                FROM platform_users
                WHERE email = ?
                """,
                (email,),
            ).fetchone()
        return self._user_from_row(row) if row is not None else None

    def upsert_user(self, user: PlatformUser) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO platform_users (
                    user_id,
                    email,
                    display_name,
                    password_salt,
                    password_hash,
                    is_platform_admin,
                    active,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id) DO UPDATE SET
                    email = excluded.email,
                    display_name = excluded.display_name,
                    password_salt = excluded.password_salt,
                    password_hash = excluded.password_hash,
                    is_platform_admin = excluded.is_platform_admin,
                    active = excluded.active,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user.user_id,
                    user.email,
                    user.display_name,
                    user.password_salt,
                    user.password_hash,
                    int(user.is_platform_admin),
                    int(user.active),
                ),
            )

    def touch_user_login(self, user_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE platform_users
                SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
                """,
                (user_id,),
            )

    def create_session(self, session: UserSession) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO user_sessions (
                    session_id,
                    user_id,
                    token_hash,
                    expires_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    session.session_id,
                    session.user_id,
                    session.token_hash,
                    session.expires_at,
                ),
            )

    def get_session_by_token_hash(self, token_hash: str) -> UserSession | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT session_id, user_id, token_hash, expires_at
                FROM user_sessions
                WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP
                """,
                (token_hash,),
            ).fetchone()
        return self._session_from_row(row) if row is not None else None

    def delete_session_by_token_hash(self, token_hash: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM user_sessions WHERE token_hash = ?",
                (token_hash,),
            )

    def create_invitation(self, invitation: OrganizationInvitation) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO organization_invitations (
                    invitation_id,
                    organization_id,
                    email,
                    roles_json,
                    invited_by_user_id,
                    token_hash,
                    expires_at,
                    accepted_by_user_id,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    invitation.invitation_id,
                    invitation.organization_id,
                    invitation.email,
                    json.dumps([role.value for role in invitation.roles]),
                    invitation.invited_by_user_id,
                    invitation.token_hash,
                    invitation.expires_at,
                    invitation.accepted_by_user_id,
                ),
            )

    def list_invitations(self, organization_id: str) -> list[OrganizationInvitation]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT invitation_id, organization_id, email, roles_json, invited_by_user_id, token_hash, expires_at, accepted_by_user_id
                FROM organization_invitations
                WHERE organization_id = ?
                ORDER BY created_at DESC
                """,
                (organization_id,),
            ).fetchall()
        return [self._invitation_from_row(row) for row in rows]

    def get_invitation_by_token_hash(self, token_hash: str) -> OrganizationInvitation | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT invitation_id, organization_id, email, roles_json, invited_by_user_id, token_hash, expires_at, accepted_by_user_id
                FROM organization_invitations
                WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP
                """,
                (token_hash,),
            ).fetchone()
        return self._invitation_from_row(row) if row is not None else None

    def accept_invitation(self, invitation_id: str, accepted_by_user_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE organization_invitations
                SET accepted_at = CURRENT_TIMESTAMP,
                    accepted_by_user_id = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE invitation_id = ?
                """,
                (accepted_by_user_id, invitation_id),
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _upsert_runtime_settings(
        self,
        connection: sqlite3.Connection,
        settings: OrganizationRuntimeSettings,
    ) -> None:
        credentials = [
            {
                "provider": credential.provider.value,
                "ownership": credential.ownership.value,
                "configured": credential.configured,
                "label": credential.label,
            }
            for credential in settings.credentials
        ]
        agents = [
            {
                "agent_id": agent.agent_id,
                "display_name": agent.display_name,
                "purpose": agent.purpose,
                "enabled": agent.enabled,
                "provider_override": agent.provider_override.value if agent.provider_override else None,
                "model_override": agent.model_override,
            }
            for agent in settings.agents
        ]
        connection.execute(
            """
            INSERT INTO organization_runtime_settings (
                organization_id,
                health,
                default_provider,
                default_model,
                credentials_json,
                agents_json,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (organization_id) DO UPDATE SET
                health = excluded.health,
                default_provider = excluded.default_provider,
                default_model = excluded.default_model,
                credentials_json = excluded.credentials_json,
                agents_json = excluded.agents_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                settings.organization_id,
                settings.health.value,
                settings.default_provider.value,
                settings.default_model,
                json.dumps(credentials),
                json.dumps(agents),
            ),
        )

    def _upsert_workspace_pool(
        self,
        connection: sqlite3.Connection,
        pool: OrganizationWorkspacePool,
    ) -> None:
        repo_mirrors = [
            {
                "organization_id": mirror.organization_id,
                "repository_full_name": mirror.repository_full_name,
                "mirror_path": mirror.mirror_path,
                "default_branch": mirror.default_branch,
            }
            for mirror in pool.repo_mirrors
        ]
        connection.execute(
            """
            INSERT INTO organization_workspace_pools (
                organization_id,
                tenancy,
                topology,
                checkout_strategy,
                pool_size,
                max_concurrent_tasks,
                repo_mirrors_json,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (organization_id) DO UPDATE SET
                tenancy = excluded.tenancy,
                topology = excluded.topology,
                checkout_strategy = excluded.checkout_strategy,
                pool_size = excluded.pool_size,
                max_concurrent_tasks = excluded.max_concurrent_tasks,
                repo_mirrors_json = excluded.repo_mirrors_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                pool.organization_id,
                pool.tenancy.value,
                pool.topology.value,
                pool.checkout_strategy.value,
                pool.pool_size,
                pool.max_concurrent_tasks,
                json.dumps(repo_mirrors),
            ),
        )

    @staticmethod
    def _organization_from_row(row: sqlite3.Row) -> Organization:
        return Organization(
            organization_id=str(row["organization_id"]),
            slug=str(row["slug"]),
            display_name=str(row["display_name"]),
            created_by_user_id=str(row["created_by_user_id"]),
            support_email=str(row["support_email"]),
            self_host_mode=bool(row["self_host_mode"]),
        )

    @staticmethod
    def _membership_from_row(row: sqlite3.Row) -> OrganizationMembership:
        roles = tuple(
            OrganizationRole(role)
            for role in json.loads(str(row["roles_json"]))
        )
        return OrganizationMembership(
            organization_id=str(row["organization_id"]),
            user_id=str(row["user_id"]),
            roles=roles,
            invited_by_user_id=row["invited_by_user_id"],
        )

    @staticmethod
    def _runtime_settings_from_row(row: sqlite3.Row) -> OrganizationRuntimeSettings:
        credentials = tuple(
            RuntimeProviderCredential(
                provider=RuntimeProvider(item["provider"]),
                ownership=RuntimeCredentialOwnership(item["ownership"]),
                configured=bool(item["configured"]),
                label=str(item.get("label", "")),
            )
            for item in json.loads(str(row["credentials_json"]))
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
            for item in json.loads(str(row["agents_json"]))
        )
        return OrganizationRuntimeSettings(
            organization_id=str(row["organization_id"]),
            health=RuntimeHealth(str(row["health"])),
            default_provider=RuntimeProvider(str(row["default_provider"])),
            default_model=str(row["default_model"]),
            credentials=credentials,
            agents=agents,
        )

    @staticmethod
    def _workspace_pool_from_row(row: sqlite3.Row) -> OrganizationWorkspacePool:
        repo_mirrors = tuple(
            RepoMirror(
                organization_id=str(item["organization_id"]),
                repository_full_name=str(item["repository_full_name"]),
                mirror_path=str(item["mirror_path"]),
                default_branch=str(item["default_branch"]),
            )
            for item in json.loads(str(row["repo_mirrors_json"]))
        )
        return OrganizationWorkspacePool(
            organization_id=str(row["organization_id"]),
            tenancy=WorkspaceTenancy(str(row["tenancy"])),
            topology=WorkspaceTopology(str(row["topology"])),
            checkout_strategy=WorktreeCheckoutStrategy(str(row["checkout_strategy"])),
            pool_size=int(row["pool_size"]),
            max_concurrent_tasks=int(row["max_concurrent_tasks"]),
            repo_mirrors=repo_mirrors,
        )

    @staticmethod
    def _github_installation_from_row(row: sqlite3.Row) -> GitHubInstallation:
        return GitHubInstallation(
            organization_id=str(row["organization_id"]),
            installation_id=str(row["installation_id"]),
            account_login=str(row["account_login"]),
            account_type=str(row["account_type"]),
        )

    @staticmethod
    def _user_from_row(row: sqlite3.Row) -> PlatformUser:
        return PlatformUser(
            user_id=str(row["user_id"]),
            email=str(row["email"]),
            display_name=str(row["display_name"]),
            password_salt=str(row["password_salt"]),
            password_hash=str(row["password_hash"]),
            is_platform_admin=bool(row["is_platform_admin"]),
            active=bool(row["active"]),
        )

    @staticmethod
    def _session_from_row(row: sqlite3.Row) -> UserSession:
        return UserSession(
            session_id=str(row["session_id"]),
            user_id=str(row["user_id"]),
            token_hash=str(row["token_hash"]),
            expires_at=str(row["expires_at"]),
        )

    @staticmethod
    def _invitation_from_row(row: sqlite3.Row) -> OrganizationInvitation:
        roles = tuple(OrganizationRole(role) for role in json.loads(str(row["roles_json"])))
        return OrganizationInvitation(
            invitation_id=str(row["invitation_id"]),
            organization_id=str(row["organization_id"]),
            email=str(row["email"]),
            roles=roles,
            invited_by_user_id=row["invited_by_user_id"],
            token_hash=str(row["token_hash"]),
            expires_at=str(row["expires_at"]),
            accepted_by_user_id=row["accepted_by_user_id"],
        )
