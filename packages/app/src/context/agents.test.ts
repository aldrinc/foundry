import { describe, expect, test } from "bun:test"

import type { FoundryProviderAuth } from "@foundry/desktop/bindings"
import { buildFoundryProviderOauthRedirectUri } from "./provider-oauth"
import {
  buildSupervisorDelegateContextFromDelegates,
  getProviderConnectionStatus,
  isProviderOauthConfigured,
  providerSupportsOauth,
  unwrapSupervisorMessageWithDelegates,
  wrapSupervisorMessageWithDelegates,
} from "./agent-runtime"

interface DelegateAgent {
  id: string
  name: string
  emoji: string
  purpose: string
  theme: string
  soul: string
  enabled: boolean
  delegateEligible: boolean
  scopeMode: "all_topics" | "selected_streams"
  streamIds: number[]
  inheritRuntimePreset: boolean
  inheritProviders: boolean
  inheritMcp: boolean
  inheritChannels: boolean
  inheritSkills: boolean
  providerOverride: string | null
  preferredModel: string
  createdAt: string
  updatedAt: string
}

function createDelegate(overrides: Partial<DelegateAgent> = {}): DelegateAgent {
  return {
    id: "researcher",
    name: "Researcher",
    emoji: "R",
    purpose: "Collect implementation context before work starts.",
    theme: "thorough",
    soul: "You are a research delegate.",
    enabled: true,
    delegateEligible: true,
    scopeMode: "all_topics",
    streamIds: [],
    inheritRuntimePreset: true,
    inheritProviders: true,
    inheritMcp: true,
    inheritChannels: true,
    inheritSkills: true,
    providerOverride: null,
    preferredModel: "",
    createdAt: "2026-03-07T00:00:00.000Z",
    updatedAt: "2026-03-07T00:00:00.000Z",
    ...overrides,
  }
}

describe("agents helpers", () => {
  test("builds the provider OAuth callback against the current org realm", () => {
    expect(
      buildFoundryProviderOauthRedirectUri("https://foundry-labs.zulip-dev-live.5.161.60.86.sslip.io/"),
    ).toBe(
      "https://foundry-labs.zulip-dev-live.5.161.60.86.sslip.io/json/foundry/providers/oauth/callback",
    )
  })

  test("returns null when the org realm URL is not usable", () => {
    expect(buildFoundryProviderOauthRedirectUri("")).toBeNull()
    expect(buildFoundryProviderOauthRedirectUri("not a url")).toBeNull()
  })

  test("maps active provider credentials to a connected status", () => {
    const provider = {
      provider: "codex",
      display_name: "Codex",
      auth_modes: ["oauth"],
      credential_status: "not_connected",
      credential: {
        auth_mode: "oauth",
        status: "active",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
    } as FoundryProviderAuth

    expect(getProviderConnectionStatus(provider)).toBe("connected")
  })

  test("does not treat OAuth capability as a connected account", () => {
    const provider = {
      provider: "codex",
      display_name: "Codex",
      auth_modes: ["oauth"],
      oauth_configured: true,
    } as FoundryProviderAuth

    expect(getProviderConnectionStatus(provider)).toBe("not_connected")
  })

  test("requires explicit oauth_configured before treating OAuth as usable", () => {
    const advertisedOnly = {
      provider: "codex",
      display_name: "Codex",
      auth_modes: ["api_key", "oauth"],
    } as FoundryProviderAuth

    const configured = {
      ...advertisedOnly,
      oauth_configured: true,
    } as FoundryProviderAuth

    expect(providerSupportsOauth(advertisedOnly)).toBe(true)
    expect(isProviderOauthConfigured(advertisedOnly)).toBe(false)
    expect(isProviderOauthConfigured(configured)).toBe(true)
  })

  test("builds a supervisor delegate manifest only from enabled delegateable agents", () => {
    const manifest = buildSupervisorDelegateContextFromDelegates([
      createDelegate(),
      createDelegate({
        id: "reviewer",
        name: "Reviewer",
        delegateEligible: false,
      }),
    ])

    expect(manifest).toContain("<foundry_delegate_manifest>")
    expect(manifest).toContain("\"id\": \"researcher\"")
    expect(manifest).not.toContain("\"id\": \"reviewer\"")
  })

  test("wraps outbound supervisor messages with delegate context", () => {
    const wrapped = wrapSupervisorMessageWithDelegates(
      "Please review the rollout plan.",
      "<foundry_delegate_manifest>\n{}\n</foundry_delegate_manifest>",
    )

    expect(wrapped).toContain("<user_message>")
    expect(wrapped).toContain("Please review the rollout plan.")
  })

  test("leaves outbound supervisor messages unchanged without delegate context", () => {
    expect(
      wrapSupervisorMessageWithDelegates("Ship it.", null),
    ).toBe("Ship it.")
  })

  test("unwraps inbound supervisor user events back to the original message", () => {
    const wrapped = wrapSupervisorMessageWithDelegates(
      "Please review the rollout plan.",
      "<foundry_delegate_manifest>\n{}\n</foundry_delegate_manifest>",
    )

    expect(unwrapSupervisorMessageWithDelegates(wrapped)).toBe(
      "Please review the rollout plan.",
    )
  })
})
