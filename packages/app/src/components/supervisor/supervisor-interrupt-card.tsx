import { For, Show } from "solid-js"
import { useSupervisor } from "../../context/supervisor"

/**
 * SupervisorInterruptCard — shows actionable interrupt states driven by runtime projection.
 * Surfaces: approval required, clarification required, repo missing, completion follow-up.
 * Only renders when at least one interrupt condition is active.
 */
export function SupervisorInterruptCard() {
  const supervisor = useSupervisor()

  const approval = () => supervisor.store.approvalRequired
  const clarification = () => supervisor.store.clarificationRequired
  const followUp = () => supervisor.store.completionFollowUpRequired
  const missingEvidence = () => supervisor.store.completionMissingEvidence
  const repoMissing = () => {
    // Repo is "missing" when execution is requested but no repo attachment exists
    return supervisor.store.executionRequested && !supervisor.store.repoAttachment
  }

  const hasInterrupt = () => approval() || clarification() || followUp() || repoMissing()

  return (
    <Show when={hasInterrupt()}>
      <div class="border-b border-[var(--border-default)] px-3 py-2 space-y-1.5">
        <Show when={approval()}>
          <InterruptRow
            icon="!"
            color="warning"
            label="Approval required"
            detail="The supervisor is waiting for your approval before proceeding."
          />
        </Show>

        <Show when={clarification()}>
          <InterruptRow
            icon="?"
            color="warning"
            label="Clarification needed"
            detail="The supervisor needs additional information to continue."
          />
        </Show>

        <Show when={repoMissing()}>
          <InterruptRow
            icon="↗"
            color="error"
            label="Repository not attached"
            detail="Execution was requested but no repository is linked to this topic."
          />
        </Show>

        <Show when={followUp()}>
          <InterruptRow
            icon="↻"
            color="info"
            label="Follow-up required"
            detail={
              missingEvidence().length > 0
                ? `Missing evidence: ${missingEvidence().join(", ")}`
                : "Completion review requires follow-up action."
            }
          />
        </Show>
      </div>
    </Show>
  )
}

function InterruptRow(props: {
  icon: string
  color: "warning" | "error" | "info"
  label: string
  detail: string
}) {
  const colorVar = () => {
    switch (props.color) {
      case "warning": return "var(--status-warning)"
      case "error": return "var(--status-error)"
      case "info": return "var(--status-info)"
    }
  }

  return (
    <div class="flex items-start gap-2">
      <span
        class="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
        style={{ color: colorVar(), background: `color-mix(in srgb, ${colorVar()} 15%, transparent)` }}
      >
        {props.icon}
      </span>
      <div class="min-w-0">
        <div class="text-xs font-medium" style={{ color: colorVar() }}>
          {props.label}
        </div>
        <div class="text-[10px] text-[var(--text-tertiary)]">{props.detail}</div>
      </div>
    </div>
  )
}
