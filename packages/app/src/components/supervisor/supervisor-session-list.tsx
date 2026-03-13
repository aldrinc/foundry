import { For } from "solid-js"
import { useSupervisor } from "../../context/supervisor"
import {
  sessionSubtitle,
} from "./supervisor-session-meta"

function sessionTitle(session: any) {
  return session?.metadata?.title || session?.metadata?.created_by_name || session?.session_id || "Session"
}

export function SupervisorSessionList() {
  const supervisor = useSupervisor()

  const isSelected = (sessionId: string) => {
    return !supervisor.store.draftingNewSession && supervisor.store.selectedSessionId === sessionId
  }

  return (
    <div class="w-[200px] shrink-0 border-r border-[var(--border-default)] bg-[var(--background-elevated)] flex flex-col">
      <div class="px-3 py-3 border-b border-[var(--border-default)]">
        <div class="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          Sessions
        </div>
        <button
          onClick={() => supervisor.startNewSession()}
          class="mt-3 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--background-surface)] transition-colors"
        >
          New session
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        <button
          onClick={() => supervisor.startNewSession()}
          class={`w-full rounded-[var(--radius-md)] px-3 py-2 text-left border transition-colors ${
            supervisor.store.draftingNewSession
              ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
              : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--background-surface)]"
          }`}
        >
          <div class="text-sm font-medium text-[var(--text-primary)] truncate">New draft</div>
          <div class="text-xs text-[var(--text-tertiary)] truncate">
            Start a separate supervisor conversation in this topic
          </div>
        </button>

        <For each={supervisor.store.sessions}>
          {(session) => (
            <button
              onClick={() => supervisor.selectSession(session.session_id)}
              class={`w-full rounded-[var(--radius-md)] px-3 py-2 text-left border transition-colors ${
                isSelected(session.session_id)
                  ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
                  : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--background-surface)]"
              }`}
            >
              <div class="flex items-center gap-2">
                <div class={`h-2 w-2 rounded-full ${session.status === "active" ? "bg-[var(--status-success)]" : "bg-[var(--text-tertiary)]"}`} />
                <div class="text-sm font-medium text-[var(--text-primary)] truncate">
                  {sessionTitle(session)}
                </div>
              </div>
              <div class="mt-1 text-xs text-[var(--text-tertiary)] truncate">
                {sessionSubtitle(session)}
              </div>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
