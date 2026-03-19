import { createMemo, createSignal, For, Show } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useNavigation } from "../context/navigation"
import type { User } from "../context/zulip-sync"

/**
 * RightSidebar — shows context-dependent user list on the right side.
 * - Stream narrow: users who posted in that stream's messages
 * - Topic narrow: participants in that topic
 * - DM narrow: user profile card
 * - Otherwise: all active users
 */
export function RightSidebar(props: { show: boolean; onClose: () => void }) {
  const sync = useZulipSync()
  const nav = useNavigation()
  const [userFilter, setUserFilter] = createSignal("")

  // Get context-specific user list
  const contextUsers = createMemo(() => {
    const narrow = nav.activeNarrow()
    const parsed = narrow ? nav.parseNarrow(narrow) : null

    if (parsed?.type === "dm" && parsed.userIds) {
      // DM: show the other participants
      return parsed.userIds
        .map(id => sync.store.users.find(u => u.user_id === id))
        .filter((u): u is User => !!u)
    }

    if (parsed?.type === "topic" || parsed?.type === "stream") {
      // Gather unique senders from messages in this narrow
      const narrowKey = narrow!
      const messages = sync.store.messages[narrowKey] || []
      const senderIds = [...new Set(messages.map(m => m.sender_id))]
      return senderIds
        .map(id => sync.store.users.find(u => u.user_id === id))
        .filter((u): u is User => !!u)
    }

    // Default: show all active users
    return sync.store.users.filter(u => u.is_active !== false && !u.is_bot)
  })

  // Apply search filter
  const filteredUsers = createMemo(() => {
    const q = userFilter().toLowerCase().trim()
    const users = contextUsers()
    if (!q) return users
    return users.filter(u =>
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    )
  })

  // Header title based on context
  const headerTitle = () => {
    const narrow = nav.activeNarrow()
    if (!narrow) return "Users"
    const parsed = nav.parseNarrow(narrow)
    if (parsed?.type === "dm") return "Conversation"
    if (parsed?.type === "topic") return "Participants"
    if (parsed?.type === "stream") return "Members"
    return "Users"
  }

  // Start DM with a user
  const startDm = (user: User) => {
    const currentId = sync.store.currentUserId
    if (!currentId) return
    const ids = [currentId, user.user_id].sort().join(",")
    nav.setActiveNarrow(`dm:${ids}`)
  }

  // Get user's role label
  const roleLabel = (role: number | null) => {
    switch (role) {
      case 100: return "Owner"
      case 200: return "Admin"
      case 300: return "Moderator"
      case 400: return "Member"
      case 600: return "Guest"
      default: return null
    }
  }

  return (
      <aside
        class="border-l border-[var(--border-default)] bg-[var(--surface-sidebar)] flex flex-col shrink-0"
        data-component="right-sidebar"
        data-visible={props.show ? "true" : "false"}
      >
        {/* Header */}
        <div class="h-12 px-3 border-b border-[var(--border-default)] flex items-center justify-between">
          <span class="text-sm font-medium text-[var(--text-primary)]">
            {headerTitle()}
          </span>
          <div class="flex items-center gap-1">
            <span class="text-[10px] text-[var(--text-tertiary)]">
              {filteredUsers().length}
            </span>
            <button
              class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
              onClick={props.onClose}
              title="Close panel"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search filter */}
        <Show when={contextUsers().length > 5}>
          <div class="px-2 py-2">
            <input
              type="text"
              placeholder="Filter users..."
              value={userFilter()}
              onInput={(e) => setUserFilter(e.currentTarget.value)}
              class="w-full px-2 py-1 text-xs rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
            />
          </div>
        </Show>

        {/* User list */}
        <div class="flex-1 overflow-y-auto py-1">
          <For each={filteredUsers()}>
            {(user) => (
              <UserRow
                user={user}
                isCurrentUser={user.user_id === sync.store.currentUserId}
                roleLabel={roleLabel(user.role)}
                onSendDm={() => startDm(user)}
              />
            )}
          </For>

          <Show when={filteredUsers().length === 0}>
            <div class="text-xs text-[var(--text-tertiary)] text-center py-4">
              No users found
            </div>
          </Show>
        </div>
      </aside>
  )
}

function UserRow(props: {
  user: User
  isCurrentUser: boolean
  roleLabel: string | null
  onSendDm: () => void
}) {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div>
      <button
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--background-surface)] transition-colors group"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Avatar + presence */}
        <div class="relative shrink-0">
          <div class="w-6 h-6 rounded-full bg-[var(--background-elevated)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)]">
            {props.user.full_name.charAt(0).toUpperCase()}
          </div>
          {/* Presence dot - green by default for active users */}
          <Show when={props.user.is_active !== false}>
            <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-[var(--surface-sidebar)]" />
          </Show>
        </div>

        {/* Name + role */}
        <div class="flex-1 min-w-0">
          <div class="text-xs text-[var(--text-primary)] truncate">
            {props.user.full_name}
            <Show when={props.isCurrentUser}>
              <span class="text-[10px] text-[var(--text-tertiary)] ml-1">(you)</span>
            </Show>
          </div>
          <Show when={props.roleLabel}>
            <div class="text-[10px] text-[var(--text-tertiary)]">{props.roleLabel}</div>
          </Show>
        </div>
      </button>

      {/* Expanded user card */}
      <Show when={expanded()}>
        <div class="mx-3 mb-2 p-2 rounded-[var(--radius-md)] bg-[var(--background-surface)] border border-[var(--border-default)]">
          <div class="text-xs text-[var(--text-secondary)] mb-1">{props.user.email}</div>
          <Show when={props.user.timezone}>
            <div class="text-[10px] text-[var(--text-tertiary)] mb-2">
              {props.user.timezone}
            </div>
          </Show>
          <Show when={!props.isCurrentUser}>
            <button
              class="w-full text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] hover:bg-[var(--interactive-primary-hover)] transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                props.onSendDm()
              }}
            >
              Send message
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}
