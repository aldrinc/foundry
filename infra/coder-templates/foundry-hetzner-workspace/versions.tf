terraform {
  required_version = ">= 1.6.0"

  required_providers {
    coder = {
      source  = "coder/coder"
      version = ">= 2.0.0"
    }
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.49.0"
    }
  }
}
