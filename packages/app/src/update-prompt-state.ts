export type UpdatePromptState =
  | { phase: "hidden" }
  | { phase: "available"; version?: string }
  | { phase: "installing"; version?: string }
  | { phase: "error"; version?: string; errorMessage: string }

export function hideUpdatePrompt(): UpdatePromptState {
  return { phase: "hidden" }
}

export function availableUpdatePrompt(version?: string): UpdatePromptState {
  return { phase: "available", version }
}

export function startInstallingUpdate(state: UpdatePromptState): UpdatePromptState {
  return {
    phase: "installing",
    version: "version" in state ? state.version : undefined,
  }
}

export function failInstallingUpdate(state: UpdatePromptState, error: unknown): UpdatePromptState {
  return {
    phase: "error",
    version: "version" in state ? state.version : undefined,
    errorMessage: normalizeUpdateError(error),
  }
}

export function getUpdatePromptTitle(state: UpdatePromptState): string {
  switch (state.phase) {
    case "installing":
      return "Installing update"
    case "available":
    case "error":
      return "Update available"
    case "hidden":
      return ""
  }
}

export function getUpdatePromptDescription(state: UpdatePromptState): string {
  switch (state.phase) {
    case "available":
      if (state.version) {
        return `A new version of Foundry (${state.version}) is ready to install.`
      }
      return "A new version of Foundry is ready to install."
    case "installing":
      return "Foundry is downloading the update and will restart when it is ready."
    case "error":
      return "The update is still available. Try installing again, or wait until later."
    case "hidden":
      return ""
  }
}

export function getUpdatePromptPrimaryActionLabel(state: UpdatePromptState): string {
  switch (state.phase) {
    case "installing":
      return "Installing..."
    case "error":
      return "Try again"
    case "available":
      return "Install and restart"
    case "hidden":
      return ""
  }
}

function normalizeUpdateError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }

  return "Installation failed. Try again in a moment."
}
