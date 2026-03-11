import { For, Show, createSignal } from "solid-js"
import type {
  InboxSecretaryCitation,
  InboxSecretaryItem,
} from "@foundry/desktop/bindings"
import { formatCitationTime } from "./utils"

export function PriorityCardCitations(props: {
  item: InboxSecretaryItem
  citations: InboxSecretaryCitation[]
  onOpenCitation: (item: InboxSecretaryItem, citation: InboxSecretaryCitation) => void
}) {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <div class="mt-3 pt-3 border-t border-[var(--border-default)]/70">
      <button
        class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <svg
          width="10" height="10" viewBox="0 0 12 12" fill="none"
          class={`transition-transform ${expanded() ? "rotate-90" : ""}`}
        >
          <path d="M4.5 3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{props.citations.length} {props.citations.length === 1 ? "source" : "sources"}</span>
      </button>

      <Show when={expanded()}>
        <div class="mt-2 flex flex-col gap-2">
          <For each={props.citations}>
            {(citation) => (
              <button
                class="min-w-0 text-left rounded-[var(--radius-sm)] border border-[var(--border-default)]/70 bg-[var(--background-base)] px-2.5 py-2 hover:bg-[var(--background-elevated)] transition-colors"
                onClick={() => props.onOpenCitation(props.item, citation)}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-[var(--text-primary)] truncate">
                    {citation.title || citation.sender_name || "Source"}
                  </span>
                  <span class="text-[11px] text-[var(--text-tertiary)] shrink-0">
                    {formatCitationTime(citation.timestamp)}
                  </span>
                </div>
                <Show when={citation.sender_name}>
                  <div class="mt-1 text-[11px] text-[var(--text-tertiary)] truncate">
                    {citation.sender_name}
                  </div>
                </Show>
                <p class="mt-1 text-xs text-[var(--text-secondary)] line-clamp-1">
                  {citation.excerpt}
                </p>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
