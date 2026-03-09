import { describe, expect, test } from "bun:test"
import {
  hydrateRecentDirectMessages,
  narrowForRecentDirectMessage,
  normalizeRecentDirectMessage,
  upsertRecentDirectMessageFromMessage,
} from "./recent-dms"

describe("recent direct message helpers", () => {
  test("adds the current user to server conversation payloads", () => {
    expect(
      normalizeRecentDirectMessage(
        { user_ids: [9, 2], max_message_id: 44 },
        5,
      ),
    ).toEqual({ user_ids: [2, 5, 9], max_message_id: 44 })
  })

  test("normalizes self-direct-messages from an empty recipient list", () => {
    const conversations = hydrateRecentDirectMessages(
      [{ user_ids: [], max_message_id: 101 }],
      7,
    )

    expect(conversations).toEqual([{ user_ids: [7], max_message_id: 101 }])
    expect(narrowForRecentDirectMessage(conversations[0]!)).toBe("dm:7")
  })

  test("deduplicates conversations and keeps the newest message id", () => {
    expect(
      hydrateRecentDirectMessages(
        [
          { user_ids: [9], max_message_id: 20 },
          { user_ids: [9], max_message_id: 40 },
          { user_ids: [4, 8], max_message_id: 30 },
        ],
        2,
      ),
    ).toEqual([
      { user_ids: [2, 9], max_message_id: 40 },
      { user_ids: [2, 4, 8], max_message_id: 30 },
    ])
  })

  test("upserts recent direct messages from live message events", () => {
    expect(
      upsertRecentDirectMessageFromMessage(
        [{ user_ids: [2, 9], max_message_id: 12 }],
        {
          id: 99,
          stream_id: null,
          display_recipient: [{ id: 9 }, { id: 2 }],
        },
        2,
      ),
    ).toEqual([{ user_ids: [2, 9], max_message_id: 99 }])
  })
})
