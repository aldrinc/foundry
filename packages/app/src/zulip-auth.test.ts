import { describe, expect, test } from "bun:test"

import {
  PENDING_SSO_STORAGE_KEY,
  buildExternalAuthUrl,
  completePendingSso,
  consumePendingDeepLinks,
  decryptOtpEncryptedApiKey,
  normalizeServerUrl,
  parseSsoCallbackUrl,
  savePendingSso,
} from "./zulip-auth"

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

describe("normalizeServerUrl", () => {
  test("drops a trailing slash from canonical realm URLs", () => {
    expect(normalizeServerUrl("https://chat.example.invalid/")).toBe("https://chat.example.invalid")
  })

  test("keeps non-URL input stable enough for validation errors", () => {
    expect(normalizeServerUrl("chat.example.com///")).toBe("chat.example.com")
  })
})

describe("external auth URL building", () => {
  test("appends the OTP to the provider login path", () => {
    const url = buildExternalAuthUrl(
      "https://chat.example.invalid",
      { login_url: "/accounts/login/social/oidc/keycloak" },
      "abcd",
    )

    expect(url).toBe(
      "https://chat.example.invalid/accounts/login/social/oidc/keycloak?mobile_flow_otp=abcd",
    )
  })
})

describe("SSO callback handling", () => {
  test("decrypts and consumes a pending OTP-protected API key", () => {
    const storage = createStorage()
    const otp = "1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd"
    const apiKey = Array.from({ length: 32 }, () => "a").join("")

    savePendingSso(storage, "https://chat.example.invalid/", otp)

    const hexApiKey = apiKey
      .split("")
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
    const encrypted = hexApiKey
      .split("")
      .map((char, index) => (Number.parseInt(char, 16) ^ Number.parseInt(otp[index]!, 16)).toString(16))
      .join("")

    expect(decryptOtpEncryptedApiKey(encrypted, otp)).toBe(apiKey)

    const completed = completePendingSso(storage, {
      realm: "https://chat.example.invalid",
      email: "alice@example.com",
      otpEncryptedApiKey: encrypted,
      userId: 42,
    })

    expect(completed).toEqual({
      serverUrl: "https://chat.example.invalid",
      email: "alice@example.com",
      apiKey,
    })
    expect(storage.getItem(PENDING_SSO_STORAGE_KEY)).toBeNull()
  })

  test("parses the Zulip deep link payload", () => {
    expect(
      parseSsoCallbackUrl(
        "zulip://login?realm=https%3A%2F%2Fchat.example.invalid&email=alice%40example.com&otp_encrypted_api_key=abcd&user_id=7",
      ),
    ).toEqual({
      realm: "https://chat.example.invalid",
      email: "alice@example.com",
      otpEncryptedApiKey: "abcd",
      userId: 7,
    })
  })

  test("only consumes matching pending deep links", () => {
    const originalWindow = (globalThis as any).window
    const ssoUrl = "zulip://login?realm=https%3A%2F%2Fchat.example.invalid&email=alice%40example.com&otp_encrypted_api_key=abcd&user_id=7"
    const messageUrl = "foundry://message?org_id=chat.example.invalid&narrow=stream%3A9%2Ftopic%3Aroadmap&message_id=214"

    ;(globalThis as any).window = {
      __FOUNDRY_PENDING_DEEP_LINKS__: [messageUrl, ssoUrl],
    }

    try {
      expect(
        consumePendingDeepLinks((url) => parseSsoCallbackUrl(url) !== null),
      ).toEqual([ssoUrl])

      expect((globalThis as any).window.__FOUNDRY_PENDING_DEEP_LINKS__).toEqual([messageUrl])
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as any).window
      } else {
        ;(globalThis as any).window = originalWindow
      }
    }
  })
})
