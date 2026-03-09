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
  description = "Hetzner location for the dev host"
  type        = string
  default     = "ash"
}

variable "server_type" {
  description = "Hetzner server type for the dev host"
  type        = string
  default     = "cpx31"
}

variable "image" {
  description = "Hetzner image name"
  type        = string
  default     = "ubuntu-24.04"
}

variable "enable_ipv6" {
  description = "Enable IPv6 on the public interface"
  type        = bool
  default     = true
}

variable "enable_server_backups" {
  description = "Enable Hetzner server backups"
  type        = bool
  default     = true
}

variable "admin_allowed_cidrs" {
  description = "CIDR allowlist for SSH access"
  type        = list(string)
  default     = []
}

variable "ssh_key_ids" {
  description = "Hetzner SSH key IDs to inject at server creation time"
  type        = list(number)
  default     = []
}

variable "private_network_name" {
  description = "Existing Hetzner private network name"
  type        = string
  default     = "foundry-private"
}

variable "private_ipv4" {
  description = "Static private IPv4 for the dev host"
  type        = string
  default     = "10.40.1.10"
}

variable "acme_email" {
  description = "Email used by Caddy for ACME registration"
  type        = string
  default     = "support@example.com"
}
