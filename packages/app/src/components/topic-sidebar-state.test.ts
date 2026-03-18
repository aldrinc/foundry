import { describe, expect, test } from "bun:test"
import { buildTopicSidebarSections, isResolvedTopicName, resolveTopicName, stripResolvedTopicPrefix, unresolveTopicName } from "./topic-sidebar-state"
import type { UnreadItem } from "../context/unread-state"

describe("topic sidebar state", () => {
  test("splits active and completed topics and applies unread counts", () => {
    const unreadItems: UnreadItem[] = [
      {
        kind: "stream",
        stream_id: 5,
        stream_name: "eng",
        stream_color: "#abc",
        topic: "deploys",
        count: 2,
        last_message_id: 120,
        message_ids: [119, 120],
      },
      {
        kind: "stream",
        stream_id: 5,
        stream_name: "eng",
        stream_color: "#abc",
        topic: "✔ shipped",
        count: 1,
        last_message_id: 130,
        message_ids: [130],
      },
    ]

    const sections = buildTopicSidebarSections(5, [
      { name: "deploys", max_id: 118 },
      { name: "✔ shipped", max_id: 121 },
      { name: "design review", max_id: 90 },
    ], unreadItems)

    expect(sections.active).toEqual([
      {
        name: "deploys",
        label: "deploys",
        maxId: 118,
        lastMessageId: 120,
        unreadCount: 2,
        resolved: false,
      },
      {
        name: "design review",
        label: "design review",
        maxId: 90,
        lastMessageId: 90,
        unreadCount: 0,
        resolved: false,
      },
    ])

    expect(sections.completed).toEqual([
      {
        name: "✔ shipped",
        label: "shipped",
        maxId: 121,
        lastMessageId: 130,
        unreadCount: 1,
        resolved: true,
      },
    ])
  })

  test("includes unread-only topics that are not present in the fetched topic list", () => {
    const sections = buildTopicSidebarSections(7, [], [
      {
        kind: "stream",
        stream_id: 7,
        stream_name: "ops",
        stream_color: "#def",
        topic: "incident-42",
        count: 3,
        last_message_id: 222,
        message_ids: [220, 221, 222],
      },
    ])

    expect(sections.active).toEqual([
      {
        name: "incident-42",
        label: "incident-42",
        maxId: 222,
        lastMessageId: 222,
        unreadCount: 3,
        resolved: false,
      },
    ])
    expect(sections.completed).toEqual([])
  })

  test("matches unread topics even when Zulip casing or whitespace differs", () => {
    const sections = buildTopicSidebarSections(9, [
      { name: "swipe-image style testimonials", max_id: 2188 },
    ], [
      {
        kind: "stream",
        stream_id: 9,
        stream_name: "mos-general",
        stream_color: "#0aa",
        topic: "  Swipe-image   style testimonials  ",
        count: 2,
        last_message_id: 2190,
        message_ids: [2189, 2190],
      },
    ])

    expect(sections.active).toEqual([
      {
        name: "swipe-image style testimonials",
        label: "swipe-image style testimonials",
        maxId: 2188,
        lastMessageId: 2190,
        unreadCount: 2,
        resolved: false,
      },
    ])
  })

  test("matches the desktop backend resolved-topic naming", () => {
    expect(isResolvedTopicName("✔ shipped")).toBe(true)
    expect(isResolvedTopicName("✅ shipped")).toBe(false)
    expect(stripResolvedTopicPrefix("✔ ✔✔ shipped")).toBe("shipped")
    expect(resolveTopicName("deploys")).toBe("✔ deploys")
    expect(resolveTopicName("✔ deploys")).toBe("✔ deploys")
    expect(unresolveTopicName("✔ deploys")).toBe("deploys")
    expect(unresolveTopicName("deploys")).toBe("deploys")
  })
})
