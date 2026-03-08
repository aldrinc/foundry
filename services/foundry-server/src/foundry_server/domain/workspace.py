from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class WorkspaceTenancy(StrEnum):
    ORGANIZATION = "organization"


class WorkspaceTopology(StrEnum):
    ORGANIZATION_POOLED = "organization_pooled"


class WorktreeCheckoutStrategy(StrEnum):
    MIRROR_AND_PER_TASK_WORKTREE = "mirror_and_per_task_worktree"


@dataclass(frozen=True)
class RepoMirror:
    organization_id: str
    repository_full_name: str
    mirror_path: str
    default_branch: str


@dataclass(frozen=True)
class TaskWorktree:
    task_id: str
    repository_full_name: str
    branch_name: str
    worktree_path: str


@dataclass(frozen=True)
class OrganizationWorkspacePool:
    organization_id: str
    tenancy: WorkspaceTenancy = WorkspaceTenancy.ORGANIZATION
    topology: WorkspaceTopology = WorkspaceTopology.ORGANIZATION_POOLED
    checkout_strategy: WorktreeCheckoutStrategy = (
        WorktreeCheckoutStrategy.MIRROR_AND_PER_TASK_WORKTREE
    )
    pool_size: int = 4
    max_concurrent_tasks: int = 20
    repo_mirrors: tuple[RepoMirror, ...] = field(default_factory=tuple)
