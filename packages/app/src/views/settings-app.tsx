import { createSignal, Show } from "solid-js"
import { useSettings } from "../context/settings"
import { usePlatform } from "../context/platform"
import { commands } from "@foundry/desktop/bindings"
import { SettingToggle, SettingRow } from "./settings-general"
import { SettingsUpdateControls } from "./settings-update-controls"

export function SettingsApp() {
  const { store, setSetting, capabilities } = useSettings()
  const platform = usePlatform()
  const [resetting, setResetting] = createSignal(false)
  const [confirmReset, setConfirmReset] = createSignal(false)

  const caps = () => capabilities()

  const pickDownloadLocation = async () => {
    if (!platform.openDirectoryPickerDialog) return
    const result = await platform.openDirectoryPickerDialog({ title: "Choose download folder" })
    if (result && typeof result === "string") {
      setSetting("downloadLocation", result)
    } else if (Array.isArray(result) && result.length > 0) {
      setSetting("downloadLocation", result[0])
    }
  }

  const handleFactoryReset = async () => {
    if (!confirmReset()) {
      setConfirmReset(true)
      return
    }
    setResetting(true)
    try {
      // Remove all servers
      const serversResult = await commands.getServers()
      if (serversResult.status === "ok") {
        for (const server of serversResult.data) {
          await commands.removeServer(server.id)
        }
      }
      // Clear persisted settings
      await commands.setConfig("app_settings", "{}")
      // Restart the app
      await platform.restart()
    } catch {
      setResetting(false)
      setConfirmReset(false)
    }
  }

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Desktop App</h3>

      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Startup</div>

      <SettingToggle
        label="Start at login"
        description="Launch the app automatically when you log in (restart required)"
        checked={store.startAtLogin}
        onChange={(v) => setSetting("startAtLogin", v)}
        disabled={caps() ? !caps()!.start_at_login : false}
      />

      <SettingToggle
        label="Start minimized"
        description="Start the app minimized to the system tray (restart required)"
        checked={store.startMinimized}
        onChange={(v) => setSetting("startMinimized", v)}
        disabled={caps() ? !caps()!.tray : false}
      />

      <SettingToggle
        label="Show in system tray"
        description="Display the app icon in the system tray (restart required)"
        checked={store.showTray}
        onChange={(v) => setSetting("showTray", v)}
        disabled={caps() ? !caps()!.tray : false}
      />

      <SettingToggle
        label="Quit on window close"
        description="Fully quit the app when the window is closed instead of minimizing (restart required)"
        checked={store.quitOnClose}
        onChange={(v) => setSetting("quitOnClose", v)}
      />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Updates</div>

      <SettingToggle
        label="Auto-update"
        description={caps()?.updater === false ? "Not yet available — updater not configured" : "Check for updates automatically and let you choose when to install"}
        checked={store.autoUpdate}
        onChange={(v) => setSetting("autoUpdate", v)}
        disabled={caps() ? !caps()!.updater : false}
      />

      <SettingToggle
        label="Beta updates"
        description={caps()?.updater === false ? "Not yet available — updater not configured" : "Reserved until a separate beta update feed is configured"}
        checked={store.betaUpdates}
        onChange={(v) => setSetting("betaUpdates", v)}
        disabled={true}
      />

      <SettingsUpdateControls />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Editor</div>

      <SettingToggle
        label="Spellcheck"
        description="Enable spellcheck in the compose box (requires restart)"
        checked={store.spellcheck}
        onChange={(v) => setSetting("spellcheck", v)}
        disabled={caps() ? !caps()!.spellcheck_settings : false}
      />

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Advanced</div>

      <SettingRow label="Download location" description="Default folder for file downloads">
        <button
          class="text-xs text-[var(--interactive-primary)] hover:underline disabled:opacity-50 disabled:pointer-events-none"
          disabled={caps() ? !caps()!.directory_picker : false}
          onClick={pickDownloadLocation}
        >
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
        <Show
          when={!confirmReset()}
          fallback={
            <div class="space-y-2">
              <div class="text-xs font-medium text-[var(--status-error)]">
                Are you sure? This will delete all organizations and reset all settings.
              </div>
              <div class="flex gap-2">
                <button
                  class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--status-error)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  disabled={resetting()}
                  onClick={handleFactoryReset}
                >
                  {resetting() ? "Resetting..." : "Yes, reset everything"}
                </button>
                <button
                  class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-base)] transition-colors"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          }
        >
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--status-error)] text-white hover:opacity-90 transition-opacity"
            onClick={handleFactoryReset}
          >
            Factory reset
          </button>
          <div class="text-[10px] text-[var(--text-tertiary)] mt-1">
            Deletes all connected organizations and resets all settings. This cannot be undone.
          </div>
        </Show>
      </div>
    </div>
  )
}
