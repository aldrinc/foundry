import { createMemo, For, Show, createSignal, createEffect, onCleanup } from "solid-js"
import fuzzysort from "fuzzysort"
import { useZulipSync } from "../context/zulip-sync"
import type { User, Subscription } from "../context/zulip-sync"

interface SpecialMentionEntry {
  kind: "special"
  name: string
  description: string
}

type MentionItem = SpecialMentionEntry | User | Subscription

/**
 * MentionAutocomplete — floating autocomplete panel for @mentions and #stream links.
 * Shows when the user types `@` or `#` in the compose box.
 */
export function MentionAutocomplete(props: {
  query: string
  type: "user" | "stream"
  onSelect: (text: string) => void
  onClose: () => void
}) {
  const sync = useZulipSync()
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const specialEntries = createMemo((): SpecialMentionEntry[] => {
    if (props.type !== "user") return []
    const q = props.query.toLowerCase()
    const entries: SpecialMentionEntry[] = []
    if (!q || "all".includes(q) || "everyone".includes(q)) {
      entries.push({ kind: "special", name: "all", description: "Notify recipients" })
    }
    return entries
  })

  // Filter users based on query (including bots, excluding deactivated)
  const userResults = createMemo((): MentionItem[] => {
    if (props.type !== "user") return []
    const q = props.query.toLowerCase()

    const activeUsers = sync.store.users.filter(u => u.is_active !== false)

    let userMatches: User[]
    if (!q) {
      userMatches = activeUsers.slice(0, 8)
    } else {
      const results = fuzzysort.go(q, activeUsers, {
        keys: ["full_name", "email"],
        limit: 8,
      })
      userMatches = results.map(r => r.obj)
    }

    return [...specialEntries(), ...userMatches]
  })

  const streamResults = createMemo((): MentionItem[] => {
    if (props.type !== "stream") return []
    const q = props.query.toLowerCase()

    if (!q) return sync.store.subscriptions.slice(0, 8)

    const results = fuzzysort.go(q, sync.store.subscriptions, {
      keys: ["name"],
      limit: 8,
    })
    return results.map(r => r.obj)
  })

  const results = (): MentionItem[] => props.type === "user" ? userResults() : streamResults()
  const resultCount = () => results().length

  // Reset selection when query changes
  createEffect(() => {
    const _ = props.query
    setSelectedIndex(0)
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, resultCount() - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      const idx = selectedIndex()
      const items = results()
      if (idx < items.length) {
        selectItem(items[idx])
      }
    } else if (e.key === "Escape") {
      props.onClose()
    }
  }

  const selectItem = (item: MentionItem) => {
    if ("kind" in item && item.kind === "special") {
      props.onSelect(`@**${item.name}** `)
    } else if (props.type === "user") {
      const user = item as User
      props.onSelect(`@**${user.full_name}** `)
    } else {
      const stream = item as Subscription
      props.onSelect(`#**${stream.name}** `)
    }
  }

  // Expose keyboard handler for the parent
  ;(window as any).__mentionAutocompleteKeyDown = handleKeyDown
  onCleanup(() => {
    ;(window as any).__mentionAutocompleteKeyDown = undefined
  })

  return (
    <Show when={resultCount() > 0}>
      <div
        class="absolute z-50 bottom-full left-0 mb-1 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-md overflow-hidden min-w-[220px] max-w-[320px]"
        data-component="mention-autocomplete"
      >
        <div class="py-1 max-h-[240px] overflow-y-auto">
          <For each={results()}>
            {(item, idx) => {
              if ("kind" in item && item.kind === "special") {
                return (
                  <button
                    class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    classList={{
                      "bg-[var(--interactive-primary)]/10": selectedIndex() === idx(),
                      "hover:bg-[var(--background-elevated)]": selectedIndex() !== idx(),
                    }}
                    onClick={() => selectItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx())}
                  >
                    <div class="w-5 h-5 rounded-full bg-[var(--background-elevated)] flex items-center justify-center shrink-0">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M6 1C3.24 1 1 3.24 1 6s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 1.5c.83 0 1.5.67 1.5 1.5S6.83 5.5 6 5.5 4.5 4.83 4.5 4 5.17 2.5 6 2.5zM6 9.5c-1.25 0-2.35-.64-3-1.61C3.01 6.78 5 6.25 6 6.25s2.99.53 3 1.64c-.65.97-1.75 1.61-3 1.61z" fill="currentColor" />
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="text-xs text-[var(--text-primary)] font-medium">{item.name}</span>
                      <span class="text-[10px] text-[var(--text-tertiary)] ml-1.5">{item.description}</span>
                    </div>
                  </button>
                )
              }

              if (props.type === "user") {
                const user = item as User
                return (
                  <button
                    class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    classList={{
                      "bg-[var(--interactive-primary)]/10": selectedIndex() === idx(),
                      "hover:bg-[var(--background-elevated)]": selectedIndex() !== idx(),
                    }}
                    onClick={() => selectItem(user)}
                    onMouseEnter={() => setSelectedIndex(idx())}
                  >
                    <div class="w-5 h-5 rounded-full bg-[var(--background-elevated)] flex items-center justify-center text-[9px] font-medium text-[var(--text-secondary)] shrink-0">
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0 flex items-center gap-1.5">
                      <span class="text-xs text-[var(--text-primary)] truncate">{user.full_name}</span>
                      <Show when={user.is_bot}>
                        <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-elevated)] px-1 rounded shrink-0">BOT</span>
                      </Show>
                      <span class="text-[10px] text-[var(--text-tertiary)] truncate">{user.email}</span>
                    </div>
                  </button>
                )
              } else {
                const stream = item as Subscription
                return (
                  <button
                    class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    classList={{
                      "bg-[var(--interactive-primary)]/10": selectedIndex() === idx(),
                      "hover:bg-[var(--background-elevated)]": selectedIndex() !== idx(),
                    }}
                    onClick={() => selectItem(stream)}
                    onMouseEnter={() => setSelectedIndex(idx())}
                  >
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ "background-color": stream.color || "var(--text-tertiary)" }}
                    />
                    <span class="text-xs text-[var(--text-primary)] truncate">{stream.name}</span>
                  </button>
                )
              }
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
