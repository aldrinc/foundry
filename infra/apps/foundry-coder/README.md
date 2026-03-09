# Foundry Coder Control Plane

Foundry-owned Coder deployment pack for the dev environment.

This deployment intentionally avoids Meridian-specific OIDC, domains, and
network defaults. It runs a local Coder + Postgres stack on the Foundry dev
host and exposes it through Caddy.

## Current dev target

- Coder UI: `https://coder-dev.<dev-host-ip>.sslip.io`
- Local upstream: `127.0.0.1:17080`

## What it is for

- bootstrap a Foundry-owned Coder control plane
- publish the `foundry-hetzner-workspace` template into that control plane
- validate that Foundry workspaces can be provisioned without Meridian

## What it does not do yet

- external OIDC for Coder login
- wildcard workspace-app routing with public trusted TLS
- production deployment separation from the shared dev host
