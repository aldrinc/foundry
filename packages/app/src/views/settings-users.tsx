import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { commands } from "@zulip/desktop/bindings"
import type { Invite } from "@zulip/desktop/bindings"

export function SettingsUsers() {
  const sync = useZulipSync()
  const org = useOrg()
  const [search, setSearch] = createSignal("")
  const [tab, setTab] = createSignal<"active" | "deactivated" | "invitations">("active")
  const [error, setError] = createSignal("")

  // Invite form state
  const [showInvite, setShowInvite] = createSignal(false)
  const [inviteEmails, setInviteEmails] = createSignal("")
  const [inviteRole, setInviteRole] = createSignal(400) // Member
  const [inviteExpiry, setInviteExpiry] = createSignal<number | null>(null)
  const [sending, setSending] = createSignal(false)
  const [inviteResult, setInviteResult] = createSignal<string>("")

  // Invitations tab state
  const [invites, setInvites] = createSignal<Invite[]>([])
  const [loadingInvites, setLoadingInvites] = createSignal(false)

  const activeUsers = createMemo(() =>
    sync.store.users
      .filter(u => u.is_active)
      .filter(u => {
        const q = search().toLowerCase()
        return !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  )

  const deactivatedUsers = createMemo(() =>
    sync.store.users
      .filter(u => !u.is_active)
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  )

  const roleLabel = (role: number | null) => {
    if (role === 100) return "Owner"
    if (role === 200) return "Admin"
    if (role === 300) return "Moderator"
    if (role === 400) return "Member"
    if (role === 600) return "Guest"
    return "Member"
  }

  const roleBadgeClass = (role: number | null) => {
    if (role === 100) return "bg-purple-100 text-purple-700"
    if (role === 200) return "bg-blue-100 text-blue-700"
    if (role === 300) return "bg-yellow-100 text-yellow-700"
    return "bg-[var(--background-base)] text-[var(--text-tertiary)]"
  }

  const handleReactivate = async (userId: number) => {
    setError("")
    const result = await commands.reactivateUser(org.orgId, userId)
    if (result.status === "error") {
      setError(result.error)
    }
    // The realm_user event from the event queue will update the users list
  }

  const handleSendInvites = async () => {
    if (!inviteEmails().trim()) return
    setSending(true)
    setError("")
    setInviteResult("")

    const result = await commands.sendInvites(
      org.orgId,
      inviteEmails().trim(),
      inviteExpiry(),
      inviteRole(),
      []
    )
    setSending(false)

    if (result.status === "error") {
      setError(result.error)
      return
    }

    const data = result.data
    const parts: string[] = []
    if (data.invited_emails?.length) parts.push(`Invited: ${data.invited_emails.join(", ")}`)
    if (data.already_invited && Object.keys(data.already_invited).length > 0) parts.push(`Already invited: ${Object.keys(data.already_invited).join(", ")}`)
    if (data.skipped && Object.keys(data.skipped).length > 0) parts.push(`Skipped: ${Object.keys(data.skipped).join(", ")}`)

    setInviteResult(parts.join(". ") || "Invitations sent")
    setInviteEmails("")
    setShowInvite(false)
    fetchInvites()
  }

  const fetchInvites = async () => {
    setLoadingInvites(true)
    const result = await commands.getInvites(org.orgId)
    setLoadingInvites(false)
    if (result.status === "ok") {
      setInvites(result.data)
    }
  }

  const handleResend = async (inviteId: number) => {
    const result = await commands.resendInvite(org.orgId, inviteId)
    if (result.status === "error") {
      setError(result.error)
    }
  }

  const handleRevoke = async (inviteId: number) => {
    const result = await commands.revokeInvite(org.orgId, inviteId)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setInvites(prev => prev.filter(i => i.id !== inviteId))
  }

  // Load invitations when switching to that tab
  const switchTab = (t: "active" | "deactivated" | "invitations") => {
    setTab(t)
    if (t === "invitations") fetchInvites()
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Users</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowInvite(s => !s)}
        >
          {showInvite() ? "Cancel" : "Invite users"}
        </button>
      </div>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 rounded-[var(--radius-sm)]">
          {error()}
        </div>
      </Show>

      <Show when={inviteResult()}>
        <div class="text-xs text-green-600 bg-green-50 px-3 py-2 rounded-[var(--radius-sm)]">
          {inviteResult()}
        </div>
      </Show>

      {/* Invite form */}
      <Show when={showInvite()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Email addresses (comma-separated)</label>
            <textarea
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] resize-none"
              rows={3}
              placeholder="user1@example.com, user2@example.com"
              value={inviteEmails()}
              onInput={(e) => setInviteEmails(e.currentTarget.value)}
            />
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Invite as</label>
              <select
                class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                value={inviteRole()}
                onChange={(e) => setInviteRole(Number(e.currentTarget.value))}
              >
                <option value="200">Admin</option>
                <option value="400">Member</option>
                <option value="600">Guest</option>
              </select>
            </div>
            <div class="flex-1">
              <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Expiry</label>
              <select
                class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                value={String(inviteExpiry() ?? "")}
                onChange={(e) => {
                  const v = e.currentTarget.value
                  setInviteExpiry(v ? Number(v) : null)
                }}
              >
                <option value="">Never expires</option>
                <option value="1440">1 day</option>
                <option value="10080">7 days</option>
                <option value="43200">30 days</option>
              </select>
            </div>
          </div>
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleSendInvites}
            disabled={!inviteEmails().trim() || sending()}
          >
            {sending() ? "Sending..." : "Send invitations"}
          </button>
        </div>
      </Show>

      {/* Tabs */}
      <div class="flex gap-4 border-b border-[var(--border-default)]">
        <TabBtn label="Active" count={activeUsers().length} active={tab() === "active"} onClick={() => switchTab("active")} />
        <TabBtn label="Deactivated" count={deactivatedUsers().length} active={tab() === "deactivated"} onClick={() => switchTab("deactivated")} />
        <TabBtn label="Invitations" count={invites().length || undefined} active={tab() === "invitations"} onClick={() => switchTab("invitations")} />
      </div>

      {/* Search */}
      <Show when={tab() !== "invitations"}>
        <input
          type="text"
          class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
          placeholder="Search users..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </Show>

      {/* Active users */}
      <Show when={tab() === "active"}>
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={activeUsers()}>
            {(user) => (
              <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-7 h-7 rounded-full bg-[var(--interactive-primary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
                    {user.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-[var(--text-primary)] truncate">{user.full_name}</div>
                    <div class="text-[10px] text-[var(--text-tertiary)] truncate">{user.email}</div>
                  </div>
                </div>
                <span class={`text-[9px] font-medium px-1.5 py-0.5 rounded ${roleBadgeClass(user.role)}`}>
                  {roleLabel(user.role)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Deactivated users */}
      <Show when={tab() === "deactivated"}>
        <Show
          when={deactivatedUsers().length > 0}
          fallback={
            <div class="text-center py-8 text-xs text-[var(--text-tertiary)]">No deactivated users</div>
          }
        >
          <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
            <For each={deactivatedUsers()}>
              {(user) => (
                <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] last:border-b-0 opacity-60">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="w-7 h-7 rounded-full bg-[var(--text-tertiary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div class="min-w-0">
                      <div class="text-xs font-medium text-[var(--text-primary)] truncate">{user.full_name}</div>
                      <div class="text-[10px] text-[var(--text-tertiary)] truncate">{user.email}</div>
                    </div>
                  </div>
                  <button
                    class="text-[10px] text-[var(--interactive-primary)] hover:underline"
                    onClick={() => handleReactivate(user.user_id)}
                  >
                    Reactivate
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Invitations */}
      <Show when={tab() === "invitations"}>
        <Show when={loadingInvites()}>
          <div class="text-center py-4 text-xs text-[var(--text-tertiary)]">Loading invitations...</div>
        </Show>
        <Show
          when={invites().length > 0}
          fallback={
            <Show when={!loadingInvites()}>
              <div class="text-center py-8">
                <div class="text-sm text-[var(--text-tertiary)]">No pending invitations</div>
                <div class="text-xs text-[var(--text-quaternary)] mt-1">
                  Use the "Invite users" button to send invitations
                </div>
              </div>
            </Show>
          }
        >
          <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
            <For each={invites()}>
              {(invite) => (
                <div class="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)] last:border-b-0">
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-[var(--text-primary)] truncate">
                      {invite.email || (invite.is_multiuse ? "Multi-use link" : "Unknown")}
                    </div>
                    <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      {invite.invited_as ? `As ${roleLabel(invite.invited_as)}` : ""}
                      {invite.expiry_date ? ` \u00b7 Expires ${new Date(invite.expiry_date * 1000).toLocaleDateString()}` : " \u00b7 Never expires"}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0 ml-2">
                    <button
                      class="text-[10px] text-[var(--interactive-primary)] hover:underline"
                      onClick={() => handleResend(invite.id)}
                    >
                      Resend
                    </button>
                    <button
                      class="text-[10px] text-[var(--status-error)] hover:underline"
                      onClick={() => handleRevoke(invite.id)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function TabBtn(props: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      class={`pb-2 text-xs transition-colors flex items-center gap-1 ${
        props.active
          ? "text-[var(--interactive-primary)] border-b-2 border-[var(--interactive-primary)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {props.label}
      <Show when={props.count !== undefined}>
        <span class="text-[9px] text-[var(--text-tertiary)]">({props.count})</span>
      </Show>
    </button>
  )
}
