# Foundry Terraform

This directory is the Terraform home for Foundry-managed infrastructure.

The first scoped baseline is the Hetzner workspace foundation used by Coder
workspace VMs.

## Layout

- `modules/foundry-workspace-baseline/`
  - reusable Hetzner baseline resources for Foundry workspace VMs
- `environments/dev/workspace-baseline/`
  - the first dev environment wiring for that module

## What the baseline provisions

- a private Hetzner network and subnet
- a restrictive workspace firewall
- optional SSH keys for workspace VM injection

It does not create any Foundry app servers yet.

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
