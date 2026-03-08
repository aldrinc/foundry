import { Show, onCleanup } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"

export function PersonalMenu(props: {
  onClose: () => void
  onOpenSettings: () => void
  onLogout: () => void
}) {
  const sync = useZulipSync()
  let menuRef!: HTMLDivElement

  const currentUser = () => {
    const userId = sync.store.currentUserId
    if (!userId) return null
    return sync.store.users.find(u => u.user_id === userId) ?? null
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose()
    }
  }

  setTimeout(() => document.addEventListener("click", handleClickOutside), 0)
  onCleanup(() => document.removeEventListener("click", handleClickOutside))

  const handleAction = (action: () => void) => {
    document.removeEventListener("click", handleClickOutside)
    props.onClose()
    action()
  }

  return (
    <div
      ref={menuRef!}
      class="absolute left-0 top-full mt-1 w-[220px] bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg z-50 py-1"
    >
      {/* User info */}
      <div class="px-3 py-2 border-b border-[var(--border-default)]">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-[var(--interactive-primary)] flex items-center justify-center text-xs font-medium text-white shrink-0">
            {currentUser()?.full_name?.charAt(0).toUpperCase() || "?"}
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-[var(--text-primary)] truncate">
              {currentUser()?.full_name || "User"}
            </div>
            <div class="text-[10px] text-[var(--text-tertiary)] truncate">
              {currentUser()?.email || ""}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <MenuItem label="Settings" onClick={() => handleAction(props.onOpenSettings)} />
      <div class="my-1 border-t border-[var(--border-default)]" />
      <MenuItem label="Log out" onClick={() => handleAction(props.onLogout)} danger />
    </div>
  )
}

function MenuItem(props: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      class="w-full text-left px-3 py-1.5 text-xs transition-colors"
      classList={{
        "text-[var(--status-error)] hover:bg-[var(--status-error)]/10": props.danger,
        "text-[var(--text-primary)] hover:bg-[var(--background-elevated)]": !props.danger,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}
