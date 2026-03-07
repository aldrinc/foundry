import type { Topic } from "@zulip/desktop/bindings";
import { commands } from "@zulip/desktop/bindings";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { useNavigation } from "../context/navigation";
import { useOrg } from "../context/org";
import { useZulipSync } from "../context/zulip-sync";
import { DirectMessageList } from "./dm-list";
import { PersonalMenu } from "./personal-menu";
import { SearchBar } from "./search-bar";

export function StreamSidebar(props: {
  onOpenSettings?: () => void;
  onLogout?: () => void;
}) {
  const sync = useZulipSync();
  const nav = useNavigation();
  const [showSearch, setShowSearch] = createSignal(false);
  const [showPersonalMenu, setShowPersonalMenu] = createSignal(false);

  const currentUserName = () => {
    const userId = sync.store.currentUserId;
    if (!userId) return null;
    return (
      sync.store.users.find((u) => u.user_id === userId)?.full_name ?? null
    );
  };

  const pinnedStreams = createMemo(() =>
    sync.store.subscriptions
      .filter((s) => s.pin_to_top && !s.is_muted)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const regularStreams = createMemo(() =>
    sync.store.subscriptions
      .filter((s) => !s.pin_to_top && !s.is_muted)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const mutedStreams = createMemo(() =>
    sync.store.subscriptions
      .filter((s) => s.is_muted)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const handleStreamClick = (streamId: number) => {
    nav.setActiveNarrow(`stream:${streamId}`);
  };

  return (
    <aside
      class="w-[260px] border-r border-[var(--border-default)] bg-[var(--surface-sidebar)] flex flex-col shrink-0"
      data-component="stream-sidebar"
    >
      {/* User header — avatar dropdown trigger */}
      <div class="relative h-12 px-3 border-b border-[var(--border-default)] flex items-center">
        <button
          class="flex items-center gap-2 min-w-0 w-full rounded-[var(--radius-sm)] hover:bg-[var(--background-surface)] transition-colors px-1 py-1 -mx-1"
          onClick={() => setShowPersonalMenu((s) => !s)}
        >
          <div class="w-6 h-6 rounded-full bg-[var(--interactive-primary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
            {currentUserName()?.charAt(0).toUpperCase() || "?"}
          </div>
          <span class="text-sm font-medium text-[var(--text-primary)] truncate flex-1 text-left">
            {currentUserName() || "User"}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            class="shrink-0 text-[var(--text-tertiary)]"
          >
            <path
              d="M3 4l2 2 2-2"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <Show when={showPersonalMenu()}>
          <PersonalMenu
            onClose={() => setShowPersonalMenu(false)}
            onOpenSettings={() => props.onOpenSettings?.()}
            onLogout={() => props.onLogout?.()}
          />
        </Show>
      </div>

      {/* Navigation views */}
      <div class="border-b border-[var(--border-default)] py-1">
        <NavButton
          label="Inbox"
          active={nav.activeNarrow() === null}
          onClick={() => nav.setActiveNarrow(null)}
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 4l5 3 5-3M2 4v6a1 1 0 001 1h8a1 1 0 001-1V4M2 4a1 1 0 011-1h8a1 1 0 011 1"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          }
        />
        <NavButton
          label="Recent Topics"
          active={nav.activeNarrow() === "recent-topics"}
          onClick={() => nav.setActiveNarrow("recent-topics")}
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1v6l4 2"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle
                cx="7"
                cy="7"
                r="6"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
          }
        />
        <NavButton
          label="Starred Messages"
          active={nav.activeNarrow() === "starred"}
          onClick={() => nav.setActiveNarrow("starred")}
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1l1.8 3.6L13 5.2l-3 2.9.7 4.1L7 10.3 3.3 12.2l.7-4.1-3-2.9 4.2-.6L7 1z"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          }
        />
        <NavButton
          label="All Messages"
          active={nav.activeNarrow() === "all-messages"}
          onClick={() => nav.setActiveNarrow("all-messages")}
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 3h10M2 7h10M2 11h6"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          }
        />
      </div>

      {/* Channels header with search icon */}
      <div class="px-3 py-2 flex items-center justify-between">
        <span class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
          Channels
        </span>
        <button
          class="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
          onClick={() => setShowSearch((s) => !s)}
          title="Search messages (⌘K)"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <circle
              cx="6"
              cy="6"
              r="4.5"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <path
              d="M9.5 9.5L13 13"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Expandable search bar */}
      <Show when={showSearch()}>
        <div class="px-2 pb-2">
          <SearchBar onClose={() => setShowSearch(false)} />
        </div>
      </Show>

      {/* Stream list */}
      <div class="flex-1 overflow-y-auto py-1 min-h-0">
        <Show when={sync.store.subscriptions.length === 0}>
          <p class="text-xs text-[var(--text-tertiary)] p-3">
            No channels loaded yet
          </p>
        </Show>

        {/* Pinned */}
        <Show when={pinnedStreams().length > 0}>
          <For each={pinnedStreams()}>
            {(stream) => (
              <StreamItem
                stream={stream}
                active={
                  nav
                    .activeNarrow()
                    ?.startsWith(`stream:${stream.stream_id}`) ?? false
                }
                unreadCount={sync.store.unreadCounts[stream.stream_id] ?? 0}
                onClick={() => handleStreamClick(stream.stream_id)}
              />
            )}
          </For>
        </Show>

        {/* Regular */}
        <Show when={regularStreams().length > 0}>
          <For each={regularStreams()}>
            {(stream) => (
              <StreamItem
                stream={stream}
                active={
                  nav
                    .activeNarrow()
                    ?.startsWith(`stream:${stream.stream_id}`) ?? false
                }
                unreadCount={sync.store.unreadCounts[stream.stream_id] ?? 0}
                onClick={() => handleStreamClick(stream.stream_id)}
              />
            )}
          </For>
        </Show>

        {/* Muted */}
        <Show when={mutedStreams().length > 0}>
          <div class="px-3 py-1 mt-2">
            <span class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
              Muted
            </span>
          </div>
          <For each={mutedStreams()}>
            {(stream) => (
              <StreamItem
                stream={stream}
                active={
                  nav
                    .activeNarrow()
                    ?.startsWith(`stream:${stream.stream_id}`) ?? false
                }
                unreadCount={sync.store.unreadCounts[stream.stream_id] ?? 0}
                onClick={() => handleStreamClick(stream.stream_id)}
                muted
              />
            )}
          </For>
        </Show>
      </div>

      {/* Direct Messages section */}
      <DirectMessageList />
    </aside>
  );
}

function StreamItem(props: {
  stream: {
    stream_id: number;
    name: string;
    color?: string;
    is_muted?: boolean;
  };
  active: boolean;
  unreadCount: number;
  onClick: () => void;
  muted?: boolean;
}) {
  const org = useOrg();
  const nav = useNavigation();
  const sync = useZulipSync();
  const [expanded, setExpanded] = createSignal(false);
  const [topics, setTopics] = createSignal<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = createSignal(false);
  const [topicError, setTopicError] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
    type: "stream" | "topic";
    topicName?: string;
  } | null>(null);

  const toggleExpand = async (e: MouseEvent) => {
    e.stopPropagation();
    if (expanded()) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (topics().length === 0 && !loadingTopics()) {
      setLoadingTopics(true);
      setTopicError("");
      try {
        // Add timeout to prevent indefinite hanging
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out")), 15000),
        );
        const result = await Promise.race([
          commands.getStreamTopics(org.orgId, props.stream.stream_id),
          timeoutPromise,
        ]);
        if (result.status === "ok") {
          setTopics(result.data);
        } else {
          console.error(
            `[Topics] Failed to load topics for stream ${props.stream.name}:`,
            result.error,
          );
          setTopicError(result.error || "Failed to load");
        }
      } catch (e: any) {
        console.error(
          `[Topics] Error loading topics for stream ${props.stream.name}:`,
          e,
        );
        setTopicError(e?.message || "Failed to load topics");
      } finally {
        setLoadingTopics(false);
      }
    }
  };

  const handleStreamContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "stream" });
    const close = () => {
      setContextMenu(null);
      document.removeEventListener("click", close);
    };
    document.addEventListener("click", close);
  };

  const handleTopicContextMenu = (e: MouseEvent, topicName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "topic", topicName });
    const close = () => {
      setContextMenu(null);
      document.removeEventListener("click", close);
    };
    document.addEventListener("click", close);
  };

  const handleMarkAsRead = async () => {
    setContextMenu(null);
    await commands.markStreamAsRead(org.orgId, props.stream.stream_id);
  };

  const handleToggleMute = async () => {
    setContextMenu(null);
    try {
      // Toggle mute state via subscription update
      const isMuted = props.stream.is_muted || props.muted;
      // Update the local store immediately for responsiveness
      sync.handleSubscriptionEvent({
        op: "update",
        stream_id: props.stream.stream_id,
        is_muted: !isMuted,
      });
    } catch (e) {
      console.error("Failed to toggle mute:", e);
    }
  };

  const handleTopicClick = (topic: string) => {
    nav.setActiveNarrow(`stream:${props.stream.stream_id}/topic:${topic}`);
  };

  const handleMarkTopicAsRead = async (topicName: string) => {
    setContextMenu(null);
    try {
      await commands.markTopicAsRead(
        org.orgId,
        props.stream.stream_id,
        topicName,
      );
    } catch (e) {
      console.error("Failed to mark topic as read:", e);
    }
  };

  return (
    <div>
      <button
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--background-surface)]"
        classList={{
          "bg-[var(--background-surface)]": props.active,
          "opacity-50": props.muted,
        }}
        onClick={props.onClick}
        onContextMenu={handleStreamContextMenu}
        data-component="stream-item"
      >
        {/* Expand arrow */}
        <span
          onClick={toggleExpand}
          class="w-3 h-3 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            class={`transition-transform ${expanded() ? "rotate-90" : ""}`}
          >
            <path
              d="M2 1l3 3-3 3"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>

        {/* Color dot */}
        <span
          class="w-2 h-2 rounded-full shrink-0"
          style={{
            "background-color": props.stream.color || "var(--text-tertiary)",
          }}
        />

        {/* Name */}
        <span class="flex-1 truncate text-[var(--text-primary)]">
          {props.stream.name}
        </span>

        {/* Unread badge */}
        <Show when={props.unreadCount > 0}>
          <span class="text-xs font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {props.unreadCount}
          </span>
        </Show>
      </button>

      {/* Topics list */}
      <Show when={expanded()}>
        <div class="ml-6 border-l border-[var(--border-default)]">
          <Show when={loadingTopics()}>
            <div class="text-[10px] text-[var(--text-tertiary)] px-3 py-1">
              Loading topics...
            </div>
          </Show>

          <Show when={topicError() && !loadingTopics()}>
            <div class="px-3 py-1 flex items-center gap-1">
              <span class="text-[10px] text-[var(--status-error)]">
                Failed to load
              </span>
              <button
                class="text-[10px] text-[var(--interactive-primary)] hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  setTopicError("");
                  setTopics([]);
                  toggleExpand(e as any);
                }}
              >
                Retry
              </button>
            </div>
          </Show>

          <For each={topics()}>
            {(topic) => (
              <button
                class="w-full flex items-center gap-2 px-3 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--background-surface)] hover:text-[var(--text-primary)] transition-colors"
                classList={{
                  "text-[var(--text-primary)] bg-[var(--background-surface)]":
                    nav.activeNarrow() ===
                    `stream:${props.stream.stream_id}/topic:${topic.name}`,
                }}
                onClick={() => handleTopicClick(topic.name)}
                onContextMenu={(e) => handleTopicContextMenu(e, topic.name)}
              >
                <span class="flex-1 truncate">{topic.name}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Context menu */}
      <Show when={contextMenu()}>
        {(ctx) => (
          <div
            class="fixed z-50 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-md py-1 min-w-[160px]"
            style={{ left: `${ctx().x}px`, top: `${ctx().y}px` }}
          >
            <Show when={ctx().type === "stream"}>
              <ContextMenuItem
                label="Mark as read"
                onClick={handleMarkAsRead}
              />
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem
                label={props.muted ? "Unmute channel" : "Mute channel"}
                onClick={handleToggleMute}
              />
            </Show>

            <Show when={ctx().type === "topic" && ctx().topicName}>
              <ContextMenuItem
                label="Mark topic as read"
                onClick={() => handleMarkTopicAsRead(ctx().topicName!)}
              />
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem
                label="Open in new view"
                onClick={() => {
                  setContextMenu(null);
                  nav.setActiveNarrow(
                    `stream:${props.stream.stream_id}/topic:${ctx().topicName}`,
                  );
                }}
              />
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function ContextMenuItem(props: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      class="w-full text-left px-3 py-1.5 text-xs transition-colors"
      classList={{
        "text-[var(--status-error)] hover:bg-[var(--status-error)]/10":
          props.danger,
        "text-[var(--text-primary)] hover:bg-[var(--background-elevated)]":
          !props.danger,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

/** Navigation button for sidebar views (Inbox, etc.) */
function NavButton(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: JSX.Element;
  badge?: number;
}) {
  return (
    <button
      class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--background-surface)]"
      classList={{
        "bg-[var(--background-surface)] text-[var(--text-primary)] font-medium":
          props.active,
        "text-[var(--text-secondary)]": !props.active,
      }}
      onClick={props.onClick}
    >
      <span class="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-tertiary)]">
        {props.icon}
      </span>
      <span class="flex-1 truncate">{props.label}</span>
      <Show when={props.badge && props.badge > 0}>
        <span class="text-xs font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
          {props.badge}
        </span>
      </Show>
    </button>
  );
}
