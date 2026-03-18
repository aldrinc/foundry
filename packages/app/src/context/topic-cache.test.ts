import { describe, expect, test } from "bun:test"

import { mergeTopicsByName, upsertTopicByName } from "./topic-cache"

describe("topic cache helpers", () => {
  test("merges topic snapshots by name and keeps the newest max id", () => {
    expect(mergeTopicsByName([
      { name: "alpha", max_id: 2 },
      { name: "deploy", max_id: 5 },
    ], [
      { name: "deploy", max_id: 9 },
      { name: "beta", max_id: 7 },
    ])).toEqual([
      { name: "deploy", max_id: 9 },
      { name: "beta", max_id: 7 },
      { name: "alpha", max_id: 2 },
    ])
  })

  test("upserts topics and keeps the list ordered by recency", () => {
    expect(upsertTopicByName([
      { name: "alpha", max_id: 2 },
      { name: "deploy", max_id: 5 },
    ], {
      name: "incident",
      max_id: 8,
    })).toEqual([
      { name: "incident", max_id: 8 },
      { name: "deploy", max_id: 5 },
      { name: "alpha", max_id: 2 },
    ])
  })

  test("merges logically identical topic names that differ only by case or whitespace", () => {
    expect(mergeTopicsByName([
      { name: "swipe-image style testimonials", max_id: 2188 },
    ], [
      { name: "  Swipe-image   style testimonials  ", max_id: 2190 },
    ])).toEqual([
      { name: "  Swipe-image   style testimonials  ", max_id: 2190 },
    ])
  })
})
