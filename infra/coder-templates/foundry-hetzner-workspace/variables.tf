variable "hcloud_token" {
  description = "Hetzner Cloud API token for the Foundry project"
  type        = string
  sensitive   = true
}

variable "location" {
  description = "Hetzner location for workspace VMs"
  type        = string
  default     = "ash"
}

variable "server_type" {
  description = "Hetzner server type for the workspace VM"
  type        = string
  default     = "cpx31"
}

variable "image" {
  description = "Hetzner image name"
  type        = string
  default     = "ubuntu-24.04"
}

variable "volume_size_gb" {
  description = "Persistent volume size for /home/coder"
  type        = number
  default     = 100
}

variable "ssh_key_ids" {
  description = "Hetzner SSH key IDs to inject at server creation time"
  type        = list(number)
  default     = []
}

variable "runner_daemon_download_url" {
  description = "HTTPS URL for the Foundry runner daemon binary"
  type        = string
  default     = ""
}

variable "netbird_setup_key" {
  description = "Optional NetBird setup key for private workspace routing"
  type        = string
  default     = ""
  sensitive   = true
}

variable "netbird_management_url" {
  description = "Optional NetBird management URL used during bootstrap"
  type        = string
  default     = ""
}

variable "extra_hosts_json" {
  description = "Optional JSON array of static host mappings added to /etc/hosts"
  type        = string
  default     = "[]"
}
