variable "hcloud_token" {
  description = "Hetzner Cloud API token for the Foundry project"
  type        = string
  sensitive   = true
}

variable "project_prefix" {
  description = "Prefix for all Foundry Hetzner resources"
  type        = string
  default     = "foundry"
}

variable "environment" {
  description = "Environment label used on resources"
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Hetzner location for resources"
  type        = string
  default     = "ash"
}

variable "network_zone" {
  description = "Hetzner private network zone"
  type        = string
  default     = "us-east"
}

variable "network_cidr" {
  description = "Private network CIDR for Foundry workspaces"
  type        = string
  default     = "10.40.0.0/16"
}

variable "network_subnet_cidr" {
  description = "Private subnet CIDR for Foundry workspaces"
  type        = string
  default     = "10.40.1.0/24"
}

variable "admin_allowed_cidrs" {
  description = "CIDR allowlist for SSH access to workspace VMs"
  type        = list(string)
  default     = []
}

variable "ssh_keys" {
  description = "SSH public keys to create in the Foundry Hetzner project"
  type = list(object({
    name       = string
    public_key = string
  }))
  default = []
}
