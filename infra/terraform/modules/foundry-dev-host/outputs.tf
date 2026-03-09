output "public_ipv4" {
  description = "Public IPv4 for the Foundry dev host"
  value       = hcloud_primary_ip.dev_host.ip_address
}

output "private_ipv4" {
  description = "Private IPv4 for the Foundry dev host"
  value       = var.private_ipv4
}

output "server_hostname" {
  description = "Temporary sslip.io hostname for the Foundry server service"
  value       = "server-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
}

output "core_hostname" {
  description = "Temporary sslip.io hostname for the Foundry core dev service"
  value       = "core-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
}

output "server_url" {
  description = "Temporary public URL for the Foundry server service"
  value       = "https://server-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
}

output "core_url" {
  description = "Temporary public URL for the Foundry core dev service"
  value       = "https://core-dev.${hcloud_primary_ip.dev_host.ip_address}.sslip.io"
}
