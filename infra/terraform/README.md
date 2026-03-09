# Foundry Terraform

This directory is the Terraform home for Foundry-managed infrastructure.

The first scoped baseline is the Hetzner workspace foundation used by Coder
workspace VMs.

## Layout

- `modules/foundry-workspace-baseline/`
  - reusable Hetzner baseline resources for Foundry workspace VMs
- `modules/foundry-dev-host/`
  - reusable Hetzner dev host for `foundry-core` and `foundry-server`
- `environments/dev/workspace-baseline/`
  - the first dev environment wiring for that module
- `environments/dev/dev-host/`
  - the first dev environment wiring for the Foundry dev host

## What the baseline provisions

- a private Hetzner network and subnet
- a restrictive workspace firewall
- optional SSH keys for workspace VM injection

## What the dev host provisions

- one Foundry dev VM on the shared private network
- a public IPv4 with temporary sslip.io hostnames
- Caddy reverse proxy stubs for `foundry-core` and `foundry-server`
- host prerequisites for deploying `foundry-server` and running the
  `foundry-core` remote dev environment

## Secrets

Do not commit credentials into this repo.

Use environment variables for sensitive inputs:

- `TF_VAR_hcloud_token`

Keep backend configuration out of git until we lock the remote state choice.

## First use

```bash
cd infra/terraform/environments/dev/workspace-baseline
terraform init -backend=false
terraform plan
```

Review the plan before any apply.
