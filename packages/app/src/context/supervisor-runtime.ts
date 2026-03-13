import type { JsonValue, RuntimeProjection } from "@foundry/desktop/bindings"

export interface RuntimeProjectionCarrier {
  phase?: string | null
  runtime_state?: JsonValue | null
}

function asRecord(value: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, JsonValue>
}

function asString(value: JsonValue | null | undefined): string | null {
  return typeof value === "string" ? value : null
}

function asBoolean(value: JsonValue | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function asStringArray(value: JsonValue | null | undefined): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  return value.filter((item): item is string => typeof item === "string")
}

export function extractRuntimeProjection(
  carrier: RuntimeProjectionCarrier | null | undefined,
): RuntimeProjection | null {
  if (!carrier) {
    return null
  }

  const runtimeState = asRecord(carrier.runtime_state)
  if (!runtimeState) {
    return carrier.phase ? { phase: carrier.phase } : null
  }

  return {
    phase: asString(runtimeState.phase) ?? carrier.phase ?? null,
    phase_reason: asString(runtimeState.phase_reason),
    approval_required: asBoolean(runtimeState.approval_required),
    clarification_required: asBoolean(runtimeState.clarification_required),
    execution_requested: asBoolean(runtimeState.execution_requested),
    execution_prerequisites_ready: asBoolean(runtimeState.execution_prerequisites_ready),
    execution_blockers: asStringArray(runtimeState.execution_blockers),
    completion_follow_up_required: asBoolean(runtimeState.completion_follow_up_required),
    completion_missing_evidence: asStringArray(runtimeState.completion_missing_evidence),
    observed_artifacts: Array.isArray(runtimeState.observed_artifacts)
      ? runtimeState.observed_artifacts as JsonValue[]
      : null,
    repo_attachment: runtimeState.repo_attachment ?? null,
    worker_backend_ready: asBoolean(runtimeState.worker_backend_ready),
    active_plan_revision_id: asString(runtimeState.active_plan_revision_id),
    contract: runtimeState.contract ?? null,
    runtime_state: runtimeState.runtime_state ?? null,
  }
}
