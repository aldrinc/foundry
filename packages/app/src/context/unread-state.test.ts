import { describe, expect, test } from "bun:test"
import {
  addUnreadStreamMessage,
  addUnreadDirectMessage,
  buildUnreadIndex,
  buildUnreadUiState,
  removeUnreadMessages,
  updateUnreadStreamMessage,
} from "./unread-state"

describe("buildUnreadUiState", () => {
  test("groups unread messages by stream topic and counts them", () => {
    const index = buildUnreadIndex({
      streams: [
        {
          stream_id: 5,
          topic: "deploys",
          unread_message_ids: [1001, 1002],
        },
        {
          stream_id: 7,
          topic: "design",
          unread_message_ids: [1003],
        },
      ],
    })

    const state = buildUnreadUiState(index, [
      { stream_id: 5, name: "eng", color: "#abc" },
      { stream_id: 7, name: "design", color: "#def" },
    ], [], 99)

    expect(state.unreadCounts).toEqual({ 5: 2, 7: 1 })
    expect(state.unreadItems).toEqual([
      {
        kind: "stream",
        stream_id: 7,
        stream_name: "design",
        stream_color: "#def",
        topic: "design",
        count: 1,
        last_message_id: 1003,
        message_ids: [1003],
      },
      {
        kind: "stream",
        stream_id: 5,
        stream_name: "eng",
        stream_color: "#abc",
        topic: "deploys",
        count: 2,
        last_message_id: 1002,
        message_ids: [1001, 1002],
      },
    ])
  })

  test("updates counts when unread messages are added moved and removed", () => {
    const index = buildUnreadIndex({
      streams: [
        {
          stream_id: 5,
          topic: "deploys",
          unread_message_ids: [1001],
        },
      ],
    }, 99)

    expect(addUnreadStreamMessage(index, 1002, 5, "deploys")).toBe(true)
    expect(updateUnreadStreamMessage(index, 1002, { topic: "rollouts" })).toBe(true)
    expect(removeUnreadMessages(index, [1001])).toBe(true)

    const state = buildUnreadUiState(index, [
      { stream_id: 5, name: "eng", color: "#abc" },
    ], [], 99)

    expect(state.unreadCounts).toEqual({ 5: 1 })
    expect(state.unreadItems).toEqual([
      {
        kind: "stream",
        stream_id: 5,
        stream_name: "eng",
        stream_color: "#abc",
        topic: "rollouts",
        count: 1,
        last_message_id: 1002,
        message_ids: [1002],
      },
    ])
  })

  test("builds direct-message unread items from pm and huddle snapshots", () => {
    const index = buildUnreadIndex({
      pms: [
        {
          other_user_id: 7,
          unread_message_ids: [2001, 2002],
        },
      ],
      huddles: [
        {
          user_ids_string: "4,6,30,101",
          unread_message_ids: [2003],
        },
      ],
    }, 30)

    const state = buildUnreadUiState(index, [], [
      { user_id: 7, full_name: "Desdemona" },
      { user_id: 4, full_name: "Alice Example" },
      { user_id: 6, full_name: "Bob Example" },
      { user_id: 30, full_name: "Me" },
      { user_id: 101, full_name: "Franky" },
    ], 30)

    expect(state.unreadCounts).toEqual({})
    expect(state.unreadItems).toEqual([
      {
        kind: "dm",
        narrow: "dm:4,6,30,101",
        user_ids: [4, 6, 30, 101],
        participant_names: ["Alice Example", "Bob Example", "Franky"],
        label: "Alice Example, Bob Example, Franky",
        count: 1,
        last_message_id: 2003,
        message_ids: [2003],
      },
      {
        kind: "dm",
        narrow: "dm:7,30",
        user_ids: [7, 30],
        participant_names: ["Desdemona"],
        label: "Desdemona",
        count: 2,
        last_message_id: 2002,
        message_ids: [2001, 2002],
      },
    ])
  })

  test("adds and removes direct-message unread entries", () => {
    const index = buildUnreadIndex(undefined, 30)

    expect(addUnreadDirectMessage(index, 3001, [30, 7])).toBe(true)
    expect(addUnreadDirectMessage(index, 3001, [7, 30])).toBe(false)
    expect(removeUnreadMessages(index, [3001])).toBe(true)
    expect(removeUnreadMessages(index, [3001])).toBe(false)
  })
})
