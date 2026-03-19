import { describe, expect, test } from "bun:test"
import type { Message } from "./zulip-sync"
import { isMessageInActiveConversation } from "./active-conversation"

function createStreamMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1001,
    sender_id: 22,
    sender_full_name: "Alicia",
    sender_email: "alicia@example.com",
    type: "stream",
    content: "<p>Hello there</p>",
    subject: "deploys",
    timestamp: 1_700_000_000,
    stream_id: 5,
    flags: [],
    reactions: [],
    avatar_url: null,
    display_recipient: "engineering",
    ...overrides,
  }
}

function createDmMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 2001,
    sender_id: 22,
    sender_full_name: "Alicia",
    sender_email: "alicia@example.com",
    type: "private",
    content: "<p>Hello there</p>",
    subject: "",
    timestamp: 1_700_000_000,
    stream_id: null,
    flags: [],
    reactions: [],
    avatar_url: null,
    display_recipient: [
      { id: 22, email: "alicia@example.com", full_name: "Alicia" },
      { id: 99, email: "desdemona@example.com", full_name: "Desdemona" },
    ],
    ...overrides,
  }
}

describe("isMessageInActiveConversation", () => {
  test("matches the exact active topic narrow", () => {
    expect(
      isMessageInActiveConversation("stream:5/topic:deploys", createStreamMessage()),
    ).toBe(true)
  })

  test("does not treat an entire stream narrow as having already viewed a new topic message", () => {
    expect(
      isMessageInActiveConversation("stream:5", createStreamMessage()),
    ).toBe(false)
  })

  test("matches the exact direct-message conversation", () => {
    expect(
      isMessageInActiveConversation("dm:22,99", createDmMessage()),
    ).toBe(true)
  })

  test("does not match unrelated conversations", () => {
    expect(
      isMessageInActiveConversation("stream:5/topic:release", createStreamMessage()),
    ).toBe(false)
    expect(
      isMessageInActiveConversation("dm:22,77", createDmMessage()),
    ).toBe(false)
  })
})
