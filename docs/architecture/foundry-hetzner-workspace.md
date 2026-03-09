# Foundry Hetzner Workspace Template

Date: 2026-03-09
Status: Draft

## Current live state

- The old Meridian Coder template path has been drained.
- The three stale workspaces previously tied to the Meridian `ash` project have
  been deleted from Coder.
- The detached `managed=coder` Hetzner volumes in that Meridian project are also
  gone.
- The Meridian orchestrator no longer has an active `CODER_TEMPLATE_ID`, so it
  cannot create more workspaces from the retired template.

## Important finding

The current Foundry Hetzner project is empty.

At the time of review it has:

- no servers
- no volumes
- no networks
- no firewalls
- no SSH keys
- no primary IPs

That means a Foundry workspace template can be prepared now, but it should not
be published for live use until the Foundry project baseline exists.

## New repo source of truth

The Foundry-owned template now lives at:

- `infra/coder-templates/foundry-hetzner-workspace/`
- `infra/terraform/modules/foundry-workspace-baseline/`
- `infra/terraform/environments/dev/workspace-baseline/`

This template intentionally removes the Meridian-specific assumptions that were
present in the earlier workspace template:

- no Meridian hostnames
- no Meridian NetBird defaults
- no hardcoded SSH key IDs
- no dependency on a Meridian-owned Hetzner project token

## Pre-provisioning requirements

Before the first Foundry workspace can be launched, we need to provision the
Foundry Hetzner project baseline through Terraform.

That baseline should define at least:

1. the SSH keys that should be available to workspace VMs
2. any required private network and firewall rules
3. any public ingress or support services the workspaces depend on
4. the routing model for Foundry service access

The new Terraform baseline scaffold is limited to those prerequisites. It does
not create the full Foundry app stack yet.

## Recommendation

Provision the Foundry Hetzner baseline first, then publish this template into
Coder with:

- the Foundry Hetzner token
- Foundry-specific SSH key IDs
- any private-network settings that survive product review

Only after that should we create a test workspace in Coder.

## First live result

The first smoke workspace now provisions successfully into the Foundry Hetzner
project and the Coder agent connects cleanly.

The remaining blocker on that path is repository bootstrap for private GitHub
repositories. A test workspace against the private `aldrinc/foundry` repo came
up correctly, but the bootstrap clone failed until GitHub App credentials are
available inside the workspace creation path.
