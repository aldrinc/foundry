import { describe, expect, test } from "bun:test"

import { handleNarrowChange } from "./compose-narrow-change"

describe("compose-box narrow change", () => {
  test("loads draft content, clears state, and calls focusCompose", () => {
    let content = ""
    let error = ""
    let uploadError = ""
    let images: { name: string; markdown: string; previewUrl: string | null }[] = [
      { name: "old.png", markdown: "![old](url)", previewUrl: null },
    ]
    let focusCalled = false

    handleNarrowChange(
      "dm:1,2",
      { "dm:1,2": "hey there" },
      (s) => content = s,
      (s) => error = s,
      (s) => uploadError = s,
      (imgs) => images = imgs,
      () => { focusCalled = true },
    )

    expect(content).toBe("hey there")
    expect(error).toBe("")
    expect(uploadError).toBe("")
    expect(images).toEqual([])
    expect(focusCalled).toBe(true)
  })

  test("defaults to empty content when no draft exists", () => {
    let content = "stale"
    let focusCalled = false

    handleNarrowChange(
      "dm:5",
      {},
      (s) => content = s,
      () => {},
      () => {},
      () => {},
      () => { focusCalled = true },
    )

    expect(content).toBe("")
    expect(focusCalled).toBe(true)
  })

  test("always calls focusCompose regardless of draft state", () => {
    const focusCalls: string[] = []

    // With draft
    handleNarrowChange(
      "dm:1",
      { "dm:1": "draft text" },
      () => {},
      () => {},
      () => {},
      () => {},
      () => { focusCalls.push("with-draft") },
    )

    // Without draft
    handleNarrowChange(
      "dm:2",
      {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => { focusCalls.push("no-draft") },
    )

    expect(focusCalls).toEqual(["with-draft", "no-draft"])
  })
})
