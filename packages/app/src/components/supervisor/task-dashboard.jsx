import { For, Show, createSignal } from "solid-js";
import { useSupervisor } from "../../context/supervisor";
const STATUS_COLORS = {
    running: "bg-[var(--status-success)]",
    queued: "bg-[var(--text-tertiary)]",
    completed: "bg-[var(--status-info)]",
    failed: "bg-[var(--status-error)]",
    paused: "bg-[var(--status-warning)]",
    stalled: "bg-orange-500",
    cancelled: "bg-[var(--text-tertiary)]",
};
export function TaskDashboard() {
    const supervisor = useSupervisor();
    const [expanded, setExpanded] = createSignal(true);
    const completedCount = () => supervisor.store.tasks.filter(t => t.status === "completed").length;
    const totalCount = () => supervisor.store.tasks.length;
    const progressPct = () => totalCount() > 0 ? Math.round((completedCount() / totalCount()) * 100) : 0;
    return (<div class="border-b border-[var(--border-default)]" data-component="task-dashboard">
      <button onClick={() => setExpanded(e => !e)} class="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] transition-colors">
        <span>Tasks ({completedCount()}/{totalCount()})</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class={`transition-transform ${expanded() ? "rotate-180" : ""}`}>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <Show when={expanded()}>
        {/* Progress bar */}
        <div class="px-3 pb-1">
          <div class="h-1 bg-[var(--border-default)] rounded-full overflow-hidden">
            <div class="h-full bg-[var(--status-info)] transition-all duration-300" style={{ width: `${progressPct()}%` }}/>
          </div>
        </div>

        {/* Task list */}
        <div class="max-h-[200px] overflow-y-auto">
          <For each={supervisor.store.tasks}>
            {(task) => <TaskRow task={task}/>}
          </For>
        </div>
      </Show>
    </div>);
}
function TaskRow(props) {
    const supervisor = useSupervisor();
    const [replyText, setReplyText] = createSignal("");
    const statusDot = () => STATUS_COLORS[props.task.status || "queued"] || "bg-[var(--text-tertiary)]";
    const handleControl = (action) => {
        supervisor.controlTask(props.task.task_id, action);
    };
    const handleReply = () => {
        const text = replyText().trim();
        if (!text)
            return;
        supervisor.replyToClarification(props.task.task_id, text);
        setReplyText("");
    };
    return (<div class="px-3 py-1.5 border-t border-[var(--border-default)] first:border-t-0">
      <div class="flex items-center gap-2">
        <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot()}`}/>
        <span class="text-xs text-[var(--text-primary)] truncate flex-1">
          {props.task.title || "Untitled task"}
        </span>
        <span class="text-[10px] text-[var(--text-tertiary)] shrink-0">
          {props.task.assigned_role || "worker"}
        </span>
      </div>

      {/* Action buttons */}
      <Show when={props.task.status === "running" || props.task.status === "paused"}>
        <div class="flex gap-1 mt-1 ml-3.5">
          <Show when={props.task.status === "running"}>
            <button onClick={() => handleControl("pause")} class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Pause
            </button>
          </Show>
          <Show when={props.task.status === "paused"}>
            <button onClick={() => handleControl("resume")} class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Resume
            </button>
          </Show>
          <button onClick={() => handleControl("cancel")} class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--background-elevated)] text-[var(--status-error)] hover:bg-[var(--status-error)]/10">
            Cancel
          </button>
        </div>
      </Show>

      {/* Clarification reply */}
      <Show when={props.task.clarification_requested}>
        <div class="mt-1.5 ml-3.5">
          <div class="text-[10px] text-[var(--status-warning)] mb-1">Clarification needed</div>
          <div class="flex gap-1">
            <input type="text" value={replyText()} onInput={(e) => setReplyText(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && handleReply()} class="flex-1 text-[10px] px-2 py-1 rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)]" placeholder="Reply..."/>
            <button onClick={handleReply} class="text-[10px] px-2 py-1 rounded bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)]">
              Send
            </button>
          </div>
        </div>
      </Show>

      {/* Error display */}
      <Show when={props.task.error_text}>
        <div class="text-[10px] text-[var(--status-error)] mt-1 ml-3.5 truncate">
          {props.task.error_text}
        </div>
      </Show>
    </div>);
}
