import { describe, expect, test } from "bun:test"
import { normalizeInboxAssistantError } from "./inbox-assistant-error"

describe("normalizeInboxAssistantError", () => {
  test("collapses unsupported-org 404 HTML responses", () => {
    expect(
      normalizeInboxAssistantError(
        "Inbox assistant session failed (404 Not Found): <!DOCTYPE html><html><body>missing</body></html>",
      ),
    ).toBe("Priority inbox is unavailable for this organization.")
  })

  test("collapses generic html errors", () => {
    expect(normalizeInboxAssistantError("<html><body>bad gateway</body></html>")).toBe(
      "Inbox assistant is unavailable right now.",
    )
  })

  test("preserves ordinary plaintext failures", () => {
    expect(normalizeInboxAssistantError("Failed to update inbox secretary")).toBe(
      "Failed to update inbox secretary",
    )
  })

  test("collapses missing anthropic key errors", () => {
    expect(
      normalizeInboxAssistantError(
        'Inbox assistant request failed (503 Service Unavailable): {"detail":"Inbox secretary requires FOUNDRY_ANTHROPIC_API_KEY"}',
      ),
    ).toBe("Priority inbox is unavailable until the dev assistant backend is configured.")
  })
})
