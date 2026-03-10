import { createSignal } from "solid-js"
import { useSettings } from "../context/settings"
import { usePlatform } from "../context/platform"
import { SettingToggle, SettingRow } from "./settings-general"

type TestNotificationState = "idle" | "sending" | "success" | "error"

const [testNotificationState, setTestNotificationState] = createSignal<TestNotificationState>("idle")
let testNotificationResetTimer: ReturnType<typeof setTimeout> | undefined

const clearTestNotificationResetTimer = () => {
  if (testNotificationResetTimer) {
    clearTimeout(testNotificationResetTimer)
    testNotificationResetTimer = undefined
  }
}

const scheduleTestNotificationReset = () => {
  clearTestNotificationResetTimer()
  testNotificationResetTimer = setTimeout(() => {
    setTestNotificationState("idle")
    testNotificationResetTimer = undefined
  }, 2500)
}

export function SettingsNotifications() {
  const { store, setSetting } = useSettings()
  const platform = usePlatform()

  const handleTestNotification = async () => {
    clearTestNotificationResetTimer()
    setTestNotificationState("sending")
    try {
      await platform.notify("Test Notification", "If you see this, notifications are working!", {
        silent: store.muteAllSounds || !store.notifSound,
        showWhenFocused: true,
      })
      setTestNotificationState("success")
    } catch {
      setTestNotificationState("error")
    }
    scheduleTestNotificationReset()
  }

  const testButtonLabel = () => {
    switch (testNotificationState()) {
      case "sending":
        return "Sending..."
      case "success":
        return "Sent"
      case "error":
        return "Failed"
      default:
        return "Send test"
    }
  }

  const testButtonClass = () => {
    switch (testNotificationState()) {
      case "success":
        return "bg-[var(--status-success)] text-white"
      case "error":
        return "bg-[var(--status-error)] text-white"
      default:
        return "bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] hover:bg-[var(--interactive-primary-hover)]"
    }
  }

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>

      <SettingToggle
        label="Desktop notifications"
        description="Show OS-level notifications for new messages"
        checked={store.desktopNotifs}
        onChange={(v) => setSetting("desktopNotifs", v)}
      />

      <SettingToggle
        label="Notification sound"
        description="Play a sound when new messages arrive"
        checked={store.notifSound}
        onChange={(v) => setSetting("notifSound", v)}
      />

      <SettingToggle
        label="Mute all sounds"
        description="Silence all notification sounds globally"
        checked={store.muteAllSounds}
        onChange={(v) => setSetting("muteAllSounds", v)}
      />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Notify me about</div>

      <SettingToggle
        label="Direct messages"
        description="Notifications for direct / private messages"
        checked={store.dmNotifs}
        onChange={(v) => setSetting("dmNotifs", v)}
      />

      <SettingToggle
        label="Mentions"
        description="Notifications when someone @mentions you"
        checked={store.mentionNotifs}
        onChange={(v) => setSetting("mentionNotifs", v)}
      />

      <SettingToggle
        label="Channel messages"
        description="Notifications for messages in subscribed channels"
        checked={store.channelNotifs}
        onChange={(v) => setSetting("channelNotifs", v)}
      />

      <SettingToggle
        label="Followed topics"
        description="Notifications for topics you follow"
        checked={store.followedTopics}
        onChange={(v) => setSetting("followedTopics", v)}
      />

      <hr class="border-[var(--border-default)]" />

      <SettingRow label="Wildcard mentions (@all)" description="Behavior when someone uses @all or @everyone">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={store.wildcardMentions}
          onChange={(e) => setSetting("wildcardMentions", e.currentTarget.value)}
        >
          <option value="default">Follow channel default</option>
          <option value="notify">Always notify</option>
          <option value="silent">Don't notify</option>
        </select>
      </SettingRow>

      <hr class="border-[var(--border-default)]" />

      <SettingRow label="Test notifications" description="Send a test notification to verify your setup">
        <button
          class={`inline-flex min-w-[7.5rem] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs transition-colors ${testButtonClass()}`}
          disabled={testNotificationState() === "sending"}
          onClick={handleTestNotification}
        >
          <span>{testButtonLabel()}</span>
          {testNotificationState() === "success" && (
            <svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          )}
          {testNotificationState() === "error" && (
            <svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M4.5 4.5 11.5 11.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
              <path d="M11.5 4.5 4.5 11.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            </svg>
          )}
        </button>
      </SettingRow>
    </div>
  )
}
