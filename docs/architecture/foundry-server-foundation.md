# Foundry Server Foundation

Date: 2026-03-08
Status: Active

## Purpose

This document records the first implementation step for the Foundry launch plan:

- establish a product-facing server location in the monorepo
- capture confirmed launch decisions in code
- define the first typed product domain models
- create a minimal API surface that future work can extend

This document is specifically about the control-plane scaffold. It does not replace the renamed core application server derived from the Zulip server.

## Confirmed defaults captured by the scaffold

- Repo strategy: monorepo
- Auth model: external OIDC
- SCM for v1: GitHub only
- GitHub integration model: GitHub App
- Billing model: hybrid
- Runtime credential ownership: organization-owned by default
- Web surface scope: onboarding and admin workflows for v1
- Workspace tenancy: organization-scoped
- Workspace topology: organization-pooled
- Task checkout strategy: per-task worktree
- Desktop launch targets: macOS, Windows, Linux

## Why the server scaffold exists now

The existing orchestration code under the internal `infra/hetzner-apps/meridian-coder-orchestrator` path already contains valuable logic, but it is not structured as a public product backend yet.

The new `services/foundry-server` location gives the monorepo a stable home for:

- hosted auth
- organizations and membership
- GitHub App setup
- billing and entitlements
- server-backed runtime and agent settings
- workspace policy and orchestration contracts

This keeps early product work from becoming trapped in internal infrastructure paths.

## What this scaffold is not

The core Foundry application server is a separate system component.

- It is the renamed Zulip-derived server.
- A sanitized snapshot is now imported under [`services/foundry-core/app`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/services/foundry-core/app).
- The import source appears to be `/Users/aldrinclement/Documents/programming/ideas-space/.tmp-zulip`.
- A second related tree exists under `/Users/aldrinclement/Documents/programming/ideas-space/.tmp-zulip-standardize`.

That means the monorepo currently contains:

- desktop client code
- imported core application server code
- control-plane scaffold code
- infrastructure template source for Foundry workspace provisioning
- architecture docs

## Initial directory map

- `services/foundry-server/src/foundry_server/app.py`
  - FastAPI app and bootstrap endpoints
- `services/foundry-server/src/foundry_server/config.py`
  - environment-backed server config
- `services/foundry-server/src/foundry_server/decisions.py`
  - launch defaults expressed as code
- `services/foundry-server/src/foundry_server/domain/`
  - typed domain model modules
- `services/foundry-server/tests/`
  - basic tests for decision and config defaults
- `infra/coder-templates/foundry-hetzner-workspace/`
  - Foundry-owned Coder workspace template without Meridian defaults

## Domain model intent

### Organizations

Organizations are the primary tenant boundary for:

- membership
- billing
- runtime settings
- GitHub installations and repository grants
- workspace pools

### Billing

Billing is modeled as hybrid from the start so pricing can combine:

- seats
- usage
- optionally workspace-related metrics if they remain simple

### GitHub

GitHub App is the primary integration path. The core server needs first-class models for:

- app identity
- installations
- repository grants
- repository permissions

### Runtime and agents

Runtime settings and agent definitions belong on the server, not in local-only desktop state. The scaffold models:

- default provider and model
- provider credential ownership
- runtime health
- agent overrides

### Workspaces

Workspace tenancy is organization-scoped. The scaffold assumes:

- pooled organization workspaces
- repository mirrors inside each org workspace
- per-task worktrees for isolation

This choice reduces per-repo infrastructure sprawl while preserving task-level isolation.

## Immediate follow-on work

1. Finish standardizing the imported core application server inside the monorepo.
2. Add persistence for organizations, memberships, and runtime settings.
3. Add OIDC auth and session issuance.
4. Add GitHub App installation and repository binding endpoints.
5. Define billing tables and Stripe webhook handling.
6. Start migrating orchestration contracts into the new service boundary.
7. Provision the Foundry Hetzner project baseline via Terraform before enabling
   any live Foundry Coder workspace template.
