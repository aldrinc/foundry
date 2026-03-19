import { describe, expect, test } from "bun:test"
import { countNewlyAppendedMessages } from "./message-list-utils"

describe("countNewlyAppendedMessages", () => {
  test("counts only messages newer than the previous newest id", () => {
    expect(
      countNewlyAppendedMessages(
        [{ id: 10 }, { id: 20 }],
        [{ id: 10 }, { id: 20 }, { id: 21 }, { id: 22 }],
      ),
    ).toBe(2)
  })

  test("does not count prepended older history as new messages", () => {
    expect(
      countNewlyAppendedMessages(
        [{ id: 20 }, { id: 30 }],
        [{ id: 5 }, { id: 10 }, { id: 20 }, { id: 30 }],
      ),
    ).toBe(0)
  })

  test("does not count the initial load as new messages", () => {
    expect(
      countNewlyAppendedMessages(
        undefined,
        [{ id: 10 }, { id: 20 }],
      ),
    ).toBe(0)
  })
})
