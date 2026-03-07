import { createSignal } from "solid-js"
import { SettingRow, SettingToggle } from "./settings-general"

export function SettingsOrgPermissions() {
  const [invitePolicy, setInvitePolicy] = createSignal("members")
  const [createPublic, setCreatePublic] = createSignal("members")
  const [createPrivate, setCreatePrivate] = createSignal("members")
  const [addSubscribers, setAddSubscribers] = createSignal("members")
  const [moveMessages, setMoveMessages] = createSignal("members")
  const [editPolicy, setEditPolicy] = createSignal("time-limited")
  const [deletePolicy, setDeletePolicy] = createSignal("admins")
  const [requireTopics, setRequireTopics] = createSignal(true)
  const [inviteOnly, setInviteOnly] = createSignal(true)
  const [emailDomains, setEmailDomains] = createSignal("")

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Organization Permissions</h3>
      <p class="text-xs text-[var(--text-tertiary)]">
        These settings control what actions members can take in your organization. Only administrators can modify these.
      </p>

      {/* Joining */}
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Joining the organization</div>

      <SettingToggle
        label="Require invitation to join"
        description="New users must receive an invitation to join"
        checked={inviteOnly()}
        onChange={setInviteOnly}
      />

      <SettingRow label="Who can invite users" description="Permission to send invitations">
        <PermissionSelect value={invitePolicy()} onChange={setInvitePolicy} />
      </SettingRow>

      <SettingRow label="Email domain restrictions" description="Restrict signups to specific email domains">
        <input
          type="text"
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] w-[140px]"
          placeholder="e.g. company.com"
          value={emailDomains()}
          onInput={(e) => setEmailDomains(e.currentTarget.value)}
        />
      </SettingRow>

      <hr class="border-[var(--border-default)]" />

      {/* Channels */}
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Channel permissions</div>

      <SettingRow label="Create public channels" description="Who can create new public channels">
        <PermissionSelect value={createPublic()} onChange={setCreatePublic} />
      </SettingRow>

      <SettingRow label="Create private channels" description="Who can create new private channels">
        <PermissionSelect value={createPrivate()} onChange={setCreatePrivate} />
      </SettingRow>

      <SettingRow label="Add subscribers" description="Who can add other users to channels">
        <PermissionSelect value={addSubscribers()} onChange={setAddSubscribers} />
      </SettingRow>

      <hr class="border-[var(--border-default)]" />

      {/* Messages */}
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Message permissions</div>

      <SettingRow label="Message editing" description="Policy for editing sent messages">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={editPolicy()}
          onChange={(e) => setEditPolicy(e.currentTarget.value)}
        >
          <option value="no-edits">No editing</option>
          <option value="topic-only">Edit topic only</option>
          <option value="time-limited">Time-limited (10 min)</option>
          <option value="anytime">Edit anytime</option>
        </select>
      </SettingRow>

      <SettingRow label="Message deletion" description="Policy for deleting messages">
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={deletePolicy()}
          onChange={(e) => setDeletePolicy(e.currentTarget.value)}
        >
          <option value="no-deletes">No deletion</option>
          <option value="admins">Admins only</option>
          <option value="time-limited">Time-limited (10 min)</option>
          <option value="anytime">Delete anytime</option>
        </select>
      </SettingRow>

      <SettingRow label="Move messages" description="Who can move messages between topics">
        <PermissionSelect value={moveMessages()} onChange={setMoveMessages} />
      </SettingRow>

      <SettingToggle
        label="Require topics"
        description="Require a topic for every message sent to a channel"
        checked={requireTopics()}
        onChange={setRequireTopics}
      />
    </div>
  )
}

function PermissionSelect(props: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      <option value="owners">Owners only</option>
      <option value="admins">Admins and above</option>
      <option value="moderators">Moderators and above</option>
      <option value="members">All members</option>
      <option value="full-members">Full members only</option>
    </select>
  )
}
