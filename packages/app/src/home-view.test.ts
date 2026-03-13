import { describe, expect, test } from "bun:test"
import { homeViewToNarrow } from "./home-view"

describe("homeViewToNarrow", () => {
  test("maps known home views to navigation narrows", () => {
    expect(homeViewToNarrow("inbox")).toBeNull()
    expect(homeViewToNarrow("recent")).toBe("recent-topics")
    expect(homeViewToNarrow("all")).toBe("all-messages")
  })

  test("returns undefined for unknown values", () => {
    expect(homeViewToNarrow("custom")).toBeUndefined()
  })
})
