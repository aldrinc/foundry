from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class RuntimeCredentialOwnership(StrEnum):
    ORGANIZATION = "organization"
    USER = "user"


class RuntimeProvider(StrEnum):
    CODEX = "codex"
    CLAUDE_CODE = "claude_code"
    OPENCODE = "opencode"


class RuntimeHealth(StrEnum):
    UNCONFIGURED = "unconfigured"
    READY = "ready"
    DEGRADED = "degraded"
    ERROR = "error"


@dataclass(frozen=True)
class RuntimeProviderCredential:
    provider: RuntimeProvider
    ownership: RuntimeCredentialOwnership
    configured: bool
    label: str = ""


@dataclass(frozen=True)
class AgentDefinition:
    agent_id: str
    display_name: str
    purpose: str
    enabled: bool = True
    provider_override: RuntimeProvider | None = None
    model_override: str | None = None


@dataclass(frozen=True)
class OrganizationRuntimeSettings:
    organization_id: str
    health: RuntimeHealth
    default_provider: RuntimeProvider
    default_model: str
    credentials: tuple[RuntimeProviderCredential, ...] = field(default_factory=tuple)
    agents: tuple[AgentDefinition, ...] = field(default_factory=tuple)
