import { describe, expect, test } from "bun:test"

import {
  PENDING_SSO_STORAGE_KEY,
  buildExternalAuthUrl,
  completePendingSso,
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
    expect(normalizeServerUrl("https://zulip.meridian.cv/")).toBe("https://zulip.meridian.cv")
  })

  test("keeps non-URL input stable enough for validation errors", () => {
    expect(normalizeServerUrl("chat.example.com///")).toBe("chat.example.com")
  })
})

describe("external auth URL building", () => {
  test("appends the OTP to the provider login path", () => {
    const url = buildExternalAuthUrl(
      "https://zulip.meridian.cv",
      { login_url: "/accounts/login/social/oidc/keycloak" },
      "abcd",
    )

    expect(url).toBe(
      "https://zulip.meridian.cv/accounts/login/social/oidc/keycloak?mobile_flow_otp=abcd",
    )
  })
})

describe("SSO callback handling", () => {
  test("decrypts and consumes a pending OTP-protected API key", () => {
    const storage = createStorage()
    const otp = "1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd"
    const apiKey = Array.from({ length: 32 }, () => "a").join("")

    savePendingSso(storage, "https://zulip.meridian.cv/", otp)

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
      realm: "https://zulip.meridian.cv",
      email: "alice@example.com",
      otpEncryptedApiKey: encrypted,
      userId: 42,
    })

    expect(completed).toEqual({
      serverUrl: "https://zulip.meridian.cv",
      email: "alice@example.com",
      apiKey,
    })
    expect(storage.getItem(PENDING_SSO_STORAGE_KEY)).toBeNull()
  })

  test("parses the Zulip deep link payload", () => {
    expect(
      parseSsoCallbackUrl(
        "zulip://login?realm=https%3A%2F%2Fzulip.meridian.cv&email=alice%40example.com&otp_encrypted_api_key=abcd&user_id=7",
      ),
    ).toEqual({
      realm: "https://zulip.meridian.cv",
      email: "alice@example.com",
      otpEncryptedApiKey: "abcd",
      userId: 7,
    })
  })
})
