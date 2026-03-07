import { createMemo, createSignal, For, Show } from "solid-js";
import { useNavigation } from "../context/navigation";
import type { User } from "../context/zulip-sync";
import { useZulipSync } from "../context/zulip-sync";

/**
 * DirectMessageList — shows recent DM conversations in the sidebar.
 * Derives conversations from message store keys starting with "dm:".
 * Also includes a "New message" button with a user picker.
 */
export function DirectMessageList() {
  const sync = useZulipSync();
  const nav = useNavigation();
  const [collapsed, setCollapsed] = createSignal(false);
  const [showUserPicker, setShowUserPicker] = createSignal(false);
  const [userFilter, setUserFilter] = createSignal("");

  // Derive DM conversations from message store
  const dmConversations = createMemo(() => {
    const convos: Array<{
      narrow: string;
      participants: User[];
      lastTimestamp: number;
      lastPreview: string;
    }> = [];

    for (const [narrow, messages] of Object.entries(sync.store.messages)) {
      if (!narrow.startsWith("dm:")) continue;
      const userIds = narrow.slice(3).split(",").map(Number);
      const participants = userIds
        .map((id) => sync.store.users.find((u) => u.user_id === id))
        .filter((u): u is User => !!u);

      // Get last message for preview
      const lastMsg = messages[messages.length - 1];
      const lastTimestamp = lastMsg?.timestamp ?? 0;
      const lastPreview = lastMsg
        ? stripHtml(lastMsg.content).slice(0, 60)
        : "";

      convos.push({ narrow, participants, lastTimestamp, lastPreview });
    }

    // Sort by most recent
    return convos.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  });

  // Filter users for new DM picker
  const filteredUsers = createMemo(() => {
    const q = userFilter().toLowerCase().trim();
    const currentId = sync.store.currentUserId;
    return sync.store.users
      .filter((u) => {
        if (u.user_id === currentId) return false;
        if (u.is_bot) return false;
        if (!q) return true;
        return (
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      })
      .slice(0, 20); // Limit display
  });

  const startDm = (user: User) => {
    const currentId = sync.store.currentUserId;
    if (!currentId) return;
    const ids = [currentId, user.user_id].sort().join(",");
    nav.setActiveNarrow(`dm:${ids}`);
    setShowUserPicker(false);
    setUserFilter("");
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return "";
    const now = Date.now() / 1000;
    const diff = now - ts;
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  // Get display name for DM participants (excluding current user)
  const participantNames = (participants: User[]) => {
    const currentId = sync.store.currentUserId;
    const others = participants.filter((u) => u.user_id !== currentId);
    if (others.length === 0) return participants[0]?.full_name ?? "Unknown";
    return others.map((u) => u.full_name).join(", ");
  };

  // Get initials for avatar
  const initials = (participants: User[]) => {
    const currentId = sync.store.currentUserId;
    const other =
      participants.find((u) => u.user_id !== currentId) ?? participants[0];
    return other?.full_name?.charAt(0).toUpperCase() ?? "?";
  };

  return (
    <div
      class="border-t border-[var(--border-default)] flex flex-col"
      data-component="dm-list"
    >
      {/* DM header */}
      <div class="px-3 py-2 flex items-center justify-between">
        <button
          class="flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider hover:text-[var(--text-secondary)] transition-colors"
          onClick={() => setCollapsed((c) => !c)}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            class={`transition-transform ${collapsed() ? "" : "rotate-90"}`}
          >
            <path
              d="M2 1l3 3-3 3"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Direct Messages
        </button>
        <button
          class="p-0.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
          onClick={() => setShowUserPicker((s) => !s)}
          title="New direct message"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 3v8M3 7h8"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      {/* User picker for new DM */}
      <Show when={showUserPicker()}>
        <div class="px-2 pb-2">
          <input
            type="text"
            placeholder="Find a user..."
            value={userFilter()}
            onInput={(e) => setUserFilter(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowUserPicker(false);
                setUserFilter("");
              }
            }}
            autofocus
            class="w-full px-2 py-1 text-xs rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-primary)] transition-colors mb-1"
          />
          <div class="max-h-[180px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)]">
            <Show when={filteredUsers().length === 0}>
              <div class="text-[10px] text-[var(--text-tertiary)] text-center py-2">
                No users found
              </div>
            </Show>
            <For each={filteredUsers()}>
              {(user) => (
                <button
                  class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--background-elevated)] transition-colors"
                  onClick={() => startDm(user)}
                >
                  <div class="w-5 h-5 rounded-full bg-[var(--background-elevated)] flex items-center justify-center text-[9px] font-medium text-[var(--text-secondary)] shrink-0">
                    {user.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[var(--text-primary)] truncate">
                      {user.full_name}
                    </div>
                    <div class="text-[10px] text-[var(--text-tertiary)] truncate">
                      {user.email}
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* DM conversations list */}
      <Show when={!collapsed()}>
        <div class="overflow-y-auto max-h-[200px] pb-1">
          <Show when={dmConversations().length === 0 && !showUserPicker()}>
            <p class="text-[10px] text-[var(--text-tertiary)] px-3 py-1">
              No conversations yet
            </p>
          </Show>
          <For each={dmConversations()}>
            {(convo) => (
              <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--background-surface)]"
                classList={{
                  "bg-[var(--background-surface)]":
                    nav.activeNarrow() === convo.narrow,
                }}
                onClick={() => nav.setActiveNarrow(convo.narrow)}
              >
                {/* Avatar */}
                <div class="w-6 h-6 rounded-full bg-[var(--background-elevated)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)] shrink-0">
                  {initials(convo.participants)}
                </div>

                {/* Name + preview */}
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-[var(--text-primary)] truncate font-medium">
                    {participantNames(convo.participants)}
                  </div>
                  <Show when={convo.lastPreview}>
                    <div class="text-[10px] text-[var(--text-tertiary)] truncate">
                      {convo.lastPreview}
                    </div>
                  </Show>
                </div>

                {/* Timestamp */}
                <Show when={convo.lastTimestamp}>
                  <span class="text-[10px] text-[var(--text-tertiary)] shrink-0">
                    {formatTimestamp(convo.lastTimestamp)}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Strip HTML tags for preview text */
function stripHtml(html: string): string {
  const tmp =
    typeof document !== "undefined" ? document.createElement("div") : null;
  if (!tmp) return html.replace(/<[^>]+>/g, "");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}
