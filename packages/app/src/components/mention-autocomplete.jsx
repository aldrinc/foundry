import { createMemo, For, Show, createSignal, createEffect } from "solid-js";
import { useZulipSync } from "../context/zulip-sync";
/**
 * MentionAutocomplete — floating autocomplete panel for @mentions and #stream links.
 * Shows when the user types `@` or `#` in the compose box.
 */
export function MentionAutocomplete(props) {
    const sync = useZulipSync();
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    // Filter users or streams based on query
    const userResults = createMemo(() => {
        if (props.type !== "user")
            return [];
        const q = props.query.toLowerCase();
        return sync.store.users
            .filter(u => {
            if (u.is_bot)
                return false;
            if (!q)
                return true;
            return u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
        })
            .slice(0, 8);
    });
    const streamResults = createMemo(() => {
        if (props.type !== "stream")
            return [];
        const q = props.query.toLowerCase();
        return sync.store.subscriptions
            .filter(s => {
            if (!q)
                return true;
            return s.name.toLowerCase().includes(q);
        })
            .slice(0, 8);
    });
    const results = () => props.type === "user" ? userResults() : streamResults();
    const resultCount = () => results().length;
    // Reset selection when query changes
    createEffect(() => {
        const _ = props.query;
        setSelectedIndex(0);
    });
    const handleKeyDown = (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, resultCount() - 1));
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        }
        else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const idx = selectedIndex();
            const items = results();
            if (idx < items.length) {
                selectItem(items[idx]);
            }
        }
        else if (e.key === "Escape") {
            props.onClose();
        }
    };
    const selectItem = (item) => {
        if (props.type === "user") {
            const user = item;
            props.onSelect(`**${user.full_name}** `);
        }
        else {
            const stream = item;
            props.onSelect(`**${stream.name}** `);
        }
    };
    window.__mentionAutocompleteKeyDown = handleKeyDown;
    return (<Show when={resultCount() > 0}>
      <div class="absolute z-50 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-md overflow-hidden min-w-[200px] max-w-[300px]" style={{
            bottom: `${(props.position?.top ?? 0) + 4}px`,
            left: `${props.position?.left ?? 0}px`,
        }} data-component="mention-autocomplete">
        <div class="py-1 max-h-[200px] overflow-y-auto">
          <For each={results()}>
            {(item, idx) => {
            if (props.type === "user") {
                const user = item;
                return (<button class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors" classList={{
                        "bg-[var(--interactive-primary)]/10": selectedIndex() === idx(),
                        "hover:bg-[var(--background-elevated)]": selectedIndex() !== idx(),
                    }} onClick={() => selectItem(user)} onMouseEnter={() => setSelectedIndex(idx())}>
                    <div class="w-5 h-5 rounded-full bg-[var(--background-elevated)] flex items-center justify-center text-[9px] font-medium text-[var(--text-secondary)] shrink-0">
                      {user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="text-xs text-[var(--text-primary)] truncate block">{user.full_name}</span>
                      <span class="text-[10px] text-[var(--text-tertiary)] truncate block">{user.email}</span>
                    </div>
                  </button>);
            }
            else {
                const stream = item;
                return (<button class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors" classList={{
                        "bg-[var(--interactive-primary)]/10": selectedIndex() === idx(),
                        "hover:bg-[var(--background-elevated)]": selectedIndex() !== idx(),
                    }} onClick={() => selectItem(stream)} onMouseEnter={() => setSelectedIndex(idx())}>
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" style={{ "background-color": stream.color || "var(--text-tertiary)" }}/>
                    <span class="text-xs text-[var(--text-primary)] truncate">{stream.name}</span>
                  </button>);
            }
        }}
          </For>
        </div>
      </div>
    </Show>);
}
