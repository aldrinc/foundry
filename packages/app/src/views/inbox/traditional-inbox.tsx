import { For, Show } from "solid-js"
import type { UnreadItem } from "../../context/zulip-sync"

type StreamGroup = {
  streamId: number
  streamName: string
  streamColor: string
  topics: Extract<UnreadItem, { kind: "stream" }>[]
  totalCount: number
}

type DirectItem = Extract<UnreadItem, { kind: "dm" }>

export function TraditionalInbox(props: {
  groupedUnreads: StreamGroup[]
  directUnreadItems: DirectItem[]
  onTopicClick: (streamId: number, topic: string) => void
  onStreamClick: (streamId: number) => void
  onMarkStreamRead: (streamId: number) => void
  onMarkTopicRead: (streamId: number, topic: string) => void
  onDmClick: (narrow: string) => void
  onMarkDmRead: (messageIds: number[]) => void
}) {
  return (
    <Show
      when={props.groupedUnreads.length > 0 || props.directUnreadItems.length > 0}
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
      <For each={props.groupedUnreads}>
        {(group) => (
          <div data-component="inbox-stream-group">
            <div class="flex items-center gap-2 px-4 py-2 bg-[var(--background-surface)] border-b border-[var(--border-default)]">
              <button
                class="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-[var(--text-primary)] transition-colors"
                onClick={() => props.onStreamClick(group.streamId)}
              >
                <span
                  class="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ "background-color": group.streamColor || "var(--text-tertiary)" }}
                />
                <span class="text-sm font-medium text-[var(--text-primary)] flex-1 truncate">
                  {group.streamName}
                </span>
                <span class="text-xs text-[var(--text-tertiary)]">
                  {group.totalCount}
                </span>
              </button>
              <button
                class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
                onClick={() => props.onMarkStreamRead(group.streamId)}
                title="Mark all as read"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7l4 4 8-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>

            <For each={group.topics.sort((a, b) => b.last_message_id - a.last_message_id)}>
              {(item) => (
                <div
                  class="group flex items-center gap-2 px-4 pl-9 py-1.5 hover:bg-[var(--background-surface)] transition-colors"
                  data-component="inbox-topic-item"
                >
                  <button
                    class="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={() => props.onTopicClick(item.stream_id, item.topic)}
                  >
                    <span class="text-sm text-[var(--text-primary)] flex-1 truncate">
                      {item.topic}
                    </span>
                    <span class="text-xs font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                      {item.count}
                    </span>
                  </button>
                  <button
                    class="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => props.onMarkTopicRead(item.stream_id, item.topic)}
                    title="Mark as read"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M1 7l4 4 8-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </div>
              )}
            </For>
          </div>
        )}
      </For>

      <Show when={props.directUnreadItems.length > 0}>
        <div data-component="inbox-dm-group">
          <div class="flex items-center justify-between px-4 py-2 bg-[var(--background-surface)] border-b border-[var(--border-default)]">
            <span class="text-sm font-medium text-[var(--text-primary)]">Direct messages</span>
            <span class="text-xs text-[var(--text-tertiary)]">
              {props.directUnreadItems.reduce((sum, item) => sum + item.count, 0)}
            </span>
          </div>

          <For each={props.directUnreadItems}>
            {(item) => (
              <div
                class="group flex items-center gap-2 px-4 py-2 hover:bg-[var(--background-surface)] transition-colors border-b border-[var(--border-default)]/50"
              >
                <button
                  class="flex items-center gap-2 flex-1 min-w-0 text-left"
                  onClick={() => props.onDmClick(item.narrow)}
                >
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-[var(--text-primary)] truncate font-medium">
                      {item.label}
                    </div>
                    <Show when={item.participant_names.length > 1}>
                      <div class="text-xs text-[var(--text-tertiary)] truncate">
                        {item.participant_names.join(", ")}
                      </div>
                    </Show>
                  </div>
                  <span class="text-xs font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {item.count}
                  </span>
                </button>
                <button
                  class="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => props.onMarkDmRead(item.message_ids)}
                  title="Mark as read"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M1 7l4 4 8-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Show>
  )
}
