import { commands } from "@zulip/desktop/bindings";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { MessageItem } from "../components/message-item";
import { useNavigation } from "../context/navigation";
import { useOrg } from "../context/org";
import type { Message } from "../context/zulip-sync";
import { useZulipSync } from "../context/zulip-sync";

/**
 * AllMessagesView — shows all messages across all streams and DMs,
 * in chronological order with stream > topic divider headers.
 */
export function AllMessagesView() {
  const sync = useZulipSync();
  const org = useOrg();
  const nav = useNavigation();

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const messages = () => sync.store.messages["all-messages"] || [];
  const loadState = () => sync.store.messageLoadState["all-messages"] || "idle";

  let scrollContainer!: HTMLDivElement;
  let isAtBottom = true;

  const markMessagesRead = async (messageIds: number[]) => {
    if (messageIds.length === 0) return;
    await commands.updateMessageFlags(org.orgId, messageIds, "add", "read");
  };

  // Fetch all messages on mount
  onMount(async () => {
    if (sync.isNarrowHydrated("all-messages")) {
      const unreadIds = messages()
        .filter((m) => !(m.flags || []).includes("read"))
        .map((m) => m.id);
      await markMessagesRead(unreadIds);
      return;
    }
    await fetchMessages();
  });

  const fetchMessages = async () => {
    if (loading()) return;
    setLoading(true);
    setError("");

    try {
      const result = await sync.ensureMessages("all-messages", [], {
        limit: 50,
        markRead: true,
      });

      if (result.status === "error") {
        setError(result.error || "Failed to load messages");
        return;
      }

      if (result.fromCache) {
        const unreadIds = messages()
          .filter((m) => !(m.flags || []).includes("read"))
          .map((m) => m.id);
        await markMessagesRead(unreadIds);
      }
    } catch (e: any) {
      setError(e?.toString() || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  const fetchOlderMessages = async () => {
    if (loadState() !== "idle" || loading()) return;
    const msgs = messages();
    if (msgs.length === 0) return;

    setLoading(true);
    try {
      const result = await commands.getMessages(
        org.orgId,
        [],
        String(msgs[0].id),
        50,
        0,
      );
      if (result.status === "ok") {
        sync.addMessages("all-messages", result.data.messages);
        if (result.data.found_oldest) {
          sync.setMessageLoadState("all-messages", "loaded-all");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleScroll = () => {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (scrollTop < 100 && loadState() === "idle" && !loading()) {
      fetchOlderMessages();
    }
  };

  // Auto-scroll to bottom
  createEffect(() => {
    const _ = messages().length;
    if (isAtBottom && scrollContainer) {
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
    }
  });

  // Get topic divider info
  const getMessageContext = (msg: Message) => {
    if (msg.stream_id) {
      const stream = sync.store.subscriptions.find(
        (s) => s.stream_id === msg.stream_id,
      );
      return {
        type: "stream" as const,
        label: `${stream?.name || `#${msg.stream_id}`} > ${msg.subject}`,
        color: stream?.color,
        narrow: `stream:${msg.stream_id}/topic:${msg.subject}`,
      };
    }
    // DM
    return {
      type: "dm" as const,
      label: `DM with ${msg.sender_full_name}`,
      color: undefined,
      narrow: undefined,
    };
  };

  // Check if we need to show a topic divider before this message
  const needsDivider = (msg: Message, prev: Message | null) => {
    if (!prev) return true;
    if (msg.stream_id !== prev.stream_id) return true;
    if (msg.subject !== prev.subject) return true;
    if (msg.type !== prev.type) return true;
    return false;
  };

  return (
    <div
      class="flex-1 flex flex-col min-h-0"
      data-component="all-messages-view"
    >
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
            d="M2 3h10M2 7h10M2 11h6"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
        <h1 class="text-sm font-semibold text-[var(--text-primary)]">
          All Messages
        </h1>
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
            <span class="text-xs text-[var(--text-tertiary)]">
              Loading older messages...
            </span>
          </div>
        </Show>

        <Show when={loadState() === "loaded-all" && messages().length > 0}>
          <div class="text-center py-3">
            <span class="text-xs text-[var(--text-tertiary)]">
              Beginning of messages
            </span>
          </div>
        </Show>

        <Show
          when={!loading() || messages().length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center py-12">
              <span class="text-sm text-[var(--text-tertiary)]">
                Loading messages...
              </span>
            </div>
          }
        >
          <For each={messages()}>
            {(message, idx) => {
              const prev = () => (idx() > 0 ? messages()[idx() - 1] : null);
              const showDivider = () => needsDivider(message, prev());
              const context = () => getMessageContext(message);
              const showSender = () => {
                const p = prev();
                if (showDivider()) return true;
                if (!p) return true;
                if (p.sender_id !== message.sender_id) return true;
                if (message.timestamp - p.timestamp > 300) return true;
                return false;
              };

              return (
                <>
                  <Show when={showDivider()}>
                    <button
                      class="w-full flex items-center gap-1.5 px-4 py-1.5 text-left bg-[var(--background-surface)] border-b border-t border-[var(--border-default)] hover:bg-[var(--background-elevated)] transition-colors sticky top-0 z-10"
                      onClick={() => {
                        const ctx = context();
                        if (ctx.narrow) nav.setActiveNarrow(ctx.narrow);
                      }}
                    >
                      <Show when={context().color}>
                        {(color) => (
                          <span
                            class="w-2 h-2 rounded-full shrink-0"
                            style={{ "background-color": color() }}
                          />
                        )}
                      </Show>
                      <span class="text-xs font-medium text-[var(--text-secondary)]">
                        {context().label}
                      </span>
                    </button>
                  </Show>
                  <MessageItem message={message} showSender={showSender()} />
                </>
              );
            }}
          </For>
        </Show>

        {/* Error */}
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
            <span class="text-sm text-[var(--text-tertiary)]">
              No messages yet
            </span>
          </div>
        </Show>

        <Show when={messages().length > 0}>
          <div style={{ height: "16px" }} />
        </Show>
      </div>
    </div>
  );
}
