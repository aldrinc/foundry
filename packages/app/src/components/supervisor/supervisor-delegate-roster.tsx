import { For, Show } from "solid-js"
import { useAgents } from "../../context/agents"
import { useSupervisor } from "../../context/supervisor"

export function SupervisorDelegateRoster() {
  const agents = useAgents()
  const supervisor = useSupervisor()

  const delegates = () => agents.availableDelegatesForStream(supervisor.store.streamId)

  return (
    <Show when={delegates().length > 0}>
      <div
        class="px-3 py-2 border-b border-[var(--border-default)] bg-[var(--background-base)]"
        data-component="supervisor-delegate-roster"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs font-medium text-[var(--text-primary)]">Delegate Agents</div>
            <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5">
              The Supervisor can use these configured delegates in this topic.
            </div>
          </div>
          <span class="text-[10px] text-[var(--text-tertiary)]">
            {delegates().length}
          </span>
        </div>

        <div class="flex flex-wrap gap-1.5 mt-2">
          <For each={delegates()}>
            {(delegate) => (
              <div class="px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--background-elevated)] text-[10px] text-[var(--text-secondary)]">
                <span class="text-[var(--text-primary)] font-medium">
                  {delegate.emoji || delegate.name.charAt(0).toUpperCase()}
                </span>
                <span class="ml-1">{delegate.name}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
