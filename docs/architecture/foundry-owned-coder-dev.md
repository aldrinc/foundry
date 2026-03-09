# Foundry-Owned Coder Dev Deployment

Date: 2026-03-09
Status: Live in Dev

## Dev URLs

- Coder UI: `https://coder-dev.5.161.83.195.sslip.io`
- Foundry server: `https://server-dev.5.161.83.195.sslip.io`
- Foundry core: `https://core-dev.5.161.83.195.sslip.io`

## What is now Foundry-owned

- Coder control plane process and data on the Foundry dev host
- Coder admin token stored on the Foundry dev host
- `foundry-hetzner-workspace` template published into the Foundry-owned Coder
- smoke workspace `foundry-owned-smoke` created from the Foundry-owned Coder

## Live validation

The current validation path succeeded end to end:

1. open Foundry-owned Coder UI
2. publish the Foundry Hetzner template into that control plane
3. create a workspace from the Foundry-owned Coder deployment
4. provision the runner in the Foundry Hetzner project
5. clone the private GitHub repo through the Foundry server bootstrap token path
6. observe a connected Coder agent

The control plane API can now also see this deployment directly:

- `GET /api/v1/coder/status`
- `GET /api/v1/coder/templates`
- `GET /api/v1/coder/workspaces`

## Current limitation

This dev deployment does not yet expose wildcard workspace-app routing with
public trusted TLS. The main Coder control plane is live, but wildcard app URLs
are not part of this dev slice.

## Next step

The next clean follow-on is wiring `foundry-server` to understand and manage the
Foundry-owned Coder control plane directly instead of treating Coder as an
external manually managed dependency.
