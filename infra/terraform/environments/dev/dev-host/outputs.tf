output "public_ipv4" {
  value = module.dev_host.public_ipv4
}

output "private_ipv4" {
  value = module.dev_host.private_ipv4
}

output "server_hostname" {
  value = module.dev_host.server_hostname
}

output "core_hostname" {
  value = module.dev_host.core_hostname
}

output "server_url" {
  value = module.dev_host.server_url
}

output "core_url" {
  value = module.dev_host.core_url
}
