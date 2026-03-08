import { For, Show, createMemo } from "solid-js"
import { useZulipSync, type UnreadItem } from "../context/zulip-sync"
import { useNavigation } from "../context/navigation"

/**
 * Inbox view — shows unread conversations grouped by stream/topic.
 */
export function InboxView() {
  const sync = useZulipSync()
  const nav = useNavigation()

  // Group unread items by stream
  const groupedUnreads = createMemo(() => {
    const items = sync.store.unreadItems
    const groups = new Map<number, {
      streamId: number
      streamName: string
      streamColor: string
      topics: UnreadItem[]
      totalCount: number
    }>()

    for (const item of items) {
      let group = groups.get(item.stream_id)
      if (!group) {
        group = {
          streamId: item.stream_id,
          streamName: item.stream_name,
          streamColor: item.stream_color,
          topics: [],
          totalCount: 0,
        }
        groups.set(item.stream_id, group)
      }
      group.topics.push(item)
      group.totalCount += item.count
    }

    // Sort groups by most recent message
    return Array.from(groups.values()).sort((a, b) => {
      const aMax = Math.max(...a.topics.map(t => t.last_message_id))
      const bMax = Math.max(...b.topics.map(t => t.last_message_id))
      return bMax - aMax
    })
  })

  const totalUnread = createMemo(() =>
    sync.store.unreadItems.reduce((sum, item) => sum + item.count, 0)
  )

  const handleTopicClick = (streamId: number, topic: string) => {
    nav.setActiveNarrow(`stream:${streamId}/topic:${topic}`)
  }

  const handleStreamClick = (streamId: number) => {
    nav.setActiveNarrow(`stream:${streamId}`)
  }

  return (
    <div
      class="flex-1 flex flex-col"
      data-component="inbox-view"
    >
      {/* Header */}
      <header class="h-12 flex items-center justify-between px-4 border-b border-[var(--border-default)] bg-[var(--background-surface)] shrink-0">
        <h1 class="text-sm font-semibold text-[var(--text-primary)]">
          Inbox
        </h1>
        <Show when={totalUnread() > 0}>
          <span class="text-xs text-[var(--text-tertiary)]">
            {totalUnread()} unread
          </span>
        </Show>
      </header>

      {/* Content */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={groupedUnreads().length > 0}
          fallback={
            <div class="text-center py-12">
              <p class="text-[var(--text-secondary)]">
                You're all caught up!
              </p>
              <p class="text-sm text-[var(--text-tertiary)] mt-1">
                No unread messages
              </p>
            </div>
          }
        >
          <For each={groupedUnreads()}>
            {(group) => (
              <div data-component="inbox-stream-group">
                {/* Stream header */}
                <button
                  class="w-full flex items-center gap-2 px-4 py-2 bg-[var(--background-surface)] border-b border-[var(--border-default)] hover:bg-[var(--background-base)] transition-colors"
                  onClick={() => handleStreamClick(group.streamId)}
                >
                  <span
                    class="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ "background-color": group.streamColor || "var(--text-tertiary)" }}
                  />
                  <span class="text-sm font-medium text-[var(--text-primary)] flex-1 text-left truncate">
                    {group.streamName}
                  </span>
                  <span class="text-xs text-[var(--text-tertiary)]">
                    {group.totalCount}
                  </span>
                </button>

                {/* Topics */}
                <For each={group.topics.sort((a, b) => b.last_message_id - a.last_message_id)}>
                  {(item) => (
                    <button
                      class="w-full flex items-center gap-2 px-4 pl-9 py-1.5 hover:bg-[var(--background-surface)] transition-colors text-left"
                      onClick={() => handleTopicClick(item.stream_id, item.topic)}
                      data-component="inbox-topic-item"
                    >
                      <span class="text-sm text-[var(--text-primary)] flex-1 truncate">
                        {item.topic}
                      </span>
                      <span class="text-xs font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                        {item.count}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
