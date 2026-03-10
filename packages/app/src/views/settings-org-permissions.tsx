import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"
import { commands } from "@foundry/desktop/bindings"
import type { RealmSettingsSnapshot, UserGroup, GroupSettingValue, GroupPermissionSetting, RealmDomain } from "@foundry/desktop/bindings"
import { SettingRow, SettingToggle } from "./settings-general"

/** Human-readable labels for realm permission keys */
const PERMISSION_LABELS: Record<string, { label: string; description: string }> = {
  realm_can_invite_users_group: { label: "Invite users", description: "Who can send invitations to join" },
  realm_create_multiuse_invite_group: { label: "Create reusable invite links", description: "Who can create multi-use invite links" },
  realm_can_create_public_channel_group: { label: "Create public channels", description: "Who can create new public channels" },
  realm_can_create_private_channel_group: { label: "Create private channels", description: "Who can create new private channels" },
  realm_can_create_web_public_channel_group: { label: "Create web-public channels", description: "Who can create web-public channels" },
  realm_can_add_subscribers_group: { label: "Add subscribers to channels", description: "Who can add other users to channels" },
  realm_can_move_messages_between_channels_group: { label: "Move messages between channels", description: "Who can move messages to another channel" },
  realm_can_move_messages_between_topics_group: { label: "Move messages between topics", description: "Who can move messages to another topic" },
  realm_can_resolve_topics_group: { label: "Resolve topics", description: "Who can mark topics as resolved" },
  realm_can_delete_any_message_group: { label: "Delete any message", description: "Who can delete messages sent by others" },
  realm_can_delete_own_message_group: { label: "Delete own messages", description: "Who can delete their own messages" },
  realm_can_mention_many_users_group: { label: "Use wildcard mentions", description: "Who can use @all or @everyone mentions" },
  realm_can_manage_all_groups: { label: "Manage all user groups", description: "Who can manage all user groups" },
  realm_can_create_groups: { label: "Create user groups", description: "Who can create new user groups" },
  realm_direct_message_permission_group: { label: "Direct message permissions", description: "Who can send direct messages" },
  realm_direct_message_initiator_group: { label: "Initiate direct messages", description: "Who can start new direct message conversations" },
  realm_can_add_custom_emoji_group: { label: "Add custom emoji", description: "Who can add custom emoji to the organization" },
  realm_can_create_bots_group: { label: "Create bots", description: "Who can create bot users" },
  realm_can_create_write_only_bots_group: { label: "Create incoming webhook bots", description: "Who can create write-only bots" },
  realm_can_access_all_users_group: { label: "Access all users", description: "Who can see the full user list" },
  realm_can_manage_billing_group: { label: "Manage billing", description: "Who can manage organization billing" },
  realm_can_summarize_topics_group: { label: "Summarize topics", description: "Who can use AI topic summaries" },
}

/** Ordered sections for permission grouping in UI */
const PERMISSION_SECTIONS: { title: string; keys: string[] }[] = [
  {
    title: "Joining the organization",
    keys: ["realm_can_invite_users_group", "realm_create_multiuse_invite_group"],
  },
  {
    title: "Channel permissions",
    keys: [
      "realm_can_create_public_channel_group",
      "realm_can_create_private_channel_group",
      "realm_can_create_web_public_channel_group",
      "realm_can_add_subscribers_group",
    ],
  },
  {
    title: "Message permissions",
    keys: [
      "realm_can_move_messages_between_channels_group",
      "realm_can_move_messages_between_topics_group",
      "realm_can_resolve_topics_group",
      "realm_can_delete_any_message_group",
      "realm_can_delete_own_message_group",
      "realm_can_mention_many_users_group",
    ],
  },
  {
    title: "Groups & users",
    keys: [
      "realm_can_manage_all_groups",
      "realm_can_create_groups",
      "realm_direct_message_permission_group",
      "realm_direct_message_initiator_group",
      "realm_can_access_all_users_group",
    ],
  },
  {
    title: "Other",
    keys: [
      "realm_can_add_custom_emoji_group",
      "realm_can_create_bots_group",
      "realm_can_create_write_only_bots_group",
      "realm_can_manage_billing_group",
      "realm_can_summarize_topics_group",
    ],
  },
]

