import { For, Show, createSignal } from "solid-js"
import { useSupervisor } from "../../context/supervisor"
import type { SupervisorTask, JsonValue } from "@foundry/desktop/bindings"

/**
 * SupervisorTaskList — collapsible section rendering the authoritative runtime task list.
 * Shows store.tasks from the runtime layer (not timeline events).
 * Only renders when there are actual tasks.
 *
 * Design: collapsible sections with text rows (Perplexity pattern).
 * No cards, badges, progress bars, or invented UI chrome.
 */
export function SupervisorTaskList() {
  const supervisor = useSupervisor()

  const tasks = () => supervisor.store.tasks
  const hasTasks = () => tasks().length > 0

  const runningCount = () => tasks().filter(t => t.status === "running").length
  const completedCount = () => tasks().filter(t => t.status === "completed").length
  const failedCount = () => tasks().filter(t => t.status === "failed").length
  const totalCount = () => tasks().length

  const summaryLabel = () => {
    const parts: string[] = []
    const r = runningCount()
    const c = completedCount()
    const f = failedCount()
    if (r > 0) parts.push(`${r} running`)
    if (c > 0) parts.push(`${c} done`)
    if (f > 0) parts.push(`${f} failed`)
    return parts.length > 0 ? parts.join(", ") : ""
  }

  return (
    <Show when={hasTasks()}>
      <details class="group border-b border-[var(--border-default)]" open>
        <summary class="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] list-none px-3 py-2">
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            class="transition-transform group-open:rotate-90 shrink-0"
          >
            <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="font-medium">Tasks</span>
          <span class="text-[10px] text-[var(--text-tertiary)]">
            ({totalCount()}{summaryLabel() ? `: ${summaryLabel()}` : ""})
          </span>
        </summary>

        <div class="px-3 pb-2 space-y-0.5">
          <For each={tasks()}>
            {(task) => <RuntimeTaskRow task={task} />}
          </For>
        </div>
      </details>
    </Show>
  )
}

// ── Individual task row ──

