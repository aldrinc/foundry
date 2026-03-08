from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class OrganizationRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    BILLING_ADMIN = "billing_admin"
    RUNTIME_ADMIN = "runtime_admin"
    MEMBER = "member"


@dataclass(frozen=True)
class Organization:
    organization_id: str
    slug: str
    display_name: str
    created_by_user_id: str
    support_email: str
    self_host_mode: bool = False


@dataclass(frozen=True)
class OrganizationMembership:
    organization_id: str
    user_id: str
    roles: tuple[OrganizationRole, ...] = field(
        default_factory=lambda: (OrganizationRole.MEMBER,)
    )
    invited_by_user_id: str | None = None
