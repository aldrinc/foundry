import { commands } from "@zulip/desktop/bindings";
import DOMPurify from "dompurify";
import { createSignal, For, Show } from "solid-js";
import { useNavigation } from "../context/navigation";
import { useOrg } from "../context/org";
import type { Message } from "../context/zulip-sync";
import { useZulipSync } from "../context/zulip-sync";

export function SearchBar(props: { onClose?: () => void }) {
  const org = useOrg();
  const nav = useNavigation();
  const sync = useZulipSync();

  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Message[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [showResults, setShowResults] = createSignal(false);

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let inputRef!: HTMLInputElement;
  const resultCache = new Map<string, Message[]>();
  let activeSearchToken = 0;

  const sanitizeSnippet = (html: string) =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["p", "br", "strong", "em", "code", "span", "mark"],
      ALLOWED_ATTR: ["class"],
    });

  const handleInput = (value: string) => {
    setQuery(value);
    if (searchTimer) clearTimeout(searchTimer);

    const trimmed = value.trim();
    if (!trimmed) {
      setResults([]);
      setShowResults(false);
      return;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setShowResults(true);
      return;
    }

    searchTimer = setTimeout(() => doSearch(trimmed), 300);
  };

  const doSearch = async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    const cached = resultCache.get(q);
    if (cached) {
      setResults(cached);
      setShowResults(true);
      return;
    }

    const searchToken = ++activeSearchToken;
    setSearching(true);
    setShowResults(true);
    try {
      const result = await commands.getMessages(
        org.orgId,
        [{ operator: "search", operand: q }],
        "newest",
        20,
        0,
      );
      if (result.status === "ok") {
        if (searchToken !== activeSearchToken) return;
        resultCache.set(q, result.data.messages);
        setResults(result.data.messages);
      }
    } finally {
      if (searchToken === activeSearchToken) {
        setSearching(false);
      }
    }
  };

  const handleResultClick = (msg: Message) => {
    setShowResults(false);
    setQuery("");
    if (msg.stream_id) {
      nav.setActiveNarrow(`stream:${msg.stream_id}/topic:${msg.subject}`);
    }
    props.onClose?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowResults(false);
      setQuery("");
      props.onClose?.();
    }
  };

  return (
    <div class="relative" data-component="search-bar">
      <input
        ref={inputRef!}
        type="text"
        placeholder="Search messages..."
        value={query()}
        onInput={(e) => handleInput(e.currentTarget.value)}
        onFocus={() => {
          if (query().trim()) setShowResults(true);
        }}
        onKeyDown={handleKeyDown}
        autofocus
        class="w-full px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
      />

      <Show when={showResults()}>
        <div class="absolute top-full left-0 right-0 mt-1 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-md max-h-[400px] overflow-y-auto z-50">
          <Show when={searching()}>
            <div class="p-3 text-xs text-[var(--text-tertiary)] text-center">
              Searching...
            </div>
          </Show>

          <Show
            when={
              !searching() &&
              query().trim().length > 0 &&
              query().trim().length < 2
            }
          >
            <div class="p-3 text-xs text-[var(--text-tertiary)] text-center">
              Type at least 2 characters
            </div>
          </Show>

          <Show
            when={
              !searching() &&
              results().length === 0 &&
              query().trim().length >= 2
            }
          >
            <div class="p-3 text-xs text-[var(--text-tertiary)] text-center">
              No results found
            </div>
          </Show>

          <For each={results()}>
            {(msg) => {
              const stream = () =>
                sync.store.subscriptions.find(
                  (s) => s.stream_id === msg.stream_id,
                );
              return (
                <button
                  class="w-full text-left px-3 py-2 hover:bg-[var(--background-elevated)] transition-colors border-b border-[var(--border-default)] last:border-b-0"
                  onClick={() => handleResultClick(msg)}
                >
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <Show when={stream()}>
                      {(s) => (
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{
                            "background-color":
                              s().color || "var(--text-tertiary)",
                          }}
                        />
                      )}
                    </Show>
                    <span class="text-[10px] text-[var(--text-secondary)] truncate">
                      {stream()?.name || ""} &gt; {msg.subject}
                    </span>
                    <span class="text-[10px] text-[var(--text-tertiary)] ml-auto shrink-0">
                      {msg.sender_full_name}
                    </span>
                  </div>
                  <div
                    class="text-xs text-[var(--text-primary)] truncate"
                    innerHTML={sanitizeSnippet(msg.content)}
                  />
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
