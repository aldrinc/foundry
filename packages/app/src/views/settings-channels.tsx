import { createMemo, createSignal, For, Show } from "solid-js";
import { useZulipSync } from "../context/zulip-sync";
import { SettingRow } from "./settings-general";

export function SettingsChannels() {
  const sync = useZulipSync();
  const [search, setSearch] = createSignal("");
  const [editingId, setEditingId] = createSignal<number | null>(null);

  const filteredChannels = createMemo(() => {
    const q = search().toLowerCase();
    return sync.store.subscriptions
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">
          Channels
        </h3>
        <button class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity">
          Create channel
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
        placeholder="Search channels..."
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />

      {/* Channel list */}
      <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
        <Show
          when={filteredChannels().length > 0}
          fallback={
            <div class="text-center py-6 text-xs text-[var(--text-tertiary)]">
              No channels found
            </div>
          }
        >
          <For each={filteredChannels()}>
            {(channel) => (
              <div class="border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center justify-between px-3 py-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        "background-color":
                          channel.color || "var(--text-tertiary)",
                      }}
                    />
                    <span class="text-xs font-medium text-[var(--text-primary)] truncate">
                      {channel.name}
                    </span>
                    <Show when={channel.pin_to_top}>
                      <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded">
                        Pinned
                      </span>
                    </Show>
                    <Show when={channel.is_muted}>
                      <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded">
                        Muted
                      </span>
                    </Show>
                  </div>
                  <button
                    class="text-[10px] text-[var(--interactive-primary)] hover:underline shrink-0"
                    onClick={() =>
                      setEditingId(
                        editingId() === channel.stream_id
                          ? null
                          : channel.stream_id,
                      )
                    }
                  >
                    {editingId() === channel.stream_id ? "Close" : "Settings"}
                  </button>
                </div>

                {/* Expanded settings */}
                <Show when={editingId() === channel.stream_id}>
                  <div class="px-3 pb-3 space-y-3 bg-[var(--background-base)] border-t border-[var(--border-default)]">
                    <SettingRow
                      label="Notification level"
                      description="Override global notification setting for this channel"
                    >
                      <select class="text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[120px]">
                        <option value="default">Default</option>
                        <option value="all">All messages</option>
                        <option value="mentions">Mentions only</option>
                        <option value="none">None</option>
                      </select>
                    </SettingRow>

                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-medium text-[var(--text-primary)]">
                          Pin to top
                        </div>
                        <div class="text-[11px] text-[var(--text-tertiary)]">
                          Pin this channel to the top of the sidebar
                        </div>
                      </div>
                      <button
                        class={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${
                          channel.pin_to_top
                            ? "bg-[var(--interactive-primary)]"
                            : "bg-[var(--border-default)]"
                        }`}
                      >
                        <span
                          class={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${channel.pin_to_top ? "left-[16px]" : "left-[2px]"}`}
                        />
                      </button>
                    </div>

                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-medium text-[var(--text-primary)]">
                          Muted
                        </div>
                        <div class="text-[11px] text-[var(--text-tertiary)]">
                          Mute notifications from this channel
                        </div>
                      </div>
                      <button
                        class={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${
                          channel.is_muted
                            ? "bg-[var(--interactive-primary)]"
                            : "bg-[var(--border-default)]"
                        }`}
                      >
                        <span
                          class={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${channel.is_muted ? "left-[16px]" : "left-[2px]"}`}
                        />
                      </button>
                    </div>

                    <SettingRow
                      label="Channel color"
                      description="Customize the color dot in the sidebar"
                    >
                      <input
                        type="color"
                        class="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer"
                        value={channel.color || "#76ce90"}
                      />
                    </SettingRow>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
