terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.49.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

module "dev_host" {
  source = "../../../modules/foundry-dev-host"

  project_prefix        = var.project_prefix
  environment           = var.environment
  location              = var.location
  server_type           = var.server_type
  image                 = var.image
  enable_ipv6           = var.enable_ipv6
  enable_server_backups = var.enable_server_backups
  admin_allowed_cidrs   = var.admin_allowed_cidrs
  ssh_key_ids           = var.ssh_key_ids
  private_network_name  = var.private_network_name
  private_ipv4          = var.private_ipv4
  acme_email            = var.acme_email
}