export function SettingsOrgPermissions() {
  const org = useOrg()
  const sync = useZulipSync()
  const [settings, setSettings] = createSignal<RealmSettingsSnapshot | null>(null)
  const [groups, setGroups] = createSignal<UserGroup[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saveMessage, setSaveMessage] = createSignal("")

  // Scalar editable state
  const [inviteRequired, setInviteRequired] = createSignal(true)
  const [emailsRestricted, setEmailsRestricted] = createSignal(false)
  const [allowEditing, setAllowEditing] = createSignal(true)
  const [editLimitSeconds, setEditLimitSeconds] = createSignal<number | null>(600)
  const [deleteLimitSeconds, setDeleteLimitSeconds] = createSignal<number | null>(600)
  const [topicsPolicy, setTopicsPolicy] = createSignal("disable_empty_topic")
  const [waitingPeriod, setWaitingPeriod] = createSignal(0)

  // Group permission overrides (key -> group id or null if unchanged)
  const [groupOverrides, setGroupOverrides] = createSignal<Record<string, number | null>>({})

  // Domain state
  const [domains, setDomains] = createSignal<RealmDomain[]>([])
  const [newDomain, setNewDomain] = createSignal("")
  const [newDomainSubs, setNewDomainSubs] = createSignal(false)
  const [domainSaving, setDomainSaving] = createSignal(false)

  const isAdmin = () => {
    const userId = sync.store.currentUserId
    if (!userId) return false
    const user = sync.store.users.find(u => u.user_id === userId)
    return user?.is_admin || (user?.role !== null && user?.role !== undefined && user.role <= 200)
  }

  /** Extract numeric group ID from a GroupSettingValue */
  const groupIdFromValue = (val: GroupSettingValue | null | undefined): number | null => {
    if (val === null || val === undefined) return null
    if (typeof val === "number") return val
    return null
  }

  /** System groups sorted for display */
  const systemGroups = createMemo(() =>
    groups().filter(g => g.is_system_group && !g.deactivated)
  )

  /** Resolve group ID to name */
  const groupName = (id: number): string => {
    const g = groups().find(g => g.id === id)
    if (!g) return `Group #${id}`
    return formatGroupName(g.name)
  }

  /** Format system group name for display */
  const formatGroupName = (name: string): string => {
    // System groups have names like "role:owners", "role:administrators", etc.
    if (name.startsWith("role:")) {
      const role = name.slice(5)
      return role.charAt(0).toUpperCase() + role.slice(1)
    }
    return name
  }

  /** Get allowed system groups for a permission key from server metadata */
  const allowedGroupsForKey = (key: string): UserGroup[] => {
    const s = settings()
    const meta = s?.server_supported_permission_settings?.realm
    // Strip the "realm_" prefix to match the server's key format
    const serverKey = key.replace(/^realm_/, "")
    const setting: GroupPermissionSetting | undefined = meta?.[serverKey]

    if (!setting?.allowed_system_groups) {
      // Fallback: return all system groups
      return systemGroups()
    }

    return systemGroups().filter(g => setting.allowed_system_groups!.includes(g.name))
  }

  /** Get current group ID for a permission (overridden or from settings) */
  const currentGroupId = (key: string): number | null => {
    const override = groupOverrides()[key]
    if (override !== undefined) return override
    const s = settings()
    if (!s) return null
    const val = (s as any)[key] as GroupSettingValue | null | undefined
    return groupIdFromValue(val)
  }

  /** Set a group override */
  const setGroupOverride = (key: string, groupId: number) => {
    setGroupOverrides(prev => ({ ...prev, [key]: groupId }))
  }

  onMount(async () => {
    try {
      const [settingsResult, groupsResult] = await Promise.all([
        commands.getRealmSettings(org.orgId),
        commands.getUserGroups(org.orgId, false),
      ])

      if (settingsResult.status === "ok") {
        const s = settingsResult.data
        setSettings(s)
        setInviteRequired(s.realm_invite_required ?? true)
        setEmailsRestricted(s.realm_emails_restricted_to_domains ?? false)
        setAllowEditing(s.realm_allow_message_editing ?? true)
        setEditLimitSeconds(s.realm_message_content_edit_limit_seconds ?? 600)
        setDeleteLimitSeconds(s.realm_message_content_delete_limit_seconds ?? 600)
        setTopicsPolicy(s.realm_topics_policy ?? "disable_empty_topic")
        setWaitingPeriod(s.realm_waiting_period_threshold ?? 0)
        setDomains(s.realm_domains ?? [])
      } else {
        setError(settingsResult.error || "Failed to load settings")
      }

      if (groupsResult.status === "ok") {
        setGroups(groupsResult.data)
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load settings")
    } finally {
      setLoading(false)
    }
  })

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage("")
    setError("")
    try {
      const s = settings()
      const patch: Record<string, any> = {}

      // Scalar settings
      if (inviteRequired() !== (s?.realm_invite_required ?? true)) patch.invite_required = inviteRequired()
      if (emailsRestricted() !== (s?.realm_emails_restricted_to_domains ?? false)) patch.emails_restricted_to_domains = emailsRestricted()
      if (allowEditing() !== (s?.realm_allow_message_editing ?? true)) patch.allow_message_editing = allowEditing()
      if (editLimitSeconds() !== (s?.realm_message_content_edit_limit_seconds ?? 600)) patch.message_content_edit_limit_seconds = editLimitSeconds()
      if (deleteLimitSeconds() !== (s?.realm_message_content_delete_limit_seconds ?? 600)) patch.message_content_delete_limit_seconds = deleteLimitSeconds()
      if (topicsPolicy() !== (s?.realm_topics_policy ?? "disable_empty_topic")) patch.topics_policy = topicsPolicy()
      if (waitingPeriod() !== (s?.realm_waiting_period_threshold ?? 0)) patch.waiting_period_threshold = waitingPeriod()

      // Group permission overrides
      const overrides = groupOverrides()
      for (const [key, groupId] of Object.entries(overrides)) {
        if (groupId === null) continue
        // Convert realm_can_xxx_group -> can_xxx_group for the API
        const apiKey = key.replace(/^realm_/, "")
        patch[apiKey] = groupId
      }

      if (Object.keys(patch).length === 0) {
        setSaveMessage("No changes to save")
        setSaving(false)
        return
      }

      const result = await commands.updateRealmSettings(org.orgId, JSON.stringify(patch))
      if (result.status === "ok") {
        setSaveMessage("Saved")
        // Update local snapshot
        setSettings(prev => {
          if (!prev) return prev
          const updated = {
            ...prev,
            realm_invite_required: inviteRequired(),
            realm_emails_restricted_to_domains: emailsRestricted(),
            realm_allow_message_editing: allowEditing(),
            realm_message_content_edit_limit_seconds: editLimitSeconds(),
            realm_message_content_delete_limit_seconds: deleteLimitSeconds(),
            realm_topics_policy: topicsPolicy() as any,
            realm_waiting_period_threshold: waitingPeriod(),
          }
          // Apply group overrides to snapshot
          for (const [key, groupId] of Object.entries(overrides)) {
            if (groupId !== null) {
              ;(updated as any)[key] = groupId
            }
          }
          return updated
        })
        setGroupOverrides({})
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

  // Domain CRUD
  const handleAddDomain = async () => {
    const d = newDomain().trim().toLowerCase()
    if (!d) return
    setDomainSaving(true)
    setError("")
    try {
      const result = await commands.createRealmDomain(org.orgId, d, newDomainSubs())
      if (result.status === "ok") {
        setDomains(prev => [...prev, { domain: d, allow_subdomains: newDomainSubs() }])
        setNewDomain("")
        setNewDomainSubs(false)
      } else {
        setError(result.error || "Failed to add domain")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to add domain")
    } finally {
      setDomainSaving(false)
    }
  }

  const handleToggleDomainSubs = async (domain: string, currentAllow: boolean) => {
    setError("")
    try {
      const result = await commands.updateRealmDomain(org.orgId, domain, !currentAllow)
      if (result.status === "ok") {
        setDomains(prev => prev.map(d => d.domain === domain ? { ...d, allow_subdomains: !currentAllow } : d))
      } else {
        setError(result.error || "Failed to update domain")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to update domain")
    }
  }

  const handleDeleteDomain = async (domain: string) => {
    setError("")
    try {
      const result = await commands.deleteRealmDomain(org.orgId, domain)
      if (result.status === "ok") {
        setDomains(prev => prev.filter(d => d.domain !== domain))
      } else {
        setError(result.error || "Failed to delete domain")
      }
    } catch (e: any) {
      setError(e?.message || "Failed to delete domain")
    }
  }

  /** Check if a permission key exists in the loaded settings (non-null) */
  const hasPermission = (key: string): boolean => {
    const s = settings()
    if (!s) return false
    return (s as any)[key] !== undefined
  }

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Organization Permissions</h3>

      <Show when={loading()}>
        <div class="text-xs text-[var(--text-tertiary)] py-4">Loading organization permissions...</div>
      </Show>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)]">{error()}</div>
      </Show>

      <Show when={!loading() && settings()}>
        <Show when={!isAdmin()}>
          <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)]">
            <div class="text-xs text-[var(--text-secondary)]">
              Only administrators can modify organization permissions. Settings shown are read-only.
            </div>
          </div>
        </Show>

        {/* Scalar: Joining */}
        <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Joining the organization</div>

        <SettingToggle
          label="Require invitation to join"
          description="New users must receive an invitation to join"
          checked={inviteRequired()}
          onChange={setInviteRequired}
          disabled={!isAdmin()}
        />

        <SettingToggle
          label="Restrict to email domains"
          description="Only allow signups from specific email domains"
          checked={emailsRestricted()}
          onChange={setEmailsRestricted}
          disabled={!isAdmin()}
        />

        <SettingRow label="Waiting period (days)" description="Days new users must wait before full membership">
          <input
            type="number"
            class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] w-[80px] disabled:opacity-50 disabled:cursor-not-allowed"
            value={waitingPeriod()}
            min={0}
            onInput={(e) => setWaitingPeriod(parseInt(e.currentTarget.value) || 0)}
            disabled={!isAdmin()}
          />
        </SettingRow>

        {/* Domain restrictions */}
        <Show when={emailsRestricted()}>
          <div class="ml-4 space-y-3">
            <div class="text-[10px] font-medium text-[var(--text-tertiary)]">Allowed email domains</div>
            <Show when={domains().length > 0}>
              <div class="border border-[var(--border-default)] rounded-[var(--radius-sm)] overflow-hidden">
                <For each={domains()}>
                  {(d) => (
                    <div class="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-default)] last:border-b-0">
                      <div class="text-xs text-[var(--text-primary)] font-mono">{d.domain}</div>
                      <div class="flex items-center gap-2">
                        <label class="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                          <input
                            type="checkbox"
                            checked={d.allow_subdomains}
                            onChange={() => handleToggleDomainSubs(d.domain, d.allow_subdomains)}
                            disabled={!isAdmin()}
                            class="disabled:opacity-50"
                          />
                          Subdomains
                        </label>
                        <Show when={isAdmin()}>
                          <button
                            class="text-[10px] text-[var(--status-error)] hover:underline"
                            onClick={() => handleDeleteDomain(d.domain)}
                          >
                            Remove
                          </button>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={isAdmin()}>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] w-[180px]"
                  placeholder="e.g. company.com"
                  value={newDomain()}
                  onInput={(e) => setNewDomain(e.currentTarget.value)}
                />
                <label class="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                  <input
                    type="checkbox"
                    checked={newDomainSubs()}
                    onChange={(e) => setNewDomainSubs(e.currentTarget.checked)}
                  />
                  Subdomains
                </label>
                <button
                  class="px-2 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
                  onClick={handleAddDomain}
                  disabled={!newDomain().trim() || domainSaving()}
                >
                  {domainSaving() ? "Adding..." : "Add"}
                </button>
              </div>
            </Show>
          </div>
        </Show>

        <hr class="border-[var(--border-default)]" />

        {/* Scalar: Message editing */}
        <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Message editing & deletion</div>

        <SettingToggle
          label="Allow message editing"
          description="Let users edit the content of their messages"
          checked={allowEditing()}
          onChange={setAllowEditing}
          disabled={!isAdmin()}
        />

        <SettingRow label="Edit time limit" description="How long users can edit messages after sending">
          <select
            class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed"
            value={editLimitSeconds() ?? 0}
            onChange={(e) => {
              const v = parseInt(e.currentTarget.value)
              setEditLimitSeconds(v === 0 ? null : v)
            }}
            disabled={!isAdmin()}
          >
            <option value={0}>No limit</option>
            <option value={120}>2 minutes</option>
            <option value={600}>10 minutes</option>
            <option value={3600}>1 hour</option>
            <option value={86400}>1 day</option>
          </select>
        </SettingRow>

        <SettingRow label="Delete time limit" description="How long users can delete messages after sending">
          <select
            class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed"
            value={deleteLimitSeconds() ?? 0}
            onChange={(e) => {
              const v = parseInt(e.currentTarget.value)
              setDeleteLimitSeconds(v === 0 ? null : v)
            }}
            disabled={!isAdmin()}
          >
            <option value={0}>No limit</option>
            <option value={120}>2 minutes</option>
            <option value={600}>10 minutes</option>
            <option value={3600}>1 hour</option>
            <option value={86400}>1 day</option>
          </select>
        </SettingRow>

        <hr class="border-[var(--border-default)]" />

        {/* Scalar: Topics */}
        <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Topics</div>

        <SettingRow label="Topic policy" description="Whether empty topics are allowed">
          <select
            class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed"
            value={topicsPolicy()}
            onChange={(e) => setTopicsPolicy(e.currentTarget.value)}
            disabled={!isAdmin()}
          >
            <option value="disable_empty_topic">Require topics</option>
            <option value="allow_empty_topic">Allow empty topics</option>
          </select>
        </SettingRow>

        <hr class="border-[var(--border-default)]" />

        {/* Group-based permission sections */}
        <For each={PERMISSION_SECTIONS}>
          {(section) => {
            const visibleKeys = () => section.keys.filter(k => hasPermission(k))
            return (
              <Show when={visibleKeys().length > 0}>
                <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">{section.title}</div>

                <For each={visibleKeys()}>
                  {(key) => {
                    const meta = PERMISSION_LABELS[key] || { label: key, description: "" }
                    const allowed = () => allowedGroupsForKey(key)
                    const current = () => currentGroupId(key)

                    return (
                      <SettingRow label={meta.label} description={meta.description}>
                        <select
                          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[160px] disabled:opacity-50 disabled:cursor-not-allowed"
                          value={current() ?? ""}
                          onChange={(e) => {
                            const v = parseInt(e.currentTarget.value)
                            if (!isNaN(v)) setGroupOverride(key, v)
                          }}
                          disabled={!isAdmin()}
                        >
                          <For each={allowed()}>
                            {(g) => (
                              <option value={g.id}>{formatGroupName(g.name)}</option>
                            )}
                          </For>
                          {/* If current value doesn't match any allowed group (e.g. custom group), show it */}
                          <Show when={current() !== null && !allowed().some(g => g.id === current())}>
                            <option value={current()!}>{groupName(current()!)}</option>
                          </Show>
                        </select>
                      </SettingRow>
                    )
                  }}
                </For>

                <hr class="border-[var(--border-default)]" />
              </Show>
            )
          }}
        </For>

        {/* Save button */}
        <Show when={isAdmin()}>
          <div class="flex items-center gap-2 pt-2">
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
      </Show>
    </div>
  )
}
