import { createEffect, createSignal, createMemo, For, Show } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { commands } from "@foundry/desktop/bindings"
import { SettingRow } from "./settings-general"

export function SettingsChannels(props: {
  focusStreamId?: number
  focusStreamName?: string
}) {
  const sync = useZulipSync()
  const org = useOrg()
  const [search, setSearch] = createSignal("")
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [showCreate, setShowCreate] = createSignal(false)
  const [newChannelName, setNewChannelName] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")
  const rowRefs = new Map<number, HTMLDivElement>()

  const filteredChannels = createMemo(() => {
    const q = search().toLowerCase()
    return sync.store.subscriptions
      .filter(s => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const handleCreate = async () => {
    const name = newChannelName().trim()
    if (!name) return
    setCreating(true)
    setError("")
    const result = await commands.subscribeStream(org.orgId, [name])
    setCreating(false)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setNewChannelName("")
    setShowCreate(false)
  }

  const handleUnsubscribe = async (streamName: string) => {
    const result = await commands.unsubscribeStream(org.orgId, [streamName])
    if (result.status === "error") {
      setError(result.error)
    }
  }

  const handleTogglePin = async (streamId: number, current: boolean) => {
    await commands.updateSubscriptionProperties(org.orgId, [
      { stream_id: streamId, property: "pin_to_top", value: !current },
    ])
  }

  const handleToggleMute = async (streamId: number, current: boolean) => {
    await commands.updateSubscriptionProperties(org.orgId, [
      { stream_id: streamId, property: "is_muted", value: !current },
    ])
  }

  const handleColorChange = async (streamId: number, color: string) => {
    await commands.updateSubscriptionProperties(org.orgId, [
      { stream_id: streamId, property: "color", value: color },
    ])
  }

  const handleNotificationLevel = async (streamId: number, level: string) => {
    const desktop = level === "all" || level === "mentions"
    const audible = level === "all"
    const push = level === "all" || level === "mentions"
    const email = level === "none" ? false : level === "all"
    const isDefault = level === "default"

    if (isDefault) {
      // Reset to default (false = use global settings)
      await commands.updateSubscriptionProperties(org.orgId, [
        { stream_id: streamId, property: "desktop_notifications", value: false },
        { stream_id: streamId, property: "audible_notifications", value: false },
        { stream_id: streamId, property: "push_notifications", value: false },
        { stream_id: streamId, property: "email_notifications", value: false },
      ])
    } else {
      await commands.updateSubscriptionProperties(org.orgId, [
        { stream_id: streamId, property: "desktop_notifications", value: desktop },
        { stream_id: streamId, property: "audible_notifications", value: audible },
        { stream_id: streamId, property: "push_notifications", value: push },
        { stream_id: streamId, property: "email_notifications", value: email },
      ])
    }
  }

  createEffect(() => {
    const focusStreamId = props.focusStreamId
    if (!focusStreamId) return

    setSearch("")
    setEditingId(focusStreamId)

    requestAnimationFrame(() => {
      rowRefs.get(focusStreamId)?.scrollIntoView({ block: "center", behavior: "smooth" })
    })
  })

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold text-[var(--text-primary)]">Channels</h3>
          <Show when={props.focusStreamName}>
            <p class="text-[11px] text-[var(--text-tertiary)]">Editing #{props.focusStreamName}</p>
          </Show>
        </div>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowCreate(s => !s)}
        >
          {showCreate() ? "Cancel" : "Create channel"}
        </button>
      </div>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 rounded-[var(--radius-sm)]">
          {error()}
        </div>
      </Show>

      {/* Create form */}
      <Show when={showCreate()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Channel name</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
              placeholder="e.g. engineering"
              value={newChannelName()}
              onInput={(e) => setNewChannelName(e.currentTarget.value)}
            />
          </div>
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleCreate}
            disabled={!newChannelName().trim() || creating()}
          >
            {creating() ? "Creating..." : "Create"}
          </button>
        </div>
      </Show>

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
              <div
                ref={(element) => rowRefs.set(channel.stream_id, element)}
                class="border-b border-[var(--border-default)] last:border-b-0"
                classList={{
                  "bg-[var(--interactive-primary)]/5": props.focusStreamId === channel.stream_id,
                }}
              >
                <div class="flex items-center justify-between px-3 py-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ "background-color": channel.color || "var(--text-tertiary)" }}
                    />
                    <span class="text-xs font-medium text-[var(--text-primary)] truncate">{channel.name}</span>
                    <Show when={channel.pin_to_top}>
                      <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded">Pinned</span>
                    </Show>
                    <Show when={channel.is_muted}>
                      <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded">Muted</span>
                    </Show>
                  </div>
                  <button
                    class="text-[10px] text-[var(--interactive-primary)] hover:underline shrink-0"
                    onClick={() => setEditingId(editingId() === channel.stream_id ? null : channel.stream_id)}
                  >
                    {editingId() === channel.stream_id ? "Close" : "Settings"}
                  </button>
                </div>

                {/* Expanded settings */}
                <Show when={editingId() === channel.stream_id}>
                  <div class="px-3 pb-3 space-y-3 bg-[var(--background-base)] border-t border-[var(--border-default)]">
                    <SettingRow label="Notification level" description="Override global notification setting for this channel">
                      <select
                        class="text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[120px]"
                        onChange={(e) => handleNotificationLevel(channel.stream_id, e.currentTarget.value)}
                      >
                        <option value="default">Default</option>
                        <option value="all">All messages</option>
                        <option value="mentions">Mentions only</option>
                        <option value="none">None</option>
                      </select>
                    </SettingRow>

                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-medium text-[var(--text-primary)]">Pin to top</div>
                        <div class="text-[11px] text-[var(--text-tertiary)]">Pin this channel to the top of the sidebar</div>
                      </div>
                      <button
                        class={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${
                          channel.pin_to_top ? "bg-[var(--interactive-primary)]" : "bg-[var(--border-default)]"
                        }`}
                        onClick={() => handleTogglePin(channel.stream_id, !!channel.pin_to_top)}
                      >
                        <span class={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${channel.pin_to_top ? "left-[16px]" : "left-[2px]"}`} />
                      </button>
                    </div>

                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-xs font-medium text-[var(--text-primary)]">Muted</div>
                        <div class="text-[11px] text-[var(--text-tertiary)]">Mute notifications from this channel</div>
                      </div>
                      <button
                        class={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${
                          channel.is_muted ? "bg-[var(--interactive-primary)]" : "bg-[var(--border-default)]"
                        }`}
                        onClick={() => handleToggleMute(channel.stream_id, !!channel.is_muted)}
                      >
                        <span class={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${channel.is_muted ? "left-[16px]" : "left-[2px]"}`} />
                      </button>
                    </div>

                    <SettingRow label="Channel color" description="Customize the color dot in the sidebar">
                      <input
                        type="color"
                        class="w-6 h-6 rounded border border-[var(--border-default)] cursor-pointer"
                        value={channel.color || "#76ce90"}
                        onInput={(e) => handleColorChange(channel.stream_id, e.currentTarget.value)}
                      />
                    </SettingRow>

                    <div class="pt-2 border-t border-[var(--border-default)]">
                      <button
                        class="text-[10px] text-[var(--status-error)] hover:underline"
                        onClick={() => handleUnsubscribe(channel.name)}
                      >
                        Unsubscribe from channel
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
