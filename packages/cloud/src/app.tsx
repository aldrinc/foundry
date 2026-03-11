import { For, Show, createMemo, createSignal, untrack } from "solid-js"
import type {
  CloudBootstrap,
  CloudCoderStatus,
  CloudInvitation,
  CloudMember,
  CloudOrganization,
  CloudOrganizationDetail,
  CloudRuntimeSettings,
  CloudWorkspacePool,
} from "./main"

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    headers: {
      "Accept": "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    let message = response.statusText
    try {
      const payload = await response.json() as { detail?: string }
      if (payload.detail) {
        message = payload.detail
      }
    } catch {
      const text = await response.text()
      if (text) {
        message = text
      }
    }
    throw new ApiError(message, response.status)
  }

  return response.json() as Promise<T>
}

function formatStatus(status: string | undefined) {
  if (!status) return "Pending"
  return status.replaceAll("_", " ")
}

function statusTone(status: string | undefined) {
  if (!status) return "warn"
  if (status === "ready" || status === "connected") return "good"
  if (status === "pending") return "warn"
  if (status === "error" || status === "failed") return "danger"
  return "warn"
}

function badgeClass(status: string | undefined) {
  const tone = statusTone(status)
  if (tone === "good") return "bg-emerald-100 text-emerald-700"
  if (tone === "danger") return "bg-rose-100 text-rose-700"
  return "bg-amber-100 text-amber-700"
}

