from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Final


@dataclass(frozen=True)
class LaunchDecisions:
    repo_strategy: str = "monorepo"
    auth_model: str = "external_oidc"
    scm_provider: str = "github"
    github_integration_model: str = "github_app"
    billing_model: str = "hybrid"
    runtime_credential_ownership: str = "organization"
    web_surface_scope: str = "onboarding_admin"
    workspace_tenancy: str = "organization"
    workspace_topology: str = "organization_pooled"
    task_checkout_strategy: str = "per_task_worktree"
    desktop_platforms: tuple[str, ...] = ("macos", "windows", "linux")

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["desktop_platforms"] = list(self.desktop_platforms)
        return data


LAUNCH_DECISIONS: Final[LaunchDecisions] = LaunchDecisions()
