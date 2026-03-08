import { useSettings } from "../context/settings"
import { SettingToggle, SettingRow } from "./settings-general"

export function SettingsApp() {
  const { store, setSetting } = useSettings()

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Desktop App</h3>

      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Startup</div>

      <SettingToggle
        label="Start at login"
        description="Launch the app automatically when you log in"
        checked={store.startAtLogin}
        onChange={(v) => setSetting("startAtLogin", v)}
      />

      <SettingToggle
        label="Start minimized"
        description="Start the app minimized to the system tray"
        checked={store.startMinimized}
        onChange={(v) => setSetting("startMinimized", v)}
      />

      <SettingToggle
        label="Show in system tray"
        description="Display the app icon in the system tray"
        checked={store.showTray}
        onChange={(v) => setSetting("showTray", v)}
      />

      <SettingToggle
        label="Quit on window close"
        description="Fully quit the app when the window is closed instead of minimizing"
        checked={store.quitOnClose}
        onChange={(v) => setSetting("quitOnClose", v)}
      />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Updates</div>

      <SettingToggle
        label="Auto-update"
        description="Automatically download and install updates"
        checked={store.autoUpdate}
        onChange={(v) => setSetting("autoUpdate", v)}
      />

      <SettingToggle
        label="Beta updates"
        description="Opt in to receive beta releases"
        checked={store.betaUpdates}
        onChange={(v) => setSetting("betaUpdates", v)}
      />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Editor</div>

      <SettingToggle
        label="Spellcheck"
        description="Enable spellcheck in the compose box (requires restart)"
        checked={store.spellcheck}
        onChange={(v) => setSetting("spellcheck", v)}
      />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Advanced</div>

      <SettingRow label="Download location" description="Default folder for file downloads">
        <button class="text-xs text-[var(--interactive-primary)] hover:underline">
          {store.downloadLocation || "Choose folder..."}
        </button>
      </SettingRow>

      <div>
        <label class="text-xs font-medium text-[var(--text-primary)] block mb-1">Custom CSS</label>
        <div class="text-[11px] text-[var(--text-tertiary)] mb-2">Add custom styles to customize the app appearance</div>
        <textarea
          class="w-full text-xs font-mono bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-h-[80px] resize-y"
          placeholder="/* Custom CSS */"
          value={store.customCSS}
          onInput={(e) => setSetting("customCSS", e.currentTarget.value)}
        />
      </div>

      <hr class="border-[var(--border-default)]" />

      <div>
        <button class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--status-error)] text-white hover:opacity-90 transition-opacity">
          Factory reset
        </button>
        <div class="text-[10px] text-[var(--text-tertiary)] mt-1">
          Deletes all connected organizations and resets all settings. This cannot be undone.
        </div>
      </div>
    </div>
  )
}
