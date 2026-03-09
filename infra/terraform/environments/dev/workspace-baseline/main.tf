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

module "workspace_baseline" {
  source = "../../../modules/foundry-workspace-baseline"

  project_prefix      = var.project_prefix
  environment         = var.environment
  location            = var.location
  network_zone        = var.network_zone
  network_cidr        = var.network_cidr
  network_subnet_cidr = var.network_subnet_cidr
  admin_allowed_cidrs = var.admin_allowed_cidrs
  ssh_keys            = var.ssh_keys
}
