import { describe, expect, test } from "bun:test"

import {
  MANUAL_LOGOUT_STORAGE_KEY,
  clearManualLogout,
  markManualLogout,
  shouldSkipAutoLogin,
} from "./manual-logout"

function createStorage() {
  const values = new Map<string, string>()

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

describe("manual logout persistence", () => {
  test("blocks auto-login after a manual logout until the next successful login", () => {
    const storage = createStorage()

    expect(shouldSkipAutoLogin(storage)).toBe(false)

    markManualLogout(storage)

    expect(storage.getItem(MANUAL_LOGOUT_STORAGE_KEY)).toBe("true")
    expect(shouldSkipAutoLogin(storage)).toBe(true)

    clearManualLogout(storage)

    expect(shouldSkipAutoLogin(storage)).toBe(false)
  })
})
