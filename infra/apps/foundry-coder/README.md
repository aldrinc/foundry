# Foundry Coder Control Plane

Foundry-owned Coder deployment pack for the dev environment.

This deployment intentionally avoids product-specific OIDC, domain, and
network defaults. It runs a local Coder + Postgres stack on a Foundry-managed
dev host and exposes it through Caddy.

## Fork model

Foundry does not rely on Coder's enterprise-only organization endpoints. This
deployment builds a Foundry-owned AGPL fork from a pinned upstream tag and
applies the tracked patch in `coder-agpl-org-create.patch`.
The patched binary is produced on the target host by
`build-foundry-coder-fork.sh`
and then packaged into the runtime image that actually serves `coder-dev`.

The current custom delta is intentionally small:

- enable `POST /api/v2/organizations` in the AGPL server
- create the org-member role, creator membership, and everyone group
- keep the change covered by upstream-style Go tests

That gives Foundry a controlled code path for one-to-one org provisioning
without patching or bypassing enterprise license checks.

## Current dev target

- Coder UI: `https://coder-dev.<dev-host-ip>.sslip.io`
- Local upstream: `127.0.0.1:17080`

## What it is for

- bootstrap a Foundry-owned Coder control plane
- build a Foundry-managed Coder fork image from a pinned upstream tag
- publish the `foundry-hetzner-workspace` template into that control plane
- validate that Foundry workspaces can be provisioned without prior internal infrastructure assumptions

## What it does not do yet

- external OIDC for Coder login
- wildcard workspace-app routing with public trusted TLS
- production deployment separation from the shared dev host
- automatic upstream rebase tooling for the Coder fork
