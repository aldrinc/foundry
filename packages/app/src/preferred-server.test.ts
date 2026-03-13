import { describe, expect, test } from "bun:test"

import {
  PREFERRED_SERVER_STORAGE_KEY,
  clearPreferredServerId,
  getAutoLoginServer,
  getSavedServerLoginSeed,
  getPreferredServerId,
  setPreferredServerId,
} from "./preferred-server"

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

describe("preferred server persistence", () => {
  test("stores and clears the preferred server id", () => {
    const storage = createStorage()

    expect(getPreferredServerId(storage)).toBeNull()

    setPreferredServerId(storage, "zulip.meridian.cv")

    expect(storage.getItem(PREFERRED_SERVER_STORAGE_KEY)).toBe("zulip.meridian.cv")
    expect(getPreferredServerId(storage)).toBe("zulip.meridian.cv")

    clearPreferredServerId(storage)

    expect(getPreferredServerId(storage)).toBeNull()
  })

  test("auto-login prefers the stored server when available", () => {
    const servers = [
      {
        id: "zulip-dev.5.161.60.86.sslip.io",
        url: "https://zulip-dev.5.161.60.86.sslip.io",
        email: "ac@meridian.cv",
        api_key: "dev-key",
        realm_name: "Meridian",
        realm_icon: "",
      },
      {
        id: "zulip.meridian.cv",
        url: "https://zulip.meridian.cv",
        email: "ac@meridian.cv",
        api_key: "prod-key",
        realm_name: "Meridian",
        realm_icon: "",
      },
    ]

    expect(getAutoLoginServer(servers, "zulip.meridian.cv")).toEqual(servers[1])
    expect(getAutoLoginServer(servers, "missing")).toEqual(servers[0])
    expect(getAutoLoginServer([], "zulip.meridian.cv")).toBeNull()
  })

  test("builds a login seed from the preferred saved server", () => {
    const servers = [
      {
        id: "zulip.meridian.cv",
        url: "https://zulip.meridian.cv",
        email: "ac@meridian.cv",
        api_key: "prod-key",
        realm_name: "Meridian",
        realm_icon: "",
      },
      {
        id: "foundry-labs.zulip-dev-live.5.161.60.86.sslip.io",
        url: "https://foundry-labs.zulip-dev-live.5.161.60.86.sslip.io",
        email: "maya@foundry.dev",
        api_key: "dev-key",
        realm_name: "Foundry Labs",
        realm_icon: "",
      },
    ]

    expect(
      getSavedServerLoginSeed(servers, "foundry-labs.zulip-dev-live.5.161.60.86.sslip.io"),
    ).toEqual({
      email: "maya@foundry.dev",
      serverUrl: "https://foundry-labs.zulip-dev-live.5.161.60.86.sslip.io",
    })

    expect(getSavedServerLoginSeed([], "foundry-labs.zulip-dev-live.5.161.60.86.sslip.io")).toBeNull()
  })
})
