export const AUTO_UPDATE_INITIAL_DELAY_MS = 3_000
export const AUTO_UPDATE_INTERVAL_MS = 30 * 60 * 1_000
export const AUTO_UPDATE_REFOCUS_THROTTLE_MS = 5 * 60 * 1_000

export type AutoUpdateTrigger = "initial" | "interval" | "focus" | "visibility"

type RunCheck = () => Promise<void>

export interface AutoUpdateCheckControllerOptions {
  now?: () => number
  refocusThrottleMs?: number
  runCheck: RunCheck
}

export interface AutoUpdateSchedulerOptions extends AutoUpdateCheckControllerOptions {
  initialDelayMs?: number
  intervalMs?: number
  subscribeToFocus?: (listener: () => void) => () => void
  subscribeToVisibility?: (listener: () => void) => () => void
  isVisible?: () => boolean
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export function createAutoUpdateCheckController(options: AutoUpdateCheckControllerOptions) {
  const now = options.now ?? Date.now
  const refocusThrottleMs = options.refocusThrottleMs ?? AUTO_UPDATE_REFOCUS_THROTTLE_MS
  let lastCheckStartedAt = 0
  let checkInFlight = false

  const shouldThrottle = (trigger: AutoUpdateTrigger, currentTime: number) => {
    if ((trigger === "focus" || trigger === "visibility") && lastCheckStartedAt > 0) {
      return currentTime - lastCheckStartedAt < refocusThrottleMs
    }
    return false
  }

  return {
    async run(trigger: AutoUpdateTrigger): Promise<boolean> {
      if (checkInFlight) {
        return false
      }

      const currentTime = now()
      if (shouldThrottle(trigger, currentTime)) {
        return false
      }

      checkInFlight = true
      lastCheckStartedAt = currentTime

      try {
        await options.runCheck()
        return true
      } finally {
        checkInFlight = false
      }
    },
  }
}

export function startAutoUpdateScheduler(options: AutoUpdateSchedulerOptions) {
  const controller = createAutoUpdateCheckController(options)
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval
  const initialDelayMs = options.initialDelayMs ?? AUTO_UPDATE_INITIAL_DELAY_MS
  const intervalMs = options.intervalMs ?? AUTO_UPDATE_INTERVAL_MS
  const isVisible = options.isVisible ?? (() => true)

  const initialTimer = setTimeoutFn(() => {
    void controller.run("initial")
  }, initialDelayMs)

  const recurringTimer = setIntervalFn(() => {
    void controller.run("interval")
  }, intervalMs)

  const unsubscribeFocus = options.subscribeToFocus?.(() => {
    void controller.run("focus")
  })

  const unsubscribeVisibility = options.subscribeToVisibility?.(() => {
    if (!isVisible()) {
      return
    }
    void controller.run("visibility")
  })

  return () => {
    clearTimeoutFn(initialTimer)
    clearIntervalFn(recurringTimer)
    unsubscribeFocus?.()
    unsubscribeVisibility?.()
  }
}
