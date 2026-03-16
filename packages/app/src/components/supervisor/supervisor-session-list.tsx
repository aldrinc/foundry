import { For, Show, createSignal, createMemo } from "solid-js"
import { useSupervisor } from "../../context/supervisor"
import {
  sessionSubtitle,
} from "./supervisor-session-meta"

function sessionTitle(session: any) {
  return session?.metadata?.title || session?.metadata?.created_by_name || session?.session_id || "Session"
}

export function SupervisorSessionList() {
  const supervisor = useSupervisor()
  const [expanded, setExpanded] = createSignal(false)
  const [search, setSearch] = createSignal("")

  const isSelected = (sessionId: string) => {
    return !supervisor.store.draftingNewSession && supervisor.store.selectedSessionId === sessionId
  }

  const visibleSessions = createMemo(() => {
    return supervisor.store.sessions.slice(0, 2)
  })

  const filteredSessions = createMemo(() => {
    const q = search().toLowerCase().trim()
    if (!q) return supervisor.store.sessions
    return supervisor.store.sessions.filter((s: any) => {
      const title = sessionTitle(s).toLowerCase()
      const subtitle = sessionSubtitle(s).toLowerCase()
      return title.includes(q) || subtitle.includes(q)
    })
  })

  const handleSelect = (sessionId: string) => {
    supervisor.selectSession(sessionId)
    setExpanded(false)
    setSearch("")
  }

  const handleNewTask = () => {
    supervisor.startNewSession()
    setExpanded(false)
    setSearch("")
  }

  return (
    <div class="relative border-b border-[var(--border-default)]" data-component="supervisor-session-bar">
      {/* Horizontal bar */}
      <div class="flex items-center gap-1.5 px-3 py-2">
        <div class="flex items-center gap-1.5 flex-1 min-w-0">
          {/* Show up to 2 session pills */}
          <Show when={supervisor.store.draftingNewSession}>
            <button
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 text-[var(--text-primary)] truncate max-w-[140px]"
            >
              <div class="w-1.5 h-1.5 rounded-full bg-[var(--status-info)] shrink-0" />
              <span class="truncate">New draft</span>
            </button>
          </Show>

          <For each={visibleSessions()}>
            {(session) => (
              <button
                onClick={() => handleSelect(session.session_id)}
                class={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border truncate max-w-[160px] transition-colors ${
                  isSelected(session.session_id)
                    ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 text-[var(--text-primary)]"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${session.status === "active" ? "bg-[var(--status-success)]" : "bg-[var(--text-tertiary)]"}`} />
                <span class="truncate">{sessionTitle(session)}</span>
              </button>
            )}
          </For>

          {/* Expand/browse button */}
          <Show when={supervisor.store.sessions.length > 2 || supervisor.store.sessions.length > 0}>
            <button
              onClick={() => setExpanded(!expanded())}
              class={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                expanded()
                  ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 text-[var(--text-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--background-elevated)]"
              }`}
              title="Browse sessions"
            >
              <Show when={supervisor.store.sessions.length > 2}>
                <span>+{supervisor.store.sessions.length - 2}</span>
              </Show>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" class={`transition-transform ${expanded() ? "rotate-180" : ""}`}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </Show>
        </div>

        {/* New task button */}
        <button
          onClick={handleNewTask}
          class="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors shrink-0"
          title="New task"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <span>New</span>
        </button>
      </div>

      {/* Dropdown panel */}
      <Show when={expanded()}>
        <div class="absolute left-0 right-0 top-full z-50 border-b border-[var(--border-default)] bg-[var(--background-elevated)] shadow-lg">
          {/* Search input */}
          <div class="px-3 py-2 border-b border-[var(--border-default)]">
            <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--background-base)] border border-[var(--border-default)]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="shrink-0 text-[var(--text-tertiary)]">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search sessions..."
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
                autofocus
              />
            </div>
          </div>

          {/* Session list */}
          <div class="max-h-[240px] overflow-y-auto py-1">
            <button
              onClick={handleNewTask}
              class={`w-full px-3 py-2 text-left flex items-center gap-2 text-xs transition-colors hover:bg-[var(--background-surface)] ${
                supervisor.store.draftingNewSession ? "bg-[var(--interactive-primary)]/10" : ""
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="shrink-0 text-[var(--text-tertiary)]">
                <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
              <div>
                <div class="font-medium text-[var(--text-primary)]">New task</div>
                <div class="text-[var(--text-tertiary)] text-[10px]">Start a new supervisor session</div>
              </div>
            </button>

            <For each={filteredSessions()}>
              {(session) => (
                <button
                  onClick={() => handleSelect(session.session_id)}
                  class={`w-full px-3 py-2 text-left flex items-center gap-2 text-xs transition-colors hover:bg-[var(--background-surface)] ${
                    isSelected(session.session_id) ? "bg-[var(--interactive-primary)]/10" : ""
                  }`}
                >
                  <div class={`w-2 h-2 rounded-full shrink-0 ${session.status === "active" ? "bg-[var(--status-success)]" : "bg-[var(--text-tertiary)]"}`} />
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-[var(--text-primary)] truncate">{sessionTitle(session)}</div>
                    <div class="text-[var(--text-tertiary)] text-[10px] truncate">{sessionSubtitle(session)}</div>
                  </div>
                </button>
              )}
            </For>

            <Show when={filteredSessions().length === 0 && search()}>
              <div class="px-3 py-4 text-xs text-[var(--text-tertiary)] text-center">
                No sessions match "{search()}"
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
