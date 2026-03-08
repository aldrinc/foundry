import { Show } from "solid-js";
import { useSupervisor } from "../../context/supervisor";
import { SupervisorHeader } from "./supervisor-header";
import { SupervisorDelegateRoster } from "./supervisor-delegate-roster";
import { TaskDashboard } from "./task-dashboard";
import { SupervisorTimeline } from "./supervisor-timeline";
import { SupervisorComposer } from "./supervisor-composer";
export function SupervisorPanel() {
    const supervisor = useSupervisor();
    return (<Show when={supervisor.store.active}>
      <aside class="w-[420px] shrink-0 flex flex-col border-l border-[var(--border-default)] bg-[var(--background-surface)] h-full" data-component="supervisor-panel">
        <SupervisorHeader />
        <SupervisorDelegateRoster />

        <Show when={supervisor.store.warning}>
          <div class={`px-3 py-2 text-xs border-b border-[var(--border-default)] ${supervisor.store.warningTone === "error"
            ? "text-[var(--status-error)] bg-[var(--status-error)]/10"
            : "text-[var(--status-warning)] bg-[var(--status-warning)]/10"}`}>
            {supervisor.store.warning}
          </div>
        </Show>

        <Show when={supervisor.store.tasks.length > 0}>
          <TaskDashboard />
        </Show>

        <SupervisorTimeline />
        <SupervisorComposer />
      </aside>
    </Show>);
}
