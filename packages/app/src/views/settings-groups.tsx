import { createSignal, For, Show } from "solid-js"

interface UserGroup {
  id: number
  name: string
  description: string
  members: number[]
}

export function SettingsGroups() {
  const [groups, setGroups] = createSignal<UserGroup[]>([])
  const [search, setSearch] = createSignal("")
  const [showCreate, setShowCreate] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newDesc, setNewDesc] = createSignal("")

  const filtered = () => {
    const q = search().toLowerCase()
    return groups().filter(g => !q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q))
  }

  const handleCreate = () => {
    if (!newName().trim()) return
    setGroups(prev => [...prev, {
      id: Date.now(),
      name: newName().trim(),
      description: newDesc().trim(),
      members: [],
    }])
    setNewName("")
    setNewDesc("")
    setShowCreate(false)
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">User Groups</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowCreate(s => !s)}
        >
          {showCreate() ? "Cancel" : "Create group"}
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        User groups allow you to mention multiple users at once. You can @mention a group to notify all its members.
      </p>

      {/* Create form */}
      <Show when={showCreate()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Group name</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
              placeholder="e.g. engineering-team"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Description</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
              placeholder="What is this group for?"
              value={newDesc()}
              onInput={(e) => setNewDesc(e.currentTarget.value)}
            />
          </div>
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleCreate}
            disabled={!newName().trim()}
          >
            Create
          </button>
        </div>
      </Show>

      {/* Search */}
      <input
        type="text"
        class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
        placeholder="Search groups..."
        value={search()}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />

      {/* Group list */}
      <Show
        when={filtered().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No user groups</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Create a group to mention multiple users at once
            </div>
          </div>
        }
      >
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={filtered()}>
            {(group) => (
              <div class="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)] last:border-b-0">
                <div class="min-w-0">
                  <div class="text-xs font-medium text-[var(--text-primary)]">@{group.name}</div>
                  <Show when={group.description}>
                    <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">{group.description}</div>
                  </Show>
                </div>
                <span class="text-[10px] text-[var(--text-tertiary)] shrink-0 ml-2">
                  {group.members.length} member{group.members.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
