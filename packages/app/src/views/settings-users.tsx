import { createSignal, createMemo, For, Show } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"

export function SettingsUsers() {
  const sync = useZulipSync()
  const [search, setSearch] = createSignal("")
  const [tab, setTab] = createSignal<"active" | "deactivated" | "invitations">("active")

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

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Users</h3>
        <button class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity">
          Invite users
        </button>
      </div>

      {/* Tabs */}
      <div class="flex gap-4 border-b border-[var(--border-default)]">
        <TabBtn label="Active" count={activeUsers().length} active={tab() === "active"} onClick={() => setTab("active")} />
        <TabBtn label="Deactivated" count={deactivatedUsers().length} active={tab() === "deactivated"} onClick={() => setTab("deactivated")} />
        <TabBtn label="Invitations" active={tab() === "invitations"} onClick={() => setTab("invitations")} />
      </div>

      {/* Search */}
      <input
        type="text"
        class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
        placeholder="Search users..."
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />

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
                  <button class="text-[10px] text-[var(--interactive-primary)] hover:underline">Reactivate</button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Invitations */}
      <Show when={tab() === "invitations"}>
        <div class="text-center py-8">
          <div class="text-sm text-[var(--text-tertiary)]">No pending invitations</div>
          <div class="text-xs text-[var(--text-quaternary)] mt-1">
            Use the "Invite users" button to send invitations
          </div>
        </div>
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
