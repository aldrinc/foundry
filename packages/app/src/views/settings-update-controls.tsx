import { createSignal, Match, Show, Switch } from "solid-js"
import { usePlatform } from "../context/platform"
import { useSettings } from "../context/settings"
import { SettingRow } from "./settings-general"
import { getManualUpdateErrorMessage } from "./settings-update"

type SettingsUpdateControlsProps = {
  buttonLabel?: string
  description?: string
  layout?: "row" | "stack"
}

export function SettingsUpdateControls(props: SettingsUpdateControlsProps) {
  const { capabilities } = useSettings()
  const platform = usePlatform()
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal("")

  const layout = () => props.layout ?? "row"
  const canCheck = () => capabilities()?.updater !== false && Boolean(platform.checkUpdate && platform.update)
  const description = () => props.description
    ?? (capabilities()?.updater === false
      ? "Updater is not configured for this build."
      : "Manually check for a new version and install it immediately if one is available.")

  const handleCheckForUpdates = async () => {
    if (!platform.checkUpdate || !platform.update) {
      setError("Updates are not available in this build.")
      setMessage("")
      return
    }

    if (capabilities()?.updater === false) {
      setError("Updates are not configured for this build yet.")
      setMessage("")
      return
    }

    setBusy(true)
    setMessage("")
    setError("")

    try {
      const result = await platform.checkUpdate()
      if (!result.updateAvailable) {
        setMessage("You’re already on the latest version.")
        return
      }

      setMessage(
        result.version
          ? `Update ${result.version} found. Installing now...`
          : "Update found. Installing now...",
      )

      await platform.update()
      setMessage("Update installed. Restarting...")
    } catch (nextError) {
      setError(getManualUpdateErrorMessage(nextError))
      setMessage("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="space-y-2">
      <Switch>
        <Match when={layout() === "stack"}>
          <button
            class="w-full px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={busy() || !canCheck()}
            onClick={() => void handleCheckForUpdates()}
          >
            {busy() ? "Checking..." : props.buttonLabel ?? "Check for updates"}
          </button>
        </Match>
        <Match when={true}>
          <SettingRow
            label="Check for updates"
            description={description()}
          >
            <button
              class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={busy() || !canCheck()}
              onClick={() => void handleCheckForUpdates()}
            >
              {busy() ? "Checking..." : props.buttonLabel ?? "Check now"}
            </button>
          </SettingRow>
        </Match>
      </Switch>

      <Show when={message() || error()}>
        <div class={`text-[11px] ${error() ? "text-[var(--status-error)]" : "text-[var(--text-tertiary)]"}`}>
          {error() || message()}
        </div>
      </Show>
    </div>
  )
}
