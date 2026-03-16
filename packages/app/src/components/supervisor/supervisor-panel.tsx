import { Show } from "solid-js"
import { useSupervisor } from "../../context/supervisor"
import { SupervisorHeader } from "./supervisor-header"
import { SupervisorSessionList } from "./supervisor-session-list"
import { SupervisorRuntimeStrip } from "./supervisor-runtime-strip"
import { SupervisorTaskList } from "./supervisor-task-list"
import { SupervisorInterruptCard } from "./supervisor-interrupt-card"
import { SupervisorTimeline } from "./supervisor-timeline"
import { SupervisorComposer } from "./supervisor-composer"

export function SupervisorPanel() {
  const supervisor = useSupervisor()

  return (
    <Show when={supervisor.store.active}>
      <aside
        class="w-[640px] shrink-0 flex flex-col border-l border-[var(--border-default)] bg-[var(--background-surface)] h-full"
        data-component="supervisor-panel"
      >
        <SupervisorHeader />
        <SupervisorSessionList />

        <Show when={supervisor.store.warning}>
          <div
            class={`px-3 py-2 text-xs border-b border-[var(--border-default)] ${
              supervisor.store.warningTone === "error"
                ? "text-[var(--status-error)] bg-[var(--status-error)]/10"
                : "text-[var(--status-warning)] bg-[var(--status-warning)]/10"
            }`}
          >
            {supervisor.store.warning}
          </div>
        </Show>

        <SupervisorRuntimeStrip />
        <SupervisorTaskList />
        <SupervisorInterruptCard />

        <SupervisorTimeline />
        <SupervisorComposer />
      </aside>
    </Show>
  )
}
