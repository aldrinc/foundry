import type {
  InboxSecretaryToolTrace,
} from "@foundry/desktop/bindings"

export function formatSecretaryStatus(status: string): string {
  switch (status) {
    case "needs_action":
      return "Needs action"
    case "waiting":
      return "Waiting"
    case "claimed_done":
      return "Claimed done"
    case "verified_done":
      return "Closed"
    case "unclear":
      return "Unclear"
    default:
      return status.replaceAll("_", " ")
  }
}

export function formatSecretaryConfidence(confidence: string): string {
  switch (confidence) {
    case "high":
      return "High confidence"
    case "low":
      return "Low confidence"
    default:
      return "Medium confidence"
  }
}

export function formatCitationTime(timestamp: number | string): string {
  if (!timestamp) return "Source"
  const date =
    typeof timestamp === "number"
      ? new Date(timestamp * 1000)
      : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return "Source"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatTurnRole(role: string): string {
  return role === "assistant" ? "Secretary" : "You"
}

export function trimToolJson(value: string): string {
  return value.length <= 280 ? value : value.slice(0, 277).trimEnd() + "..."
}

export function summarizeTrace(trace: InboxSecretaryToolTrace): string {
  const duration = trace.duration_ms > 0 ? `${trace.duration_ms}ms` : "done"
  return `${trace.tool_name} · ${trace.status} · ${duration}`
}

export function statusAccentColor(status: string): string {
  switch (status) {
    case "needs_action":
      return "var(--interactive-primary)"
    case "waiting":
      return "var(--status-warning)"
    case "claimed_done":
    case "verified_done":
      return "var(--status-success)"
    case "unclear":
      return "var(--text-tertiary)"
    default:
      return "var(--border-default)"
  }
}

export function confidenceDotColor(confidence: string): string {
  switch (confidence) {
    case "high":
      return "var(--status-success)"
    case "low":
      return "var(--text-tertiary)"
    default:
      return "var(--status-warning)"
  }
}
