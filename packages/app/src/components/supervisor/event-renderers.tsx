import { For, Match, Show, Switch, createSignal } from "solid-js"
import type { SupervisorEvent, JsonValue } from "@zulip/desktop/bindings"

// ── Main event dispatcher ──

export function EventItem(props: { event: SupervisorEvent }) {
  return (
    <Switch fallback={<MessageEvent event={props.event} />}>
      <Match when={props.event.kind === "thinking"}>
        <ThinkingEvent event={props.event} />
      </Match>
      <Match when={props.event.kind === "tool_call"}>
        <ToolEvent event={props.event} type="call" />
      </Match>
      <Match when={props.event.kind === "tool_result"}>
        <ToolEvent event={props.event} type="result" />
      </Match>
      <Match when={props.event.kind === "dispatch_result"}>
        <DispatchEvent event={props.event} />
      </Match>
      <Match when={props.event.kind === "plan_draft"}>
        <PlanDraftEvent event={props.event} />
      </Match>
    </Switch>
  )
}

// ── Message bubble ──

function MessageEvent(props: { event: SupervisorEvent }) {
  const isUser = () => props.event.role === "user"
  const isLocal = () => props.event.id < 0

  return (
    <div class={`mb-2 ${isUser() ? "flex justify-end" : ""}`}>
      <div
        class={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser()
            ? "bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)]"
            : "bg-[var(--background-elevated)] text-[var(--text-primary)]"
        } ${isLocal() ? "opacity-60" : ""}`}
      >
        <Show when={!isUser() && props.event.author_name}>
          <div class="text-[10px] font-medium text-[var(--text-secondary)] mb-1">
            {props.event.author_name}
          </div>
        </Show>
        <div
          class="supervisor-content whitespace-pre-wrap break-words"
          data-component="message-content"
          innerHTML={renderMarkdown(props.event.content_md || "")}
        />
      </div>
    </div>
  )
}

// ── Thinking event (collapsible) ──

function ThinkingEvent(props: { event: SupervisorEvent }) {
  return (
    <details class="mb-2 group">
      <summary class="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] list-none">
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          class="transition-transform group-open:rotate-90"
        >
          <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="italic">Thinking</span>
        <TraceFields payload={props.event.payload} />
      </summary>
      <div class="ml-4 mt-1 text-xs text-[var(--text-tertiary)] italic whitespace-pre-wrap max-h-[200px] overflow-y-auto">
        {props.event.content_md || "..."}
      </div>
    </details>
  )
}

// ── Tool call/result event ──

function ToolEvent(props: { event: SupervisorEvent; type: "call" | "result" }) {
  const payload = () => (props.event.payload || {}) as Record<string, JsonValue>
  const toolName = () => extractString(payload(), "tool") || extractString(payload(), "name") || "tool"
  const statusIcon = () => {
    if (props.type === "call") return "→"
    const content = props.event.content_md || ""
    const err = extractString(payload(), "error")
    if (err) return "✗"
    if (/success|complete|done/i.test(content)) return "✓"
    return "→"
  }
  const statusColor = () => {
    const icon = statusIcon()
    if (icon === "✗") return "text-[var(--status-error)]"
    if (icon === "✓") return "text-[var(--status-success)]"
    return "text-[var(--status-info)]"
  }

  return (
    <details class="mb-2 group">
      <summary class="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] list-none">
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          class="transition-transform group-open:rotate-90"
        >
          <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class={`font-mono ${statusColor()}`}>{statusIcon()}</span>
        <span class="font-mono">{toolName()}</span>
        <TraceFields payload={props.event.payload} />
      </summary>
      <div class="ml-4 mt-1 text-xs text-[var(--text-tertiary)] whitespace-pre-wrap max-h-[200px] overflow-y-auto font-mono">
        {props.event.content_md || JSON.stringify(payload(), null, 2)}
      </div>
    </details>
  )
}

// ── Dispatch result (task cards) ──

function DispatchEvent(props: { event: SupervisorEvent }) {
  const payload = () => (props.event.payload || {}) as Record<string, JsonValue>
  const tasks = () => {
    const t = payload()?.tasks
    if (Array.isArray(t)) return t as Record<string, JsonValue>[]
    return []
  }

  return (
    <div class="mb-2 rounded-lg border border-[var(--border-default)] bg-[var(--background-elevated)] p-2">
      <div class="text-xs font-medium text-[var(--text-secondary)] mb-1">
        Task Dispatch ({tasks().length} tasks)
      </div>
      <Show when={props.event.content_md}>
        <div class="text-xs text-[var(--text-tertiary)] mb-1 whitespace-pre-wrap">
          {props.event.content_md}
        </div>
      </Show>
      <Show when={tasks().length > 0}>
        <div class="space-y-1">
          <For each={tasks()}>
            {(task) => (
              <div class="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] shrink-0" />
                <span class="truncate">{extractString(task, "title") || "Task"}</span>
                <span class="text-[var(--text-tertiary)]">{extractString(task, "assigned_role") || ""}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Plan draft event ──

function PlanDraftEvent(props: { event: SupervisorEvent }) {
  return (
    <div class="mb-2 rounded-lg border border-[var(--status-info)]/30 bg-[var(--status-info)]/5 p-2">
      <div class="text-xs font-medium text-[var(--status-info)] mb-1">Plan Draft</div>
      <div
        class="text-xs text-[var(--text-primary)] whitespace-pre-wrap"
        data-component="message-content"
        innerHTML={renderMarkdown(props.event.content_md || "")}
      />
    </div>
  )
}

// ── Trace fields (engine, model, etc.) ──

function TraceFields(props: { payload: JsonValue | undefined }) {
  const fields = () => {
    if (!props.payload || typeof props.payload !== "object" || Array.isArray(props.payload)) return []
    const p = props.payload as Record<string, JsonValue>
    const items: string[] = []
    const engine = extractString(p, "engine")
    const model = extractString(p, "model")
    const intent = extractString(p, "intent")
    if (engine) items.push(engine)
    if (model) items.push(model)
    if (intent) items.push(intent)
    return items
  }

  return (
    <Show when={fields().length > 0}>
      <span class="text-[10px] text-[var(--text-tertiary)]">
        {fields().join(" · ")}
      </span>
    </Show>
  )
}

// ── Utilities ──

function extractString(obj: Record<string, JsonValue> | undefined, key: string): string | undefined {
  if (!obj) return undefined
  const val = obj[key]
  if (typeof val === "string") return val
  return undefined
}

/**
 * Simple markdown rendering: bold, italic, code blocks, inline code, links.
 * Full markdown library can be added later if needed.
 */
function renderMarkdown(text: string): string {
  if (!text) return ""

  let html = escapeHtml(text)

  // Code blocks: ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre class="bg-[var(--background-base)] rounded px-2 py-1.5 my-1 overflow-x-auto text-[11px] font-mono"><code>${code}</code></pre>`
  })

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code class="bg-[var(--background-base)] rounded px-1 py-0.5 text-[11px] font-mono">$1</code>')

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")

  // Italic: *...*
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>")

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-[var(--interactive-primary)] underline" target="_blank" rel="noopener">$1</a>')

  // Line breaks
  html = html.replace(/\n/g, "<br>")

  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
