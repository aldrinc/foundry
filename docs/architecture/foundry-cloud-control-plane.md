# Foundry Cloud Control Plane

Date: 2026-03-09
Status: In Progress

## What is live now

- `foundry-server` is the active Foundry Cloud control-plane API on the dev host.
- It now persists organization state in SQLite on the dev host instead of
  serving only static scaffolding.
- The GitHub App bootstrap path for workspace clone access remains active and
  now sits alongside persisted organization records.

## Live persisted capabilities

The current dev control plane supports:

- organization creation
- owner membership bootstrap
- persisted org runtime settings
- persisted org workspace-pool settings
- binding a GitHub App installation to an organization

The current live dev validation used:

- organization slug: `foundry-cloud-dev`
- GitHub App installation: `115185467`
- default runtime provider: `codex`

## What is not migrated yet

The workspace bootstrap path is working, but the Coder control plane is still
the existing Meridian-hosted deployment.

That means the current state is:

- Foundry owns the workspace provisioning template and the Hetzner project
- Foundry owns the GitHub bootstrap path
- Foundry owns the control-plane server state
- Meridian still owns the running Coder control plane

## Next cutover target

The next infrastructure milestone is a Foundry-owned Coder deployment managed by
Terraform and pointed at Foundry-controlled domains and secrets.

That slice should include:

1. Terraform module for a Foundry Coder control plane
2. Foundry-specific Coder env and storage paths
3. Foundry-owned public/wildcard access URLs
4. Foundry-side GitHub/workspace template publishing path
5. migrating the working `foundry-hetzner-workspace` template into that control plane

## Why this order

Persisting Foundry organization/runtime state first reduces cutover risk. The
control plane can now survive restarts and keep GitHub/runtime ownership data
separate from the old Meridian app server before the Coder control plane itself
is moved.
