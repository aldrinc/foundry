from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class GitHubRepositoryPermission(StrEnum):
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"


@dataclass(frozen=True)
class GitHubAppIdentity:
    app_name: str
    app_id: str
    client_id: str
    webhook_secret_present: bool


@dataclass(frozen=True)
class GitHubInstallation:
    organization_id: str
    installation_id: str
    account_login: str
    account_type: str


@dataclass(frozen=True)
class GitHubRepositoryGrant:
    organization_id: str
    installation_id: str
    repository_id: str
    full_name: str
    default_branch: str
    permission: GitHubRepositoryPermission
    private: bool
