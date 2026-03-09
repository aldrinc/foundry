import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { useNavigation } from "../context/navigation"
import { commands } from "@zulip/desktop/bindings"
import type { Topic } from "@zulip/desktop/bindings"
import { DirectMessageList } from "./dm-list"
import { SearchBar } from "./search-bar"
import { PersonalMenu } from "./personal-menu"
import { OrgSwitcher } from "./org-switcher"
import type { SavedServerStatus } from "@zulip/desktop/bindings"
import { getUnreadTotalCount } from "../context/unread-state"

export function StreamSidebar(props: { onOpenSettings?: () => void; onLogout?: () => void | Promise<void>; onSwitchOrg?: (server: SavedServerStatus) => void }) {
  const sync = useZulipSync()
  const org = useOrg()
  const nav = useNavigation()
  const [showSearch, setShowSearch] = createSignal(false)
  const [showPersonalMenu, setShowPersonalMenu] = createSignal(false)
  const [showCreateChannel, setShowCreateChannel] = createSignal(false)

  const currentUserName = () => {
    const userId = sync.store.currentUserId
    if (!userId) return null
    return sync.store.users.find(u => u.user_id === userId)?.full_name ?? null
  }

  const pinnedStreams = createMemo(() =>
    sync.store.subscriptions
      .filter(s => s.pin_to_top && !s.is_muted)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  const regularStreams = createMemo(() =>
    sync.store.subscriptions
      .filter(s => !s.pin_to_top && !s.is_muted)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  const mutedStreams = createMemo(() =>
    sync.store.subscriptions
      .filter(s => s.is_muted)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  const totalUnread = createMemo(() => getUnreadTotalCount(sync.store.unreadItems))

  const handleStreamClick = (streamId: number) => {
    nav.setActiveNarrow(`stream:${streamId}`)
  }

  return (
    <aside
      class="w-[260px] border-r border-[var(--border-default)] bg-[var(--surface-sidebar)] flex flex-col shrink-0"
      data-component="stream-sidebar"
    >
      {/* Org switcher */}
      <OrgSwitcher
        currentOrgId={org.orgId}
        onSwitch={(server) => props.onSwitchOrg?.(server)}
        onAddOrg={() => props.onOpenSettings?.()}
      />

      {/* User header — avatar dropdown trigger */}
      <div class="relative h-12 px-3 border-b border-[var(--border-default)] flex items-center">
        <button
          class="flex items-center gap-2 min-w-0 w-full rounded-[var(--radius-sm)] hover:bg-[var(--background-surface)] transition-colors px-1 py-1 -mx-1"
          onClick={() => setShowPersonalMenu(s => !s)}
        >
          <div class="w-6 h-6 rounded-full bg-[var(--interactive-primary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
            {currentUserName()?.charAt(0).toUpperCase() || "?"}
          </div>
          <span class="text-sm font-medium text-[var(--text-primary)] truncate flex-1 text-left">
            {currentUserName() || "User"}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="shrink-0 text-[var(--text-tertiary)]">
            <path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
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
          badge={totalUnread()}
          icon={<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4l5 3 5-3M2 4v6a1 1 0 001 1h8a1 1 0 001-1V4M2 4a1 1 0 011-1h8a1 1 0 011 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>}
        />
        <NavButton
          label="Recent Topics"
          active={nav.activeNarrow() === "recent-topics"}
          onClick={() => nav.setActiveNarrow("recent-topics")}
          icon={<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v6l4 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" /></svg>}
        />
        <NavButton
          label="Starred Messages"
          active={nav.activeNarrow() === "starred"}
          onClick={() => nav.setActiveNarrow("starred")}
          icon={<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.8 3.6L13 5.2l-3 2.9.7 4.1L7 10.3 3.3 12.2l.7-4.1-3-2.9 4.2-.6L7 1z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>}
        />
        <NavButton
          label="All Messages"
          active={nav.activeNarrow() === "all-messages"}
          onClick={() => nav.setActiveNarrow("all-messages")}
          icon={<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M2 7h10M2 11h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>}
        />
      </div>

      {/* Channels header with search and add icons */}
      <div class="px-3 py-2 flex items-center justify-between">
        <span class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Channels</span>
        <div class="flex items-center gap-0.5">
          <button
            class="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
            onClick={() => setShowCreateChannel(s => !s)}
            title="Create channel"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
          <button
            class="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
            onClick={() => setShowSearch(s => !s)}
            title="Search messages (⌘K)"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3" />
              <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Create channel form */}
      <Show when={showCreateChannel()}>
        <CreateChannelForm
          orgId={org.orgId}
          onClose={() => setShowCreateChannel(false)}
        />
      </Show>

      {/* Expandable search bar */}
      <Show when={showSearch()}>
        <div class="px-2 pb-2">
          <SearchBar onClose={() => setShowSearch(false)} />
        </div>
      </Show>

      {/* Stream list */}
      <div class="flex-1 overflow-y-auto py-1 min-h-0">
        <Show when={sync.store.subscriptions.length === 0}>
          <p class="text-xs text-[var(--text-tertiary)] p-3">No channels loaded yet</p>
        </Show>

        {/* Pinned */}
        <Show when={pinnedStreams().length > 0}>
          <For each={pinnedStreams()}>
            {(stream) => (
              <StreamItem
                stream={stream}
                active={nav.activeNarrow()?.startsWith(`stream:${stream.stream_id}`) ?? false}
                unreadCount={sync.store.unreadCounts[stream.stream_id] ?? 0}
                onClick={() => handleStreamClick(stream.stream_id)}
                onOpenSettings={props.onOpenSettings}
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
                active={nav.activeNarrow()?.startsWith(`stream:${stream.stream_id}`) ?? false}
                unreadCount={sync.store.unreadCounts[stream.stream_id] ?? 0}
                onClick={() => handleStreamClick(stream.stream_id)}
                onOpenSettings={props.onOpenSettings}
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
                active={nav.activeNarrow()?.startsWith(`stream:${stream.stream_id}`) ?? false}
                unreadCount={sync.store.unreadCounts[stream.stream_id] ?? 0}
                onClick={() => handleStreamClick(stream.stream_id)}
                muted
                onOpenSettings={props.onOpenSettings}
              />
            )}
          </For>
        </Show>
      </div>

      {/* Direct Messages section */}
      <DirectMessageList />
    </aside>
  )
}

function StreamItem(props: {
  stream: { stream_id: number; name: string; color?: string; is_muted?: boolean; pin_to_top?: boolean }
  active: boolean
  unreadCount: number
  onClick: () => void
  muted?: boolean
  onOpenSettings?: () => void
}) {
  const org = useOrg()
  const nav = useNavigation()
  const sync = useZulipSync()
  const [expanded, setExpanded] = createSignal(false)
  const [topics, setTopics] = createSignal<Topic[]>([])
  const [loadingTopics, setLoadingTopics] = createSignal(false)
  const [topicError, setTopicError] = createSignal("")
  const [topicsLoaded, setTopicsLoaded] = createSignal(false)
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; type: "stream" | "topic"; topicName?: string } | null>(null)
  const [moveDialog, setMoveDialog] = createSignal<{ topicName: string } | null>(null)

  /** Fetch topics if not already loaded */
  const ensureTopicsLoaded = async () => {
    if (topics().length > 0 || loadingTopics()) return
    setLoadingTopics(true)
    setTopicError("")
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), 15000)
      )
      const result = await Promise.race([
        commands.getStreamTopics(org.orgId, props.stream.stream_id),
        timeoutPromise,
      ])
      if (result.status === "ok") {
        setTopics(result.data)
      } else {
        console.error(`[Topics] Failed to load topics for stream ${props.stream.name}:`, result.error)
        setTopicError(result.error || "Failed to load")
      }
    } catch (e: any) {
      console.error(`[Topics] Error loading topics for stream ${props.stream.name}:`, e)
      setTopicError(e?.message || "Failed to load topics")
    } finally {
      setLoadingTopics(false)
      setTopicsLoaded(true)
    }
  }

  const toggleExpand = async (e: MouseEvent) => {
    e.stopPropagation()
    if (expanded()) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    await ensureTopicsLoaded()
  }

  const openContextMenu = (e: MouseEvent, type: "stream" | "topic", topicName?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, type, topicName })
    const close = () => { setContextMenu(null); document.removeEventListener("click", close) }
    document.addEventListener("click", close)
  }

  // ── Channel actions ──

  const handleMarkAsRead = async () => {
    setContextMenu(null)
    await commands.markStreamAsRead(org.orgId, props.stream.stream_id)
  }

  const handleToggleMute = async () => {
    setContextMenu(null)
    const isMuted = props.stream.is_muted || props.muted
    // Optimistic local update
    sync.handleSubscriptionEvent({ op: "update", stream_id: props.stream.stream_id, is_muted: !isMuted })
    // Backend mutation
    try {
      await commands.updateSubscriptionProperties(org.orgId, [{
        stream_id: props.stream.stream_id,
        property: "is_muted",
        value: !isMuted,
      }])
    } catch (e) {
      console.error("Failed to toggle mute:", e)
      // Revert optimistic update
      sync.handleSubscriptionEvent({ op: "update", stream_id: props.stream.stream_id, is_muted: isMuted })
    }
  }

  const handleTogglePin = async () => {
    setContextMenu(null)
    const isPinned = props.stream.pin_to_top
    sync.handleSubscriptionEvent({ op: "update", stream_id: props.stream.stream_id, pin_to_top: !isPinned })
    try {
      await commands.updateSubscriptionProperties(org.orgId, [{
        stream_id: props.stream.stream_id,
        property: "pin_to_top",
        value: !isPinned,
      }])
    } catch (e) {
      console.error("Failed to toggle pin:", e)
      sync.handleSubscriptionEvent({ op: "update", stream_id: props.stream.stream_id, pin_to_top: isPinned })
    }
  }

  const handleUnsubscribe = async () => {
    setContextMenu(null)
    try {
      await commands.unsubscribeStream(org.orgId, [props.stream.name])
    } catch (e) {
      console.error("Failed to unsubscribe:", e)
    }
  }

  const handleCopyStreamLink = () => {
    setContextMenu(null)
    const link = `#narrow/stream/${props.stream.stream_id}-${encodeURIComponent(props.stream.name)}`
    navigator.clipboard.writeText(link).catch(() => {})
  }

  // ── Topic actions ──

  const handleTopicClick = (topic: string) => {
    nav.setActiveNarrow(`stream:${props.stream.stream_id}/topic:${topic}`)
  }

  const handleMarkTopicAsRead = async (topicName: string) => {
    setContextMenu(null)
    try {
      await commands.markTopicAsRead(org.orgId, props.stream.stream_id, topicName)
    } catch (e) {
      console.error("Failed to mark topic as read:", e)
    }
  }

  const handleCopyTopicLink = (topicName: string) => {
    setContextMenu(null)
    const link = `#narrow/stream/${props.stream.stream_id}-${encodeURIComponent(props.stream.name)}/topic/${encodeURIComponent(topicName)}`
    navigator.clipboard.writeText(link).catch(() => {})
  }

  const handleResolveToggle = async (topicName: string) => {
    setContextMenu(null)
    const isResolved = topicName.startsWith("\u2705 ")
    // Need an anchor message — get the latest message in this topic
    try {
      const narrowFilters = [
        { operator: "stream", operand: props.stream.name, negated: false },
        { operator: "topic", operand: topicName, negated: false },
      ]
      const result = await commands.getMessages(org.orgId, narrowFilters, "newest", 1, 0)
      if (result.status === "ok" && result.data.messages.length > 0) {
        const anchorId = result.data.messages[result.data.messages.length - 1].id
        await commands.setTopicResolved(org.orgId, {
          anchor_message_id: anchorId,
          topic_name: topicName,
          resolved: !isResolved,
        })
      }
    } catch (e) {
      console.error("Failed to resolve/unresolve topic:", e)
    }
  }

  const openMoveDialog = (topicName: string) => {
    setContextMenu(null)
    setMoveDialog({ topicName })
  }

  return (
    <div>
      {/* Channel row with hover ellipsis */}
      <div
        class="group/stream relative w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--background-surface)] cursor-pointer"
        classList={{
          "bg-[var(--background-surface)]": props.active,
          "opacity-50": props.muted,
        }}
        onClick={() => {
          props.onClick()
          if (!expanded()) {
            setExpanded(true)
            void ensureTopicsLoaded()
          }
        }}
        onContextMenu={(e) => openContextMenu(e, "stream")}
        data-component="stream-item"
      >
        {/* Color dot */}
        <span
          class="w-2 h-2 rounded-full shrink-0"
          style={{ "background-color": props.stream.color || "var(--text-tertiary)" }}
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

        {/* Hover ellipsis — hidden by default, visible on hover */}
        <span
          class="w-4 h-4 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer hidden group-hover/stream:flex shrink-0"
          onClick={(e) => openContextMenu(e, "stream")}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="2.5" cy="6" r="1" fill="currentColor" />
            <circle cx="6" cy="6" r="1" fill="currentColor" />
            <circle cx="9.5" cy="6" r="1" fill="currentColor" />
          </svg>
        </span>

        {/* Expand arrow — always visible so empty channels can be expanded */}
        <span
          onClick={toggleExpand}
          class="w-3 h-3 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
        >
          <svg
            width="8" height="8" viewBox="0 0 8 8" fill="none"
            class={`transition-transform ${expanded() ? "rotate-90" : ""}`}
          >
            <path d="M2 1l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </div>

      {/* Topics list */}
      <Show when={expanded()}>
        <div class="ml-6 border-l border-[var(--border-default)]">
          <Show when={loadingTopics()}>
            <div class="text-[10px] text-[var(--text-tertiary)] px-3 py-1">Loading topics...</div>
          </Show>

          <Show when={topicError() && !loadingTopics()}>
            <div class="px-3 py-1 flex items-center gap-1">
              <span class="text-[10px] text-[var(--status-error)]">Failed to load</span>
              <button
                class="text-[10px] text-[var(--interactive-primary)] hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  setTopicError("")
                  setTopics([])
                  toggleExpand(e as any)
                }}
              >
                Retry
              </button>
            </div>
          </Show>

          {/* Empty state when no topics exist */}
          <Show when={topicsLoaded() && topics().length === 0 && !loadingTopics() && !topicError()}>
            <div class="text-[10px] text-[var(--text-tertiary)] px-3 py-1">No topics yet</div>
          </Show>

          <For each={topics()}>
            {(topic) => (
              <div
                class="group/topic w-full flex items-center gap-2 px-3 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--background-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                classList={{
                  "text-[var(--text-primary)] bg-[var(--background-surface)]":
                    nav.activeNarrow() === `stream:${props.stream.stream_id}/topic:${topic.name}`,
                }}
                onClick={() => handleTopicClick(topic.name)}
                onContextMenu={(e) => openContextMenu(e, "topic", topic.name)}
              >
                <span class="flex-1 truncate">{topic.name}</span>
                {/* Topic hover ellipsis */}
                <span
                  class="w-4 h-4 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer hidden group-hover/topic:flex shrink-0"
                  onClick={(e) => openContextMenu(e, "topic", topic.name)}
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <circle cx="2.5" cy="6" r="1" fill="currentColor" />
                    <circle cx="6" cy="6" r="1" fill="currentColor" />
                    <circle cx="9.5" cy="6" r="1" fill="currentColor" />
                  </svg>
                </span>
              </div>
            )}
          </For>

          {/* New topic row — always shown at bottom of expanded topics */}
          <Show when={!loadingTopics() && !topicError()}>
            <div
              class="w-full flex items-center gap-2 px-3 py-1 text-left text-xs text-[var(--text-tertiary)] hover:bg-[var(--background-surface)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              onClick={() => {
                nav.setActiveNarrow(`stream:${props.stream.stream_id}`)
                // Focus the topic input after navigation settles
                requestAnimationFrame(() => {
                  const topicInput = document.querySelector<HTMLInputElement>('[placeholder="New topic..."]')
                  topicInput?.focus()
                })
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" class="shrink-0">
                <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
              <span class="flex-1 truncate">New topic</span>
            </div>
          </Show>
        </div>
      </Show>

      {/* Context menu */}
      <Show when={contextMenu()}>
        {(ctx) => (
          <div
            class="fixed z-50 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-md py-1 min-w-[180px]"
            style={{ left: `${ctx().x}px`, top: `${ctx().y}px` }}
          >
            <Show when={ctx().type === "stream"}>
              <ContextMenuItem label="Mark as read" onClick={handleMarkAsRead} />
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem
                label={props.muted ? "Unmute channel" : "Mute channel"}
                onClick={handleToggleMute}
              />
              <ContextMenuItem
                label={props.stream.pin_to_top ? "Unpin channel" : "Pin channel"}
                onClick={handleTogglePin}
              />
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem label="Channel settings" onClick={() => { setContextMenu(null); props.onOpenSettings?.() }} />
              <ContextMenuItem label="Copy link" onClick={handleCopyStreamLink} />
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem label="Unsubscribe" onClick={handleUnsubscribe} danger />
            </Show>

            <Show when={ctx().type === "topic" && ctx().topicName}>
              <ContextMenuItem
                label="Mark topic as read"
                onClick={() => handleMarkTopicAsRead(ctx().topicName!)}
              />
              <div class="my-1 border-t border-[var(--border-default)]" />
              {(() => {
                const topicName = ctx().topicName!
                const visibility = sync.getTopicVisibility(props.stream.stream_id, topicName)
                return (
                  <>
                    <Show when={visibility !== "Muted"}>
                      <ContextMenuItem
                        label="Mute topic"
                        onClick={() => {
                          setContextMenu(null)
                          commands.updateTopicVisibilityPolicy(org.orgId, props.stream.stream_id, topicName, "Muted").catch(() => {})
                        }}
                      />
                    </Show>
                    <Show when={visibility !== "Followed"}>
                      <ContextMenuItem
                        label="Follow topic"
                        onClick={() => {
                          setContextMenu(null)
                          commands.updateTopicVisibilityPolicy(org.orgId, props.stream.stream_id, topicName, "Followed").catch(() => {})
                        }}
                      />
                    </Show>
                    <Show when={visibility !== "Inherit"}>
                      <ContextMenuItem
                        label={visibility === "Muted" ? "Unmute topic" : "Unfollow topic"}
                        onClick={() => {
                          setContextMenu(null)
                          commands.updateTopicVisibilityPolicy(org.orgId, props.stream.stream_id, topicName, "Inherit").catch(() => {})
                        }}
                      />
                    </Show>
                  </>
                )
              })()}
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem
                label={ctx().topicName!.startsWith("\u2705 ") ? "Unresolve topic" : "Resolve topic"}
                onClick={() => handleResolveToggle(ctx().topicName!)}
              />
              <ContextMenuItem
                label="Move topic"
                onClick={() => openMoveDialog(ctx().topicName!)}
              />
              <div class="my-1 border-t border-[var(--border-default)]" />
              <ContextMenuItem
                label="Copy link"
                onClick={() => handleCopyTopicLink(ctx().topicName!)}
              />
            </Show>
          </div>
        )}
      </Show>

      {/* Move topic dialog */}
      <Show when={moveDialog()}>
        {(dialog) => (
          <MoveTopicDialog
            orgId={org.orgId}
            streamId={props.stream.stream_id}
            streamName={props.stream.name}
            topicName={dialog().topicName}
            subscriptions={sync.store.subscriptions}
            onClose={() => setMoveDialog(null)}
          />
        )}
      </Show>
    </div>
  )
}

