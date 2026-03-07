import { createSignal, For, Show } from "solid-js"

export function SettingsAlertWords() {
  const [alertWords, setAlertWords] = createSignal<string[]>([])
  const [newWord, setNewWord] = createSignal("")

  const handleAdd = () => {
    const word = newWord().trim()
    if (word && !alertWords().includes(word)) {
      setAlertWords(prev => [...prev, word])
      setNewWord("")
    }
  }

  const handleRemove = (word: string) => {
    setAlertWords(prev => prev.filter(w => w !== word))
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Alert Words</h3>
      <p class="text-xs text-[var(--text-tertiary)]">
        Get notified when someone sends a message containing any of your alert words. Alert word matching is case-insensitive.
      </p>

      {/* Add word input */}
      <div class="flex items-center gap-2">
        <input
          type="text"
          class="flex-1 text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
          placeholder="Add an alert word..."
          value={newWord()}
          onInput={(e) => setNewWord(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          onClick={handleAdd}
          disabled={!newWord().trim()}
        >
          Add
        </button>
      </div>

      {/* Alert words list */}
      <Show
        when={alertWords().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No alert words</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Add words above to get notified when they appear in messages
            </div>
          </div>
        }
      >
        <div class="flex flex-wrap gap-2">
          <For each={alertWords()}>
            {(word) => (
              <span class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-full text-[var(--text-primary)]">
                {word}
                <button
                  class="text-[var(--text-tertiary)] hover:text-[var(--status-error)] transition-colors"
                  onClick={() => handleRemove(word)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  </svg>
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
