import { createSignal } from "solid-js"
import { useSettings } from "../context/settings"
import { usePlatform } from "../context/platform"
import { SettingToggle, SettingRow } from "./settings-general"

export function SettingsNotifications() {
  const { store, setSetting } = useSettings()
  const platform = usePlatform()
  const [testStatus, setTestStatus] = createSignal("")

  const handleTestNotification = async () => {
    setTestStatus("Sending...")
    try {
      await platform.notify("Test Notification", "If you see this, notifications are working!")
      setTestStatus("Sent! Check your OS notifications.")
    } catch (err) {
      setTestStatus(`Error: ${err}`)
    }
    setTimeout(() => setTestStatus(""), 5000)
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
        <div class="flex items-center gap-2">
          <button
            class="text-xs bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] px-3 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--interactive-primary-hover)] transition-colors"
            onClick={handleTestNotification}
          >
            Send test
          </button>
          {testStatus() && (
            <span class="text-[10px] text-[var(--text-tertiary)]">{testStatus()}</span>
          )}
        </div>
      </SettingRow>
    </div>
  )
}
