import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useOrg } from "../context/org"
import { commands } from "@zulip/desktop/bindings"
import type { UserGroup } from "@zulip/desktop/bindings"

export function SettingsGroups() {
  const org = useOrg()
  const [groups, setGroups] = createSignal<UserGroup[]>([])
  const [search, setSearch] = createSignal("")
  const [showCreate, setShowCreate] = createSignal(false)
  const [showDeactivated, setShowDeactivated] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newDesc, setNewDesc] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [editName, setEditName] = createSignal("")
  const [editDesc, setEditDesc] = createSignal("")
  const [confirmDeactivate, setConfirmDeactivate] = createSignal<number | null>(null)

  const fetchGroups = async () => {
    const result = await commands.getUserGroups(org.orgId, showDeactivated())
    if (result.status === "ok") {
      setGroups(result.data)
    }
  }

  onMount(() => { void fetchGroups() })

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    return groups().filter(g => !q || g.name.toLowerCase().includes(q) || (g.description || "").toLowerCase().includes(q))
  })

  /** Separate system vs custom groups, system first */
  const sortedFiltered = createMemo(() => {
    const all = filtered()
    const system = all.filter(g => g.is_system_group)
    const custom = all.filter(g => !g.is_system_group)
    return [...system, ...custom]
  })

  const handleCreate = async () => {
    if (!newName().trim()) return
    setCreating(true)
    setError("")
    const result = await commands.createUserGroup(org.orgId, newName().trim(), newDesc().trim(), [])
    setCreating(false)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setNewName("")
    setNewDesc("")
    setShowCreate(false)
    fetchGroups()
  }

  const handleStartEdit = (group: UserGroup) => {
    if (group.is_system_group) return
    setEditingId(group.id)
    setEditName(group.name)
    setEditDesc(group.description || "")
  }

  const handleSaveEdit = async () => {
    const id = editingId()
    if (!id || !editName().trim()) return
    setError("")
    const result = await commands.updateUserGroup(org.orgId, id, editName().trim(), editDesc().trim())
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setEditingId(null)
    fetchGroups()
  }

  const handleDeactivate = async (groupId: number) => {
    if (confirmDeactivate() !== groupId) {
      setConfirmDeactivate(groupId)
      setTimeout(() => setConfirmDeactivate(null), 3000)
      return
    }
    setError("")
    const result = await commands.deactivateUserGroup(org.orgId, groupId)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setConfirmDeactivate(null)
    fetchGroups()
  }

  const toggleShowDeactivated = () => {
    setShowDeactivated(s => !s)
    fetchGroups()
  }

  /** Format system group name for display */
  const formatGroupName = (name: string): string => {
    if (name.startsWith("role:")) {
      const role = name.slice(5)
      return role.charAt(0).toUpperCase() + role.slice(1)
    }
    return name
  }

  /** Format unix timestamp to readable date */
  const formatDate = (ts: number | null | undefined): string => {
    if (!ts) return ""
    return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
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

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 rounded-[var(--radius-sm)]">
          {error()}
        </div>
      </Show>

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
            disabled={!newName().trim() || creating()}
          >
            {creating() ? "Creating..." : "Create"}
          </button>
        </div>
      </Show>

      {/* Search + filter */}
      <div class="flex gap-2">
        <input
          type="text"
          class="flex-1 text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
          placeholder="Search groups..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <button
          class={`text-[10px] px-2 py-1.5 rounded-[var(--radius-sm)] border transition-colors ${
            showDeactivated()
              ? "border-[var(--interactive-primary)] text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
              : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
          onClick={toggleShowDeactivated}
        >
          Show deactivated
        </button>
      </div>

      {/* Group list */}
      <Show
        when={sortedFiltered().length > 0}
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
          <For each={sortedFiltered()}>
            {(group) => (
              <div class={`border-b border-[var(--border-default)] last:border-b-0 ${group.deactivated ? "opacity-50" : ""}`}>
                <Show
                  when={editingId() === group.id}
                  fallback={
                    <div class="flex items-center justify-between px-3 py-2.5">
                      <div class="min-w-0">
                        <div class="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          @{group.is_system_group ? formatGroupName(group.name) : group.name}
                          <Show when={group.is_system_group}>
                            <span class="text-[9px] text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 px-1.5 py-0.5 rounded font-normal">
                              System
                            </span>
                          </Show>
                          <Show when={group.deactivated}>
                            <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded font-normal">Deactivated</span>
                          </Show>
                        </div>
                        <Show when={group.description}>
                          <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">{group.description}</div>
                        </Show>
                        {/* Creator / date metadata for custom groups */}
                        <Show when={!group.is_system_group && group.date_created}>
                          <div class="text-[9px] text-[var(--text-quaternary)] mt-0.5">
                            Created {formatDate(group.date_created)}
                          </div>
                        </Show>
                      </div>
                      <div class="flex items-center gap-2 shrink-0 ml-2">
                        <span class="text-[10px] text-[var(--text-tertiary)]">
                          {(group.members || []).length} member{(group.members || []).length !== 1 ? "s" : ""}
                        </span>
                        {/* Only show edit/deactivate for custom (non-system) groups */}
                        <Show when={!group.deactivated && !group.is_system_group}>
                          <button
                            class="text-[10px] text-[var(--interactive-primary)] hover:underline"
                            onClick={() => handleStartEdit(group)}
                          >
                            Edit
                          </button>
                          <button
                            class={`text-[10px] hover:underline ${confirmDeactivate() === group.id ? "text-[var(--status-error)]" : "text-[var(--text-tertiary)]"}`}
                            onClick={() => handleDeactivate(group.id)}
                          >
                            {confirmDeactivate() === group.id ? "Confirm?" : "Deactivate"}
                          </button>
                        </Show>
                      </div>
                    </div>
                  }
                >
                  {/* Inline edit form */}
                  <div class="px-3 py-2.5 space-y-2 bg-[var(--background-base)]">
                    <input
                      type="text"
                      class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                      value={editName()}
                      onInput={(e) => setEditName(e.currentTarget.value)}
                    />
                    <input
                      type="text"
                      class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                      value={editDesc()}
                      onInput={(e) => setEditDesc(e.currentTarget.value)}
                      placeholder="Description"
                    />
                    <div class="flex gap-2">
                      <button
                        class="px-2 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
                        onClick={handleSaveEdit}
                        disabled={!editName().trim()}
                      >
                        Save
                      </button>
                      <button
                        class="px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
