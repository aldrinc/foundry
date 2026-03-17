export function getManualUpdateErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : String(error ?? "").trim()

  if (!message) {
    return "Unable to check for updates right now."
  }

  if (message.includes("Updater does not have any endpoints set")) {
    return "Updates are not configured for this build yet."
  }

  if (message.includes("plugin updater not found") || message.includes("not allowed")) {
    return "This build cannot access the updater right now."
  }

  if (message.includes("secure protocol")) {
    return "The updater endpoint for this build is invalid. Use a build configured with HTTPS update endpoints."
  }

  return message
}
