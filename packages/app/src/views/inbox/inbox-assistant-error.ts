export function normalizeInboxAssistantError(error: string | null | undefined): string {
  const trimmed = (error || "").trim()
  if (!trimmed) {
    return "Inbox assistant is unavailable right now."
  }

  const normalized = trimmed.toLowerCase()
  if (
    normalized.includes("404 not found")
    && (
      normalized.includes("/api/v1/foundry/inbox/assistant/")
      || normalized.includes("inbox assistant session failed")
    )
  ) {
    return "Priority inbox is unavailable for this organization."
  }

  if (normalized.includes("<!doctype html>") || normalized.includes("<html")) {
    return "Inbox assistant is unavailable right now."
  }

  if (
    normalized.includes("foundry_anthropic_api_key")
    || (
      normalized.includes("secretary")
      && normalized.includes("not configured")
      && normalized.includes("claude")
    )
  ) {
    return "Priority inbox is unavailable until the dev assistant backend is configured."
  }

  return trimmed
}