function roleSummary(roles: string[]) {
  return roles.map((role) => role.replaceAll("_", " ")).join(", ")
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

type OrganizationMutationResponse = {
  organization: CloudOrganization
}

type InvitationMutationResponse = {
  invitation: CloudInvitation
  invite_link: string
}

type ProvisionMutationResponse = {
  detail: CloudOrganizationDetail
}

export function App(props: { bootstrap: CloudBootstrap }) {
  return (
    <div class="min-h-screen bg-transparent px-3 py-3 text-[var(--text-primary)] sm:px-4">
      <div class="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1600px] overflow-hidden rounded-[28px] border border-white/12 bg-[var(--surface-outer-bg)] shadow-[0_32px_90px_rgba(7,16,18,0.34)]">
        <Sidebar bootstrap={props.bootstrap} />
        <main class="min-w-0 flex-1 bg-[var(--background-base)]">
          <Show
            when={props.bootstrap.page === "dashboard"}
            fallback={<OrganizationPage bootstrap={props.bootstrap as Extract<CloudBootstrap, { page: "organization" }>} />}
          >
            <DashboardPage bootstrap={props.bootstrap as Extract<CloudBootstrap, { page: "dashboard" }>} />
          </Show>
        </main>
      </div>
    </div>
  )
}

function Sidebar(props: { bootstrap: CloudBootstrap }) {
  const organizations = createMemo(() => props.bootstrap.page === "dashboard"
    ? props.bootstrap.organizations
    : [props.bootstrap.detail.organization])

  return (
    <aside
      data-component="stream-sidebar"
      class="hidden w-[320px] shrink-0 border-r border-[var(--border-default)] bg-[var(--surface-sidebar)] lg:flex lg:flex-col"
    >
      <div class="border-b border-[var(--border-default)] px-6 py-6">
        <div class="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--text-tertiary)]">
          Foundry
        </div>
        <div class="mt-3 text-2xl font-semibold text-[var(--text-primary)]">Cloud control plane</div>
        <div class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          One UI system for desktop, org setup, runtime policy, and workspace orchestration.
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-5">
        <div class="rounded-[22px] border border-white/10 bg-white/5 p-4">
          <div class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
            Signed in
          </div>
          <div class="mt-3 text-base font-semibold text-[var(--text-primary)]">
            {props.bootstrap.current_user.display_name}
          </div>
          <div class="mt-1 text-sm text-[var(--text-secondary)]">{props.bootstrap.current_user.email}</div>
          <Show when={props.bootstrap.current_user.is_platform_admin}>
            <div class="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[var(--text-primary)]">
              Platform admin
            </div>
          </Show>
        </div>

        <div class="mt-6">
          <div class="px-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
            Organizations
          </div>
          <div class="mt-3 space-y-2">
            <For each={organizations()}>
              {(organization) => {
                const active = props.bootstrap.page === "organization"
                  && props.bootstrap.detail.organization.organization_id === organization.organization_id
                return (
                  <a
                    href={`/cloud/organizations/${organization.organization_id}`}
                    class={`block rounded-[18px] border px-4 py-3 transition-colors ${
                      active
                        ? "border-white/15 bg-white/10"
                        : "border-transparent bg-white/0 hover:border-white/10 hover:bg-white/6"
                    }`}
                  >
                    <div class="text-sm font-medium text-[var(--text-primary)]">{organization.display_name}</div>
                    <div class="mt-1 text-xs uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                      {organization.slug}
                    </div>
                  </a>
                )
              }}
            </For>
            <Show when={organizations().length === 0}>
              <div class="rounded-[18px] border border-dashed border-white/10 px-4 py-5 text-sm text-[var(--text-secondary)]">
                No organizations yet.
              </div>
            </Show>
          </div>
        </div>
      </div>

      <div class="border-t border-[var(--border-default)] px-4 py-4">
        <form method="post" action="/logout">
          <button
            type="submit"
            class="w-full rounded-[16px] border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-white/10"
          >
            Log out
          </button>
        </form>
      </div>
    </aside>
  )
}

function DashboardPage(props: { bootstrap: Extract<CloudBootstrap, { page: "dashboard" }> }) {
  const [organizations, setOrganizations] = createSignal(untrack(() => props.bootstrap.organizations))
  const [displayName, setDisplayName] = createSignal("")
  const [slug, setSlug] = createSignal("")
  const [supportEmail, setSupportEmail] = createSignal(untrack(() => props.bootstrap.current_user.email))
  const [ownerPassword, setOwnerPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  const orgCount = createMemo(() => organizations().length)

  const handleNameInput = (value: string) => {
    setDisplayName(value)
    if (!slug()) {
      setSlug(slugify(value))
    }
  }

  const createOrganization = async (event: SubmitEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const response = await requestJson<OrganizationMutationResponse>("/api/v1/organizations", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName(),
          slug: slug(),
          support_email: supportEmail(),
        }),
      })
      setOrganizations((current) => [...current, response.organization])

      if (ownerPassword().trim()) {
        await requestJson<ProvisionMutationResponse>(
          `/api/v1/cloud/organizations/${response.organization.organization_id}/provision`,
          {
            method: "POST",
            body: JSON.stringify({ owner_password: ownerPassword() }),
          },
        )
      }

      window.location.href = `/cloud/organizations/${response.organization.organization_id}`
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Failed to create organization.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="flex h-full flex-col overflow-y-auto">
      <section class="border-b border-[var(--border-default)] bg-[var(--background-base)] px-5 py-5 sm:px-8 sm:py-7">
        <div class="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div class="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--text-tertiary)]">
              Product surface
            </div>
            <h1 class="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
              Foundry Cloud runs on the same UI system as desktop.
            </h1>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-[var(--text-secondary)] sm:text-[15px]">
              Manage org bootstrap, runtime defaults, GitHub binding, and workspace policy without falling back
              to a separate legacy admin surface.
            </p>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Organizations" value={String(orgCount())} detail="Control-plane tenants under management" />
            <MetricCard
              label="Desktop releases"
              value="OTA ready"
              detail="Signed desktop builds and update metadata"
            />
            <CoderMetric coderStatus={props.bootstrap.coder_status} />
          </div>
        </div>
      </section>

      <div class="grid flex-1 gap-5 px-5 py-5 sm:px-8 sm:py-7 xl:grid-cols-[minmax(0,1.3fr)_380px]">
        <section class="space-y-5">
          <div class="rounded-[24px] border border-[var(--border-default)] bg-[var(--background-surface)] p-5 shadow-[var(--shadow-sm)]">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
                  Organization directory
                </div>
                <div class="mt-2 text-xl font-semibold text-[var(--text-primary)]">
                  Current tenants and control-plane state
                </div>
              </div>
            </div>
            <div class="mt-5 grid gap-4 lg:grid-cols-2">
              <For each={organizations()}>
                {(organization) => (
                  <a
                    href={`/cloud/organizations/${organization.organization_id}`}
                    class="rounded-[22px] border border-[var(--border-default)] bg-[var(--surface-message)] p-5 transition-transform duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-lg font-semibold text-[var(--text-primary)]">{organization.display_name}</div>
                        <div class="mt-1 text-xs uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                          {organization.slug}
                        </div>
                      </div>
                      <span class="rounded-full bg-[var(--background-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                        Control plane
                      </span>
                    </div>
                    <div class="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
                      Support: {organization.support_email || "Not set"}
                    </div>
                  </a>
                )}
              </For>
              <Show when={organizations().length === 0}>
                <div class="rounded-[22px] border border-dashed border-[var(--border-default)] bg-[var(--surface-message)] p-6 text-sm leading-6 text-[var(--text-secondary)]">
                  Create the first organization to provision the tenant app, runtime defaults, and desktop surface.
                </div>
              </Show>
            </div>
          </div>
        </section>

        <aside class="space-y-5">
          <div class="rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-message)] p-5 shadow-[var(--shadow-sm)]">
            <div class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
              New organization
            </div>
            <div class="mt-2 text-xl font-semibold text-[var(--text-primary)]">Create and bootstrap a tenant</div>
            <p class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Create the control-plane record first. If you enter an owner password, Foundry will immediately retry
              tenant provisioning after the record is created.
            </p>
            <Show when={error()}>
              <div class="mt-4 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error()}
              </div>
            </Show>
            <form class="mt-5 space-y-4" onSubmit={createOrganization}>
              <LabeledField label="Organization name">
                <input
                  value={displayName()}
                  onInput={(event) => handleNameInput(event.currentTarget.value)}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                  type="text"
                  required
                />
              </LabeledField>
              <LabeledField label="Slug">
                <input
                  value={slug()}
                  onInput={(event) => setSlug(slugify(event.currentTarget.value))}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                  type="text"
                  required
                />
              </LabeledField>
              <LabeledField label="Support email">
                <input
                  value={supportEmail()}
                  onInput={(event) => setSupportEmail(event.currentTarget.value)}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                  type="email"
                />
              </LabeledField>
              <LabeledField label="Owner password">
                <input
                  value={ownerPassword()}
                  onInput={(event) => setOwnerPassword(event.currentTarget.value)}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                  type="password"
                  placeholder="Optional"
                />
              </LabeledField>
              <button
                type="submit"
                disabled={submitting()}
                class="w-full rounded-[16px] bg-[var(--interactive-primary)] px-4 py-3 text-sm font-semibold text-[var(--interactive-primary-text)] transition-colors hover:bg-[var(--interactive-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting() ? "Creating..." : "Create organization"}
              </button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  )
}

