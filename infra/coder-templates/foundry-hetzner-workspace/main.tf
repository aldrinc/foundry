provider "hcloud" {
  token = var.hcloud_token
}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

data "coder_parameter" "repo_id" {
  name         = "repo_id"
  display_name = "Repository ID"
  description  = "Repository identity (for example: aldrinc/foundry)"
  type         = "string"
  default      = ""
  mutable      = true
  order        = 10
}

data "coder_parameter" "repo_url" {
  name         = "repo_url"
  display_name = "Repository URL"
  description  = "Git clone URL used to bootstrap /home/coder/repos/<repo>/base"
  type         = "string"
  default      = ""
  mutable      = true
  order        = 20
}

locals {
  workspace_key = data.coder_workspace.me.id
  volume_name   = "coder-${local.workspace_key}-home"
  server_name   = "coder-${local.workspace_key}"
  labels = {
    managed      = "coder"
    stack        = "foundry"
    workspace_id = data.coder_workspace.me.id
    owner_name   = data.coder_workspace_owner.me.name
  }
}

resource "coder_agent" "runner" {
  os   = "linux"
  arch = "amd64"
  dir  = "/home/coder"

  startup_script = <<-EOT
    set -euo pipefail
    mkdir -p /home/coder
    mkdir -p /home/coder/repos
  EOT
}

resource "hcloud_volume" "home" {
  name     = local.volume_name
  size     = var.volume_size_gb
  location = var.location
  format   = "ext4"
  labels   = local.labels

  lifecycle {
    ignore_changes = all
  }
}

resource "hcloud_server" "runner" {
  count = data.coder_workspace.me.start_count

  name        = local.server_name
  server_type = var.server_type
  image       = var.image
  location    = var.location
  ssh_keys    = var.ssh_key_ids
  labels      = local.labels

  dynamic "network" {
    for_each = var.private_network_id == null ? [] : [var.private_network_id]
    content {
      network_id = network.value
    }
  }

  user_data = templatefile("${path.module}/cloud-init.yml.tftpl", {
    volume_id                  = hcloud_volume.home.id
    agent_init_script_b64      = base64encode(coder_agent.runner.init_script)
    coder_agent_token          = coder_agent.runner.token
    workspace_owner            = data.coder_workspace_owner.me.name
    workspace_name             = data.coder_workspace.me.name
    repo_id                    = data.coder_parameter.repo_id.value
    repo_url                   = data.coder_parameter.repo_url.value
    runner_daemon_download_url = var.runner_daemon_download_url
    netbird_setup_key          = var.netbird_setup_key
    netbird_management_url     = var.netbird_management_url
    extra_hosts_json           = var.extra_hosts_json
  })
}

resource "hcloud_volume_attachment" "home" {
  count = data.coder_workspace.me.start_count

  volume_id = hcloud_volume.home.id
  server_id = hcloud_server.runner[0].id
  automount = false
}

resource "hcloud_firewall_attachment" "runner" {
  for_each = data.coder_workspace.me.start_count == 0 ? {} : {
    for id in var.firewall_ids : tostring(id) => id
  }

  firewall_id = each.value
  server_ids  = [hcloud_server.runner[0].id]
}
