import { createSignal, For, Show } from "solid-js"

interface CustomEmoji {
  name: string
  url: string
  author: string
}

export function SettingsEmoji() {
  const [emojis, setEmojis] = createSignal<CustomEmoji[]>([])
  const [search, setSearch] = createSignal("")
  const [newName, setNewName] = createSignal("")

  const filtered = () => {
    const q = search().toLowerCase()
    return emojis().filter(e => !q || e.name.toLowerCase().includes(q))
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Custom Emoji</h3>
        <button class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity">
          Upload emoji
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        Custom emoji can be used in messages by typing <code class="text-[var(--text-secondary)]">:emoji_name:</code>. Only administrators can add or remove custom emoji.
      </p>

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
                  <span class="text-base">{emoji.url ? "" : "?"}</span>
                  <span class="text-xs text-[var(--text-primary)]">:{emoji.name}:</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-[10px] text-[var(--text-tertiary)]">by {emoji.author}</span>
                  <button class="text-[10px] text-[var(--status-error)] hover:underline">Remove</button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
