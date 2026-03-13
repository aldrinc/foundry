import { describe, expect, test } from "bun:test"
import {
  sessionEngineLabel,
  sessionSubtitle,
} from "./supervisor-session-meta"

describe("sessionEngineLabel", () => {
  test("includes the model for moltis sessions", () => {
    expect(
      sessionEngineLabel({
        metadata: {
          engine: "moltis",
          moltis_model: "openai::gpt-5.2",
        },
      }),
    ).toBe("moltis · openai::gpt-5.2")
  })
})

describe("sessionSubtitle", () => {
  test("prefers the actual engine metadata over a manual fallback", () => {
    expect(
      sessionSubtitle({
        metadata: {
          engine: "moltis",
          moltis_model: "openai::gpt-5.2",
        },
      }),
    ).toBe("moltis · openai::gpt-5.2")
  })

  test("appends creator details when present", () => {
    expect(
      sessionSubtitle({
        metadata: {
          engine: "moltis",
          created_by_name: "Maya Chen",
        },
      }),
    ).toBe("moltis · Maya Chen")
  })
})
