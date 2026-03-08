import { createSignal, For, Show } from "solid-js";
export function SettingsBots() {
    const [bots, setBots] = createSignal([]);
    const [tab, setTab] = createSignal("yours");
    const [showCreate, setShowCreate] = createSignal(false);
    const [newName, setNewName] = createSignal("");
    const [newType, setNewType] = createSignal("incoming");
    return (<div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Bots</h3>
        <button class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity" onClick={() => setShowCreate(s => !s)}>
          {showCreate() ? "Cancel" : "Create bot"}
        </button>
      </div>

      {/* Tabs */}
      <div class="flex gap-4 border-b border-[var(--border-default)]">
        <button onClick={() => setTab("yours")} class={`pb-2 text-xs transition-colors ${tab() === "yours"
            ? "text-[var(--interactive-primary)] border-b-2 border-[var(--interactive-primary)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
          Your bots
        </button>
        <button onClick={() => setTab("all")} class={`pb-2 text-xs transition-colors ${tab() === "all"
            ? "text-[var(--interactive-primary)] border-b-2 border-[var(--interactive-primary)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
          All bots
        </button>
      </div>

      {/* Create form */}
      <Show when={showCreate()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Bot name</label>
            <input type="text" class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]" placeholder="e.g. CI Bot" value={newName()} onInput={(e) => setNewName(e.currentTarget.value)}/>
          </div>
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Type</label>
            <select class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]" value={newType()} onChange={(e) => setNewType(e.currentTarget.value)}>
              <option value="incoming">Incoming webhook</option>
              <option value="outgoing">Outgoing webhook</option>
            </select>
          </div>
          <button class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50" disabled={!newName().trim()}>
            Create bot
          </button>
        </div>
      </Show>

      {/* Bot list */}
      <Show when={bots().length > 0} fallback={<div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No bots</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Create a bot to integrate with external services
            </div>
          </div>}>
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={bots()}>
            {(bot) => (<div class="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-7 h-7 rounded-full bg-[var(--text-tertiary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <rect x="3" y="2" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/>
                      <circle cx="5.5" cy="5" r="0.8" fill="currentColor"/>
                      <circle cx="8.5" cy="5" r="0.8" fill="currentColor"/>
                      <path d="M4 8v2M10 8v2M6 8v3h2V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-[var(--text-primary)] truncate">{bot.name}</div>
                    <div class="text-[10px] text-[var(--text-tertiary)] truncate">{bot.email}</div>
                  </div>
                </div>
                <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded">
                  {bot.type}
                </span>
              </div>)}
          </For>
        </div>
      </Show>
    </div>);
}
