import { For, Show, createMemo, createSignal } from "solid-js"
import type {
  InboxSecretaryCitation,
  InboxSecretaryItem,
  InboxSecretaryTurn,
  InboxSecretaryToolTrace,
} from "@foundry/desktop/bindings"
import { PriorityCard } from "./priority-card"
import { SecretaryChat } from "./secretary-chat"
import { PrioritySectionSkeleton, UnclearSectionSkeleton } from "./skeleton-cards"
import { formatCitationTime, formatSecretaryStatus } from "./utils"

type RunInfo = {
  model: string
  created_at: string | number
  tool_traces: InboxSecretaryToolTrace[]
}

type StatusGroup = {
  status: string
  label: string
  items: InboxSecretaryItem[]
}

export function PrioritySection(props: {
  likelyItems: InboxSecretaryItem[]
  unclearItems: InboxSecretaryItem[]
  assistantTurns: InboxSecretaryTurn[]
  latestRun: RunInfo | null
  latestReviewTime: string
  assistantLoading: boolean
  assistantError: string
  configured: boolean
  feedbackPending: Record<string, boolean>
  assistantInput: string
  onReview: () => void
  onSendMessage: (message: string) => void
  onRecordFeedback: (item: InboxSecretaryItem, action: string) => void
  onOpenItem: (item: InboxSecretaryItem) => void
  onOpenCitation: (item: InboxSecretaryItem, citation: InboxSecretaryCitation) => void
  onSetAssistantInput: (value: string) => void
}) {
  const [collapsed, setCollapsed] = createSignal(false)
  const [chatExpanded, setChatExpanded] = createSignal(false)

  const totalItemCount = () => props.likelyItems.length + props.unclearItems.length
  const isFirstLoad = () => props.assistantLoading && totalItemCount() === 0 && props.assistantTurns.length === 0

  const itemKey = (item: InboxSecretaryItem) => item.external_key || item.conversation_key

  // Group likely items by status
  const likelyByStatus = createMemo((): StatusGroup[] => {
    const map = new Map<string, InboxSecretaryItem[]>()
    for (const item of props.likelyItems) {
      const list = map.get(item.status) || []
      list.push(item)
      map.set(item.status, list)
    }
    // Sort: needs_action first, then waiting, then others
    const order = ["needs_action", "waiting", "claimed_done", "verified_done"]
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
      .map(([status, items]) => ({
        status,
        label: formatSecretaryStatus(status),
        items,
      }))
  })

  return (
    <section
      class="px-4 py-3 border-b border-[var(--border-default)] bg-[var(--background-surface)]/70"
      data-component="priority-inbox-section"
    >
      {/* Section header */}
      <div class="flex items-start justify-between gap-3">
        <button
          class="flex items-start gap-2 min-w-0 text-left"
          onClick={() => setCollapsed(c => !c)}
        >
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            class={`mt-1 transition-transform text-[var(--text-tertiary)] ${collapsed() ? "" : "rotate-180"}`}
          >
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div>
            <h2 class="text-sm font-semibold text-[var(--text-primary)]">Priority</h2>
            <Show when={collapsed() && totalItemCount() > 0}>
              <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
                <span class="inline-flex items-center gap-1.5">
                  <span class="text-[11px] font-medium text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 rounded-full">
                    {props.likelyItems.length}
                  </span>
                  items
                  <Show when={props.unclearItems.length > 0}>
                    <span class="text-[var(--text-tertiary)]"> · </span>
                    <span class="text-[11px] font-medium text-[var(--text-tertiary)] bg-[var(--background-elevated)] px-1.5 rounded-full">
                      {props.unclearItems.length}
                    </span>
                    unclear
                  </Show>
                </span>
              </p>
            </Show>
            <Show when={!collapsed() && props.latestReviewTime}>
              <p class="text-xs text-[var(--text-tertiary)] mt-0.5">
                Last review {props.latestReviewTime}
              </p>
            </Show>
          </div>
        </button>
        <button
          class="px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] text-xs text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors shrink-0 flex items-center gap-1.5"
          onClick={() => props.onReview()}
        >
          <Show when={props.assistantLoading}>
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--interactive-primary)] supervisor-pulse shrink-0" />
          </Show>
          Review now
        </button>
      </div>

      {/* Collapsible content */}
      <div
        class={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${collapsed() ? "max-h-0 opacity-0" : "max-h-[3000px] opacity-100"}`}
      >
        {/* Error state */}
        <Show when={props.assistantError}>
          <div class="mt-3 rounded-[var(--radius-md)] border border-[var(--status-error)]/20 bg-[var(--status-error)]/5 px-3 py-2 text-sm text-[var(--status-error)]">
            {props.assistantError}
          </div>
        </Show>

        {/* Not configured state */}
        <Show when={!props.assistantError && !props.configured}>
          <div class="mt-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-elevated)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            Foundry-server is reachable, but the secretary is not configured with Claude yet.
          </div>
        </Show>

        <Show when={!props.assistantError && props.configured}>
          <div class="mt-3 flex flex-col gap-1">
            {/* Likely important — grouped by status */}
            <Show when={!isFirstLoad()} fallback={<PrioritySectionSkeleton />}>
              <Show when={props.likelyItems.length > 0} fallback={
                <div class="px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {props.assistantLoading ? "Reviewing current work…" : "No strong priorities surfaced from the latest review."}
                </div>
              }>
                <For each={likelyByStatus()}>
                  {(group) => (
                    <div>
                      <div class="flex items-center gap-2 px-3 pt-2 pb-1">
                        <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                          {group.label}
                        </span>
                        <span class="text-[11px] text-[var(--text-tertiary)]">
                          {group.items.length}
                        </span>
                      </div>
                      <For each={group.items}>
                        {(item) => (
                          <PriorityCard
                            item={item}
                            variant="likely"
                            feedbackPending={!!props.feedbackPending[itemKey(item)]}
                            onFeedback={(action) => props.onRecordFeedback(item, action)}
                            onOpenThread={() => props.onOpenItem(item)}
                            onOpenCitation={(i, c) => props.onOpenCitation(i, c)}
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </Show>

            {/* Unclear */}
            <Show when={!isFirstLoad()} fallback={<UnclearSectionSkeleton />}>
              <Show when={props.unclearItems.length > 0}>
                <div>
                  <div class="flex items-center gap-2 px-3 pt-3 pb-1">
                    <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                      Unclear
                    </span>
                    <span class="text-[11px] text-[var(--text-tertiary)]">
                      {props.unclearItems.length}
                    </span>
                  </div>
                  <For each={props.unclearItems}>
                    {(item) => (
                      <PriorityCard
                        item={item}
                        variant="unclear"
                        feedbackPending={!!props.feedbackPending[itemKey(item)]}
                        onFeedback={(action) => props.onRecordFeedback(item, action)}
                        onOpenThread={() => props.onOpenItem(item)}
                        onOpenCitation={(i, c) => props.onOpenCitation(i, c)}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>

            {/* Secretary chat — expandable inline */}
            <div class="mt-2">
              <Show
                when={chatExpanded()}
                fallback={
                  <button
                    class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--background-base)] px-3 py-2 text-left text-sm text-[var(--text-tertiary)] hover:bg-[var(--background-elevated)] transition-colors"
                    onClick={() => setChatExpanded(true)}
                  >
                    Ask the secretary…
                  </button>
                }
              >
                <SecretaryChat
                  turns={props.assistantTurns}
                  loading={props.assistantLoading}
                  error={props.assistantError}
                  input={props.assistantInput}
                  latestRun={props.latestRun}
                  onSendMessage={props.onSendMessage}
                  onSetInput={props.onSetAssistantInput}
                />
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </section>
  )
}