function RuntimeTaskRow(props: { task: SupervisorTask }) {
  const supervisor = useSupervisor()
  const [replyText, setReplyText] = createSignal("")

  const status = () => props.task.status || "queued"
  const title = () => props.task.title || "Task"
  const role = () => props.task.assigned_role
  const activity = () => props.task.activity
  const resultText = () => props.task.result_text
  const errorText = () => props.task.error_text
  const taskId = () => props.task.task_id
  const clarificationRequested = () => !!props.task.clarification_requested
  const branchName = () => props.task.branch_name
  const previewUrl = () => props.task.preview_url
  const blockers = () => props.task.blockers || []
  const turnsUsed = () => props.task.turns_used
  const tokensUsed = () => props.task.tokens_used

  const hasDetails = () =>
    !!activity() || !!resultText() || !!errorText() ||
    clarificationRequested() || blockers().length > 0 ||
    !!branchName() || !!previewUrl() ||
    status() === "running" || status() === "paused"

  const handleControl = (action: string) => {
    supervisor.controlTask(taskId(), action)
  }

  const handleReply = () => {
    const text = replyText().trim()
    if (!text) return
    supervisor.replyToClarification(taskId(), text)
    setReplyText("")
  }

  return (
    <details class="group/task" open={status() === "running" || clarificationRequested()}>
      <summary class="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] list-none py-0.5">
        <TaskStatusIcon status={status()} />
        <Show when={role()}>
          <span class="text-[10px] text-[var(--text-tertiary)] shrink-0">{role()}</span>
        </Show>
        <span class="truncate flex-1">{title()}</span>
        <Show when={hasDetails()}>
          <svg
            width="8" height="8" viewBox="0 0 10 10" fill="none"
            class="transition-transform group-open/task:rotate-90 shrink-0 text-[var(--text-tertiary)]"
          >
            <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </Show>
      </summary>

      <Show when={hasDetails()}>
        <div class="ml-5 mt-0.5 mb-1 space-y-0.5">
          {/* Activity */}
          <Show when={activity()}>
            <div class="text-[10px] text-[var(--text-secondary)]">{activity()}</div>
          </Show>

          {/* Branch name */}
          <Show when={branchName()}>
            <div class="text-[10px] text-[var(--text-tertiary)]">
              <span class="font-mono">{branchName()}</span>
            </div>
          </Show>

          {/* Preview URL */}
          <Show when={previewUrl()}>
            <div class="text-[10px]">
              <a
                href={previewUrl()!}
                target="_blank"
                rel="noopener"
                class="text-[var(--interactive-primary)] hover:underline"
              >
                Preview
              </a>
            </div>
          </Show>

          {/* Turns / tokens */}
          <Show when={turnsUsed() != null || tokensUsed() != null}>
            <div class="text-[10px] text-[var(--text-tertiary)]">
              {turnsUsed() != null ? `${turnsUsed()} turns` : ""}
              {turnsUsed() != null && tokensUsed() != null ? " · " : ""}
              {tokensUsed() != null ? `${tokensUsed()!.toLocaleString()} tokens` : ""}
            </div>
          </Show>

          {/* Blockers */}
          <Show when={blockers().length > 0}>
            <div class="text-[10px] text-[var(--status-warning)]">
              Blocked: {blockers().join(", ")}
            </div>
          </Show>

          {/* Result */}
          <Show when={resultText()}>
            <div class="text-[10px] text-[var(--status-success)]">{resultText()}</div>
          </Show>

          {/* Error */}
          <Show when={errorText()}>
            <div class="text-[10px] text-[var(--status-error)]">{errorText()}</div>
          </Show>

          {/* Controls for running/paused tasks */}
          <Show when={status() === "running" || status() === "paused"}>
            <div class="flex gap-1 mt-1">
              <Show when={status() === "running"}>
                <button
                  onClick={() => handleControl("pause")}
                  class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Pause
                </button>
              </Show>
              <Show when={status() === "paused"}>
                <button
                  onClick={() => handleControl("resume")}
                  class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Resume
                </button>
              </Show>
              <button
                onClick={() => handleControl("cancel")}
                class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--status-error)] hover:bg-[var(--status-error)]/10"
              >
                Cancel
              </button>
            </div>
          </Show>

          {/* Clarification reply */}
          <Show when={clarificationRequested()}>
            <div class="mt-1">
              <div class="text-[10px] text-[var(--status-warning)] mb-0.5">Clarification needed</div>
              <div class="flex gap-1">
                <input
                  type="text"
                  value={replyText()}
                  onInput={(e) => setReplyText(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleReply()}
                  class="flex-1 text-[10px] px-2 py-1 rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)]"
                  placeholder="Reply..."
                />
                <button
                  onClick={handleReply}
                  class="text-[10px] px-2 py-1 rounded bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)]"
                >
                  Send
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </details>
  )
}

// ── Status icon ──

function TaskStatusIcon(props: { status: string }) {
  return (
    <>
      <Show when={props.status === "running"}>
        <span class="w-3 h-3 rounded-full border-2 border-[var(--status-success)] border-t-transparent supervisor-spin shrink-0" />
      </Show>
      <Show when={props.status === "completed"}>
        <span class="text-[var(--status-success)] shrink-0 text-xs">✓</span>
      </Show>
      <Show when={props.status === "failed"}>
        <span class="text-[var(--status-error)] shrink-0 text-xs">✗</span>
      </Show>
      <Show when={props.status === "paused"}>
        <span class="text-[var(--status-warning)] shrink-0 text-xs">⏸</span>
      </Show>
      <Show when={props.status === "cancelled"}>
        <span class="text-[var(--text-tertiary)] shrink-0 text-xs">⊘</span>
      </Show>
      <Show when={props.status !== "running" && props.status !== "completed" && props.status !== "failed" && props.status !== "paused" && props.status !== "cancelled"}>
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] shrink-0" />
      </Show>
    </>
  )
}
