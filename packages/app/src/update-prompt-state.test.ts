import { describe, expect, test } from "bun:test"
import {
  availableUpdatePrompt,
  failInstallingUpdate,
  getUpdatePromptDescription,
  getUpdatePromptPrimaryActionLabel,
  getUpdatePromptTitle,
  hideUpdatePrompt,
  startInstallingUpdate,
} from "./update-prompt-state"

describe("update prompt state", () => {
  test("describes an available update with its version", () => {
    const state = availableUpdatePrompt("1.2.3")

    expect(getUpdatePromptTitle(state)).toBe("Update available")
    expect(getUpdatePromptDescription(state)).toBe(
      "A new version of Foundry (1.2.3) is ready to install.",
    )
    expect(getUpdatePromptPrimaryActionLabel(state)).toBe("Install and restart")
  })

  test("preserves the discovered version while installing", () => {
    const state = startInstallingUpdate(availableUpdatePrompt("2.0.0"))

    expect(state).toEqual({ phase: "installing", version: "2.0.0" })
    expect(getUpdatePromptTitle(state)).toBe("Installing update")
    expect(getUpdatePromptPrimaryActionLabel(state)).toBe("Installing...")
  })

  test("surfaces retry copy when installation fails", () => {
    const state = failInstallingUpdate(
      startInstallingUpdate(availableUpdatePrompt()),
      new Error("Network timeout"),
    )

    expect(state).toEqual({
      phase: "error",
      version: undefined,
      errorMessage: "Network timeout",
    })
    expect(getUpdatePromptDescription(state)).toBe(
      "The update is still available. Try installing again, or wait until later.",
    )
    expect(getUpdatePromptPrimaryActionLabel(state)).toBe("Try again")
  })

  test("returns to a hidden state when dismissed", () => {
    expect(hideUpdatePrompt()).toEqual({ phase: "hidden" })
  })
})
