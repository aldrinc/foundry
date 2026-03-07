import { createSignal, For, Show } from "solid-js";

interface MutedUser {
  id: number;
  name: string;
  email: string;
  mutedAt: string;
}

export function SettingsMutedUsers() {
  const [mutedUsers, setMutedUsers] = createSignal<MutedUser[]>([]);

  const handleUnmute = (userId: number) => {
    setMutedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  return (
    <div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">
        Muted Users
      </h3>
      <p class="text-xs text-[var(--text-tertiary)]">
        Messages from muted users will be hidden. You can mute a user by
        clicking on their name in a message and selecting "Mute this user".
      </p>

      <Show
        when={mutedUsers().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">
              No muted users
            </div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Users you mute will appear here
            </div>
          </div>
        }
      >
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={mutedUsers()}>
            {(user) => (
              <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-6 h-6 rounded-full bg-[var(--interactive-primary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-[var(--text-primary)] truncate">
                      {user.name}
                    </div>
                    <div class="text-[10px] text-[var(--text-tertiary)] truncate">
                      {user.email}
                    </div>
                  </div>
                </div>
                <button
                  class="text-[10px] text-[var(--interactive-primary)] hover:underline shrink-0 ml-2"
                  onClick={() => handleUnmute(user.id)}
                >
                  Unmute
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
