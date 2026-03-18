import { createEffect, createSignal, For, Show, on, onCleanup } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { useNavigation } from "../context/navigation"
import { narrowToApiFilters } from "../context/navigation-utils"
import { useSupervisor } from "../context/supervisor"
import { commands } from "@foundry/desktop/bindings"
import type { NarrowFilter } from "@foundry/desktop/bindings"
import { MessageItem } from "./message-item"
import type { ReplyTarget } from "./message-reply"
import { scrollToMessageWhenReady } from "./message-scroll"
import { THREAD_SCROLL_TO_BOTTOM_EVENT, type ThreadScrollDetail } from "./thread-scroll"

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

function MessageSkeleton(props: { short?: boolean }) {
  return (
    <div class="flex gap-3 px-5 py-1 pt-4">
      <div class="w-9 h-9 rounded-full bg-[var(--background-elevated)] animate-pulse shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <div class="w-24 h-3.5 rounded bg-[var(--background-elevated)] animate-pulse" />
          <div class="w-10 h-3 rounded bg-[var(--background-elevated)] animate-pulse" />
        </div>
        <div class="space-y-1.5">
          <div class="h-3.5 rounded bg-[var(--background-elevated)] animate-pulse" style={{ width: props.short ? "40%" : "85%" }} />
          <Show when={!props.short}>
            <div class="h-3.5 rounded bg-[var(--background-elevated)] animate-pulse" style={{ width: "60%" }} />
          </Show>
        </div>
      </div>
    </div>
  )
}

