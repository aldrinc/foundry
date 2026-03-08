import { createSignal, onMount, For, Show } from "solid-js"
import { useOrg } from "../context/org"
import { commands } from "@zulip/desktop/bindings"
import type { Linkifier } from "@zulip/desktop/bindings"

export function SettingsLinkifiers() {
  const org = useOrg()
  const [linkifiers, setLinkifiers] = createSignal<Linkifier[]>([])
  const [showCreate, setShowCreate] = createSignal(false)
  const [newPattern, setNewPattern] = createSignal("")
  const [newUrl, setNewUrl] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [editPattern, setEditPattern] = createSignal("")
  const [editUrl, setEditUrl] = createSignal("")
  const [confirmDelete, setConfirmDelete] = createSignal<number | null>(null)

  const fetchLinkifiers = async () => {
    const result = await commands.getLinkifiers(org.orgId)
    if (result.status === "ok") {
      setLinkifiers(result.data)
    }
  }

  onMount(() => { void fetchLinkifiers() })

  const handleCreate = async () => {
    if (!newPattern().trim() || !newUrl().trim()) return
    setCreating(true)
    setError("")
    const result = await commands.createLinkifier(org.orgId, newPattern().trim(), newUrl().trim())
    setCreating(false)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setNewPattern("")
    setNewUrl("")
    setShowCreate(false)
    fetchLinkifiers()
  }

  const handleStartEdit = (linkifier: Linkifier) => {
    setEditingId(linkifier.id)
    setEditPattern(linkifier.pattern)
    setEditUrl(linkifier.url_template)
  }

  const handleSaveEdit = async () => {
    const id = editingId()
    if (!id || !editPattern().trim() || !editUrl().trim()) return
    setError("")
    const result = await commands.updateLinkifier(org.orgId, id, editPattern().trim(), editUrl().trim())
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setEditingId(null)
    fetchLinkifiers()
  }

  const handleDelete = async (filterId: number) => {
    if (confirmDelete() !== filterId) {
      setConfirmDelete(filterId)
      setTimeout(() => setConfirmDelete(null), 3000)
      return
    }
    setError("")
    const result = await commands.deleteLinkifier(org.orgId, filterId)
    if (result.status === "error") {
      setError(result.error)
      return
    }
    setConfirmDelete(null)
    fetchLinkifiers()
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Linkifiers</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowCreate(s => !s)}
        >
          {showCreate() ? "Cancel" : "Add linkifier"}
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        Linkifiers automatically turn patterns in messages into links. For example, <code class="text-[var(--text-secondary)]">#123</code> could link to issue #123 in your issue tracker.
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
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Pattern</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono"
              placeholder={"#(?P<id>[0-9]+)"}
              value={newPattern()}
              onInput={(e) => setNewPattern(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">URL template</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono"
              placeholder="https://github.com/org/repo/issues/{id}"
              value={newUrl()}
              onInput={(e) => setNewUrl(e.currentTarget.value)}
            />
          </div>
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleCreate}
            disabled={!newPattern().trim() || !newUrl().trim() || creating()}
          >
            {creating() ? "Adding..." : "Add"}
          </button>
        </div>
      </Show>

      <Show
        when={linkifiers().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No linkifiers configured</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Add linkifiers to auto-link patterns like issue numbers
            </div>
          </div>
        }
      >
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={linkifiers()}>
            {(linkifier) => (
              <div class="border-b border-[var(--border-default)] last:border-b-0">
                <Show
                  when={editingId() === linkifier.id}
                  fallback={
                    <div class="flex items-center justify-between px-3 py-2.5">
                      <div class="min-w-0">
                        <div class="text-xs font-mono text-[var(--text-primary)] truncate">{linkifier.pattern}</div>
                        <div class="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5 truncate">{linkifier.url_template}</div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0 ml-2">
                        <button
                          class="text-[10px] text-[var(--interactive-primary)] hover:underline"
                          onClick={() => handleStartEdit(linkifier)}
                        >
                          Edit
                        </button>
                        <button
                          class={`text-[10px] hover:underline ${confirmDelete() === linkifier.id ? "text-[var(--status-error)] font-medium" : "text-[var(--status-error)]"}`}
                          onClick={() => handleDelete(linkifier.id)}
                        >
                          {confirmDelete() === linkifier.id ? "Confirm?" : "Remove"}
                        </button>
                      </div>
                    </div>
                  }
                >
                  {/* Inline edit */}
                  <div class="px-3 py-2.5 space-y-2 bg-[var(--background-base)]">
                    <input
                      type="text"
                      class="w-full text-xs font-mono bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                      value={editPattern()}
                      onInput={(e) => setEditPattern(e.currentTarget.value)}
                      placeholder="Pattern"
                    />
                    <input
                      type="text"
                      class="w-full text-xs font-mono bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                      value={editUrl()}
                      onInput={(e) => setEditUrl(e.currentTarget.value)}
                      placeholder="URL template"
                    />
                    <div class="flex gap-2">
                      <button
                        class="px-2 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
                        onClick={handleSaveEdit}
                        disabled={!editPattern().trim() || !editUrl().trim()}
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
