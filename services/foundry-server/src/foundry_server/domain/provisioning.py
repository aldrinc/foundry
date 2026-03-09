from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ProvisioningStatus(StrEnum):
    PENDING = "pending"
    READY = "ready"
    ERROR = "error"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class CoreRealmBinding:
    organization_id: str
    realm_subdomain: str
    realm_url: str
    owner_email: str
    status: ProvisioningStatus = ProvisioningStatus.PENDING
    detail: str = ""


@dataclass(frozen=True)
class CoderOrganizationBinding:
    organization_id: str
    coder_organization_id: str
    name: str
    display_name: str
    template_name: str = "foundry-hetzner-workspace"
    status: ProvisioningStatus = ProvisioningStatus.PENDING
    detail: str = ""
