import { createSignal, For, Show } from "solid-js";
export function SettingsLinkifiers() {
    const [linkifiers, setLinkifiers] = createSignal([]);
    const [showCreate, setShowCreate] = createSignal(false);
    const [newPattern, setNewPattern] = createSignal("");
    const [newUrl, setNewUrl] = createSignal("");
    const handleCreate = () => {
        if (!newPattern().trim() || !newUrl().trim())
            return;
        setLinkifiers(prev => [...prev, {
                id: Date.now(),
                pattern: newPattern().trim(),
                urlTemplate: newUrl().trim(),
            }]);
        setNewPattern("");
        setNewUrl("");
        setShowCreate(false);
    };
    const handleRemove = (id) => {
        setLinkifiers(prev => prev.filter(l => l.id !== id));
    };
    return (<div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Linkifiers</h3>
        <button class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity" onClick={() => setShowCreate(s => !s)}>
          {showCreate() ? "Cancel" : "Add linkifier"}
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        Linkifiers automatically turn patterns in messages into links. For example, <code class="text-[var(--text-secondary)]">#123</code> could link to issue #123 in your issue tracker.
      </p>

      {/* Create form */}
      <Show when={showCreate()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Pattern</label>
            <input type="text" class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono" placeholder="#(?P<id>[0-9]+)" value={newPattern()} onInput={(e) => setNewPattern(e.currentTarget.value)}/>
          </div>
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">URL template</label>
            <input type="text" class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono" placeholder="https://github.com/org/repo/issues/{id}" value={newUrl()} onInput={(e) => setNewUrl(e.currentTarget.value)}/>
          </div>
          <button class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50" onClick={handleCreate} disabled={!newPattern().trim() || !newUrl().trim()}>
            Add
          </button>
        </div>
      </Show>

      <Show when={linkifiers().length > 0} fallback={<div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No linkifiers configured</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Add linkifiers to auto-link patterns like issue numbers
            </div>
          </div>}>
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={linkifiers()}>
            {(linkifier) => (<div class="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)] last:border-b-0">
                <div class="min-w-0">
                  <div class="text-xs font-mono text-[var(--text-primary)] truncate">{linkifier.pattern}</div>
                  <div class="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5 truncate">{linkifier.urlTemplate}</div>
                </div>
                <button class="text-[10px] text-[var(--status-error)] hover:underline shrink-0 ml-2" onClick={() => handleRemove(linkifier.id)}>
                  Remove
                </button>
              </div>)}
          </For>
        </div>
      </Show>
    </div>);
}
