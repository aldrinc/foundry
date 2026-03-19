import { createSignal, Show } from "solid-js"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { usePlatform } from "../context/platform"
import { commands } from "@foundry/desktop/bindings"

export function SettingsProfile() {
  const sync = useZulipSync()
  const org = useOrg()
  const platform = usePlatform()

  const currentUser = () => sync.store.users.find(u => u.user_id === sync.store.currentUserId)

  const [fullName, setFullName] = createSignal(currentUser()?.full_name || "")
  const [saving, setSaving] = createSignal(false)
  const [saveMessage, setSaveMessage] = createSignal("")
  const [error, setError] = createSignal("")
  const [uploading, setUploading] = createSignal("")

  const avatarUrl = () => {
    const user = currentUser()
    if (!user?.avatar_url) return null
    // If relative URL, prefix with realm URL
    if (user.avatar_url.startsWith("/")) {
      return `${org.realmUrl}${user.avatar_url}`
    }
    return user.avatar_url
  }

  const hasChanges = () => {
    const user = currentUser()
    return fullName().trim() !== (user?.full_name || "")
  }

  const handleSave = async () => {
    const trimmed = fullName().trim()
    if (!trimmed) {
      setError("Name cannot be empty")
      return
    }
    if (!hasChanges()) {
      setSaveMessage("No changes to save")
      setTimeout(() => setSaveMessage(""), 2000)
      return
    }

    setSaving(true)
    setSaveMessage("")
    setError("")
    try {
      const settingsJson = JSON.stringify({ full_name: trimmed })
      const result = await commands.updateZulipSettings(org.orgId, settingsJson)
      if (result.status === "ok") {
        // Update local user store
        sync.replaceUsers(
          sync.store.users.map(u =>
            u.user_id === sync.store.currentUserId
              ? { ...u, full_name: trimmed }
              : u
          )
        )
        setSaveMessage("Profile updated")
        setTimeout(() => setSaveMessage(""), 2000)
      } else {
        setError(result.error || "Failed to update profile")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to update profile")
    } finally {
      setSaving(false)
    }
  }

  const handleUploadAvatar = async () => {
    if (!platform.openFilePickerDialog) return
    setError("")
    setUploading("avatar")
    try {
      const picked = await platform.openFilePickerDialog({ title: "Choose profile picture (max 5 MiB)" })
      if (!picked || Array.isArray(picked)) { setUploading(""); return }
      const result = await commands.uploadAvatar(org.orgId, picked)
      if (result.status === "ok") {
        // Update local user store with new avatar URL
        sync.replaceUsers(
          sync.store.users.map(u =>
            u.user_id === sync.store.currentUserId
              ? { ...u, avatar_url: result.data }
              : u
          )
        )
        setSaveMessage("Avatar updated")
        setTimeout(() => setSaveMessage(""), 2000)
      } else {
        setError(result.error || "Failed to upload avatar")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to upload avatar")
    } finally {
      setUploading("")
    }
  }

  const handleDeleteAvatar = async () => {
    setError("")
    setUploading("avatar-delete")
    try {
      const result = await commands.deleteAvatar(org.orgId)
      if (result.status === "ok") {
        // Keep the local store in sync with the server-provided fallback avatar.
        sync.replaceUsers(
          sync.store.users.map(u =>
            u.user_id === sync.store.currentUserId
              ? { ...u, avatar_url: result.data }
              : u
          )
        )
        setSaveMessage("Avatar removed")
        setTimeout(() => setSaveMessage(""), 2000)
      } else {
        setError(result.error || "Failed to remove avatar")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to remove avatar")
    } finally {
      setUploading("")
    }
  }

  const roleLabel = () => {
    const role = currentUser()?.role
    if (role === 100) return "Owner"
    if (role === 200) return "Administrator"
    if (role === 300) return "Moderator"
    if (role === 400) return "Member"
    if (role === 600) return "Guest"
    return "Member"
  }

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Profile</h3>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)]">{error()}</div>
      </Show>

      {/* Avatar */}
      <div>
        <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-2">Profile picture</label>
        <div class="flex items-center gap-4">
          <Show
            when={avatarUrl()}
            fallback={
              <div class="w-16 h-16 rounded-full bg-[var(--interactive-primary)] flex items-center justify-center text-white text-xl font-bold shrink-0">
                {currentUser()?.full_name?.charAt(0).toUpperCase() || "?"}
              </div>
            }
          >
            <img
              src={avatarUrl()!}
              alt="Profile picture"
              class="w-16 h-16 rounded-full object-cover shrink-0"
            />
          </Show>
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <button
                class="text-[10px] text-[var(--interactive-primary)] hover:underline disabled:opacity-50"
                onClick={handleUploadAvatar}
                disabled={!!uploading()}
              >
                {uploading() === "avatar" ? "Uploading..." : "Change picture"}
              </button>
              <Show when={avatarUrl()}>
                <button
                  class="text-[10px] text-[var(--status-error)] hover:underline disabled:opacity-50"
                  onClick={handleDeleteAvatar}
                  disabled={!!uploading()}
                >
                  {uploading() === "avatar-delete" ? "Removing..." : "Remove"}
                </button>
              </Show>
            </div>
            <div class="text-[9px] text-[var(--text-quaternary)]">
              Max 5 MiB. PNG, JPG, or GIF.
            </div>
          </div>
        </div>
      </div>

      <hr class="border-[var(--border-default)]" />

      {/* Full name */}
      <div>
        <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Full name</label>
        <input
          type="text"
          class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
          value={fullName()}
          onInput={(e) => setFullName(e.currentTarget.value)}
          placeholder="Your full name"
        />
      </div>

      {/* Read-only info */}
      <div class="space-y-3 p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)]">
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Email</label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">{currentUser()?.email || sync.store.currentUserEmail || "\u2014"}</div>
        </div>
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Role</label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">{roleLabel()}</div>
        </div>
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Organization</label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">{org.realmName}</div>
        </div>
      </div>

      {/* Save button */}
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          onClick={handleSave}
          disabled={saving() || !hasChanges()}
        >
          {saving() ? "Saving..." : "Save changes"}
        </button>
        <Show when={saveMessage()}>
          <span class="text-[10px] text-[var(--status-success)]">{saveMessage()}</span>
        </Show>
      </div>
    </div>
  )
}
