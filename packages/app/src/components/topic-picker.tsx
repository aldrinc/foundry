import { createSignal, For, Show, onMount } from "solid-js"
import { commands } from "@zulip/desktop/bindings"
import type { Topic } from "@zulip/desktop/bindings"
import { useOrg } from "../context/org"

export function TopicPicker(props: {
  streamId: number
  value: string
  onChange: (topic: string) => void
}) {
  const org = useOrg()
  const [topics, setTopics] = createSignal<Topic[]>([])
  const [focused, setFocused] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)

  const loadTopics = async () => {
    if (loaded()) return
    try {
      const result = await commands.getStreamTopics(org.orgId, props.streamId)
      if (result.status === "ok") {
        setTopics(result.data)
      }
    } catch {
      // Non-critical
    }
    setLoaded(true)
  }

  const filteredTopics = () => {
    const q = props.value.toLowerCase()
    if (!q) return topics().slice(0, 10)
    return topics().filter(t => t.name.toLowerCase().includes(q)).slice(0, 10)
  }

  const handleFocus = () => {
    setFocused(true)
    void loadTopics()
  }

  return (
    <div class="relative">
      <div class="flex items-center gap-1 px-3 py-1.5 text-xs text-[var(--text-tertiary)]">
        <span>Topic:</span>
        <input
          type="text"
          class="flex-1 bg-transparent text-[var(--text-primary)] text-xs focus:outline-none placeholder:text-[var(--text-quaternary)]"
          placeholder="New topic..."
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          onFocus={handleFocus}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      </div>

      <Show when={focused() && filteredTopics().length > 0}>
        <div class="absolute left-0 right-0 bottom-full z-50 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg max-h-[200px] overflow-y-auto">
          <For each={filteredTopics()}>
            {(topic) => (
              <button
                class="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors truncate"
                onMouseDown={(e) => {
                  e.preventDefault()
                  props.onChange(topic.name)
                  setFocused(false)
                }}
              >
                {topic.name}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
