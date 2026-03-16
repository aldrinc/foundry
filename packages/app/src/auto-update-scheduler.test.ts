import { describe, expect, test } from "bun:test"
import {
  AUTO_UPDATE_INITIAL_DELAY_MS,
  AUTO_UPDATE_INTERVAL_MS,
  createAutoUpdateCheckController,
  startAutoUpdateScheduler,
} from "./auto-update-scheduler"

describe("auto update scheduler", () => {
  test("throttles focus-driven rechecks but still allows interval checks", async () => {
    let now = 1_000
    const triggers: string[] = []
    const controller = createAutoUpdateCheckController({
      now: () => now,
      refocusThrottleMs: 5_000,
      runCheck: async () => {
        triggers.push("check")
      },
    })

    expect(await controller.run("initial")).toBe(true)
    now += 1_000
    expect(await controller.run("focus")).toBe(false)
    now += 1_000
    expect(await controller.run("interval")).toBe(true)
    expect(triggers).toEqual(["check", "check"])
  })

  test("avoids overlapping update checks", async () => {
    let resolveCheck: (() => void) | undefined
    let runs = 0
    const controller = createAutoUpdateCheckController({
      runCheck: () => new Promise<void>((resolve) => {
        runs += 1
        if (runs === 1) {
          resolveCheck = resolve
          return
        }
        resolve()
      }),
    })

    const firstRun = controller.run("initial")
    expect(await controller.run("interval")).toBe(false)

    resolveCheck?.()
    expect(await firstRun).toBe(true)
    expect(await controller.run("interval")).toBe(true)
  })

  test("wires initial, interval, focus, and visible-state checks", async () => {
    const triggers: string[] = []
    let now = 10_000
    let visible = false
    let focusListener: (() => void) | undefined
    let visibilityListener: (() => void) | undefined
    let initialCallback: (() => void) | undefined
    let intervalCallback: (() => void) | undefined
    let clearedInitial = false
    let clearedInterval = false

    const stop = startAutoUpdateScheduler({
      now: () => now,
      refocusThrottleMs: 5_000,
      runCheck: async () => {
        triggers.push(`check:${now}`)
      },
      subscribeToFocus: (listener) => {
        focusListener = listener
        return () => { focusListener = undefined }
      },
      subscribeToVisibility: (listener) => {
        visibilityListener = listener
        return () => { visibilityListener = undefined }
      },
      isVisible: () => visible,
      setTimeoutFn: ((callback: () => void, delay?: number) => {
        expect(delay).toBe(AUTO_UPDATE_INITIAL_DELAY_MS)
        initialCallback = callback
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutFn: ((timer: ReturnType<typeof setTimeout>) => {
        expect(timer).toBe(1 as unknown as ReturnType<typeof setTimeout>)
        clearedInitial = true
      }) as typeof clearTimeout,
      setIntervalFn: ((callback: () => void, delay?: number) => {
        expect(delay).toBe(AUTO_UPDATE_INTERVAL_MS)
        intervalCallback = callback
        return 2 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval,
      clearIntervalFn: ((timer: ReturnType<typeof setInterval>) => {
        expect(timer).toBe(2 as unknown as ReturnType<typeof setInterval>)
        clearedInterval = true
      }) as typeof clearInterval,
    })

    initialCallback?.()
    await Promise.resolve()
    expect(triggers).toEqual(["check:10000"])

    now += 1_000
    focusListener?.()
    await Promise.resolve()
    expect(triggers).toEqual(["check:10000"])

    now += 5_000
    focusListener?.()
    await Promise.resolve()
    expect(triggers).toEqual(["check:10000", "check:16000"])

    now += 1_000
    visibilityListener?.()
    await Promise.resolve()
    expect(triggers).toEqual(["check:10000", "check:16000"])

    visible = true
    now += 5_000
    visibilityListener?.()
    await Promise.resolve()
    expect(triggers).toEqual(["check:10000", "check:16000", "check:22000"])

    now += 1_000
    intervalCallback?.()
    await Promise.resolve()
    expect(triggers).toEqual(["check:10000", "check:16000", "check:22000", "check:23000"])

    stop()
    expect(clearedInitial).toBe(true)
    expect(clearedInterval).toBe(true)
    expect(focusListener).toBeUndefined()
    expect(visibilityListener).toBeUndefined()
  })
})
