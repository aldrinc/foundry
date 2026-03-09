from __future__ import annotations

from dataclasses import dataclass, field

from .organizations import OrganizationRole


@dataclass(frozen=True)
class PlatformUser:
    user_id: str
    email: str
    display_name: str
    password_salt: str = ""
    password_hash: str = ""
    is_platform_admin: bool = False
    active: bool = True


@dataclass(frozen=True)
class UserSession:
    session_id: str
    user_id: str
    token_hash: str
    expires_at: str


@dataclass(frozen=True)
class OrganizationInvitation:
    invitation_id: str
    organization_id: str
    email: str
    roles: tuple[OrganizationRole, ...] = field(default_factory=lambda: (OrganizationRole.MEMBER,))
    invited_by_user_id: str | None = None
    token_hash: str = ""
    expires_at: str = ""
    accepted_by_user_id: str | None = None
