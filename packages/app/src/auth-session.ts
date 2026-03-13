export function isUnauthorizedErrorMessage(error: string | null | undefined): boolean {
  const normalized = (error || "").trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return normalized.includes("invalid api key")
    || normalized.includes("\"code\":\"unauthorized\"")
    || normalized.includes("401 unauthorized")
}

export function isAuthInvalidDisconnectPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false
  }

  const record = payload as {
    auth_invalid?: unknown
    code?: unknown
    error?: unknown
  }

  if (record.auth_invalid === true) {
    return true
  }

  if (typeof record.code === "string" && record.code.trim().toUpperCase() === "UNAUTHORIZED") {
    return true
  }

  if (typeof record.error === "string") {
    return isUnauthorizedErrorMessage(record.error)
  }

  return false
}

export function buildAuthInvalidMessage(error: string | null | undefined): string {
  if (isUnauthorizedErrorMessage(error)) {
    return "Your saved session is no longer valid. Reconnect to continue."
  }

  const trimmed = (error || "").trim()
  if (trimmed) {
    return trimmed
  }

  return "Your session disconnected. Reconnect to continue."
}
