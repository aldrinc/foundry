import { For, Show, createEffect, createSignal } from "solid-js"
import type {
  InboxSecretaryTurn,
  InboxSecretaryToolTrace,
} from "@foundry/desktop/bindings"
import { formatCitationTime, formatTurnRole, summarizeTrace, trimToolJson } from "./utils"

type RunInfo = {
  model: string
  created_at: string | number
  tool_traces: InboxSecretaryToolTrace[]
}

export function SecretaryChat(props: {
  turns: InboxSecretaryTurn[]
  loading: boolean
  error: string
  input: string
  latestRun: RunInfo | null
  onSendMessage: (message: string) => void
  onSetInput: (value: string) => void
}) {
  let turnsRef!: HTMLDivElement
  let textareaRef!: HTMLTextAreaElement

  // Auto-scroll to bottom when new turns arrive
  createEffect(() => {
    const _ = props.turns.length
    if (!turnsRef) return
    requestAnimationFrame(() => {
      turnsRef.scrollTop = turnsRef.scrollHeight
    })
  })

  // Auto-resize textarea
  createEffect(() => {
    const _ = props.input
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + "px"
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      props.onSendMessage(props.input)
    }
  }

  return (
    <div class="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-base)] p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Secretary chat</h3>
        <Show when={props.loading}>
          <span class="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--interactive-primary)] supervisor-pulse" />
            Working
          </span>
        </Show>
      </div>

      <div
        ref={turnsRef}
        class="mt-3 flex max-h-[400px] flex-col gap-2 overflow-y-auto"
      >
        <Show when={props.turns.length > 0} fallback={
          <div class="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--background-surface)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            Start a review or ask the secretary to focus on a project, transcript, or recent code changes.
          </div>
        }>
          <For each={props.turns}>
            {(turn) => (
              <div class="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--background-surface)] px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    {formatTurnRole(turn.role)}
                  </span>
                  <span class="text-[11px] text-[var(--text-tertiary)]">
                    {formatCitationTime(turn.created_at)}
                  </span>
                </div>
                <p class="mt-1 text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                  {turn.text}
                </p>
              </div>
            )}
          </For>
        </Show>
      </div>

      <div class="mt-3 flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={props.input}
          rows={1}
          class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--background-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--interactive-primary)]/20 resize-none"
          placeholder="Ask the secretary to re-review, explain a priority, or focus on a specific thread."
          onInput={(event) => props.onSetInput(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-[var(--text-tertiary)]">
            Enter sends. Shift+Enter adds a line.
          </span>
          <button
            class="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-xs text-white hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-60"
            disabled={props.loading || !props.input.trim()}
            onClick={() => props.onSendMessage(props.input)}
          >
            Send
          </button>
        </div>
      </div>

      {/* Run trace — collapsible footer */}
      <Show when={props.latestRun}>
        {(run) => (
          <details class="mt-3 pt-3 border-t border-[var(--border-default)]/70">
            <summary class="cursor-pointer list-none">
              <div class="flex items-center justify-between gap-2 text-[11px] text-[var(--text-tertiary)]">
                <span>Latest run · {run().model} · {formatCitationTime(run().created_at)}</span>
                <span class="uppercase tracking-[0.08em]">
                  {run().tool_traces.length} tools
                </span>
              </div>
            </summary>
            <div class="mt-2 flex flex-col gap-2">
              <For each={run().tool_traces}>
                {(trace) => (
                  <details class="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--background-surface)] px-3 py-2">
                    <summary class="cursor-pointer text-xs text-[var(--text-secondary)]">
                      {summarizeTrace(trace)}
                    </summary>
                    <div class="mt-2 grid gap-2">
                      <div>
                        <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                          Input
                        </div>
                        <pre class="mt-1 whitespace-pre-wrap break-words text-xs text-[var(--text-secondary)]">
                          {trimToolJson(trace.input)}
                        </pre>
                      </div>
                      <div>
                        <div class="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                          Result
                        </div>
                        <pre class="mt-1 whitespace-pre-wrap break-words text-xs text-[var(--text-secondary)]">
                          {trimToolJson(trace.result)}
                        </pre>
                      </div>
                    </div>
                  </details>
                )}
              </For>
            </div>
          </details>
        )}
      </Show>
    </div>
  )
}
