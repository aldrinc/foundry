import { createSignal, For, onMount, Show } from "solid-js";
import { MessageItem } from "../components/message-item";
import { useNavigation } from "../context/navigation";
import type { Message } from "../context/zulip-sync";
import { useZulipSync } from "../context/zulip-sync";

/**
 * StarredView — shows all starred messages.
 * Fetches using the `is:starred` narrow filter.
 */
export function StarredView() {
  const sync = useZulipSync();
  const nav = useNavigation();

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const messages = () => sync.store.messages["starred"] || [];

  // Fetch starred messages on mount
  onMount(async () => {
    if (sync.isNarrowHydrated("starred")) return;
    setLoading(true);
    setError("");

    try {
      const result = await sync.ensureMessages(
        "starred",
        [{ operator: "is", operand: "starred" }],
        { limit: 50, markRead: false },
      );

      if (result.status === "error") {
        setError(result.error || "Failed to load starred messages");
      }
    } catch (e: any) {
      setError(e?.toString() || "Failed to load starred messages");
    } finally {
      setLoading(false);
    }
  });

  // Get stream info for message origin headers
  const getMessageOrigin = (msg: Message) => {
    if (msg.stream_id) {
      const stream = sync.store.subscriptions.find(
        (s) => s.stream_id === msg.stream_id,
      );
      return {
        label: `${stream?.name || `#${msg.stream_id}`} > ${msg.subject}`,
        color: stream?.color,
        narrow: `stream:${msg.stream_id}/topic:${msg.subject}`,
      };
    }
    return null;
  };

  // Group messages by origin (stream > topic)
  const groupedMessages = () => {
    const groups: Array<{
      origin: { label: string; color?: string; narrow: string } | null;
      messages: Message[];
    }> = [];

    let currentOrigin: string | null = null;
    let currentGroup: Message[] = [];

    for (const msg of messages()) {
      const origin = getMessageOrigin(msg);
      const originKey = origin?.narrow ?? "unknown";

      if (originKey !== currentOrigin) {
        if (currentGroup.length > 0) {
          const prevOrigin = currentGroup[0]
            ? getMessageOrigin(currentGroup[0])
            : null;
          groups.push({ origin: prevOrigin, messages: currentGroup });
        }
        currentOrigin = originKey;
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }
    }

    if (currentGroup.length > 0) {
      const prevOrigin = currentGroup[0]
        ? getMessageOrigin(currentGroup[0])
        : null;
      groups.push({ origin: prevOrigin, messages: currentGroup });
    }

    return groups;
  };

  return (
    <div class="flex-1 flex flex-col min-h-0" data-component="starred-view">
      {/* Header */}
      <header class="h-12 flex items-center gap-2 px-4 border-b border-[var(--border-default)] bg-[var(--background-surface)] shrink-0">
        <svg
          width="16"
          height="16"
          viewBox="0 0 14 14"
          fill="none"
          class="text-[var(--text-tertiary)]"
        >
          <path
            d="M7 1l1.8 3.6L13 5.2l-3 2.9.7 4.1L7 10.3 3.3 12.2l.7-4.1-3-2.9 4.2-.6L7 1z"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <h1 class="text-sm font-semibold text-[var(--text-primary)]">
          Starred Messages
        </h1>
        <Show when={messages().length > 0}>
          <span class="text-xs text-[var(--text-tertiary)]">
            ({messages().length})
          </span>
        </Show>
      </header>

      {/* Messages */}
      <div class="flex-1 overflow-y-auto">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-12">
            <span class="text-sm text-[var(--text-tertiary)]">
              Loading starred messages...
            </span>
          </div>
        </Show>

        <Show when={error()}>
          <div class="text-center py-4">
            <p class="text-sm text-[var(--status-error)]">{error()}</p>
          </div>
        </Show>

        <Show when={!loading() && messages().length === 0 && !error()}>
          <div class="flex items-center justify-center py-12">
            <div class="text-center">
              <svg
                width="32"
                height="32"
                viewBox="0 0 14 14"
                fill="none"
                class="mx-auto mb-2 text-[var(--text-tertiary)]"
              >
                <path
                  d="M7 1l1.8 3.6L13 5.2l-3 2.9.7 4.1L7 10.3 3.3 12.2l.7-4.1-3-2.9 4.2-.6L7 1z"
                  stroke="currentColor"
                  stroke-width="1"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="text-sm text-[var(--text-tertiary)]">
                No starred messages yet
              </span>
              <p class="text-xs text-[var(--text-tertiary)] mt-1">
                Star important messages to find them here
              </p>
            </div>
          </div>
        </Show>

        <Show when={!loading() && messages().length > 0}>
          <For each={groupedMessages()}>
            {(group) => (
              <div>
                {/* Origin header */}
                <Show when={group.origin}>
                  {(origin) => (
                    <button
                      class="w-full flex items-center gap-1.5 px-4 py-1.5 text-left bg-[var(--background-surface)] border-b border-[var(--border-default)] hover:bg-[var(--background-elevated)] transition-colors"
                      onClick={() => nav.setActiveNarrow(origin().narrow)}
                    >
                      <Show when={origin().color}>
                        {(color) => (
                          <span
                            class="w-2 h-2 rounded-full shrink-0"
                            style={{ "background-color": color() }}
                          />
                        )}
                      </Show>
                      <span class="text-xs font-medium text-[var(--text-secondary)]">
                        {origin().label}
                      </span>
                    </button>
                  )}
                </Show>

                {/* Messages in this group */}
                <For each={group.messages}>
                  {(message, idx) => {
                    const prev = () =>
                      idx() > 0 ? group.messages[idx() - 1] : null;
                    const showSender = () => {
                      const p = prev();
                      if (!p) return true;
                      if (p.sender_id !== message.sender_id) return true;
                      if (message.timestamp - p.timestamp > 300) return true;
                      return false;
                    };
                    return (
                      <MessageItem
                        message={message}
                        showSender={showSender()}
                      />
                    );
                  }}
                </For>
              </div>
            )}
          </For>
          <div style={{ height: "16px" }} />
        </Show>
      </div>
    </div>
  );
}
