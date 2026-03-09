output "network_id" {
  description = "Hetzner private network ID for workspace VM attachment"
  value       = hcloud_network.private.id
}

output "network_name" {
  description = "Hetzner private network name"
  value       = hcloud_network.private.name
}

output "workspace_firewall_id" {
  description = "Hetzner firewall ID for workspace VM attachment"
  value       = hcloud_firewall.workspace.id
}

output "workspace_firewall_name" {
  description = "Hetzner firewall name for workspace VM attachment"
  value       = hcloud_firewall.workspace.name
}

output "ssh_key_ids" {
  description = "Hetzner SSH key IDs created for workspace VM injection"
  value = [
    for name in sort(keys(hcloud_ssh_key.workspace)) :
    hcloud_ssh_key.workspace[name].id
  ]
}

output "coder_template_inputs" {
  description = "Values to feed into the Foundry Hetzner workspace Coder template"
  value = {
    private_network_id = hcloud_network.private.id
    firewall_ids       = [hcloud_firewall.workspace.id]
    ssh_key_ids = [
      for name in sort(keys(hcloud_ssh_key.workspace)) :
      hcloud_ssh_key.workspace[name].id
    ]
  }
}
