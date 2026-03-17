import { describe, expect, test } from "bun:test"
import { getManualUpdateErrorMessage } from "./settings-update"

describe("getManualUpdateErrorMessage", () => {
  test("shows a friendly message when updater endpoints are missing", () => {
    expect(
      getManualUpdateErrorMessage(new Error("Updater does not have any endpoints set.")),
    ).toBe("Updates are not configured for this build yet.")
  })

  test("falls back to the source error message when it is already user-readable", () => {
    expect(
      getManualUpdateErrorMessage(new Error("Network timeout while checking for updates.")),
    ).toBe("Network timeout while checking for updates.")
  })
})