export function MessageList(props: {
  narrow: string
  onReply?: (target: ReplyTarget) => void
  onToggleUserPanel?: () => void
}) {
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
  const anchorMessageId = () => nav.activeNarrow() === props.narrow ? nav.messageAnchorId() : null

  let scrollPollTimer: ReturnType<typeof setInterval> | undefined
  let lastHandledAnchor: { narrow: string; messageId: number } | null = null

  const scrollToBottom = () => {
    if (!scrollContainer) return
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    isAtBottom = true
  }

  // Poll scrollHeight for a few seconds after narrow change to catch
  // late-loading content (images, link previews) that increases height
  const startScrollPolling = () => {
    if (scrollPollTimer) clearInterval(scrollPollTimer)
    let lastHeight = 0
    const until = Date.now() + 1000
    scrollPollTimer = setInterval(() => {
      if (Date.now() > until || !scrollContainer) {
        clearInterval(scrollPollTimer)
        return
      }
      if (scrollContainer.scrollHeight !== lastHeight) {
        lastHeight = scrollContainer.scrollHeight
        scrollToBottom()
      }
    }, 100)
  }

  const markMessagesRead = async (messageIds: number[]) => {
    if (messageIds.length === 0) return
    await sync.markMessagesRead(messageIds)
  }

  const narrowFilters = (): NarrowFilter[] => narrowToApiFilters(props.narrow, sync.store.subscriptions)

  // Fetch messages when narrow changes
  const fetchMessages = async (targetMessageId: number | null = null) => {
    if (IS_DEMO) {
      setError("")
      setLoading(false)
      return
    }

    if (targetMessageId !== null && messages().some((message) => message.id === targetMessageId)) {
      setError("")
      return
    }

    // Guard on local loading signal to prevent concurrent fetches
    // (avoids stale store loadState from interrupted HMR)
    if (loading()) return

    setLoading(true)
    setError("")

    try {
      if (targetMessageId !== null) {
        const result = await commands.getMessages(
          org.orgId,
          narrowFilters(),
          String(targetMessageId),
          30,
          30,
        )

        if (result.status === "error") {
          setError(result.error || "Failed to load messages")
          return
        }

        sync.addMessages(props.narrow, result.data.messages)
        sync.setMessageLoadState(props.narrow, result.data.found_oldest ? "loaded-all" : "idle")

        const unreadIds = result.data.messages
          .filter((message) => !(message.flags || []).includes("read"))
          .map((message) => message.id)
        await markMessagesRead(unreadIds)
        return
      }

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

  // Clean up polling on component dispose
  onCleanup(() => { if (scrollPollTimer) clearInterval(scrollPollTimer) })

  // Auto-scroll when content height grows (reactions, images, etc.) while at bottom
  let resizeObserver: ResizeObserver | undefined
  createEffect(() => {
    if (!scrollContainer) return
    resizeObserver?.disconnect()
    let lastHeight = scrollContainer.scrollHeight
    resizeObserver = new ResizeObserver(() => {
      const newHeight = scrollContainer.scrollHeight
      if (newHeight > lastHeight && isAtBottom) {
        requestAnimationFrame(() => scrollToBottom())
      }
      lastHeight = newHeight
    })
    // Observe the content inside the scroll container
    for (const child of scrollContainer.children) {
      resizeObserver.observe(child)
    }
  })
  onCleanup(() => resizeObserver?.disconnect())

  // Scroll to bottom when compose box sends a message
  const handleThreadScroll = (e: Event) => {
    const detail = (e as CustomEvent<ThreadScrollDetail>).detail
    if (detail.narrow === props.narrow) {
      requestAnimationFrame(() => scrollToBottom())
    }
  }
  window.addEventListener(THREAD_SCROLL_TO_BOTTOM_EVENT, handleThreadScroll)
  onCleanup(() => window.removeEventListener(THREAD_SCROLL_TO_BOTTOM_EVENT, handleThreadScroll))

  // Fetch on mount / narrow change, and optionally center an anchor message.
  createEffect(on(
    () => [props.narrow, anchorMessageId()] as const,
    ([narrow, currentAnchorMessageId]) => {
      if (currentAnchorMessageId === null && lastHandledAnchor?.narrow === narrow) {
        lastHandledAnchor = null
        return
      }

      isAtBottom = currentAnchorMessageId === null
      if (currentAnchorMessageId !== null) {
        lastHandledAnchor = { narrow, messageId: currentAnchorMessageId }
      } else {
        lastHandledAnchor = null
      }

      void fetchMessages(currentAnchorMessageId).then(() => {
        requestAnimationFrame(() => {
          if (currentAnchorMessageId !== null) {
            void scrollToMessageWhenReady(currentAnchorMessageId).finally(() => {
              nav.clearMessageAnchor(currentAnchorMessageId)
            })
            return
          }

          scrollToBottom()
          // Poll for 3s to catch async content (images, link previews)
          startScrollPolling()
        })
      })
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
                  await sync.markTopicAsRead(p.streamId, p.topic)
                } else {
                  await sync.markStreamAsRead(p.streamId)
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

          <Show when={props.onToggleUserPanel && nav.parseNarrow(props.narrow)?.type !== "dm"}>
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
        role="log"
        aria-live="polite"
        aria-label="Message history"
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
            <div class="py-4">
              <MessageSkeleton />
              <MessageSkeleton />
              <MessageSkeleton />
              <MessageSkeleton short />
              <MessageSkeleton />
            </div>
          }
        >
          <div class="message-list-enter">
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
                      <div class="flex items-center px-5 pt-6 pb-2 select-none" data-component="date-separator">
                        <div class="flex-1 h-px bg-[var(--border-default)]" />
                        <span class="text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap px-3 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--background-base)]">
                          {formatDateSeparator(message.timestamp)}
                        </span>
                        <div class="flex-1 h-px bg-[var(--border-default)]" />
                      </div>
                    </Show>
                    <MessageItem
                      message={message}
                      onReply={props.onReply}
                      showSender={showSender()}
                    />
                  </>
                )
              }}
            </For>
          </div>
        </Show>

        {/* Error state */}
        <Show when={error()}>
          <div class="text-center py-4">
            <p class="text-sm text-[var(--status-error)]">{error()}</p>
            <button
              class="text-xs text-[var(--interactive-primary)] mt-1 hover:underline"
              onClick={() => {
                void fetchMessages()
              }}
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
