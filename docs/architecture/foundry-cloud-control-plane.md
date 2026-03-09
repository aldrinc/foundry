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

## What is migrated now

The Foundry dev environment now has a Foundry-owned Coder control plane running
on the Foundry dev host.

That means the current state is:

- Foundry owns the workspace provisioning template and the Hetzner project
- Foundry owns the GitHub bootstrap path
- Foundry owns the control-plane server state
- Foundry owns the dev Coder control plane used for smoke validation
- Foundry server now exposes live Coder status, templates, and workspaces from
  the Foundry-owned Coder deployment

## Next cutover target

The next infrastructure milestone is deeper integration between
`foundry-server` and the Foundry-owned Coder deployment.

That slice should include:

1. migrating manual template publication into a product-controlled path
2. replacing the remaining Meridian Coder operational dependency
3. deciding the production topology for a dedicated Foundry Coder host
4. binding organizations to template/workspace ownership rules
5. adding authenticated operator/admin flows for Coder lifecycle management

## Why this order

Persisting Foundry organization/runtime state first reduced cutover risk. The
control plane can now survive restarts and keep GitHub/runtime ownership data
separate from the old Meridian app server, and the dev Coder control plane is
already running on Foundry infrastructure.
