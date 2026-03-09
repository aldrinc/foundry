# Foundry Coder Template: Hetzner Workspace

This template is the Foundry-owned replacement for the old Meridian Hetzner
workspace template.

It keeps the same basic lifecycle model:

- `hcloud_server.runner` is ephemeral and tied to Coder start/stop state.
- `hcloud_volume.home` is persistent and reattached on every start.
- repository bootstrap happens inside `/home/coder/repos/<repo_slug>/base`.

## Why this template exists

The previous Meridian template had two problems that block public Foundry use:

- it was wired to a Meridian-owned Hetzner project
- it relied on Meridian-specific defaults and hardcoded SSH key IDs

This version removes those assumptions. It does not embed any Meridian hostnames,
NetBird endpoints, or project-specific SSH key IDs.

## Required template variables

- `hcloud_token`
- `ssh_key_ids`
- `server_type`
- `volume_size_gb`
- `runner_daemon_download_url`
- `foundry_server_url`
- `workspace_bootstrap_secret`

## Optional template variables

- `private_network_id`
- `firewall_ids`
- `netbird_setup_key`
- `netbird_management_url`
- `extra_hosts_json`

`extra_hosts_json` must be a JSON array shaped like:

```json
[
  { "ip": "10.20.1.12", "hosts": ["api.foundry.local", "core.foundry.local"] }
]
```

## Workspace parameters

- `repo_id`
- `repo_url`

## Preflight before first use

1. Provision the Foundry Hetzner project baseline via Terraform.
2. Create any SSH keys that should be injected into workspace VMs.
3. Decide whether workspaces will reach Foundry services over public URLs or a
   private mesh such as NetBird.
4. Feed the Terraform outputs for `private_network_id`, `firewall_ids`, and
   `ssh_key_ids` into the Coder template configuration.
5. Only then publish this template into Coder with the Foundry Hetzner token.

Until that baseline exists, this template is a safe source-of-truth artifact in
the repo, not something to use for live workspace creation.

## Private GitHub repo bootstrap

When `foundry_server_url` and `workspace_bootstrap_secret` are configured, the
workspace bootstrap requests a short-lived GitHub installation token from
`foundry-server` and uses `GIT_ASKPASS` for clone/fetch operations. The GitHub
App private key stays on the Foundry server host and is not embedded into the
workspace template.
