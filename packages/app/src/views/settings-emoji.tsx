import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useOrg } from "../context/org"
import { usePlatform } from "../context/platform"
import { commands } from "@zulip/desktop/bindings"
import type { RealmEmoji } from "@zulip/desktop/bindings"

export function SettingsEmoji() {
  const org = useOrg()
  const platform = usePlatform()
  const [emojis, setEmojis] = createSignal<RealmEmoji[]>([])
  const [search, setSearch] = createSignal("")
  const [error, setError] = createSignal("")
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null)

  const fetchEmojis = async () => {
    const result = await commands.getRealmEmoji(org.orgId)
    if (result.status === "ok") {
      setEmojis(result.data.filter(e => !e.deactivated))
    }
  }

  onMount(() => { void fetchEmojis() })

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    return emojis().filter(e => !q || e.name.toLowerCase().includes(q))
  })

  const handleUpload = async () => {
    setError("")
    if (!platform.openFilePickerDialog) return

    const selection = await platform.openFilePickerDialog({ title: "Upload emoji" })
    const filePath = Array.isArray(selection) ? selection[0] : selection
    if (!filePath) return

    // Prompt for emoji name — derive from filename
    const fileName = filePath.split("/").pop()?.split(".")[0] || ""
    const emojiName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()

    if (!emojiName) {
      setError("Could not determine emoji name from filename")
      return
    }

    const result = await commands.uploadCustomEmoji(org.orgId, emojiName, filePath)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    fetchEmojis()
  }

  const handleDelete = async (emojiName: string) => {
    if (confirmDelete() !== emojiName) {
      setConfirmDelete(emojiName)
      setTimeout(() => setConfirmDelete(null), 3000)
      return
    }
    setError("")
    const result = await commands.deleteCustomEmoji(org.orgId, emojiName)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setConfirmDelete(null)
    fetchEmojis()
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Custom Emoji</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={handleUpload}
        >
          Upload emoji
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        Custom emoji can be used in messages by typing <code class="text-[var(--text-secondary)]">:emoji_name:</code>. Only administrators can add or remove custom emoji.
      </p>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 rounded-[var(--radius-sm)]">
          {error()}
        </div>
      </Show>

      <input
        type="text"
        class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
        placeholder="Search emoji..."
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />

      <Show
        when={filtered().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No custom emoji</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Upload custom emoji to use in your organization's messages
            </div>
          </div>
        }
      >
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={filtered()}>
            {(emoji) => (
              <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center gap-2">
                  <Show when={emoji.source_url} fallback={<span class="text-base w-5 h-5 flex items-center justify-center">?</span>}>
                    <img src={emoji.source_url} alt={emoji.name} class="w-5 h-5 object-contain" />
                  </Show>
                  <span class="text-xs text-[var(--text-primary)]">:{emoji.name}:</span>
                </div>
                <button
                  class={`text-[10px] hover:underline ${confirmDelete() === emoji.name ? "text-[var(--status-error)]" : "text-[var(--status-error)]"}`}
                  onClick={() => handleDelete(emoji.name)}
                >
                  {confirmDelete() === emoji.name ? "Confirm remove?" : "Remove"}
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
