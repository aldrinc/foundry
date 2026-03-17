import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("MessageActions", () => {
  const source = readFileSync(join(import.meta.dir, "message-actions.tsx"), "utf-8")

  test("toolbar does not use negative top positioning (prevents clipping by scroll container)", () => {
    // The message-actions toolbar is absolutely positioned inside a message row
    // that lives within a scroll container (overflow-y: auto). Using a negative
    // top value (e.g. -top-3) causes the toolbar to extend above the message
    // row, where the scroll container clips it when the message is near the
    // top of the visible area.
    //
    // Regression: https://github.com/anthropics/foundry/issues/toolbar-clipping
    const toolbarLineMatch = source.match(/data-component="message-actions"/)
    expect(toolbarLineMatch).not.toBeNull()

    // Find the class string on the toolbar's containing div
    // The toolbar div is the one with data-component="message-actions"
    const classMatch = source.match(/class="([^"]+)"[\s\S]*?data-component="message-actions"/)
    expect(classMatch).not.toBeNull()

    const classString = classMatch![1]

    // Assert no negative top Tailwind class (e.g. -top-1, -top-2, -top-3, etc.)
    expect(classString).not.toMatch(/-top-\d/)
  })
})
