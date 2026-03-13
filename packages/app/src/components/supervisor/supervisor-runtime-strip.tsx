import { Show } from "solid-js"
import { useSupervisor } from "../../context/supervisor"

/**
 * SupervisorRuntimeStrip — collapsible summary of the authoritative runtime state.
 * Shows: phase, phase reason, active plan id, repo attachment status, worker readiness.
 * Only renders when there is a non-null runtime phase.
 */
export function SupervisorRuntimeStrip() {
  const supervisor = useSupervisor()

  const phase = () => supervisor.store.runtimePhase
  const phaseReason = () => supervisor.store.runtimePhaseReason
  const planId = () => supervisor.store.activePlanRevisionId
  const workerReady = () => supervisor.store.workerBackendReady
  const repo = () => supervisor.store.repoAttachment
  const executionReady = () => supervisor.store.executionReady
  const blockers = () => supervisor.store.executionBlockers
  const counts = () => supervisor.store.taskCounts

  const hasContent = () => phase() !== null

  const phaseLabel = () => {
    const p = phase()
    if (!p) return ""
    return p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
  }

  const phaseColor = () => {
    const p = phase()
    if (!p) return "text-[var(--text-tertiary)]"
    if (p === "completed" || p === "done") return "text-[var(--status-success)]"
    if (p === "failed" || p === "error") return "text-[var(--status-error)]"
    if (p === "awaiting_approval" || p === "awaiting_clarification") return "text-[var(--status-warning)]"
    return "text-[var(--status-info)]"
  }

  const repoLabel = () => {
    const r = repo()
    if (!r || typeof r !== "object") return null
    const obj = r as Record<string, unknown>
    const name = obj.repo_name || obj.name || obj.url
    return typeof name === "string" ? name : null
  }

  const countsLabel = () => {
    const c = counts()
    if (!c) return null
    const parts: string[] = []
    if (c.running > 0) parts.push(`${c.running} running`)
    if (c.completed > 0) parts.push(`${c.completed} done`)
    if (c.failed > 0) parts.push(`${c.failed} failed`)
    if (c.pending > 0) parts.push(`${c.pending} pending`)
    return parts.length ? `${c.total} tasks: ${parts.join(", ")}` : `${c.total} tasks`
  }

  return (
    <Show when={hasContent()}>
      <details class="group border-b border-[var(--border-default)]" open>
        <summary class="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] list-none px-3 py-2">
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            class="transition-transform group-open:rotate-90 shrink-0"
          >
            <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class={`font-medium ${phaseColor()}`}>{phaseLabel()}</span>
          <Show when={countsLabel()}>
            <span class="text-[10px] text-[var(--text-tertiary)]">({countsLabel()})</span>
          </Show>
        </summary>

        <div class="px-3 pb-2 space-y-1 text-xs text-[var(--text-secondary)]">
          <Show when={phaseReason()}>
            <div class="text-[var(--text-tertiary)]">{phaseReason()}</div>
          </Show>

          <Show when={planId()}>
            <div>
              <span class="text-[var(--text-tertiary)]">Plan: </span>
              <span class="font-mono text-[10px]">{planId()}</span>
            </div>
          </Show>

          <Show when={repoLabel()}>
            <div>
              <span class="text-[var(--text-tertiary)]">Repo: </span>
              <span>{repoLabel()}</span>
            </div>
          </Show>

          <Show when={workerReady()}>
            <div class="text-[var(--status-success)]">Worker backend ready</div>
          </Show>
          <Show when={phase() && !workerReady()}>
            <div class="text-[var(--text-tertiary)]">Worker backend not ready</div>
          </Show>

          <Show when={executionReady()}>
            <div class="text-[var(--status-success)]">Execution prerequisites met</div>
          </Show>

          <Show when={blockers().length > 0}>
            <div>
              <span class="text-[var(--status-warning)]">Blockers: </span>
              <span class="text-[var(--text-tertiary)]">{blockers().join(", ")}</span>
            </div>
          </Show>
        </div>
      </details>
    </Show>
  )
}
