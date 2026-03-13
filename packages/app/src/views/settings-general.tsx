import { useSettings } from "../context/settings"

export function SettingsGeneral() {
  const { store, setSetting } = useSettings()

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">General</h3>

      {/* Theme */}
      <SettingRow label="Theme" description="Choose the app color scheme">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={store.theme}
          onChange={(e) => setSetting("theme", e.currentTarget.value)}
        >
          <option value="foundry">Foundry</option>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </SettingRow>

      {/* Language — not yet implemented (no i18n system) */}
      <SettingRow label="Language" description="Interface language — coming soon">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px] opacity-50 cursor-not-allowed"
          value="en"
          disabled
        >
          <option value="en">English</option>
        </select>
      </SettingRow>

      <hr class="border-[var(--border-default)]" />

      {/* 24-hour time */}
      <SettingToggle
        label="24-hour time"
        description="Use 24-hour time format instead of 12-hour"
        checked={store.timeFormat24h}
        onChange={(v) => setSetting("timeFormat24h", v)}
      />

      {/* Enter sends message */}
      <SettingToggle
        label="Enter sends message"
        description="Press Enter to send, Shift+Enter for new line"
        checked={store.enterSends}
        onChange={(v) => setSetting("enterSends", v)}
      />

      <hr class="border-[var(--border-default)]" />

      {/* Font size */}
      <SettingRow label="Font size" description="Message text size">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={store.fontSize}
          onChange={(e) => setSetting("fontSize", e.currentTarget.value)}
        >
          <option value="small">Small</option>
          <option value="normal">Normal</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </SettingRow>

      {/* Home view */}
      <SettingRow label="Home view" description="Default view when the app opens">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={store.homeView}
          onChange={(e) => setSetting("homeView", e.currentTarget.value)}
        >
          <option value="inbox">Inbox</option>
          <option value="recent">Recent conversations</option>
          <option value="all">All messages</option>
        </select>
      </SettingRow>

      {/* Animate images — not yet implemented */}
      <SettingRow label="Animate image previews" description="Control animated GIF behavior — coming soon">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px] opacity-50 cursor-not-allowed"
          value="always"
          disabled
        >
          <option value="always">Always</option>
        </select>
      </SettingRow>
    </div>
  )
}

/* Shared setting components */

export function SettingRow(props: { label: string; description: string; children: any }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="text-xs font-medium text-[var(--text-primary)]">{props.label}</div>
        <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5">{props.description}</div>
      </div>
      <div class="shrink-0">{props.children}</div>
    </div>
  )
}

export function SettingToggle(props: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div class={`flex items-center justify-between gap-4 ${props.disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div class="min-w-0">
        <div class="text-xs font-medium text-[var(--text-primary)]">{props.label}</div>
        <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5">{props.description}</div>
      </div>
      <button
        class={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${
          props.checked ? "bg-[var(--interactive-primary)]" : "bg-[var(--border-default)]"
        }`}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span
          class={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
            props.checked ? "left-[16px]" : "left-[2px]"
          }`}
        />
      </button>
    </div>
  )
}
