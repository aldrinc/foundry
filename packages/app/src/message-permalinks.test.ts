import { describe, expect, test } from "bun:test"

import {
  buildMessageDeepLinkUrl,
  messageDeepLinkMatchesTarget,
  parseMessageDeepLinkUrl,
  sameMessageDeepLink,
} from "./message-permalinks"

describe("message deep links", () => {
  test("builds and parses a desktop permalink for a message", () => {
    const url = buildMessageDeepLinkUrl({
      orgId: "chat.example.invalid",
      realmUrl: "https://chat.example.invalid/",
      narrow: "stream:9/topic:roadmap",
      messageId: 214,
    })

    expect(url).toBe(
      "foundry://message?org_id=chat.example.invalid&narrow=stream%3A9%2Ftopic%3Aroadmap&message_id=214&realm=https%3A%2F%2Fchat.example.invalid",
    )

    expect(parseMessageDeepLinkUrl(url)).toEqual({
      orgId: "chat.example.invalid",
      narrow: "stream:9/topic:roadmap",
      messageId: 214,
      realm: "https://chat.example.invalid",
    })
  })

  test("matches org targets by org id before falling back to realm url", () => {
    const payload = parseMessageDeepLinkUrl(
      "foundry://message?org_id=chat.example.invalid&narrow=dm%3A2%2C9&message_id=88&realm=https%3A%2F%2Fchat.example.invalid",
    )!

    expect(messageDeepLinkMatchesTarget(payload, {
      orgId: "chat.example.invalid",
      realmUrl: "https://other.example.invalid",
    })).toBe(true)

    expect(messageDeepLinkMatchesTarget(payload, {
      orgId: "other.example.invalid",
      realmUrl: "https://chat.example.invalid/",
    })).toBe(true)
  })

  test("compares deep links by their full target payload", () => {
    const left = parseMessageDeepLinkUrl(
      "foundry://message?org_id=chat.example.invalid&narrow=stream%3A9%2Ftopic%3Aroadmap&message_id=214",
    )
    const right = parseMessageDeepLinkUrl(
      "foundry://message?org_id=chat.example.invalid&narrow=stream%3A9%2Ftopic%3Aroadmap&message_id=214",
    )
    const different = parseMessageDeepLinkUrl(
      "foundry://message?org_id=chat.example.invalid&narrow=stream%3A9%2Ftopic%3Aroadmap&message_id=215",
    )

    expect(sameMessageDeepLink(left, right)).toBe(true)
    expect(sameMessageDeepLink(left, different)).toBe(false)
  })
})
