import { createSignal, onMount, Show } from "solid-js"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"
import { usePlatform } from "../context/platform"
import { commands } from "@zulip/desktop/bindings"
import type { RealmSettingsSnapshot } from "@zulip/desktop/bindings"

export function SettingsOrgProfile() {
  const org = useOrg()
  const sync = useZulipSync()
  const platform = usePlatform()
  const [settings, setSettings] = createSignal<RealmSettingsSnapshot | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saveMessage, setSaveMessage] = createSignal("")
  const [uploading, setUploading] = createSignal("")

  // Editable fields
  const [name, setName] = createSignal("")
  const [description, setDescription] = createSignal("")

  const isAdmin = () => {
    const userId = sync.store.currentUserId
    if (!userId) return false
    const user = sync.store.users.find(u => u.user_id === userId)
    return user?.is_admin || (user?.role !== null && user?.role !== undefined && user.role <= 200)
  }

  const reload = async () => {
    try {
      const result = await commands.getRealmSettings(org.orgId)
      if (result.status === "ok") {
        setSettings(result.data)
        setName(result.data.realm_name || org.realmName || "")
        setDescription(result.data.realm_description || "")
      } else {
        setError(result.error || "Failed to load organization settings")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load organization settings")
    }
  }

  onMount(async () => {
    await reload()
    setLoading(false)
  })

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage("")
    setError("")
    try {
      const patch: Record<string, any> = {}
      const s = settings()
      if (name().trim() && name().trim() !== (s?.realm_name || "")) {
        patch.name = name().trim()
      }
      if (description() !== (s?.realm_description || "")) {
        patch.description = description()
      }
      if (Object.keys(patch).length === 0) {
        setSaveMessage("No changes to save")
        setSaving(false)
        return
      }
      const result = await commands.updateRealmSettings(org.orgId, JSON.stringify(patch))
      if (result.status === "ok") {
        setSaveMessage("Saved")
        setSettings(prev => prev ? { ...prev, realm_name: name().trim(), realm_description: description() } : prev)
        if (patch.name) org.setRealmName(patch.name)
        setTimeout(() => setSaveMessage(""), 2000)
      } else {
        setError(result.error || "Failed to save")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleUploadIcon = async () => {
    if (!platform.openFilePickerDialog) return
    const s = settings()
    const maxMib = s?.max_icon_file_size_mib ?? 5
    setError("")
    setUploading("icon")
    try {
      const picked = await platform.openFilePickerDialog({ title: `Choose organization icon (max ${maxMib} MiB)` })
      if (!picked || Array.isArray(picked)) { setUploading(""); return }
      const result = await commands.uploadRealmIcon(org.orgId, picked)
      if (result.status === "ok") {
        await reload()
        const updated = settings()
        if (updated?.realm_icon_url) org.setRealmIcon(updated.realm_icon_url)
      } else {
        setError(result.error || "Failed to upload icon")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to upload icon")
    } finally {
      setUploading("")
    }
  }

  const handleDeleteIcon = async () => {
    setError("")
    setUploading("icon-delete")
    try {
      const result = await commands.deleteRealmIcon(org.orgId)
      if (result.status === "ok") {
        await reload()
        const updated = settings()
        if (updated?.realm_icon_url) org.setRealmIcon(updated.realm_icon_url)
        else org.setRealmIcon("")
      } else {
        setError(result.error || "Failed to delete icon")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to delete icon")
    } finally {
      setUploading("")
    }
  }

  const handleUploadLogo = async (night: boolean) => {
    if (!platform.openFilePickerDialog) return
    const s = settings()
    const maxMib = s?.max_logo_file_size_mib ?? 5
    const label = night ? "night logo" : "day logo"
    setError("")
    setUploading(night ? "night-logo" : "day-logo")
    try {
      const picked = await platform.openFilePickerDialog({ title: `Choose ${label} (max ${maxMib} MiB)` })
      if (!picked || Array.isArray(picked)) { setUploading(""); return }
      const result = await commands.uploadRealmLogo(org.orgId, picked, night)
      if (result.status === "ok") {
        await reload()
      } else {
        setError(result.error || `Failed to upload ${label}`)
      }
    } catch (e: any) {
      setError(e?.message || `Failed to upload ${label}`)
    } finally {
      setUploading("")
    }
  }

  const handleDeleteLogo = async (night: boolean) => {
    const label = night ? "night logo" : "day logo"
    setError("")
    setUploading(night ? "night-logo-delete" : "day-logo-delete")
    try {
      const result = await commands.deleteRealmLogo(org.orgId, night)
      if (result.status === "ok") {
        await reload()
      } else {
        setError(result.error || `Failed to delete ${label}`)
      }
    } catch (e: any) {
      setError(e?.message || `Failed to delete ${label}`)
    } finally {
      setUploading("")
    }
  }

  const isUploaded = (source: string | undefined) => source === "U"

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Organization Profile</h3>

      <Show when={loading()}>
        <div class="text-xs text-[var(--text-tertiary)] py-4">Loading organization settings...</div>
      </Show>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)]">{error()}</div>
      </Show>

      <Show when={!loading() && settings()}>
        {(_s) => {
          const s = () => settings()!
          return (
            <div class="space-y-4">
              {/* Org Icon */}
              <div>
                <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-2">Organization icon</label>
                <div class="flex items-center gap-4">
                  <Show
                    when={s().realm_icon_url}
                    fallback={
                      <div class="w-16 h-16 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] flex items-center justify-center text-white text-xl font-bold shrink-0">
                        {name()?.charAt(0)?.toUpperCase() || "O"}
                      </div>
                    }
                  >
                    <img
                      src={s().realm_icon_url}
                      alt="Organization icon"
                      class="w-16 h-16 rounded-[var(--radius-md)] object-cover shrink-0"
                    />
                  </Show>
                  <div class="space-y-1">
                    <div class="text-sm font-medium text-[var(--text-primary)]">{name() || org.realmName}</div>
                    <Show when={isAdmin()}>
                      <div class="flex items-center gap-2">
                        <button
                          class="text-[10px] text-[var(--interactive-primary)] hover:underline disabled:opacity-50"
                          onClick={handleUploadIcon}
                          disabled={!!uploading()}
                        >
                          {uploading() === "icon" ? "Uploading..." : "Change icon"}
                        </button>
                        <Show when={isUploaded(s().realm_icon_source)}>
                          <button
                            class="text-[10px] text-[var(--status-error)] hover:underline disabled:opacity-50"
                            onClick={handleDeleteIcon}
                            disabled={!!uploading()}
                          >
                            {uploading() === "icon-delete" ? "Deleting..." : "Delete"}
                          </button>
                        </Show>
                      </div>
                      <div class="text-[9px] text-[var(--text-quaternary)]">
                        Max {s().max_icon_file_size_mib ?? 5} MiB
                      </div>
                    </Show>
                    <Show when={!isAdmin()}>
                      <div class="text-[10px] text-[var(--text-tertiary)] mt-1">Only administrators can edit organization settings</div>
                    </Show>
                  </div>
                </div>
              </div>

              <hr class="border-[var(--border-default)]" />

              {/* Day Logo */}
              <Show when={s().zulip_plan_is_not_limited}>
                <div>
                  <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-2">Day logo</label>
                  <div class="flex items-center gap-4">
                    <Show
                      when={s().realm_logo_url && isUploaded(s().realm_logo_source)}
                      fallback={
                        <div class="w-32 h-10 rounded-[var(--radius-sm)] bg-[var(--background-base)] border border-[var(--border-default)] flex items-center justify-center text-[10px] text-[var(--text-quaternary)]">
                          No logo uploaded
                        </div>
                      }
                    >
                      <img
                        src={s().realm_logo_url}
                        alt="Day logo"
                        class="h-10 max-w-[160px] object-contain rounded-[var(--radius-sm)]"
                      />
                    </Show>
                    <Show when={isAdmin()}>
                      <div class="flex items-center gap-2">
                        <button
                          class="text-[10px] text-[var(--interactive-primary)] hover:underline disabled:opacity-50"
                          onClick={() => handleUploadLogo(false)}
                          disabled={!!uploading()}
                        >
                          {uploading() === "day-logo" ? "Uploading..." : "Upload"}
                        </button>
                        <Show when={isUploaded(s().realm_logo_source)}>
                          <button
                            class="text-[10px] text-[var(--status-error)] hover:underline disabled:opacity-50"
                            onClick={() => handleDeleteLogo(false)}
                            disabled={!!uploading()}
                          >
                            {uploading() === "day-logo-delete" ? "Deleting..." : "Delete"}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>

                {/* Night Logo */}
                <div>
                  <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-2">Night logo (dark theme)</label>
                  <div class="flex items-center gap-4">
                    <Show
                      when={s().realm_night_logo_url && isUploaded(s().realm_night_logo_source)}
                      fallback={
                        <div class="w-32 h-10 rounded-[var(--radius-sm)] bg-[var(--background-base)] border border-[var(--border-default)] flex items-center justify-center text-[10px] text-[var(--text-quaternary)]">
                          No logo uploaded
                        </div>
                      }
                    >
                      <img
                        src={s().realm_night_logo_url}
                        alt="Night logo"
                        class="h-10 max-w-[160px] object-contain rounded-[var(--radius-sm)] bg-[var(--background-base)]"
                      />
                    </Show>
                    <Show when={isAdmin()}>
                      <div class="flex items-center gap-2">
                        <button
                          class="text-[10px] text-[var(--interactive-primary)] hover:underline disabled:opacity-50"
                          onClick={() => handleUploadLogo(true)}
                          disabled={!!uploading()}
                        >
                          {uploading() === "night-logo" ? "Uploading..." : "Upload"}
                        </button>
                        <Show when={isUploaded(s().realm_night_logo_source)}>
                          <button
                            class="text-[10px] text-[var(--status-error)] hover:underline disabled:opacity-50"
                            onClick={() => handleDeleteLogo(true)}
                            disabled={!!uploading()}
                          >
                            {uploading() === "night-logo-delete" ? "Deleting..." : "Delete"}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>

                <div class="text-[9px] text-[var(--text-quaternary)]">
                  Max logo size: {s().max_logo_file_size_mib ?? 5} MiB
                </div>

                <hr class="border-[var(--border-default)]" />
              </Show>

              <Show when={!s().zulip_plan_is_not_limited}>
                <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)]">
                  <div class="text-xs text-[var(--text-secondary)]">
                    Custom logos are available on paid plans.
                  </div>
                </div>
                <hr class="border-[var(--border-default)]" />
              </Show>

              {/* Org Name */}
              <div>
                <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Organization name</label>
                <input
                  type="text"
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  disabled={!isAdmin()}
                />
              </div>

              {/* Org Description */}
              <div>
                <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Description</label>
                <textarea
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-h-[60px] resize-y disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Add a description for your organization..."
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                  disabled={!isAdmin()}
                />
              </div>

              {/* Save button */}
              <Show when={isAdmin()}>
                <div class="flex items-center gap-2">
                  <button
                    class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                    onClick={handleSave}
                    disabled={saving()}
                  >
                    {saving() ? "Saving..." : "Save changes"}
                  </button>
                  <Show when={saveMessage()}>
                    <span class="text-[10px] text-[var(--status-success)]">{saveMessage()}</span>
                  </Show>
                </div>
              </Show>

              {/* Org ID */}
              <div>
                <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Organization ID</label>
                <div class="text-xs text-[var(--text-tertiary)] font-mono bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5">
                  {org.orgId}
                </div>
              </div>
            </div>
          )
        }}
      </Show>
    </div>
  )
}
