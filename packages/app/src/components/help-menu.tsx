import { createSignal, Show, onCleanup } from "solid-js"

export function HelpMenu(props: { onShowShortcuts: () => void; darkBackground?: boolean }) {
  const [open, setOpen] = createSignal(false)
  let menuRef!: HTMLDivElement

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      setOpen(false)
    }
  }

  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    if (open()) {
      setOpen(false)
    } else {
      setOpen(true)
      setTimeout(() => document.addEventListener("click", handleClickOutside), 0)
    }
  }

  onCleanup(() => document.removeEventListener("click", handleClickOutside))

  const handleAction = (action: () => void) => {
    setOpen(false)
    document.removeEventListener("click", handleClickOutside)
    action()
  }

  return (
    <div class="relative" ref={menuRef!}>
      <button
        class={props.darkBackground
          ? "p-1.5 rounded-[var(--radius-sm)] text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
          : "p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
        }
        onClick={toggle}
        title="Help"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" />
          <path d="M5.5 5.5a1.5 1.5 0 0 1 2.8.5c0 1-1.3 1.3-1.3 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          <circle cx="7" cy="10" r="0.6" fill="currentColor" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute right-0 top-full mt-1 w-[200px] bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg z-50 py-1">
          <MenuItem
            label="Keyboard shortcuts"
            shortcut="?"
            onClick={() => handleAction(props.onShowShortcuts)}
          />
          <MenuItem
            label="Message formatting"
            onClick={() => handleAction(props.onShowShortcuts)}
          />
          <div class="my-1 border-t border-[var(--border-default)]" />
          <div class="px-3 py-1.5">
            <div class="text-[10px] text-[var(--text-tertiary)]">
              Search filters: <span class="text-[var(--text-secondary)]">stream:</span>, <span class="text-[var(--text-secondary)]">topic:</span>, <span class="text-[var(--text-secondary)]">sender:</span>
            </div>
          </div>
          <div class="my-1 border-t border-[var(--border-default)]" />
          <div class="px-3 py-1.5">
            <span class="text-[10px] text-[var(--text-tertiary)]">Foundry Desktop &middot; Built with Tauri + SolidJS</span>
          </div>
        </div>
      </Show>
    </div>
  )
}

function MenuItem(props: { label: string; onClick: () => void; shortcut?: string }) {
  return (
    <button
      class="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors flex items-center justify-between"
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      <Show when={props.shortcut}>
        <span class="text-[10px] text-[var(--text-tertiary)]">{props.shortcut}</span>
      </Show>
    </button>
  )
}
