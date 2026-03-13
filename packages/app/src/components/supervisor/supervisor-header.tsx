import { Show } from "solid-js"
import { useSupervisor } from "../../context/supervisor"

export function SupervisorHeader() {
  const supervisor = useSupervisor()

  const statusColor = () => {
    switch (supervisor.store.status) {
      case "connected": return "bg-[var(--status-success)]"
      case "connecting": return "bg-[var(--status-warning)]"
      case "disconnected": return "bg-[var(--status-error)]"
      default: return "bg-[var(--text-tertiary)]"
    }
  }

  const engineLabel = () => {
    const sessionTitle = supervisor.store.draftingNewSession
      ? "New session"
      : supervisor.store.session?.metadata?.title
    return sessionTitle || supervisor.store.session?.metadata?.engine || "Supervisor"
  }

  const phaseLabel = () => {
    const p = supervisor.store.runtimePhase
    if (!p) return null
    return p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
  }

  const repoName = () => {
    const r = supervisor.store.repoAttachment
    if (!r || typeof r !== "object") return null
    const obj = r as Record<string, unknown>
    const name = obj.repo_name || obj.name
    return typeof name === "string" ? name : null
  }

  const hasSubInfo = () => phaseLabel() || repoName()

  return (
    <div
      class="flex items-center justify-between px-3 border-b border-[var(--border-default)] bg-[var(--background-elevated)]"
      style={{ "min-height": "3rem" }}
      data-component="supervisor-header"
    >
      <div class="flex items-center gap-2 min-w-0 py-1.5">
        <div class={`w-2 h-2 rounded-full shrink-0 ${statusColor()}`} />
        <div class="min-w-0">
          <div class="text-sm font-medium text-[var(--text-primary)] truncate">
            {engineLabel()}
          </div>
          <div class="text-xs text-[var(--text-tertiary)] truncate">
            #{supervisor.store.streamName} &gt; {supervisor.store.topicName}
            <Show when={hasSubInfo()}>
              <span class="text-[var(--text-tertiary)]">
                <Show when={phaseLabel()}>
                  {" · "}<span class="text-[var(--status-info)]">{phaseLabel()}</span>
                </Show>
                <Show when={repoName()}>
                  {" · "}{repoName()}
                </Show>
              </span>
            </Show>
          </div>
        </div>
      </div>

      <button
        onClick={() => supervisor.close()}
        class="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-base)] transition-colors"
        title="Close supervisor"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  )
}
