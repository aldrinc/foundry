locals {
  labels = {
    stack       = "foundry"
    service     = "workspace-baseline"
    environment = var.environment
    managed     = "terraform"
  }

  ssh_keys_by_name = {
    for item in var.ssh_keys : item.name => item
    if trimspace(item.public_key) != ""
  }
}

resource "hcloud_network" "private" {
  name     = "${var.project_prefix}-private"
  ip_range = var.network_cidr
  labels   = local.labels
}

resource "hcloud_network_subnet" "private" {
  network_id   = hcloud_network.private.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = var.network_subnet_cidr
}

resource "hcloud_firewall" "workspace" {
  name   = "${var.project_prefix}-workspace-fw"
  labels = local.labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_allowed_cidrs
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "1-65535"
    source_ips = [var.network_cidr]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "1-65535"
    source_ips = [var.network_cidr]
  }
}

resource "hcloud_ssh_key" "workspace" {
  for_each   = local.ssh_keys_by_name
  name       = each.value.name
  public_key = each.value.public_key
}
