import { For } from "solid-js"

interface ShortcutGroup {
  title: string
  shortcuts: { keys: string; description: string }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "c", description: "Focus compose box" },
      { keys: "/", description: "Focus search" },
      { keys: "?", description: "Show keyboard shortcuts" },
      { keys: "Escape", description: "Close modals / panels" },
    ],
  },
  {
    title: "Composing",
    shortcuts: [
      { keys: "Ctrl+Enter / Cmd+Enter", description: "Send message" },
      { keys: "Cmd+B / Ctrl+B", description: "Bold" },
      { keys: "Cmd+I / Ctrl+I", description: "Italic" },
    ],
  },
  {
    title: "Formatting",
    shortcuts: [
      { keys: "**text**", description: "Bold" },
      { keys: "*text*", description: "Italic" },
      { keys: "~~text~~", description: "Strikethrough" },
      { keys: "`code`", description: "Inline code" },
      { keys: "```code```", description: "Code block" },
      { keys: "> text", description: "Quote" },
      { keys: "- item", description: "Bullet list" },
      { keys: "1. item", description: "Numbered list" },
      { keys: "[text](url)", description: "Link" },
      { keys: "# Heading", description: "Heading" },
    ],
  },
]

export function KeyboardShortcutsModal(props: { onClose: () => void }) {
  return (
    <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={props.onClose}>
      <div
        class="w-[440px] max-h-[70vh] bg-[var(--background-surface)] rounded-[var(--radius-lg)] shadow-lg border border-[var(--border-default)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <h2 class="text-sm font-semibold text-[var(--text-primary)]">Keyboard shortcuts</h2>
          <button
            onClick={props.onClose}
            class="p-1 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4 space-y-5">
          <For each={SHORTCUT_GROUPS}>
            {(group) => (
              <div>
                <h3 class="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{group.title}</h3>
                <div class="space-y-1">
                  <For each={group.shortcuts}>
                    {(shortcut) => (
                      <div class="flex items-center justify-between py-1">
                        <span class="text-xs text-[var(--text-primary)]">{shortcut.description}</span>
                        <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)]">
                          {shortcut.keys}
                        </kbd>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
