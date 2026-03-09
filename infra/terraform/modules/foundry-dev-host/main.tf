locals {
  labels = {
    stack       = "foundry"
    service     = "dev-host"
    environment = var.environment
    managed     = "terraform"
  }
}

data "hcloud_network" "private" {
  name = var.private_network_name
}

resource "hcloud_primary_ip" "dev_host" {
  name          = "${var.project_prefix}-dev-ipv4"
  type          = "ipv4"
  assignee_type = "server"
  auto_delete   = false
  location      = var.location
  labels        = local.labels
}

resource "hcloud_firewall" "dev_host" {
  name   = "${var.project_prefix}-dev-fw"
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
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "1-65535"
    source_ips = [data.hcloud_network.private.ip_range]
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "1-65535"
    source_ips = [data.hcloud_network.private.ip_range]
  }
}

resource "hcloud_server" "dev_host" {
  name        = "${var.project_prefix}-dev-01"
  server_type = var.server_type
  image       = var.image
  location    = var.location
  backups     = var.enable_server_backups
  ssh_keys    = var.ssh_key_ids

  public_net {
    ipv4         = tonumber(hcloud_primary_ip.dev_host.id)
    ipv4_enabled = true
    ipv6_enabled = var.enable_ipv6
  }

  network {
    network_id = data.hcloud_network.private.id
    ip         = var.private_ipv4
  }

  user_data = templatefile("${path.module}/templates/cloud-init-foundry-dev.yaml.tftpl", {
    acme_email              = var.acme_email
    foundry_coder_hostname  = "coder-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
    foundry_core_hostname   = "core-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
    foundry_server_hostname = "server-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
  })

  labels = local.labels

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "hcloud_firewall_attachment" "dev_host" {
  firewall_id = hcloud_firewall.dev_host.id
  server_ids  = [hcloud_server.dev_host.id]
}
