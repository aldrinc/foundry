import { createEffect, createSignal, For, Show, on } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { useNavigation } from "../context/navigation"
import { useSupervisor } from "../context/supervisor"
import { commands } from "@foundry/desktop/bindings"
import type { NarrowFilter } from "@foundry/desktop/bindings"
import { MessageItem } from "./message-item"
import { SearchBar } from "./search-bar"

const IS_DEMO = typeof window !== "undefined" && window.location.search.includes("demo")

function formatDateSeparator(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  })
}

function isDifferentDay(ts1: number, ts2: number): boolean {
  return new Date(ts1 * 1000).toDateString() !== new Date(ts2 * 1000).toDateString()
}

export function MessageList(props: { narrow: string; onToggleUserPanel?: () => void }) {
  const sync = useZulipSync()
  const org = useOrg()
  const nav = useNavigation()
  const supervisor = useSupervisor()

  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  let scrollContainer!: HTMLDivElement
  let isAtBottom = true

  const messages = () => sync.store.messages[props.narrow] || []
  const loadState = () => sync.store.messageLoadState[props.narrow] || "idle"

  const scrollToBottom = () => {
    if (!scrollContainer) return
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    isAtBottom = true
  }

  const markMessagesRead = async (messageIds: number[]) => {
    if (messageIds.length === 0) return
    await commands.updateMessageFlags(org.orgId, messageIds, "add", "read")
  }

  // Build narrow filters for the API
  // The Zulip API interprets string operands for "stream" as stream names,
  // so we must resolve numeric stream IDs to their display names.
  const narrowFilters = (): NarrowFilter[] => {
    const filters = nav.narrowToFilters(props.narrow) as NarrowFilter[]
    return filters.map(f => {
      if (f.operator === "stream" && typeof f.operand === "string") {
        const id = parseInt(f.operand as string, 10)
        if (!isNaN(id)) {
          const stream = sync.store.subscriptions.find(s => s.stream_id === id)
          if (stream) {
            return { ...f, operand: stream.name }
          }
        }
      }
      return f
    })
  }

  // Fetch messages when narrow changes
  const fetchMessages = async () => {
    if (IS_DEMO) {
      setError("")
      setLoading(false)
      return
    }

    // Guard on local loading signal to prevent concurrent fetches
    // (avoids stale store loadState from interrupted HMR)
    if (loading()) return

    setLoading(true)
    setError("")

    try {
      const result = await sync.ensureMessages(
        props.narrow,
        narrowFilters(),
        { limit: 50, markRead: true },
      )

      if (result.status === "error") {
        setError(result.error || "Failed to load messages")
        return
      }

      if (result.fromCache) {
        const unreadIds = messages()
          .filter(m => !(m.flags || []).includes("read"))
          .map(m => m.id)
        await markMessagesRead(unreadIds)
      }
    } catch (e: any) {
      setError(e?.toString() || "Failed to load messages")
    } finally {
      setLoading(false)
    }
  }

  // Load older messages
  const fetchOlderMessages = async () => {
    if (IS_DEMO) return
    if (loadState() !== "idle" || loading()) return
    const msgs = messages()
    if (msgs.length === 0) return

    setLoading(true)
    try {
      const result = await commands.getMessages(
        org.orgId,
        narrowFilters(),
        String(msgs[0].id),
        50,
        0,
      )
      if (result.status === "ok") {
        sync.addMessages(props.narrow, result.data.messages)
        if (result.data.found_oldest) {
          sync.setMessageLoadState(props.narrow, "loaded-all")
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // Track scroll position
  const handleScroll = () => {
    if (!scrollContainer) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    isAtBottom = scrollHeight - scrollTop - clientHeight < 50

    // Load older messages when scrolled to top
    if (scrollTop < 100 && loadState() === "idle" && !loading()) {
      fetchOlderMessages()
    }
  }

  // Auto-scroll to bottom on new messages if already at bottom
  createEffect(() => {
    const _ = messages().length
    if (isAtBottom && scrollContainer) {
      requestAnimationFrame(() => {
        scrollToBottom()
      })
    }
  })

  // Fetch on mount / narrow change
  createEffect(on(
    () => props.narrow,
    () => {
      void fetchMessages()
    },
  ))

  // Get header text
  const headerText = () => {
    const parsed = nav.parseNarrow(props.narrow)
    if (!parsed) return props.narrow

    if (parsed.type === "topic") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)
      return `${stream?.name || `#${parsed.streamId}`} > ${parsed.topic}`
    } else if (parsed.type === "stream") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)
      return stream?.name || `#${parsed.streamId}`
    } else if (parsed.type === "dm") {
      const users = parsed.userIds!
        .map(id => sync.store.users.find(u => u.user_id === id))
        .filter(Boolean)
        .map(u => u!.full_name)
      return users.join(", ") || "Direct message"
    }
    return props.narrow
  }

  // Get stream color for the header
  const headerColor = () => {
    const parsed = nav.parseNarrow(props.narrow)
    if (!parsed?.streamId) return undefined
    return sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)?.color
  }

  return (
    <div class="flex-1 flex flex-col min-h-0" data-component="message-list">
      {/* Header */}
      <header class="h-12 flex items-center gap-2 px-4 border-b border-[var(--border-default)] bg-[var(--background-surface)] shrink-0">
        <Show when={headerColor()}>
          {(color) => (
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ "background-color": color() }}
            />
          )}
        </Show>
        <h1 class="text-sm font-semibold text-[var(--text-primary)] truncate flex-1">
          {headerText()}
        </h1>
        <div class="flex items-center gap-1 shrink-0">
          {/* Mark all as read */}
          <Show when={nav.parseNarrow(props.narrow)?.type === "stream" || nav.parseNarrow(props.narrow)?.type === "topic"}>
            <button
              class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
              onClick={async () => {
                const p = nav.parseNarrow(props.narrow)
                if (!p?.streamId) return
                if (p.type === "topic" && p.topic) {
                  await commands.markTopicAsRead(org.orgId, p.streamId, p.topic)
                } else {
                  await commands.markStreamAsRead(org.orgId, p.streamId)
                }
              }}
              title="Mark all as read"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7l4 4 8-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </Show>

          {/* Supervisor toggle — visible in stream and topic narrows */}
          <Show when={nav.parseNarrow(props.narrow)?.type === "topic" || nav.parseNarrow(props.narrow)?.type === "stream"}>
            {(() => {
              const isTopic = () => nav.parseNarrow(props.narrow)?.type === "topic"
              return (
                <button
                  class={`p-1.5 rounded-[var(--radius-sm)] transition-colors ${
                    supervisor.store.active
                      ? "text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
                      : isTopic()
                        ? "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
                        : "text-[var(--text-quaternary)] cursor-default"
                  }`}
                  onClick={() => {
                    if (!isTopic()) return
                    if (supervisor.store.active) {
                      supervisor.close()
                    } else {
                      const parsed = nav.parseNarrow(props.narrow)
                      if (!parsed || parsed.type !== "topic") return
                      const stream = sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)
                      supervisor.openForTopic(parsed.streamId!, stream?.name ?? "", parsed.topic!)
                    }
                  }}
                  title={
                    supervisor.store.active
                      ? "Close Supervisor"
                      : isTopic()
                        ? "Open Supervisor"
                        : "Select a topic to use the Supervisor"
                  }
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v1a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5Z" stroke="currentColor" stroke-width="1.2" />
                    <path d="M3 8.5h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                    <circle cx="5" cy="11.5" r="1" fill="currentColor" />
                    <circle cx="8" cy="11.5" r="1" fill="currentColor" />
                    <circle cx="11" cy="11.5" r="1" fill="currentColor" />
                  </svg>
                </button>
              )
            })()}
          </Show>

          <Show when={props.onToggleUserPanel}>
            <button
              class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
              onClick={() => props.onToggleUserPanel?.()}
              title="Toggle user panel"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2" />
                <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
              </svg>
            </button>
          </Show>

        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollContainer!}
        class="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {/* Loading indicator at top */}
        <Show when={loading() && messages().length > 0}>
          <div class="text-center py-2">
            <span class="text-xs text-[var(--text-tertiary)]">Loading older messages...</span>
          </div>
        </Show>

        <Show when={loadState() === "loaded-all" && messages().length > 0}>
          <div class="text-center py-3">
            <span class="text-xs text-[var(--text-tertiary)]">Beginning of conversation</span>
          </div>
        </Show>

        {/* Message list */}
        <Show
          when={!loading() || messages().length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center py-12">
              <span class="text-sm text-[var(--text-tertiary)]">Loading messages...</span>
            </div>
          }
        >
          <For each={messages()}>
            {(message, idx) => {
              const prev = () => idx() > 0 ? messages()[idx() - 1] : null
              const showDateSeparator = () => {
                const p = prev()
                if (!p) return true
                return isDifferentDay(p.timestamp, message.timestamp)
              }
              const showSender = () => {
                if (showDateSeparator()) return true
                const p = prev()
                if (!p) return true
                if (p.sender_id !== message.sender_id) return true
                if (message.timestamp - p.timestamp > 300) return true
                return false
              }

              return (
                <>
                  <Show when={showDateSeparator()}>
                    <div class="flex items-center gap-4 px-4 pt-4 pb-1 select-none" data-component="date-separator">
                      <div class="flex-1 h-px bg-[var(--border-default)]" />
                      <span class="text-xs font-medium text-[var(--text-tertiary)] whitespace-nowrap">
                        {formatDateSeparator(message.timestamp)}
                      </span>
                      <div class="flex-1 h-px bg-[var(--border-default)]" />
                    </div>
                  </Show>
                  <MessageItem message={message} showSender={showSender()} />
                </>
              )
            }}
          </For>
        </Show>

        {/* Error state */}
        <Show when={error()}>
          <div class="text-center py-4">
            <p class="text-sm text-[var(--status-error)]">{error()}</p>
            <button
              class="text-xs text-[var(--interactive-primary)] mt-1 hover:underline"
              onClick={fetchMessages}
            >
              Retry
            </button>
          </div>
        </Show>

        {/* Empty state */}
        <Show when={!loading() && messages().length === 0 && !error()}>
          <div class="flex-1 flex items-center justify-center py-12">
            <span class="text-sm text-[var(--text-tertiary)]">No messages yet</span>
          </div>
        </Show>

        {/* Bottom spacer — breathing room before compose box */}
        <Show when={messages().length > 0}>
          <div style={{ height: "16px" }} />
        </Show>
      </div>
    </div>
  )
}
