import { createSignal, For, Show, createMemo, onMount } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useNavigation } from "../context/navigation"
import type { Message } from "../context/zulip-sync"
import { ALL_MESSAGES_NARROW } from "../context/message-cache"

interface TopicEntry {
  streamId: number
  streamName: string
  streamColor: string
  topic: string
  lastMessage: Message
  participantIds: number[]
  unreadCount: number
}

/**
 * RecentTopicsView — shows recent activity across all streams,
 * grouped by stream + topic, sorted by most recent activity.
 */
export function RecentTopicsView() {
  const sync = useZulipSync()
  const nav = useNavigation()

  const [loading, setLoading] = createSignal(false)

  // Fetch recent messages across all streams
  onMount(async () => {
    if (sync.isNarrowHydrated(ALL_MESSAGES_NARROW)) return
    setLoading(true)
    try {
      const result = await sync.ensureMessages(
        ALL_MESSAGES_NARROW,
        [],
        { limit: 200, markRead: false },
      )
      if (result.status === "error") {
        console.error("Failed to fetch recent topics:", result.error || "unknown error")
      }
    } catch (e) {
      console.error("Failed to fetch recent topics:", e)
    } finally {
      setLoading(false)
    }
  })

  // Derive topics from all cached messages
  const topics = createMemo(() => {
    const topicMap = new Map<string, TopicEntry>()
    const allMessages = sync.store.messages[ALL_MESSAGES_NARROW] || []
    const messageSources = allMessages.length > 0
      ? [allMessages]
      : Object.entries(sync.store.messages)
        .filter(([narrow]) => narrow.startsWith("stream:"))
        .map(([, messages]) => messages)

    for (const messages of messageSources) {
      const topicMessages = new Map<string, Message[]>()

      for (const msg of messages) {
        if (!msg.stream_id || !msg.subject) continue
        const key = `${msg.stream_id}:${msg.subject}`
        const group = topicMessages.get(key) || []
        group.push(msg)
        topicMessages.set(key, group)
      }

      for (const [key, groupedMessages] of topicMessages.entries()) {
        const separator = key.indexOf(":")
        const streamIdRaw = separator >= 0 ? key.slice(0, separator) : key
        const topic = separator >= 0 ? key.slice(separator + 1) : ""
        const streamId = parseInt(streamIdRaw, 10)
        if (isNaN(streamId) || groupedMessages.length === 0) continue

        const stream = sync.store.subscriptions.find(s => s.stream_id === streamId)
        if (!stream) continue

        const lastMsg = groupedMessages[groupedMessages.length - 1]
        const participantIds = [...new Set(groupedMessages.map(m => m.sender_id))]
        const unreadCount = groupedMessages.filter(m => !(m.flags || []).includes("read")).length
        const existing = topicMap.get(key)

        if (!existing || lastMsg.timestamp > existing.lastMessage.timestamp) {
          topicMap.set(key, {
            streamId,
            streamName: stream.name,
            streamColor: stream.color || "var(--text-tertiary)",
            topic,
            lastMessage: lastMsg,
            participantIds,
            unreadCount,
          })
        }
      }
    }

    return Array.from(topicMap.values()).sort(
      (a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp
    )
  })

  const formatTime = (ts: number) => {
    const now = Date.now() / 1000
    const diff = now - ts
    if (diff < 60) return "just now"
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }

  return (
    <div class="flex-1 flex flex-col min-h-0" data-component="recent-topics-view">
      {/* Header */}
      <header class="h-12 flex items-center gap-2 px-4 border-b border-[var(--border-default)] bg-[var(--background-surface)] shrink-0">
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" class="text-[var(--text-tertiary)]">
          <path d="M7 1v6l4 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <h1 class="text-sm font-semibold text-[var(--text-primary)]">Recent Topics</h1>
      </header>

      {/* Content */}
      <div class="flex-1 overflow-y-auto">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-12">
            <span class="text-sm text-[var(--text-tertiary)]">Loading recent topics...</span>
          </div>
        </Show>

        <Show when={!loading() && topics().length === 0}>
          <div class="flex items-center justify-center py-12">
            <span class="text-sm text-[var(--text-tertiary)]">No recent topics found</span>
          </div>
        </Show>

        <Show when={!loading() && topics().length > 0}>
          {/* Table header */}
          <div class="flex items-center px-4 py-2 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider border-b border-[var(--border-default)] bg-[var(--background-surface)]">
            <span class="flex-1">Topic</span>
            <span class="w-24 text-right">Activity</span>
            <span class="w-16 text-right">Unread</span>
          </div>

          <For each={topics()}>
            {(entry) => {
              // Pre-resolve participant users for this entry
              const participants = () => entry.participantIds.slice(0, 4).map(id => {
                const user = sync.store.users.find(u => u.user_id === id)
                return { id, name: user?.full_name ?? "?", initial: user?.full_name?.charAt(0).toUpperCase() ?? "?" }
              })

              return (
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--background-surface)] transition-colors border-b border-[var(--border-default)]/50"
                  onClick={() => nav.setActiveNarrow(`stream:${entry.streamId}/topic:${entry.topic}`)}
                >
                  {/* Stream color dot + name > topic */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        style={{ "background-color": entry.streamColor }}
                      />
                      <span class="text-xs text-[var(--text-secondary)] shrink-0">
                        {entry.streamName}
                      </span>
                      <span class="text-xs text-[var(--text-tertiary)]">&gt;</span>
                      <span class="text-sm text-[var(--text-primary)] truncate font-medium">
                        {entry.topic}
                      </span>
                    </div>
                  </div>

                  {/* Participant avatars — inline with fixed sizing */}
                  <div class="flex items-center shrink-0" style={{ gap: "3px" }}>
                    <For each={participants()}>
                      {(p) => (
                        <div
                          class="rounded-full flex items-center justify-center font-medium shrink-0"
                          style={{
                            width: "20px",
                            height: "20px",
                            "min-width": "20px",
                            "font-size": "10px",
                            background: "var(--background-elevated)",
                            color: "var(--text-secondary)",
                            border: "1px solid var(--border-default)",
                          }}
                          title={p.name}
                        >
                          {p.initial}
                        </div>
                      )}
                    </For>
                    <Show when={entry.participantIds.length > 4}>
                      <span class="text-[10px] text-[var(--text-tertiary)] ml-0.5">
                        +{entry.participantIds.length - 4}
                      </span>
                    </Show>
                  </div>

                  {/* Activity time */}
                  <span class="w-20 text-right text-xs text-[var(--text-tertiary)] shrink-0">
                    {formatTime(entry.lastMessage.timestamp)}
                  </span>

                  {/* Unread badge */}
                  <span class="w-14 text-right shrink-0">
                    <Show when={entry.unreadCount > 0}>
                      <span class="inline-block text-xs font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                        {entry.unreadCount}
                      </span>
                    </Show>
                  </span>
                </button>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}