function CreateChannelForm(props: { orgId: string; onClose: () => void }) {
  const [name, setName] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const channelName = name().trim()
    if (!channelName) return

    setCreating(true)
    setError("")
    try {
      const result = await commands.subscribeStream(props.orgId, [channelName])
      if (result.status === "ok") {
        props.onClose()
      } else {
        setError(result.error || "Failed to create channel")
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create channel")
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} class="px-2 pb-2">
      <div class="flex items-center gap-1">
        <input
          type="text"
          class="flex-1 text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] focus:outline-none focus:border-[var(--interactive-primary)]"
          placeholder="Channel name..."
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          disabled={creating()}
          autofocus
        />
        <button
          type="submit"
          class="px-2 py-1.5 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          disabled={creating() || !name().trim()}
        >
          {creating() ? "..." : "Add"}
        </button>
        <button
          type="button"
          class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors shrink-0"
          onClick={props.onClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <Show when={error()}>
        <div class="text-[10px] text-[var(--status-error)] mt-1 px-0.5">{error()}</div>
      </Show>
    </form>
  )
}

function MoveTopicDialog(props: {
  orgId: string
  streamId: number
  streamName: string
  topicName: string
  subscriptions: { stream_id: number; name: string }[]
  onClose: () => void
}) {
  const [newTopic, setNewTopic] = createSignal(props.topicName)
  const [newStreamId, setNewStreamId] = createSignal(props.streamId)
  const [notifyOld, setNotifyOld] = createSignal(true)
  const [notifyNew, setNotifyNew] = createSignal(true)
  const [moving, setMoving] = createSignal(false)
  const [error, setError] = createSignal("")

  const handleMove = async (e: Event) => {
    e.preventDefault()
    const topic = newTopic().trim()
    if (!topic) return

    setMoving(true)
    setError("")
    try {
      // Get an anchor message from this topic
      const narrowFilters = [
        { operator: "stream", operand: props.streamName, negated: false },
        { operator: "topic", operand: props.topicName, negated: false },
      ]
      const msgResult = await commands.getMessages(props.orgId, narrowFilters, "newest", 1, 0)
      if (msgResult.status !== "ok" || msgResult.data.messages.length === 0) {
        setError("No messages found in this topic")
        setMoving(false)
        return
      }
      const anchorId = msgResult.data.messages[msgResult.data.messages.length - 1].id

      const result = await commands.moveTopic(props.orgId, {
        anchor_message_id: anchorId,
        new_topic: topic,
        new_stream_id: newStreamId() !== props.streamId ? newStreamId() : null,
        send_notification_to_old_thread: notifyOld(),
        send_notification_to_new_thread: notifyNew(),
      })
      if (result.status === "ok") {
        props.onClose()
      } else {
        setError(result.error || "Failed to move topic")
      }
    } catch (err: any) {
      setError(err?.message || "Failed to move topic")
    } finally {
      setMoving(false)
    }
  }

  return (
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={props.onClose}>
      <form
        class="bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-lg)] shadow-lg p-4 w-[340px] space-y-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleMove}
      >
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Move topic</h3>

        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">New topic name</label>
          <input
            type="text"
            class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
            value={newTopic()}
            onInput={(e) => setNewTopic(e.currentTarget.value)}
            disabled={moving()}
            autofocus
          />
        </div>

        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Destination channel</label>
          <select
            class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
            value={newStreamId()}
            onChange={(e) => setNewStreamId(Number(e.currentTarget.value))}
            disabled={moving()}
          >
            <For each={props.subscriptions.slice().sort((a, b) => a.name.localeCompare(b.name))}>
              {(sub) => <option value={sub.stream_id}>{sub.name}</option>}
            </For>
          </select>
        </div>

        <div class="space-y-1.5">
          <label class="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={notifyOld()} onChange={(e) => setNotifyOld(e.currentTarget.checked)} class="rounded" />
            Send notification to old thread
          </label>
          <label class="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={notifyNew()} onChange={(e) => setNotifyNew(e.currentTarget.checked)} class="rounded" />
            Send notification to new thread
          </label>
        </div>

        <Show when={error()}>
          <div class="text-[10px] text-[var(--status-error)]">{error()}</div>
        </Show>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-base)] transition-colors"
            onClick={props.onClose}
            disabled={moving()}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={moving() || !newTopic().trim()}
          >
            {moving() ? "Moving..." : "Move"}
          </button>
        </div>
      </form>
    </div>
  )
}

function ContextMenuItem(props: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      class="w-full text-left px-3 py-1.5 text-xs transition-colors"
      classList={{
        "text-[var(--status-error)] hover:bg-[var(--status-error)]/10": props.danger,
        "text-[var(--text-primary)] hover:bg-[var(--background-elevated)]": !props.danger,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

/** Navigation button for sidebar views (Inbox, etc.) */
function NavButton(props: {
  label: string
  active: boolean
  onClick: () => void
  icon?: JSX.Element
  badge?: number
}) {
  return (
    <button
      class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--background-surface)]"
      classList={{
        "bg-[var(--background-surface)] text-[var(--text-primary)] font-medium": props.active,
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
  )
}
