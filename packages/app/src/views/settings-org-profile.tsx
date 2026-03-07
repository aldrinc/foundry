import { useOrg } from "../context/org";

export function SettingsOrgProfile() {
  const org = useOrg();

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">
        Organization Profile
      </h3>

      <div class="space-y-4">
        {/* Org Avatar */}
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] flex items-center justify-center text-white text-xl font-bold shrink-0">
            {org.realmName?.charAt(0)?.toUpperCase() || "O"}
          </div>
          <div>
            <div class="text-sm font-medium text-[var(--text-primary)]">
              {org.realmName}
            </div>
            <button class="text-[10px] text-[var(--interactive-primary)] hover:underline mt-1">
              Change logo
            </button>
          </div>
        </div>

        <hr class="border-[var(--border-default)]" />

        {/* Org Name */}
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
            Organization name
          </label>
          <input
            type="text"
            class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
            value={org.realmName}
            readOnly
          />
          <div class="text-[10px] text-[var(--text-tertiary)] mt-1">
            Only organization administrators can change this.
          </div>
        </div>

        {/* Org Description */}
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
            Description
          </label>
          <textarea
            class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] min-h-[60px] resize-y"
            placeholder="Add a description for your organization..."
            readOnly
          />
        </div>

        {/* Org ID */}
        <div>
          <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
            Organization ID
          </label>
          <div class="text-xs text-[var(--text-tertiary)] font-mono bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5">
            {org.orgId}
          </div>
        </div>
      </div>
    </div>
  );
}
