import { useOrg } from "../context/org";
import { useSettings } from "../context/settings";
import { useZulipSync } from "../context/zulip-sync";
import { SettingRow, SettingToggle } from "./settings-general";

export function SettingsAccount(props: { onLogout: () => void }) {
  const sync = useZulipSync();
  const org = useOrg();
  const { store, setSetting } = useSettings();

  const currentUser = () =>
    sync.store.users.find((u) => u.user_id === sync.store.currentUserId);

  const roleLabel = () => {
    const role = currentUser()?.role;
    if (role === 100) return "Owner";
    if (role === 200) return "Administrator";
    if (role === 300) return "Moderator";
    if (role === 400) return "Member";
    if (role === 600) return "Guest";
    return "Member";
  };

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">
        Account & Privacy
      </h3>

      {/* Profile info */}
      <div class="space-y-3 p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)]">
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Full name
          </label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">
            {currentUser()?.full_name || "Unknown"}
          </div>
        </div>
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Email
          </label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">
            {currentUser()?.email || sync.store.currentUserEmail || "—"}
          </div>
        </div>
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Role
          </label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">
            {roleLabel()}
          </div>
        </div>
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Organization
          </label>
          <div class="text-sm text-[var(--text-primary)] mt-0.5">
            {org.realmName}
          </div>
        </div>
      </div>

      <hr class="border-[var(--border-default)]" />
      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
        Privacy
      </div>

      <SettingToggle
        label="Send typing notifications"
        description="Let others see when you are typing a message"
        checked={store.sendTyping}
        onChange={(v) => setSetting("sendTyping", v)}
      />

      <SettingToggle
        label="Send read receipts"
        description="Let others see when you have read their messages"
        checked={store.sendReadReceipts}
        onChange={(v) => setSetting("sendReadReceipts", v)}
      />

      <SettingToggle
        label="Show availability"
        description="Display your online/idle/offline status to other users"
        checked={store.showAvailability}
        onChange={(v) => setSetting("showAvailability", v)}
      />

      <SettingRow
        label="Email address visibility"
        description="Who can see your email address"
      >
        <select
          class="text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-w-[140px]"
          value={store.emailVisibility}
          onChange={(e) => setSetting("emailVisibility", e.currentTarget.value)}
        >
          <option value="everyone">Everyone</option>
          <option value="members">Members only</option>
          <option value="admins">Admins only</option>
          <option value="nobody">Nobody</option>
        </select>
      </SettingRow>

      <hr class="border-[var(--border-default)]" />

      <button
        onClick={props.onLogout}
        class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--status-error)] text-white hover:opacity-90 transition-opacity"
      >
        Log out
      </button>
    </div>
  );
}
