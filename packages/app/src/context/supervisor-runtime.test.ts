import { describe, expect, test } from "bun:test"
import { extractRuntimeProjection } from "./supervisor-runtime"

describe("extractRuntimeProjection", () => {
  test("hydrates runtime fields from task summary runtime state", () => {
    const projection = extractRuntimeProjection({
      phase: "idle",
      runtime_state: {
        phase: "idle",
        phase_reason: "no active runtime evidence",
        worker_backend_ready: true,
        execution_blockers: [],
        repo_attachment: { status: "missing" },
        observed_artifacts: [],
        runtime_state: {
          jobs: [],
          tasks: [],
        },
      },
    })

    expect(projection?.phase).toBe("idle")
    expect(projection?.phase_reason).toBe("no active runtime evidence")
    expect(projection?.worker_backend_ready).toBe(true)
    expect(projection?.execution_blockers).toEqual([])
    expect(projection?.repo_attachment).toEqual({ status: "missing" })
    expect(projection?.runtime_state).toEqual({
      jobs: [],
      tasks: [],
    })
  })

  test("falls back to the carrier phase when runtime state is absent", () => {
    expect(
      extractRuntimeProjection({
        phase: "awaiting_approval",
        runtime_state: null,
      }),
    ).toEqual({
      phase: "awaiting_approval",
    })
  })

  test("returns null when neither runtime state nor phase are present", () => {
    expect(extractRuntimeProjection({})).toBeNull()
    expect(extractRuntimeProjection(null)).toBeNull()
  })
})
