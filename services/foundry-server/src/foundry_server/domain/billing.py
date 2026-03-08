from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class BillingInterval(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class BillingComponentType(StrEnum):
    SEAT = "seat"
    USAGE = "usage"
    WORKSPACE = "workspace"


@dataclass(frozen=True)
class BillingComponent:
    component_type: BillingComponentType
    metric_key: str
    display_name: str
    unit_amount_usd: float
    included_quantity: int = 0


@dataclass(frozen=True)
class BillingPlan:
    plan_id: str
    display_name: str
    interval: BillingInterval
    components: tuple[BillingComponent, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class OrganizationBillingAccount:
    organization_id: str
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    active_plan_id: str | None
    status: str