function OrganizationPage(props: { bootstrap: Extract<CloudBootstrap, { page: "organization" }> }) {
  const [detail, setDetail] = createSignal(untrack(() => props.bootstrap.detail))
  const [inviteEmail, setInviteEmail] = createSignal("")
  const [inviteRole, setInviteRole] = createSignal("member")
  const [ownerPassword, setOwnerPassword] = createSignal("")
  const [inviteLink, setInviteLink] = createSignal("")
  const [error, setError] = createSignal("")
  const [inviteSubmitting, setInviteSubmitting] = createSignal(false)
  const [provisionSubmitting, setProvisionSubmitting] = createSignal(false)

  const refreshDetail = async () => {
    const response = await requestJson<CloudOrganizationDetail>(
      `/api/v1/cloud/organizations/${detail().organization.organization_id}`,
    )
    setDetail(response)
  }

  const createInvitation = async (event: SubmitEvent) => {
    event.preventDefault()
    setInviteSubmitting(true)
    setError("")
    try {
      const response = await requestJson<InvitationMutationResponse>(
        `/api/v1/cloud/organizations/${detail().organization.organization_id}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            email: inviteEmail(),
            role: inviteRole(),
          }),
        },
      )
      setInviteLink(response.invite_link)
      setInviteEmail("")
      await refreshDetail()
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Failed to create invitation.")
    } finally {
      setInviteSubmitting(false)
    }
  }

  const reprovision = async (event: SubmitEvent) => {
    event.preventDefault()
    setProvisionSubmitting(true)
    setError("")
    try {
      const response = await requestJson<ProvisionMutationResponse>(
        `/api/v1/cloud/organizations/${detail().organization.organization_id}/provision`,
        {
          method: "POST",
          body: JSON.stringify({
            owner_password: ownerPassword(),
          }),
        },
      )
      setDetail(response.detail)
      setOwnerPassword("")
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Failed to reprovision the tenant.")
    } finally {
      setProvisionSubmitting(false)
    }
  }

  return (
    <div class="flex h-full flex-col overflow-y-auto">
      <section class="border-b border-[var(--border-default)] bg-[var(--background-base)] px-5 py-5 sm:px-8 sm:py-7">
        <div class="flex flex-col gap-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--text-tertiary)]">
                Organization
              </div>
              <h1 class="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
                {detail().organization.display_name}
              </h1>
              <div class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {detail().organization.slug} · {detail().organization.support_email || "No support email"}
              </div>
            </div>
            <div class="flex flex-wrap gap-3">
              <a
                href="/cloud"
                class="rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-message)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]"
              >
                Back to Cloud
              </a>
              <Show when={detail().core_binding?.realm_url}>
                <a
                  href={detail().core_binding!.realm_url}
                  class="rounded-[16px] bg-[var(--interactive-primary)] px-4 py-3 text-sm font-semibold text-[var(--interactive-primary-text)]"
                >
                  Launch tenant app
                </a>
              </Show>
            </div>
          </div>

          <div class="grid gap-4 xl:grid-cols-4">
            <StatusCard
              label="Tenant app"
              status={detail().core_binding?.status}
              title={detail().core_binding?.realm_subdomain || "Not provisioned"}
              description={detail().core_binding?.detail || "Tenant realm has not been provisioned yet."}
              link={detail().core_binding?.realm_url || null}
            />
            <StatusCard
              label="GitHub"
              status={detail().github_installation ? "connected" : "pending"}
              title={detail().github_installation?.account_login || "Pending GitHub App bind"}
              description={
                detail().github_installation?.installation_id
                  ? `Installation ${detail().github_installation?.installation_id}`
                  : "GitHub App installation has not been bound to this org."
              }
            />
            <StatusCard
              label="Runtime"
              status={detail().runtime_settings.health}
              title={detail().runtime_settings.default_model || detail().runtime_settings.default_provider}
              description="Inherited provider defaults and org-level overrides."
            />
            <StatusCard
              label="Workspace policy"
              status="ready"
              title={`Pool ${detail().workspace_pool.pool_size}`}
              description={`Max concurrent tasks ${detail().workspace_pool.max_concurrent_tasks}.`}
            />
          </div>
        </div>
      </section>

      <div class="grid flex-1 gap-5 px-5 py-5 sm:px-8 sm:py-7 xl:grid-cols-[minmax(0,1.3fr)_380px]">
        <section class="space-y-5">
          <Show when={error()}>
            <div class="rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error()}
            </div>
          </Show>
          <Show when={inviteLink()}>
            <div class="rounded-[20px] border border-emerald-200 bg-emerald-50 px-5 py-4">
              <div class="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">
                Invite link
              </div>
              <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  readOnly
                  value={inviteLink()}
                  class="min-w-0 flex-1 rounded-[14px] border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-900"
                />
                <button
                  type="button"
                  class="rounded-[14px] bg-emerald-600 px-4 py-3 text-sm font-semibold text-white"
                  onClick={() => navigator.clipboard.writeText(inviteLink()).catch(() => {})}
                >
                  Copy link
                </button>
              </div>
            </div>
          </Show>
          <DataTable
            title="Members"
            eyebrow="People"
            headers={["Name", "Email", "Roles"]}
            rows={detail().members.map((member) => [
              <div class="space-y-1">
                <div class="font-medium text-[var(--text-primary)]">{member.display_name}</div>
                <Show when={member.is_platform_admin}>
                  <div class="text-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Platform admin</div>
                </Show>
              </div>,
              <span class="text-sm text-[var(--text-secondary)]">{member.email || member.user_id}</span>,
              <span class="text-sm text-[var(--text-secondary)]">{roleSummary(member.roles)}</span>,
            ])}
            empty="No members found."
          />
          <DataTable
            title="Pending invitations"
            eyebrow="Invitations"
            headers={["Email", "Roles", "Status"]}
            rows={detail().invitations.map((invitation) => invitationRow(invitation))}
            empty="No invitations yet."
          />
        </section>

        <aside class="space-y-5">
          <Card title="Provisioning" eyebrow="Actions">
            <p class="text-sm leading-6 text-[var(--text-secondary)]">
              Retry tenant and Coder org provisioning when credentials or external dependencies have changed.
            </p>
            <form class="mt-4 space-y-4" onSubmit={reprovision}>
              <LabeledField label="Owner password">
                <input
                  value={ownerPassword()}
                  onInput={(event) => setOwnerPassword(event.currentTarget.value)}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                  type="password"
                  placeholder="Only required if the tenant owner is not bootstrapped"
                />
              </LabeledField>
              <button
                type="submit"
                disabled={provisionSubmitting()}
                class="w-full rounded-[16px] bg-[var(--interactive-primary)] px-4 py-3 text-sm font-semibold text-[var(--interactive-primary-text)] transition-colors hover:bg-[var(--interactive-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {provisionSubmitting() ? "Reprovisioning..." : "Retry tenant provisioning"}
              </button>
            </form>
          </Card>

          <Card title="Invite teammate" eyebrow="Actions">
            <form class="space-y-4" onSubmit={createInvitation}>
              <LabeledField label="Email">
                <input
                  value={inviteEmail()}
                  onInput={(event) => setInviteEmail(event.currentTarget.value)}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                  type="email"
                  required
                />
              </LabeledField>
              <LabeledField label="Role">
                <select
                  value={inviteRole()}
                  onChange={(event) => setInviteRole(event.currentTarget.value)}
                  class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-input)] px-4 py-3 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="runtime_admin">Runtime admin</option>
                  <option value="billing_admin">Billing admin</option>
                </select>
              </LabeledField>
              <button
                type="submit"
                disabled={inviteSubmitting()}
                class="w-full rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-message)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--background-surface)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {inviteSubmitting() ? "Creating invite..." : "Create invite"}
              </button>
            </form>
          </Card>

          <ChecklistCard
            members={detail().members}
            runtimeSettings={detail().runtime_settings}
            workspacePool={detail().workspace_pool}
            githubConnected={Boolean(detail().github_installation)}
            coreStatus={detail().core_binding?.status}
            coderStatus={detail().coder_binding?.status}
          />
        </aside>
      </div>
    </div>
  )
}

function invitationRow(invitation: CloudInvitation) {
  return [
    <span class="text-sm text-[var(--text-primary)]">{invitation.email}</span>,
    <span class="text-sm text-[var(--text-secondary)]">{roleSummary(invitation.roles)}</span>,
    <span class="text-sm text-[var(--text-secondary)]">
      {invitation.accepted_by_user_id ? "Accepted" : "Pending"}
    </span>,
  ]
}

function MetricCard(props: { label: string; value: string; detail: string }) {
  return (
    <div class="rounded-[22px] border border-[var(--border-default)] bg-[var(--background-surface)] p-4 shadow-[var(--shadow-sm)]">
      <div class="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">{props.label}</div>
      <div class="mt-3 text-xl font-semibold text-[var(--text-primary)]">{props.value}</div>
      <div class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{props.detail}</div>
    </div>
  )
}

function CoderMetric(props: { coderStatus: CloudCoderStatus }) {
  return (
    <MetricCard
      label="Coder"
      value={props.coderStatus ? "Configured" : "Not linked"}
      detail={props.coderStatus
        ? `${props.coderStatus.workspace_count} workspaces · ${props.coderStatus.healthy_workspace_count} healthy`
        : "Platform status is hidden until Coder credentials are configured."}
    />
  )
}

function StatusCard(props: {
  label: string
  status: string | undefined
  title: string
  description: string
  link?: string | null
}) {
  return (
    <div class="rounded-[22px] border border-[var(--border-default)] bg-[var(--background-surface)] p-5 shadow-[var(--shadow-sm)]">
      <div class="flex items-start justify-between gap-3">
        <div class="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">{props.label}</div>
        <span class={`rounded-full px-3 py-1 text-xs font-medium ${badgeClass(props.status)}`}>
          {formatStatus(props.status)}
        </span>
      </div>
      <div class="mt-4 text-lg font-semibold text-[var(--text-primary)]">
        <Show when={props.link} fallback={<span>{props.title}</span>}>
          <a href={props.link!} class="text-[var(--text-primary)] underline decoration-[var(--border-default)] underline-offset-4">
            {props.title}
          </a>
        </Show>
      </div>
      <div class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{props.description}</div>
    </div>
  )
}

function Card(props: { title: string; eyebrow: string; children: any }) {
  return (
    <div class="rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-message)] p-5 shadow-[var(--shadow-sm)]">
      <div class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">{props.eyebrow}</div>
      <div class="mt-2 text-xl font-semibold text-[var(--text-primary)]">{props.title}</div>
      <div class="mt-4">{props.children}</div>
    </div>
  )
}

function DataTable(props: {
  title: string
  eyebrow: string
  headers: string[]
  rows: any[][]
  empty: string
}) {
  return (
    <div class="overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-message)] shadow-[var(--shadow-sm)]">
      <div class="border-b border-[var(--border-default)] px-5 py-4">
        <div class="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--text-tertiary)]">{props.eyebrow}</div>
        <div class="mt-2 text-xl font-semibold text-[var(--text-primary)]">{props.title}</div>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full border-collapse">
          <thead>
            <tr class="border-b border-[var(--border-default)]">
              <For each={props.headers}>
                {(header) => (
                  <th class="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                    {header}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <Show
              when={props.rows.length > 0}
              fallback={
                <tr>
                  <td
                    colspan={props.headers.length}
                    class="px-5 py-6 text-sm leading-6 text-[var(--text-secondary)]"
                  >
                    {props.empty}
                  </td>
                </tr>
              }
            >
              <For each={props.rows}>
                {(row) => (
                  <tr class="border-b border-[var(--border-default)] last:border-b-0">
                    <For each={row}>
                      {(cell) => <td class="px-5 py-4 align-top">{cell}</td>}
                    </For>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChecklistCard(props: {
  members: CloudMember[]
  runtimeSettings: CloudRuntimeSettings
  workspacePool: CloudWorkspacePool
  githubConnected: boolean
  coreStatus?: string
  coderStatus?: string
}) {
  const items = createMemo(() => [
    {
      title: "Cloud org ready",
      detail: `${props.members.length} member${props.members.length === 1 ? "" : "s"} in the control-plane directory.`,
    },
    {
      title: "Tenant app",
      detail: props.coreStatus === "ready" ? "Tenant realm is provisioned." : "Tenant provisioning still needs attention.",
    },
    {
      title: "GitHub binding",
      detail: props.githubConnected ? "GitHub App installation is connected." : "GitHub App is still pending.",
    },
    {
      title: "Runtime defaults",
      detail: props.runtimeSettings.health === "ready"
        ? "Runtime defaults are healthy."
        : "Runtime defaults still need provider configuration.",
    },
    {
      title: "Workspace pool",
      detail: `Pool size ${props.workspacePool.pool_size} with max concurrency ${props.workspacePool.max_concurrent_tasks}.`,
    },
    {
      title: "Coder org",
      detail: props.coderStatus === "ready"
        ? "Coder org, provisioner, and template are ready."
        : "Coder org is still reconciling.",
    },
  ])

  return (
    <Card title="Readiness checklist" eyebrow="Status">
      <div class="space-y-4">
        <For each={items()}>
          {(item) => (
            <div class="rounded-[18px] border border-[var(--border-default)] bg-[var(--background-surface)] px-4 py-4">
              <div class="text-sm font-semibold text-[var(--text-primary)]">{item.title}</div>
              <div class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.detail}</div>
            </div>
          )}
        </For>
      </div>
    </Card>
  )
}

function LabeledField(props: { label: string; children: any }) {
  return (
    <label class="block">
      <div class="mb-2 text-sm font-medium text-[var(--text-primary)]">{props.label}</div>
      {props.children}
    </label>
  )
}
