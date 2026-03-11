import { render } from "solid-js/web"
import { App } from "./app"
import "./cloud.css"

declare global {
  interface Window {
    __FOUNDRY_CLOUD_BOOTSTRAP__?: CloudBootstrap
  }
}

export type CloudUser = {
  user_id: string
  email: string
  display_name: string
  is_platform_admin: boolean
  active: boolean
}

export type CloudOrganization = {
  organization_id: string
  slug: string
  display_name: string
  created_by_user_id: string
  support_email: string
  self_host_mode: boolean
}

export type CloudRuntimeCredential = {
  provider: string
  ownership: string
  configured: boolean
  label: string
}

export type CloudRuntimeSettings = {
  organization_id: string
  health: string
  default_provider: string
  default_model: string
  credentials: CloudRuntimeCredential[]
  agents: Array<{
    agent_id: string
    display_name: string
    purpose: string
    enabled: boolean
    provider_override: string | null
    model_override: string | null
  }>
}

export type CloudWorkspacePool = {
  organization_id: string
  tenancy: string
  topology: string
  checkout_strategy: string
  pool_size: number
  max_concurrent_tasks: number
  repo_mirrors: Array<{
    organization_id: string
    repository_full_name: string
    mirror_path: string
    default_branch: string
  }>
}

export type CloudGitHubInstallation = {
  organization_id: string
  installation_id: string
  account_login: string
  account_type: string
} | null

export type CloudCoreBinding = {
  organization_id: string
  realm_subdomain: string
  realm_url: string
  owner_email: string
  status: string
  detail: string
} | null

export type CloudCoderBinding = {
  organization_id: string
  coder_organization_id: string
  name: string
  display_name: string
  template_name: string
  status: string
  detail: string
} | null

export type CloudInvitation = {
  invitation_id: string
  organization_id: string
  email: string
  roles: string[]
  invited_by_user_id: string
  expires_at: string
  accepted_by_user_id: string | null
}

export type CloudMember = {
  organization_id: string
  user_id: string
  roles: string[]
  invited_by_user_id: string | null
  email: string
  display_name: string
  is_platform_admin: boolean
}

export type CloudOrganizationDetail = {
  organization: CloudOrganization
  members: CloudMember[]
  runtime_settings: CloudRuntimeSettings
  workspace_pool: CloudWorkspacePool
  github_installation: CloudGitHubInstallation
  core_binding: CloudCoreBinding
  coder_binding: CloudCoderBinding
  invitations: CloudInvitation[]
}

export type CloudCoderStatus = {
  configured: boolean
  url: string
  build: {
    version?: string
  }
  template_count: number
  workspace_count: number
  healthy_workspace_count: number
} | null

export type DashboardBootstrap = {
  page: "dashboard"
  current_user: CloudUser
  organizations: CloudOrganization[]
  coder_status: CloudCoderStatus
}

export type OrganizationBootstrap = {
  page: "organization"
  current_user: CloudUser
  detail: CloudOrganizationDetail
}

export type CloudBootstrap = DashboardBootstrap | OrganizationBootstrap

function readBootstrap(): CloudBootstrap {
  const bootstrap = window.__FOUNDRY_CLOUD_BOOTSTRAP__
  if (!bootstrap) {
    throw new Error("Missing Foundry Cloud bootstrap payload.")
  }
  return bootstrap
}

document.documentElement.setAttribute("data-theme", "foundry")
document.documentElement.style.setProperty("--font-size-base", "14px")

render(() => <App bootstrap={readBootstrap()} />, document.getElementById("root")!)
