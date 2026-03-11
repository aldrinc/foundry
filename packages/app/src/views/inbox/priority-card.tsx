import { For, Show, createSignal } from "solid-js"
import type {
  InboxSecretaryCitation,
  InboxSecretaryItem,
} from "@foundry/desktop/bindings"
import { confidenceDotColor, formatCitationTime } from "./utils"

export function PriorityCard(props: {
  item: InboxSecretaryItem
  variant: "likely" | "unclear"
  feedbackPending: boolean
  onFeedback: (action: string) => void
  onOpenThread: () => void
  onOpenCitation: (item: InboxSecretaryItem, citation: InboxSecretaryCitation) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const dotColor = () => confidenceDotColor(props.item.confidence)
  const sourceCount = () => props.item.citations.length

  return (
    <div>
      <div
        class="group flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--background-elevated)] transition-colors cursor-pointer"
        onClick={() => {
          if (sourceCount() > 0) {
            setExpanded(e => !e)
          } else {
            props.onOpenThread()
          }
        }}
      >
        {/* Confidence dot */}
        <span
          class="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ "background-color": dotColor() }}
          title={props.item.confidence + " confidence"}
        />

        {/* Title */}
        <span class="text-sm text-[var(--text-primary)] flex-1 min-w-0 truncate">
          {props.item.title}
        </span>

        {/* Source count */}
        <Show when={sourceCount() > 0}>
          <span class="text-[11px] text-[var(--text-tertiary)] shrink-0">
            {sourceCount()} {sourceCount() === 1 ? "src" : "srcs"}
          </span>
        </Show>

        {/* Expand chevron when has sources */}
        <Show when={sourceCount() > 0}>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            class={`shrink-0 text-[var(--text-tertiary)] transition-transform ${expanded() ? "rotate-90" : ""}`}
          >
            <path d="M4.5 3l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </Show>

        {/* Action icons — always visible */}
        <div class="flex items-center gap-0.5 shrink-0">
          {/* Done (checkmark) */}
          <button
            class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--status-success)] hover:bg-[var(--status-success)]/10 transition-colors disabled:opacity-40"
            disabled={props.feedbackPending}
            onClick={(e) => { e.stopPropagation(); props.onFeedback("done") }}
            title="Mark done"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 7l3 3 6-6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          {/* Waiting (clock) */}
          <button
            class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--status-warning)] hover:bg-[var(--status-warning)]/10 transition-colors disabled:opacity-40"
            disabled={props.feedbackPending}
            onClick={(e) => { e.stopPropagation(); props.onFeedback("waiting") }}
            title="Waiting"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2" />
              <path d="M7 4v3.5l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          {/* Not mine (x) */}
          <button
            class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors disabled:opacity-40"
            disabled={props.feedbackPending}
            onClick={(e) => { e.stopPropagation(); props.onFeedback("not_mine") }}
            title="Not mine"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded citations */}
      <Show when={expanded()}>
        <div class="pl-9 pr-3 pb-2 flex flex-col gap-1">
          <For each={props.item.citations}>
            {(citation) => (
              <button
                class="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-left hover:bg-[var(--background-elevated)] transition-colors min-w-0"
                onClick={() => props.onOpenCitation(props.item, citation)}
              >
                <span class="text-xs text-[var(--text-primary)] truncate flex-1 min-w-0">
                  {citation.title || citation.sender_name || "Source"}
                </span>
                <Show when={citation.sender_name && citation.title}>
                  <span class="text-[11px] text-[var(--text-tertiary)] shrink-0 truncate max-w-[120px]">
                    {citation.sender_name}
                  </span>
                </Show>
                <span class="text-[11px] text-[var(--text-tertiary)] shrink-0">
                  {formatCitationTime(citation.timestamp)}
                </span>
              </button>
            )}
          </For>
          {/* Open thread link at the bottom of citations */}
          <button
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            onClick={() => props.onOpenThread()}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Open thread
          </button>
        </div>
      </Show>
    </div>
  )
}
