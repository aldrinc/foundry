import { describe, expect, test } from "bun:test"
import {
  buildAuthInvalidMessage,
  isAuthInvalidDisconnectPayload,
  isUnauthorizedErrorMessage,
} from "./auth-session"

describe("auth session helpers", () => {
  test("recognizes unauthorized tenant errors", () => {
    expect(
      isUnauthorizedErrorMessage(
        "Get topics failed (401 Unauthorized): {\"result\":\"error\",\"msg\":\"Invalid API key\",\"code\":\"UNAUTHORIZED\"}",
      ),
    ).toBe(true)
  })

  test("ignores non-auth failures", () => {
    expect(isUnauthorizedErrorMessage("Get topics failed (502 Bad Gateway):")).toBe(false)
    expect(isUnauthorizedErrorMessage("")).toBe(false)
  })

  test("recognizes auth-invalid disconnect payloads", () => {
    expect(isAuthInvalidDisconnectPayload({ auth_invalid: true, error: "Invalid API key" })).toBe(true)
    expect(isAuthInvalidDisconnectPayload({ code: "UNAUTHORIZED" })).toBe(true)
    expect(isAuthInvalidDisconnectPayload({ error: "Get messages failed (401 Unauthorized)" })).toBe(true)
  })

  test("ignores generic disconnect payloads", () => {
    expect(isAuthInvalidDisconnectPayload({ error: "stream disconnected" })).toBe(false)
    expect(isAuthInvalidDisconnectPayload(null)).toBe(false)
  })

  test("builds a reconnect message for invalid sessions", () => {
    expect(buildAuthInvalidMessage("Invalid API key")).toBe(
      "Your saved session is no longer valid. Reconnect to continue.",
    )
    expect(buildAuthInvalidMessage("")).toBe("Your session disconnected. Reconnect to continue.")
  })
})
