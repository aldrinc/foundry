import { createSignal, Show, For, onMount, onCleanup } from "solid-js"
import { useOrg } from "../context/org"
import { useNavigation } from "../context/navigation"
import { useZulipSync } from "../context/zulip-sync"
import { commands } from "@foundry/desktop/bindings"
import type { Message } from "../context/zulip-sync"

export function SearchBar(props: { onClose?: () => void; autofocus?: boolean; darkBackground?: boolean }) {
  const org = useOrg()
  const nav = useNavigation()
  const sync = useZulipSync()

  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<Message[]>([])
  const [searching, setSearching] = createSignal(false)
  const [showResults, setShowResults] = createSignal(false)

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let inputRef!: HTMLInputElement
  let containerRef!: HTMLDivElement
  const resultCache = new Map<string, Message[]>()
  let activeSearchToken = 0

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setShowResults(false)
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside)
  })

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside)
  })

  const handleInput = (value: string) => {
    setQuery(value)
    if (searchTimer) clearTimeout(searchTimer)

    const trimmed = value.trim()
    if (!trimmed) {
      setResults([])
      setShowResults(false)
      return
    }

    if (trimmed.length < 2) {
      setResults([])
      setShowResults(true)
      return
    }

    searchTimer = setTimeout(() => doSearch(trimmed), 300)
  }

  const doSearch = async (q: string) => {
    if (q.length < 2) {
      setResults([])
      setShowResults(false)
      return
    }

    const cached = resultCache.get(q)
    if (cached) {
      setResults(cached)
      setShowResults(true)
      return
    }

    const searchToken = ++activeSearchToken
    setSearching(true)
    setShowResults(true)
    try {
      const result = await commands.getMessages(
        org.orgId,
        [{ operator: "search", operand: q }],
        "newest",
        20,
        0,
      )
      if (result.status === "ok") {
        if (searchToken !== activeSearchToken) return
        resultCache.set(q, result.data.messages)
        setResults(result.data.messages)
      }
    } finally {
      if (searchToken === activeSearchToken) {
        setSearching(false)
      }
    }
  }

  const handleResultClick = (msg: Message) => {
    setShowResults(false)
    setQuery("")
    if (msg.stream_id) {
      nav.setActiveNarrow(`stream:${msg.stream_id}/topic:${msg.subject}`)
    } else if (Array.isArray(msg.display_recipient)) {
      const ids = msg.display_recipient.map(u => u.id).sort((a, b) => a - b).join(",")
      nav.setActiveNarrow(`dm:${ids}`)
    }
    props.onClose?.()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowResults(false)
      setQuery("")
      inputRef?.blur()
      props.onClose?.()
    }
  }

  const inputBg = () => props.darkBackground ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.06)"
  const inputBgFocus = () => props.darkBackground ? "rgba(255, 255, 255, 0.20)" : "rgba(0, 0, 0, 0.10)"
  const inputColor = () => props.darkBackground ? "#f1f5f9" : "var(--text-primary)"
  const placeholderColor = () => props.darkBackground ? "rgba(255, 255, 255, 0.45)" : "var(--text-tertiary)"
  const iconColor = () => props.darkBackground ? "rgba(255, 255, 255, 0.4)" : "var(--text-tertiary)"

  return (
    <div ref={containerRef!} class="relative" data-component="search-bar">
      <div class="relative">
        {/* Search icon */}
        <svg
          class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: iconColor() }}
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef!}
          type="text"
          placeholder="Search messages..."
          value={query()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onFocus={(e) => {
            e.currentTarget.style.background = inputBgFocus()
            if (query().trim()) setShowResults(true)
          }}
          onBlur={(e) => {
            e.currentTarget.style.background = inputBg()
          }}
          onKeyDown={handleKeyDown}
          autofocus={props.autofocus}
          class="w-full pl-8 pr-3 text-xs rounded-md focus:outline-none transition-colors"
          style={{
            height: "22px",
            background: inputBg(),
            color: inputColor(),
            "--placeholder-color": placeholderColor(),
          }}
        />
        <style>{`
          [data-component="search-bar"] input::placeholder {
            color: var(--placeholder-color) !important;
          }
        `}</style>
      </div>

      <Show when={showResults()}>
        <div
          class="absolute top-full left-0 right-0 mt-1 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg max-h-[400px] overflow-y-auto z-50"
        >
          <Show when={searching()}>
            <div class="p-3 text-xs text-[var(--text-tertiary)] text-center">Searching...</div>
          </Show>

          <Show when={!searching() && query().trim().length > 0 && query().trim().length < 2}>
            <div class="p-3 text-xs text-[var(--text-tertiary)] text-center">Type at least 2 characters</div>
          </Show>

          <Show when={!searching() && results().length === 0 && query().trim().length >= 2}>
            <div class="p-3 text-xs text-[var(--text-tertiary)] text-center">No results found</div>
          </Show>

          <For each={results()}>
            {(msg) => {
              const stream = () => sync.store.subscriptions.find(s => s.stream_id === msg.stream_id)
              const timeStr = () => {
                const d = new Date(msg.timestamp * 1000)
                const now = new Date()
                const isToday = d.toDateString() === now.toDateString()
                const yesterday = new Date(now)
                yesterday.setDate(yesterday.getDate() - 1)
                const isYesterday = d.toDateString() === yesterday.toDateString()
                const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                if (isToday) return time
                if (isYesterday) return `Yesterday ${time}`
                return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`
              }
              return (
                <button
                  class="w-full text-left px-3 py-2 hover:bg-[var(--background-elevated)] transition-colors border-b border-[var(--border-default)] last:border-b-0"
                  onClick={() => handleResultClick(msg)}
                >
                  {/* Row 1: sender + timestamp */}
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <Show when={stream()}>
                      {(s) => (
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ "background-color": s().color || "var(--text-tertiary)" }}
                        />
                      )}
                    </Show>
                    <span class="text-[11px] font-semibold text-[var(--text-primary)] truncate">
                      {msg.sender_full_name}
                    </span>
                    <span class="text-[10px] text-[var(--text-tertiary)] shrink-0">
                      in {stream()?.name || "DM"} &rsaquo; {msg.subject}
                    </span>
                    <span class="text-[10px] text-[var(--text-tertiary)] ml-auto shrink-0">
                      {timeStr()}
                    </span>
                  </div>
                  {/* Row 2: message preview */}
                  <div class="text-[11px] text-[var(--text-secondary)] truncate [&_*]:inline" innerHTML={msg.content} />
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
