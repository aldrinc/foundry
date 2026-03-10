import $ from "jquery";
import _ from "lodash";

import * as channel from "./channel.ts";
import * as compose_state from "./compose_state.ts";
import * as hash_util from "./hash_util.ts";
import * as markdown from "./markdown.ts";
import * as narrow_state from "./narrow_state.ts";
import * as rendered_markdown from "./rendered_markdown.ts";
import * as sidebar_ui from "./sidebar_ui.ts";
import * as stream_data from "./stream_data.ts";
import * as ui_report from "./ui_report.ts";

type TopicContext = {
    stream_id: number;
    stream_name: string;
    topic: string;
    topic_scope_id: string;
};

type SupervisorSession = {
    session_id: string;
    topic_scope_id: string;
    status: string;
    updated_at: string;
    metadata: Record<string, unknown>;
};

type SupervisorEvent = {
    id: number;
    topic_scope_id: string;
    session_id: string;
    ts: string;
    kind: string;
    role: string;
    author_id: string;
    author_name: string;
    content_md: string;
    payload: Record<string, unknown>;
    client_msg_id: string;
};

type TaskEntry = {
    task_id: string;
    title: string;
    assigned_role: string;
    status: string;
    activity: string;
    last_updated: number;
};

type TaskSummary = {
    active_plan_revision_id: string;
    filtered_plan_revision_id: string;
    tasks: TaskEntry[];
};

type SidebarState = {
    initialized: boolean;
    active_tab: "users" | "ai";
    context: TopicContext | null;
    session: SupervisorSession | null;
    current_plan_revision_id: string;
    after_id: number;
    seen_event_ids: Set<number>;
    poll_timer: number | null;
    request_in_flight: boolean;
    sending_message: boolean;
    disconnected: boolean;
    poll_failure_count: number;
    last_status_message: string;
    last_live_message: string;
    last_thinking_preview: string;
    last_thinking_event_ms: number;
    pending_user_echoes: Map<string, number>;
    next_local_event_id: number;
    pending_attachments: File[];
    task_registry: Map<string, TaskEntry>;
};

const state: SidebarState = {
    initialized: false,
    active_tab: "users",
    context: null,
    session: null,
    current_plan_revision_id: "",
    after_id: 0,
    seen_event_ids: new Set<number>(),
    poll_timer: null,
    request_in_flight: false,
    sending_message: false,
    disconnected: false,
    poll_failure_count: 0,
    last_status_message: "",
    last_live_message: "",
    last_thinking_preview: "",
    last_thinking_event_ms: 0,
    pending_user_echoes: new Map<string, number>(),
    next_local_event_id: -1,
    pending_attachments: [],
    task_registry: new Map<string, TaskEntry>(),
};

const POLL_INTERVAL_MS = 1200;
const POLL_WARNING_THRESHOLD = 5;
const LIVE_THINKING_FRESH_MS = 22000;
const SUPERVISOR_AI_OPEN_BODY_CLASS = "foundry-supervisor-ai-open";

function as_record(value: unknown): Record<string, unknown> | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        out[key] = item;
    }
    return out;
}

function as_string(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    try {
        return JSON.stringify(value) ?? "";
    } catch {
        return "";
    }
}

function as_number(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function topic_scope_id_for(stream_id: number, topic: string): string {
    return `stream_id:${stream_id}:topic:${topic}`.toLowerCase();
}

function fallback_topic_from_hash(hash: string): string {
    const match = /\/topic\/([^/]+)/.exec(hash);
    if (!match || !match[1]) {
        return "";
    }
    const dot_encoded = match[1].replace(/\.([0-9A-Fa-f]{2})/g, "%$1");
    try {
        return decodeURIComponent(dot_encoded).trim();
    } catch {
        return "";
    }
}

function fallback_context_from_hash(hash: string): TopicContext | undefined {
    const match = /\/channel\/(\d+)(?:-([^/]+))?\/topic\/([^/]*)/.exec(hash);
    if (!match) {
        return undefined;
    }
    const stream_id = Number.parseInt(match[1] ?? "", 10);
    if (Number.isNaN(stream_id)) {
        return undefined;
    }
    const encoded_topic = match[3] ?? "";
    const topic = fallback_topic_from_hash(`/topic/${encoded_topic}`);
    const stream = stream_data.get_sub_by_id(stream_id);
    let stream_name = stream?.name ?? "";
    if (!stream_name) {
        const encoded_slug = match[2] ?? "";
        const slug = encoded_slug.replace(/\.([0-9A-Fa-f]{2})/g, "%$1");
        try {
            stream_name = decodeURIComponent(slug).trim();
        } catch {
            stream_name = "";
        }
    }
    return {
        stream_id,
        stream_name,
        topic,
        topic_scope_id: topic_scope_id_for(stream_id, topic),
    };
}

function topic_context_from_hash(hash: string): TopicContext | undefined {
    const decoded = hash_util.decode_stream_topic_from_url(hash);
    if (decoded?.topic_name !== undefined) {
        const topic_name = decoded.topic_name;
        const stream = stream_data.get_sub_by_id(decoded.stream_id);
        return {
            stream_id: decoded.stream_id,
            stream_name: stream?.name ?? "",
            topic: topic_name,
            topic_scope_id: topic_scope_id_for(decoded.stream_id, topic_name),
        };
    }
    return fallback_context_from_hash(hash);
}

function current_topic_context(): TopicContext | undefined {
    const by_hash = topic_context_from_hash(window.location.hash);
    if (by_hash) {
        return by_hash;
    }
    const stream_id = narrow_state.stream_id();
    const topic = narrow_state.topic();
    if (stream_id !== undefined && topic) {
        const stream = stream_data.get_sub_by_id(stream_id);
        return {
            stream_id,
            stream_name: stream?.name ?? "",
            topic,
            topic_scope_id: topic_scope_id_for(stream_id, topic),
        };
    }

    if (compose_state.get_message_type() === "stream") {
        const compose_stream_id = compose_state.stream_id();
        if (compose_stream_id !== undefined) {
            const compose_topic = compose_state.topic();
            if (compose_topic) {
                const stream = stream_data.get_sub_by_id(compose_stream_id);
                return {
                    stream_id: compose_stream_id,
                    stream_name: stream?.name ?? compose_state.stream_name(),
                    topic: compose_topic,
                    topic_scope_id: topic_scope_id_for(compose_stream_id, compose_topic),
                };
            }
        }
    }
    return undefined;
}

function make_client_msg_id(): string {
    const rand = Math.random().toString(36).slice(2, 11);
    return `cmsg_${Date.now().toString(36)}_${rand}`;
}

function sanitize_markdown_text(message: string): string {
    let text = message.replaceAll("\r\n", "\n");
    text = text.replaceAll(/```(bash|sh|zsh|shell)\s+(?=\S)/g, "```$1\n");
    text = text.replaceAll(/```(bash|sh|zsh|shell)(?=[^\s\n])/g, "```$1\n");
    const fence_count = (text.match(/(^|\n)```/g) ?? []).length;
    if (fence_count % 2 === 1) {
        text = `${text.trimEnd()}\n\`\`\``;
    }
    return dedupe_supervisor_output(text);
}

function collapse_exact_double(text: string): string {
    const normalized = text.trim();
    if (!normalized || normalized.length < 10) {
        return text;
    }

    const exact_double = /^([\s\S]{80,}?)(?:\s*)\1$/.exec(normalized);
    if (exact_double?.[1]) {
        return exact_double[1].trim();
    }

    if (normalized.length % 2 === 0) {
        const half = normalized.length / 2;
        const first = normalized.slice(0, half);
        const second = normalized.slice(half);
        if (first && first === second) {
            return first.trim();
        }
    }
    return text;
}

function dedupe_supervisor_output(text: string): string {
    let normalized = collapse_exact_double(text);
    const lines = normalized.split("\n");
    const deduped: string[] = [];
    for (const line of lines) {
        const current = line.trim();
        const previous = deduped.length > 0 ? deduped.at(-1)!.trim() : "";
        if (current && current === previous) {
            continue;
        }
        deduped.push(line);
    }
    normalized = deduped.join("\n");
    return normalized;
}

function detect_code_language(block: HTMLElement): string {
    const code_el = block.querySelector("code");
    if (code_el) {
        for (const cls of code_el.classList) {
            const match = /^language-(.+)$/.exec(cls);
            if (match?.[1]) {
                return match[1];
            }
        }
    }
    const hilite = block.closest(".codehilite");
    if (hilite instanceof HTMLElement) {
        const lang = hilite.getAttribute("data-code-language");
        if (lang) {
            return lang;
        }
    }
    return "";
}

function decorate_markdown_code_blocks(root: HTMLElement): void {
    const code_blocks = [...root.querySelectorAll("pre")];
    for (const block of code_blocks) {
        const existing_parent = block.parentElement;
        if (!existing_parent) {
            continue;
        }
        let wrapper: HTMLElement;
        if (existing_parent.classList.contains("foundry-markdown-code")) {
            wrapper = existing_parent;
        } else {
            wrapper = document.createElement("div");
            wrapper.className = "foundry-markdown-code";
            block.replaceWith(wrapper);
            wrapper.append(block);
        }
        if (!wrapper.querySelector("[data-foundry-lang-label]")) {
            const lang = detect_code_language(block);
            if (lang) {
                const label = document.createElement("span");
                label.className = "foundry-code-lang-label";
                label.setAttribute("data-foundry-lang-label", "1");
                label.textContent = lang;
                wrapper.append(label);
            }
        }
        if (wrapper.querySelector("[data-foundry-markdown-copy]")) {
            continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "foundry-markdown-copy";
        button.setAttribute("data-foundry-markdown-copy", "1");
        button.setAttribute("aria-label", "Copy code block");
        button.innerHTML = '<i class="zulip-icon zulip-icon-copy" aria-hidden="true"></i>';
        wrapper.append(button);

        /* Annotate shell prompt lines for visual distinction */
        annotate_terminal_prompt_lines(block);
    }

    /* Remove Zulip-native copy buttons — we provide our own icon-based ones */
    for (const btn of root.querySelectorAll("button")) {
        if (
            btn instanceof HTMLElement &&
            !btn.classList.contains("foundry-markdown-copy") &&
            !btn.closest(".foundry-supervisor-composer-actions") &&
            !btn.closest(".foundry-supervisor-tool-trigger") &&
            !btn.closest(".foundry-task-dashboard-collapse") &&
            !btn.id
        ) {
            const text = btn.textContent?.trim() ?? "";
            if (text === "Copy" || text === "Copy code") {
                btn.remove();
            }
        }
    }
}

const SHELL_LANGUAGES = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);

function annotate_terminal_prompt_lines(block: HTMLElement): void {
    const lang = detect_code_language(block).toLowerCase();
    if (!SHELL_LANGUAGES.has(lang)) {
        return;
    }
    const code_el = block.querySelector("code") ?? block;
    const text = code_el.textContent ?? "";
    if (!text.trim()) {
        return;
    }
    const lines = text.split("\n");
    const html_parts: string[] = [];
    for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("$ ") || trimmed.startsWith("# ") || trimmed === "$") {
            html_parts.push(`<span class="foundry-terminal-prompt">${_.escape(line)}</span>`);
        } else {
            html_parts.push(_.escape(line));
        }
    }
    code_el.innerHTML = html_parts.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Shell-heavy content detection & collapsed card rendering           */
/* ------------------------------------------------------------------ */

function is_code_heavy_content(content: string): boolean {
    const fence_count = (content.match(/(^|\n)\s*```/g) ?? []).length;
    return fence_count >= 6; /* 3+ fenced code blocks (open+close = 2 each) */
}

function count_code_blocks_in_content(content: string): number {
    const fence_count = (content.match(/(^|\n)\s*```/g) ?? []).length;
    return Math.floor(fence_count / 2);
}

function first_narrative_line(content: string): string {
    const lines = content.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("#")) {
            continue;
        }
        if (trimmed.length < 8) {
            continue;
        }
        const clean = trimmed
            .replace(/^\*+\s*/, "")
            .replace(/\*+\s*$/, "")
            .replace(/^[-•]\s*/, "")
            .trim();
        if (clean.length < 8) {
            continue;
        }
        return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean;
    }
    return "Shell commands";
}

function render_shell_output_card(event: SupervisorEvent): JQuery {
    const summary = first_narrative_line(event.content_md);
    const block_count = count_code_blocks_in_content(event.content_md);
    const badge = `${block_count} cmd${block_count !== 1 ? "s" : ""}`;
    const html = `
<div class="foundry-supervisor-shell-output-card" data-supervisor-event-id="${event.id}">
  <details class="foundry-supervisor-tool-collapse">
    <summary class="foundry-supervisor-tool-trigger">
      <i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i>
      <span class="foundry-supervisor-tool-icon foundry-shell-icon">$</span>
      <span class="foundry-supervisor-tool-name">${_.escape(summary)}</span>
      <span class="foundry-supervisor-tool-status">${_.escape(badge)}</span>
    </summary>
    <div class="foundry-supervisor-tool-body">
      ${render_markdown(event.content_md)}
    </div>
  </details>
</div>`;
    const $node = $(html);
    rendered_markdown.update_elements($node);
    const root = $node.get(0);
    if (root) {
        decorate_markdown_code_blocks(root);
    }
    return $node;
}

function parse_session(value: unknown): SupervisorSession | null {
    const item = as_record(value);
    if (!item) {
        return null;
    }
    const session_id = as_string(item["session_id"]).trim();
    const topic_scope_id = as_string(item["topic_scope_id"]).trim();
    if (!session_id || !topic_scope_id) {
        return null;
    }
    return {
        session_id,
        topic_scope_id,
        status: as_string(item["status"]).trim() || "active",
        updated_at: as_string(item["updated_at"]).trim(),
        metadata: as_record(item["metadata"]) ?? {},
    };
}

function session_engine_label(session: SupervisorSession | null): string {
    if (!session) {
        return "";
    }
    const metadata = session.metadata ?? {};
    const engine = as_string(metadata["engine"]).trim().toLowerCase();
    if (engine === "moltis") {
        const model = as_string(metadata["moltis_model"]).trim();
        return model ? `moltis · ${model}` : "moltis";
    }
    return engine;
}

function parse_event(value: unknown): SupervisorEvent | null {
    const item = as_record(value);
    if (!item) {
        return null;
    }
    const id = as_number(item["id"]);
    const topic_scope_id = as_string(item["topic_scope_id"]).trim();
    const session_id = as_string(item["session_id"]).trim();
    if (id === undefined || !topic_scope_id || !session_id) {
        return null;
    }
    const payload = as_record(item["payload"]) ?? {};
    return {
        id,
        topic_scope_id,
        session_id,
        ts: as_string(item["ts"]),
        kind: as_string(item["kind"]) || "message",
        role: as_string(item["role"]) || "assistant",
        author_id: as_string(item["author_id"]),
        author_name: as_string(item["author_name"]),
        content_md: as_string(item["content_md"]),
        payload,
        client_msg_id: as_string(item["client_msg_id"]),
    };
}

function render_markdown(content: string): string {
    const source = sanitize_markdown_text(content || "(no content)");
    try {
        const rendered = markdown.parse_non_message(source);
        return `<div class="foundry-supervisor-content rendered_markdown">${rendered}</div>`;
    } catch {
        return `<div class="foundry-supervisor-content">${_.escape(source)}</div>`;
    }
}

function role_label(role: string): string {
    const normalized = role.trim().toLowerCase();
    if (normalized === "user") {
        return "Human";
    }
    if (normalized === "assistant") {
        return "Supervisor";
    }
    return normalized || "Event";
}

type TraceField = {
    label: string;
    value: string;
};

function payload_trace_fields(event: SupervisorEvent): TraceField[] {
    const payload = event.payload ?? {};
    const fields: TraceField[] = [];

    const push_field = (label: string, value: unknown): void => {
        const text = as_string(value).trim();
        if (!text) {
            return;
        }
        if (fields.some((item) => item.label === label && item.value === text)) {
            return;
        }
        fields.push({label, value: text});
    };

    push_field("Engine", payload["engine"]);
    if (event.kind === "tool_call" || event.kind === "tool_result") {
        push_field("Tool", payload["tool_name"] ?? payload["tool"]);
        if (typeof payload["topic_transcript_count"] === "number") {
            push_field("Thread msgs", payload["topic_transcript_count"]);
        }
    }
    push_field("Intent", payload["intent"] ?? payload["intent_hint"]);
    push_field("Model", payload["moltis_model_used"] ?? payload["moltis_model_requested"]);
    push_field("Run", payload["moltis_run_id"]);
    push_field("Plan", payload["plan_revision_id"]);
    if (typeof payload["topic_transcript_count"] === "number") {
        push_field("Thread msgs", payload["topic_transcript_count"]);
    }

    const tasks = Array.isArray(payload["tasks"]) ? payload["tasks"] : [];
    if (tasks.length > 0) {
        push_field("Tasks", String(tasks.length));
    }
    if (typeof payload["dispatch_blocked"] === "boolean") {
        push_field("Dispatch", payload["dispatch_blocked"] ? "blocked" : "ready");
    }

    const completion = as_record(payload["moltis_completion"]);
    if (completion) {
        const status = completion["ok"] === true ? "complete" : completion["active"] ? "active" : "";
        push_field("Run status", status || completion["error"]);
    }

    return fields.slice(0, 8);
}

function render_trace_fields(event: SupervisorEvent): string {
    const fields = payload_trace_fields(event);
    if (fields.length === 0) {
        return "";
    }
    const badges = fields
        .map(
            (field) =>
                `<span class="foundry-supervisor-trace-badge"><span class="foundry-supervisor-trace-label">${_.escape(field.label)}:</span> ${_.escape(field.value)}</span>`,
        )
        .join("");
    return `
<details class="foundry-supervisor-trace-collapse">
  <summary class="foundry-supervisor-trace-toggle"><i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i> ${fields.length} trace fields</summary>
  <div class="foundry-supervisor-traces">${badges}</div>
</details>`;
}

function render_dispatch_tasks(event: SupervisorEvent): string {
    const tasks = Array.isArray(event.payload?.["tasks"]) ? event.payload["tasks"] : [];
    if (tasks.length === 0) {
        return "";
    }
    const cards: string[] = [];
    for (const task of tasks.slice(0, 6)) {
        const item = as_record(task);
        if (!item) {
            continue;
        }
        const task_id = as_string(item["task_id"]).trim() || "task";
        const role = as_string(item["assigned_role"]).trim() || "worker";
        const status = as_string(item["status"]).trim() || "queued";
        cards.push(`
<article class="foundry-supervisor-tool-card" data-task-id="${_.escape(task_id)}">
  <div class="foundry-supervisor-tool-title">${_.escape(task_id)}</div>
  <div class="foundry-supervisor-tool-subtitle" data-task-role="${_.escape(role)}">${_.escape(role)} · ${_.escape(status)}</div>
</article>`);
    }
    if (cards.length === 0) {
        return "";
    }
    return `<div class="foundry-supervisor-tool-list">${cards.join("")}</div>`;
}

function payload_details_text(payload: Record<string, unknown>): string {
    const compact: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (key === "topic_transcript" || key === "raw_prompt" || key === "raw_response") {
            continue;
        }
        compact[key] = value;
    }
    if (Object.keys(compact).length === 0) {
        return "";
    }
    try {
        const json = JSON.stringify(compact, null, 2);
        if (!json) {
            return "";
        }
        const max_len = 10000;
        if (json.length <= max_len) {
            return json;
        }
        return `${json.slice(0, max_len).trimEnd()}\n...`;
    } catch {
        return "";
    }
}

function render_payload_details(event: SupervisorEvent): string {
    const details = payload_details_text(event.payload ?? {});
    if (!details) {
        return "";
    }
    return `
<details class="foundry-supervisor-event-details">
  <summary><i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i> Trace details</summary>
  <pre class="foundry-supervisor-event-details-body">${_.escape(details)}</pre>
</details>`;
}

function normalize_live_preview(raw: string, max_len = 220): string {
    const collapsed = raw.replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
    if (!collapsed) {
        return "";
    }
    if (collapsed.length <= max_len) {
        return collapsed;
    }
    return `${collapsed.slice(0, max_len - 1).trimEnd()}…`;
}

function clear_thinking_preview(): void {
    state.last_thinking_preview = "";
    state.last_thinking_event_ms = 0;
}

function remember_thinking_preview(text: string): void {
    const preview = normalize_live_preview(text);
    if (!preview) {
        return;
    }
    state.last_thinking_preview = preview;
    state.last_thinking_event_ms = Date.now();
}

function update_live_preview_from_event(event: SupervisorEvent): void {
    const kind = event.kind.trim().toLowerCase();
    const role = event.role.trim().toLowerCase();
    if (kind === "thinking") {
        remember_thinking_preview(event.content_md);
        return;
    }
    if (role === "user") {
        clear_thinking_preview();
        return;
    }
    if (role === "assistant" && (kind === "assistant" || kind === "dispatch_result" || kind === "plan_draft")) {
        clear_thinking_preview();
    }
}

function event_css_class(event: SupervisorEvent): string {
    const kind = event.kind.trim().toLowerCase();
    const role = event.role.trim().toLowerCase();
    if (role === "user") {
        return "is-user";
    }
    if (kind === "thinking") {
        return "is-thinking";
    }
    if (kind === "tool_call" || kind === "tool_result") {
        return "is-tool";
    }
    if (kind === "dispatch_result") {
        return "is-dispatch";
    }
    if (kind === "plan_draft") {
        return "is-plan";
    }
    if (kind === "assistant") {
        return "is-supervisor";
    }
    return "is-assistant";
}

function render_thinking_event(event: SupervisorEvent): JQuery {
    const preview = normalize_live_preview(event.content_md, 120);
    const summary_text = preview ? `Thinking: ${_.escape(preview)}` : "Thinking…";
    const html = `
<article class="foundry-supervisor-event is-thinking" data-supervisor-event-id="${event.id}">
  <details class="foundry-supervisor-thinking-collapse">
    <summary><i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i> ${summary_text}</summary>
    <div class="foundry-supervisor-thinking-body">
      ${render_markdown(event.content_md)}
    </div>
  </details>
</article>`;
    const $node = $(html);
    rendered_markdown.update_elements($node);
    const root = $node.get(0);
    if (root) {
        decorate_markdown_code_blocks(root);
    }
    return $node;
}

function infer_tool_status(event: SupervisorEvent): {status: string; icon: string} {
    const kind = event.kind.trim().toLowerCase();
    if (kind === "tool_result") {
        const payload = event.payload ?? {};
        const error = as_string(payload["error"]).trim();
        if (error) {
            return {status: "error", icon: "✗"};
        }
        return {status: "done", icon: "✓"};
    }
    const content = event.content_md.trim().toLowerCase();
    if (content.includes("error") || content.includes("failed")) {
        return {status: "error", icon: "✗"};
    }
    if (content.includes("result") || content.includes("success") || content.includes("complete")) {
        return {status: "done", icon: "✓"};
    }
    return {status: "called", icon: "→"};
}

function render_tool_event(event: SupervisorEvent): JQuery {
    const tool_name = as_string(event.payload?.["tool_name"] ?? event.payload?.["tool"]).trim() || "tool";
    const {status, icon: status_icon} = infer_tool_status(event);
    const html = `
<div class="foundry-supervisor-tool-collapse-wrap" data-supervisor-event-id="${event.id}">
  <details class="foundry-supervisor-tool-collapse">
    <summary class="foundry-supervisor-tool-trigger">
      <i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i>
      <span class="foundry-supervisor-tool-icon">⚙</span>
      <span class="foundry-supervisor-tool-name">${_.escape(tool_name)}</span>
      <span class="foundry-supervisor-tool-status">${_.escape(status_icon)} ${_.escape(status)}</span>
    </summary>
    <div class="foundry-supervisor-tool-body">
      ${render_markdown(event.content_md)}
    </div>
  </details>
</div>`;
    const $node = $(html);
    rendered_markdown.update_elements($node);
    const root = $node.get(0);
    if (root) {
        decorate_markdown_code_blocks(root);
    }
    return $node;
}

/* ------------------------------------------------------------------ */
/*  Worker Lifecycle Event Detection & Rendering                      */
/* ------------------------------------------------------------------ */

function is_worker_lifecycle_event(event: SupervisorEvent): boolean {
    const payload = event.payload ?? {};
    const trigger = as_string(payload["trigger"]).trim().toLowerCase();
    if (trigger.startsWith("task.") || trigger === "needs_clarification") {
        return true;
    }
    const content_lower = event.content_md.trim().toLowerCase();
    if (
        content_lower.includes("worker lifecycle") ||
        content_lower.includes("lifecycle notice")
    ) {
        return true;
    }
    return false;
}

function lifecycle_status_from_event(event: SupervisorEvent): {icon: string; css: string; label: string} {
    const payload = event.payload ?? {};
    const trigger = as_string(payload["trigger"]).trim().toLowerCase();
    const task_id = as_string(payload["task_id"] ?? payload["task"]).trim();
    const title = extract_task_title_from_content(event.content_md);
    const short_id = task_id.length > 20 ? `${task_id.slice(0, 17)}…` : task_id;
    const display = title || short_id || "Task";

    switch (trigger) {
        case "task.completed":
            return {icon: "✓", css: "is-lc-completed", label: `${display} completed`};
        case "task.failed":
            return {icon: "✗", css: "is-lc-failed", label: `${display} failed`};
        case "task.started":
            return {icon: "●", css: "is-lc-working", label: `${display} started`};
        case "task.stalled":
            return {icon: "⏸", css: "is-lc-blocked", label: `${display} stalled`};
        case "needs_clarification":
            return {icon: "?", css: "is-lc-blocked", label: `${display} needs input`};
        default: {
            const content = event.content_md.trim();
            const first_line = content.split("\n")[0] ?? "";
            const short = first_line.length > 60 ? `${first_line.slice(0, 57)}…` : first_line;
            return {icon: "→", css: "is-lc-info", label: short || "Worker event"};
        }
    }
}

function render_lifecycle_event(event: SupervisorEvent): JQuery {
    const ts = event.ts ? new Date(event.ts).toLocaleTimeString() : "";
    const {icon, css, label} = lifecycle_status_from_event(event);
    const has_body = event.content_md.trim().length > 80;
    const body_section = has_body
        ? `<details class="foundry-lifecycle-details">
             <summary class="foundry-lifecycle-details-toggle"><i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i> Details</summary>
             <div class="foundry-lifecycle-details-body">${render_markdown(event.content_md)}</div>
           </details>`
        : "";

    const html = `
<div class="foundry-supervisor-lifecycle-card ${css}" data-supervisor-event-id="${event.id}">
  <div class="foundry-lifecycle-row">
    <span class="foundry-lifecycle-icon ${css}">${_.escape(icon)}</span>
    <span class="foundry-lifecycle-label">${_.escape(label)}</span>
    <span class="foundry-lifecycle-time">${_.escape(ts)}</span>
  </div>
  ${body_section}
</div>`;
    const $node = $(html);
    if (has_body) {
        rendered_markdown.update_elements($node);
        const root = $node.get(0);
        if (root) {
            decorate_markdown_code_blocks(root);
        }
    }
    return $node;
}

function render_event(event: SupervisorEvent): JQuery {
    const kind = event.kind.trim().toLowerCase();
    if (kind === "thinking") {
        return render_thinking_event(event);
    }
    if (kind === "tool_call" || kind === "tool_result") {
        return render_tool_event(event);
    }
    if (is_worker_lifecycle_event(event)) {
        return render_lifecycle_event(event);
    }
    /* Auto-collapse shell-heavy assistant messages into compact cards */
    if (event.role.trim().toLowerCase() === "assistant" && is_code_heavy_content(event.content_md)) {
        return render_shell_output_card(event);
    }
    const label = event.author_name.trim() || role_label(event.role);
    const ts = event.ts ? new Date(event.ts).toLocaleTimeString() : "";
    const dispatched = render_dispatch_tasks(event);
    const html = `
<article class="foundry-supervisor-event ${event_css_class(event)}" data-supervisor-event-id="${event.id}">
  <header class="foundry-supervisor-event-header">
    <span class="foundry-supervisor-event-author">${_.escape(label)}</span>
    <span class="foundry-supervisor-event-meta">${_.escape(ts)}</span>
  </header>
  ${render_markdown(event.content_md)}
  ${dispatched}
</article>`;
    const $node = $(html);
    rendered_markdown.update_elements($node);
    const root = $node.get(0);
    if (root) {
        decorate_markdown_code_blocks(root);
    }
    return $node;
}

function sync_scroll_bottom_button(): void {
    const $timeline = timeline_selector();
    const $btn = $("#foundry-supervisor-scroll-bottom");
    if ($timeline.length === 0 || $btn.length === 0) {
        return;
    }
    const near = timeline_near_bottom($timeline);
    $btn.toggle(!near);
}

function group_intermediate_steps(): void {
    const timeline = timeline_selector().get(0);
    if (!timeline) {
        return;
    }
    const children = [...timeline.children] as HTMLElement[];
    let group_start = -1;
    let group_count = 0;

    const flush_group = (end_index: number): void => {
        if (group_count < 2 || group_start < 0) {
            group_start = -1;
            group_count = 0;
            return;
        }
        const nodes_to_group: HTMLElement[] = [];
        for (let i = group_start; i < end_index; i++) {
            const child = children[i];
            if (child) {
                nodes_to_group.push(child);
            }
        }
        if (nodes_to_group.length < 2) {
            group_start = -1;
            group_count = 0;
            return;
        }
        const wrapper = document.createElement("details");
        wrapper.className = "foundry-supervisor-steps-group";
        const summary = document.createElement("summary");
        summary.innerHTML = `<i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i> ${nodes_to_group.length} intermediate steps`;
        wrapper.append(summary);
        const first = nodes_to_group[0];
        if (first) {
            first.before(wrapper);
        }
        for (const node of nodes_to_group) {
            wrapper.append(node);
        }
        group_start = -1;
        group_count = 0;
    };

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) {
            continue;
        }
        const is_user = child.classList.contains("is-user");
        const is_supervisor = child.classList.contains("is-supervisor") || child.classList.contains("is-dispatch") || child.classList.contains("is-plan");
        const is_separator = child.tagName === "HR";
        const is_intermediate = child.classList.contains("is-thinking") || child.classList.contains("is-tool") || child.classList.contains("foundry-supervisor-lifecycle-card") || child.classList.contains("foundry-supervisor-shell-output-card") || child.querySelector(".foundry-supervisor-tool-collapse") !== null;
        const is_steps_group = child.classList.contains("foundry-supervisor-steps-group");

        if (is_steps_group) {
            continue;
        }
        if (is_user || is_separator) {
            flush_group(i);
            continue;
        }
        if (is_supervisor) {
            flush_group(i);
            continue;
        }
        if (is_intermediate) {
            if (group_start < 0) {
                group_start = i;
            }
            group_count += 1;
        }
    }
    flush_group(children.length);
}

function root_selector(): JQuery {
    return $("#foundry-supervisor-sidebar-root");
}

function timeline_selector(): JQuery {
    return $("#foundry-supervisor-sidebar-timeline");
}

function set_status_message(message: string): void {
    if (state.last_status_message === message) {
        return;
    }
    state.last_status_message = message;
    $("#foundry-supervisor-sidebar-status").text(message);
}

function set_warning(message: string): void {
    const $warning = $("#foundry-supervisor-sidebar-warning");
    if (!message) {
        $warning.hide().text("");
        return;
    }
    $warning.text(message).show();
}

function render_shell(context: TopicContext): void {
    const topic_title = `${_.escape(context.stream_name)} · ${_.escape(context.topic)}`;
    const html = `
<div class="foundry-supervisor-sidebar-shell">
  <div class="foundry-supervisor-sidebar-header">
    <div class="foundry-supervisor-sidebar-header-row">
      <div class="foundry-supervisor-sidebar-title" title="${topic_title}">Supervisor</div>
      <span id="foundry-supervisor-sidebar-status" class="foundry-supervisor-sidebar-status-badge">Connecting…</span>
    </div>
    <div class="foundry-supervisor-sidebar-topic" title="${topic_title}">${topic_title}</div>
  </div>
  <div id="foundry-supervisor-task-dashboard" class="foundry-supervisor-task-dashboard" style="display:none"></div>
  <div id="foundry-supervisor-sidebar-warning" class="foundry-supervisor-sidebar-warning" style="display:none;"></div>
  <div id="foundry-supervisor-sidebar-timeline" class="foundry-supervisor-sidebar-timeline scrolling_list">
    <button type="button" id="foundry-supervisor-scroll-bottom" class="foundry-supervisor-scroll-bottom" style="display:none" aria-label="Scroll to bottom">↓</button>
  </div>
  <div class="foundry-supervisor-sidebar-composer">
    <textarea id="foundry-supervisor-sidebar-input" class="foundry-supervisor-sidebar-input" rows="2" placeholder="Ask anything..."></textarea>
    <div id="foundry-supervisor-attachments" class="foundry-supervisor-composer-attachments" style="display:none"></div>
    <div class="foundry-supervisor-composer-actions">
      <input type="file" id="foundry-supervisor-file-input" multiple style="display:none" />
      <button type="button" class="foundry-supervisor-composer-attach" id="foundry-supervisor-attach" title="Attach files" aria-label="Attach files">+</button>
      <button type="button" class="foundry-supervisor-composer-send" id="foundry-supervisor-sidebar-send" title="Send message">↑</button>
    </div>
  </div>
</div>`;
    root_selector().html(html);
    attach_timeline_wheel_listener();
    update_send_button_state();
}

function render_empty_state(message: string): void {
    root_selector().html(
        `<div class="foundry-supervisor-sidebar-empty">${_.escape(message)}</div>`,
    );
}

function scroll_timeline_to_bottom(): void {
    const timeline = timeline_selector().get(0);
    if (!timeline) {
        return;
    }
    timeline.scrollTop = timeline.scrollHeight;
}

function timeline_near_bottom($timeline: JQuery): boolean {
    const node = $timeline.get(0);
    if (!node) {
        return false;
    }
    return ($timeline.scrollTop() ?? 0) + ($timeline.innerHeight() ?? 0) >= node.scrollHeight - 120;
}

type LiveRowMode = "thinking" | "working" | "reconnecting";

function render_live_row(message: string, mode: LiveRowMode): string {
    const mode_class = `is-${mode}`;
    const meta = mode === "thinking" ? "Thinking" : mode === "working" ? "Working" : "Live";
    const show_shimmer = mode === "working" || mode === "thinking";
    return `
<article class="foundry-supervisor-event foundry-supervisor-live-row is-supervisor ${mode_class}" id="foundry-supervisor-live-row">
  <div class="foundry-supervisor-live-body ${mode_class}">
    <span class="foundry-supervisor-live-dot" aria-hidden="true"></span>
    <span class="foundry-supervisor-live-text">${_.escape(message)}</span>
    <span class="foundry-supervisor-live-meta">${meta}</span>
  </div>${show_shimmer ? '\n  <div class="foundry-supervisor-live-shimmer" aria-hidden="true"></div>' : ""}
</article>`;
}

function build_live_row_node(message: string, mode: LiveRowMode): HTMLElement | undefined {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = render_live_row(message, mode).trim();
    const node = wrapper.firstElementChild;
    if (!node) {
        return undefined;
    }
    if (!(node instanceof HTMLElement)) {
        return undefined;
    }
    return node;
}

/* ------------------------------------------------------------------ */
/*  Task Registry – parse task/worker status from every event         */
/* ------------------------------------------------------------------ */

function extract_task_title_from_content(content: string): string {
    const title_match = /Title:\s*(.+)/i.exec(content);
    if (title_match?.[1]) {
        const raw = title_match[1].trim();
        return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
    }
    return "";
}

function extract_task_id_from_content(content: string): string {
    /* Broadly match any task ID pattern: task_<alphanumeric 4+ chars> */
    const match = /\btask[_-][\da-zA-Z]{4,}\b/i.exec(content);
    return match ? match[0].toLowerCase().replace(/-/g, "_") : "";
}

function extract_trigger_from_content(content: string): string {
    /* Extract trigger info like "Trigger: task.completed" from content text */
    const match = /Trigger:\s*(task\.\w+)/i.exec(content);
    return match?.[1]?.trim().toLowerCase() ?? "";
}

function parse_tasks_from_content(content: string): Array<{task_id: string; title: string; role: string; status: string}> {
    const results: Array<{task_id: string; title: string; role: string; status: string}> = [];
    if (!content.trim()) {
        return results;
    }

    /* First pass: look for explicit "Trigger:" + "Task:" patterns in lifecycle notices */
    const content_trigger = extract_trigger_from_content(content);
    const content_task_id = extract_task_id_from_content(content);
    const content_title = extract_task_title_from_content(content);
    if (content_task_id && content_trigger) {
        let status = "";
        if (content_trigger.includes("completed")) {
            status = "completed";
        } else if (content_trigger.includes("failed")) {
            status = "failed";
        } else if (content_trigger.includes("started")) {
            status = "working";
        } else if (content_trigger.includes("stalled")) {
            status = "blocked";
        }
        results.push({task_id: content_task_id, title: content_title, role: "", status});
    }

    /* Second pass: scan each line for task ID patterns */
    const lines = content.split("\n");
    for (const line of lines) {
        /* Match orchestrator task IDs: task_ or task- followed by 4+ alphanumeric chars */
        const task_match = /\b(task[_-][\da-zA-Z]{4,})\b/i.exec(line);
        if (!task_match?.[0]) {
            continue;
        }
        const task_id = task_match[0].toLowerCase().replace(/-/g, "_");
        if (results.some((r) => r.task_id === task_id)) {
            continue;
        }
        /* Extract role and title from the rest of the line after task ID */
        const after_id = line.slice(task_match.index + task_match[0].length);
        let role = "";
        let title = "";
        let status = "";
        /* Pattern: "task_abc123 — Writer: Title" or "task_abc123 - Helper — Audit" */
        const role_match = /\s*(?:—|–|-|:|\|)\s*(\w+)(?:\s*(?:—|–|-|:|\|)\s*)(.+)?/i.exec(after_id);
        if (role_match) {
            role = role_match[1] ?? "";
            title = (role_match[2] ?? "").replace(/[✓✗●⏸→☐☑■□]/g, "").trim();
        }
        /* Infer status from line content */
        const lower = line.toLowerCase();
        if (lower.includes("completed") || line.includes("✓") || lower.includes("done") || lower.includes("finished")) {
            status = "completed";
        } else if (lower.includes("failed") || line.includes("✗") || lower.includes("error")) {
            status = "failed";
        } else if (lower.includes("working") || lower.includes("in progress") || lower.includes("active") || lower.includes("running")) {
            status = "working";
        } else if (lower.includes("spawning") || lower.includes("starting")) {
            status = "spawning";
        } else if (lower.includes("blocked") || lower.includes("stalled")) {
            status = "blocked";
        } else if (lower.includes("queued") || lower.includes("pending") || lower.includes("waiting")) {
            status = "queued";
        }
        results.push({task_id, title: title || content_title, role, status});
    }
    return results;
}

function update_task_registry(event: SupervisorEvent): void {
    const payload = event.payload ?? {};
    const now = Date.now();
    const payload_plan_revision_id = as_string(payload["plan_revision_id"]).trim();

    if (
        event.kind === "dispatch_result"
        && payload_plan_revision_id
        && payload_plan_revision_id !== state.current_plan_revision_id
    ) {
        state.current_plan_revision_id = payload_plan_revision_id;
        state.task_registry = new Map<string, TaskEntry>();
    }

    const event_matches_current_plan =
        !state.current_plan_revision_id ||
        !payload_plan_revision_id ||
        payload_plan_revision_id === state.current_plan_revision_id;
    const allow_new_unknown_tasks =
        !state.current_plan_revision_id ||
        (event.kind === "dispatch_result"
            && (!payload_plan_revision_id || payload_plan_revision_id === state.current_plan_revision_id)) ||
        payload_plan_revision_id === state.current_plan_revision_id;

    /* 1. Upsert tasks from the tasks[] array in dispatch events */
    const tasks = Array.isArray(payload["tasks"]) ? payload["tasks"] : [];
    if (event_matches_current_plan) {
        for (const task of tasks) {
            const item = as_record(task);
            if (!item) {
                continue;
            }
            const task_id = as_string(item["task_id"]).trim();
            if (!task_id) {
                continue;
            }
            const existing = state.task_registry.get(task_id);
            state.task_registry.set(task_id, {
                task_id,
                title: as_string(item["title"]).trim() || existing?.title || "",
                assigned_role: as_string(item["assigned_role"]).trim() || existing?.assigned_role || "worker",
                status: as_string(item["status"]).trim() || existing?.status || "queued",
                activity: as_string(item["activity"]).trim() || existing?.activity || "",
                last_updated: now,
            });
        }
    }

    /* 2. Lifecycle triggers: task.completed, task.started, task.failed, etc. */
    const trigger = as_string(payload["trigger"]).trim().toLowerCase();
    if (trigger) {
        /* Try payload first, then fall back to extracting task_id from content */
        const trigger_task_id =
            as_string(payload["task_id"] ?? payload["task"]).trim() ||
            extract_task_id_from_content(event.content_md);
        const trigger_title = extract_task_title_from_content(event.content_md);
        if (trigger_task_id) {
            const existing = state.task_registry.get(trigger_task_id);
            let new_status = existing?.status ?? "queued";
            if (trigger === "task.completed") {
                new_status = "completed";
            } else if (trigger === "task.failed") {
                new_status = "failed";
            } else if (trigger === "task.started") {
                new_status = "working";
            } else if (trigger === "task.stalled") {
                new_status = "blocked";
            }
            state.task_registry.set(trigger_task_id, {
                task_id: trigger_task_id,
                title: trigger_title || existing?.title || "",
                assigned_role: as_string(payload["assigned_role"]).trim() || existing?.assigned_role || "worker",
                status: new_status,
                activity: as_string(payload["activity"]).trim() || existing?.activity || "",
                last_updated: now,
            });
        }
    }

    /* 3. Worker session status updates */
    const worker_status = as_string(payload["worker_status"]).trim();
    const worker_task_id = as_string(payload["task_id"]).trim();
    if (worker_status && worker_task_id) {
        const existing = state.task_registry.get(worker_task_id);
        if (existing) {
            existing.status = worker_status;
            existing.activity = as_string(payload["activity"]).trim() || existing.activity;
            existing.last_updated = now;
        }
    }

    /* 4. Parse task mentions from message content (Worker DAG, lifecycle notices, etc.) */
    const content_tasks = parse_tasks_from_content(event.content_md);
    for (const ct of content_tasks) {
        const existing = state.task_registry.get(ct.task_id);
        if (existing) {
            if (ct.title && !existing.title) {
                existing.title = ct.title;
            }
            if (ct.role && (!existing.assigned_role || existing.assigned_role === "worker")) {
                existing.assigned_role = ct.role;
            }
            if (ct.status) {
                existing.status = ct.status;
            }
            existing.last_updated = now;
        } else if (allow_new_unknown_tasks) {
            state.task_registry.set(ct.task_id, {
                task_id: ct.task_id,
                title: ct.title,
                assigned_role: ct.role || "worker",
                status: ct.status || "queued",
                activity: "",
                last_updated: now,
            });
        }
    }
}

function parse_task_summary(value: unknown): TaskSummary | undefined {
    const root = as_record(value);
    if (!root) {
        return undefined;
    }
    const active_plan_revision_id = as_string(root["active_plan_revision_id"]).trim();
    const filtered_plan_revision_id = as_string(root["filtered_plan_revision_id"]).trim();
    const task_values = Array.isArray(root["tasks"]) ? root["tasks"] : [];
    const tasks: TaskEntry[] = [];
    for (const value of task_values) {
        const item = as_record(value);
        if (!item) {
            continue;
        }
        const task_id = as_string(item["task_id"]).trim();
        if (!task_id) {
            continue;
        }
        tasks.push({
            task_id,
            title: as_string(item["title"]).trim(),
            assigned_role: as_string(item["assigned_role"]).trim() || "worker",
            status: as_string(item["status"]).trim() || "queued",
            activity: as_string(item["activity"]).trim(),
            last_updated: Date.now(),
        });
    }
    return {
        active_plan_revision_id,
        filtered_plan_revision_id,
        tasks,
    };
}

function sync_task_registry_from_summary(summary: TaskSummary | undefined): void {
    if (!summary) {
        return;
    }
    const target_plan_revision_id =
        summary.filtered_plan_revision_id || summary.active_plan_revision_id || state.current_plan_revision_id;
    if (target_plan_revision_id) {
        state.current_plan_revision_id = target_plan_revision_id;
    }
    if (summary.tasks.length === 0 && !target_plan_revision_id) {
        return;
    }
    const next_registry = new Map<string, TaskEntry>();
    for (const task of summary.tasks) {
        const existing = state.task_registry.get(task.task_id);
        next_registry.set(task.task_id, {
            ...task,
            activity: task.activity || existing?.activity || "",
            last_updated: existing?.last_updated ?? task.last_updated,
        });
    }
    state.task_registry = next_registry;
}

function task_dashboard_overall(): "idle" | "working" | "completed" | "failed" {
    const entries = [...state.task_registry.values()];
    if (entries.length === 0) {
        return "idle";
    }
    const statuses = entries.map((t) => t.status);
    if (statuses.some((s) => s === "failed")) {
        return "failed";
    }
    if (statuses.every((s) => s === "completed")) {
        return "completed";
    }
    if (statuses.some((s) => ["working", "spawning", "pr_open", "queued"].includes(s))) {
        return "working";
    }
    return "idle";
}

function task_status_dot_class(status: string): string {
    switch (status) {
        case "completed":
            return "is-task-completed";
        case "failed":
            return "is-task-failed";
        case "working":
        case "spawning":
            return "is-task-working";
        case "pr_open":
            return "is-task-pr";
        case "blocked":
        case "waiting_input":
            return "is-task-blocked";
        default:
            return "is-task-queued";
    }
}

function sync_dispatch_task_cards(): void {
    $("#foundry-supervisor-sidebar-timeline .foundry-supervisor-tool-card[data-task-id]").each(
        (_idx, elem) => {
            const $card = $(elem);
            const task_id = $card.attr("data-task-id")?.trim() ?? "";
            if (!task_id) {
                return;
            }
            const current = state.task_registry.get(task_id);
            if (!current) {
                if (state.current_plan_revision_id && state.task_registry.size > 0) {
                    $card.remove();
                }
                return;
            }
            const role =
                current.assigned_role ||
                $card.find(".foundry-supervisor-tool-subtitle").attr("data-task-role")?.trim() ||
                "worker";
            $card
                .find(".foundry-supervisor-tool-subtitle")
                .text(`${role} · ${current.status || "queued"}`);
        },
    );
}

function sync_task_dashboard(): void {
    const $dashboard = $("#foundry-supervisor-task-dashboard");
    if ($dashboard.length === 0) {
        return;
    }
    const entries = [...state.task_registry.values()];
    if (entries.length === 0) {
        $dashboard.hide();
        return;
    }

    const total = entries.length;
    const completed_count = entries.filter((t) => t.status === "completed").length;
    const failed_count = entries.filter((t) => t.status === "failed").length;
    const done_count = completed_count + failed_count;
    const done_pct = total > 0 ? Math.round((done_count / total) * 100) : 0;
    const overall = task_dashboard_overall();
    const overall_label =
        overall === "completed"
            ? "All done"
            : overall === "failed"
              ? "Failed"
              : overall === "working"
                ? "In progress"
                : "Idle";

    const rows = entries
        .map((t) => {
            const dot = task_status_dot_class(t.status);
            const display_id = t.task_id.length > 24 ? `${t.task_id.slice(0, 21)}…` : t.task_id;
            const label = t.title || display_id;
            return `<div class="foundry-task-row">
                <span class="foundry-task-dot ${dot}"></span>
                <span class="foundry-task-label" title="${_.escape(t.task_id)}">${_.escape(label)}</span>
                <span class="foundry-task-status-text">${_.escape(t.status)}</span>
            </div>`;
        })
        .join("");

    const html = `
    <details class="foundry-task-dashboard-collapse" open>
      <summary class="foundry-task-dashboard-summary">
        <i class="zulip-icon zulip-icon-chevron-right foundry-collapse-chevron" aria-hidden="true"></i>
        <span class="foundry-task-dashboard-title">Tasks</span>
        <span class="foundry-task-dashboard-counts">${done_count}/${total}</span>
        <span class="foundry-task-dashboard-overall ${overall}">${_.escape(overall_label)}</span>
      </summary>
      <div class="foundry-task-dashboard-body">
        <div class="foundry-task-progress-bar"><div class="foundry-task-progress-fill" style="width:${done_pct}%"></div></div>
        ${rows}
      </div>
    </details>`;

    $dashboard.html(html).show();
    sync_dispatch_task_cards();
}

function sync_live_row(): void {
    const $timeline = timeline_selector();
    if ($timeline.length === 0) {
        return;
    }
    const near_bottom = timeline_near_bottom($timeline);
    const $existing = $("#foundry-supervisor-live-row");

    let live_message = "";
    let live_mode: LiveRowMode | undefined;
    const thinking_is_fresh =
        Boolean(state.last_thinking_preview) &&
        Date.now() - state.last_thinking_event_ms <= LIVE_THINKING_FRESH_MS;
    if (thinking_is_fresh) {
        live_message = state.last_thinking_preview;
        live_mode = "thinking";
    } else if (state.sending_message) {
        live_message = "Thinking…";
        live_mode = "working";
    } else if (state.poll_failure_count >= POLL_WARNING_THRESHOLD) {
        live_message = "Live stream reconnecting. Poll fallback is active…";
        live_mode = "reconnecting";
    }

    if (!live_message || !live_mode) {
        state.last_live_message = "";
        $existing.remove();
        return;
    }

    const live_key = `${live_mode}:${live_message}`;
    const timeline = $timeline.get(0);

    /* Even if message hasn't changed, ensure live row is the last child */
    if (state.last_live_message === live_key && $existing.length > 0) {
        const existing_node = $existing.get(0);
        if (existing_node && timeline && existing_node !== timeline.lastElementChild) {
            timeline.append(existing_node);
        }
        return;
    }

    const node = build_live_row_node(live_message, live_mode);
    if (!node) {
        return;
    }
    state.last_live_message = live_key;

    /* Always remove old and append at the bottom */
    $existing.remove();
    timeline?.append(node);

    if (near_bottom) {
        scroll_timeline_to_bottom();
    }
}

function append_events(events: SupervisorEvent[]): void {
    if (events.length === 0) {
        return;
    }
    const $timeline = timeline_selector();
    if ($timeline.length === 0) {
        return;
    }
    const near_bottom = timeline_near_bottom($timeline);
    const timeline = $timeline.get(0);

    for (const event of events) {
        const role = event.role.trim().toLowerCase();
        if (role === "user" && event.client_msg_id && state.pending_user_echoes.has(event.client_msg_id)) {
            state.pending_user_echoes.delete(event.client_msg_id);
            state.after_id = Math.max(state.after_id, event.id);
            continue;
        }
        if (state.seen_event_ids.has(event.id)) {
            continue;
        }
        state.seen_event_ids.add(event.id);
        state.after_id = Math.max(state.after_id, event.id);
        update_live_preview_from_event(event);
        update_task_registry(event);

        if (timeline) {
            if (role === "user" && timeline.children.length > 0) {
                const separator = document.createElement("hr");
                separator.className = "foundry-supervisor-turn-separator";
                timeline.append(separator);
            }
            const event_node = render_event(event).get(0);
            if (event_node) {
                timeline.append(event_node);
            }
        }
    }

    if (near_bottom) {
        scroll_timeline_to_bottom();
    }
    sync_live_row();
    sync_task_dashboard();
    group_intermediate_steps();
    sync_scroll_bottom_button();
}

function confine_timeline_wheel(e: JQuery.TriggeredEvent): void {
    const original = e.originalEvent;
    if (!(original instanceof WheelEvent)) {
        return;
    }
    const timeline = timeline_selector().get(0);
    if (!timeline) {
        return;
    }
    const max_top = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
    if (max_top <= 0) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    const next_top = Math.min(max_top, Math.max(0, timeline.scrollTop + original.deltaY));
    const next_left = Math.max(0, timeline.scrollLeft + original.deltaX);
    timeline.scrollTop = next_top;
    timeline.scrollLeft = next_left;
    e.preventDefault();
    e.stopPropagation();
}

function confine_timeline_native_wheel(e: WheelEvent): void {
    const timeline = timeline_selector().get(0);
    if (!timeline) {
        return;
    }
    const max_top = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
    if (max_top <= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
    const next_top = Math.min(max_top, Math.max(0, timeline.scrollTop + e.deltaY));
    const next_left = Math.max(0, timeline.scrollLeft + e.deltaX);
    timeline.scrollTop = next_top;
    timeline.scrollLeft = next_left;
    e.preventDefault();
    e.stopImmediatePropagation();
}

function is_scrollable_y(element: HTMLElement): boolean {
    const styles = window.getComputedStyle(element);
    const overflow_y = styles.overflowY;
    if (overflow_y !== "auto" && overflow_y !== "scroll") {
        return false;
    }
    return element.scrollHeight > element.clientHeight + 1;
}

function nearest_scrollable_in_panel(target: EventTarget | null, panel: HTMLElement): HTMLElement | undefined {
    if (!(target instanceof HTMLElement)) {
        return undefined;
    }
    let node: HTMLElement | null = target;
    while (node && node !== panel) {
        if (is_scrollable_y(node)) {
            return node;
        }
        node = node.parentElement;
    }
    return undefined;
}

function confine_panel_native_wheel(e: WheelEvent): void {
    const panel = document.querySelector<HTMLElement>("#right-sidebar-ai-panel");
    if (!panel?.classList.contains("is-active")) {
        return;
    }
    const timeline = timeline_selector().get(0);
    if (!timeline) {
        return;
    }
    const scroller = nearest_scrollable_in_panel(e.target, panel) ?? timeline;
    const max_top = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (max_top <= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
    const next_top = Math.min(max_top, Math.max(0, scroller.scrollTop + e.deltaY));
    const max_left = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const next_left = Math.min(max_left, Math.max(0, scroller.scrollLeft + e.deltaX));
    scroller.scrollTop = next_top;
    scroller.scrollLeft = next_left;
    e.preventDefault();
    e.stopImmediatePropagation();
}

function attach_timeline_wheel_listener(): void {
    const timeline = timeline_selector().get(0);
    if (!timeline || timeline.dataset["foundryWheelBound"] === "1") {
        return;
    }
    timeline.dataset["foundryWheelBound"] = "1";
    timeline.addEventListener("wheel", confine_timeline_native_wheel, {passive: false});
    timeline.addEventListener("scroll", () => {
        sync_scroll_bottom_button();
    }, {passive: true});
}

function attach_panel_wheel_listener(): void {
    const panel = document.querySelector<HTMLElement>("#right-sidebar-ai-panel");
    if (!panel || panel.dataset["foundryPanelWheelBound"] === "1") {
        return;
    }
    panel.dataset["foundryPanelWheelBound"] = "1";
    panel.addEventListener("wheel", confine_panel_native_wheel, {capture: true, passive: false});
}

function format_file_size(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function render_attachment_chips(): void {
    const $container = $("#foundry-supervisor-attachments");
    if (state.pending_attachments.length === 0) {
        $container.hide().empty();
        return;
    }
    const chips = state.pending_attachments
        .map(
            (file, index) =>
                `<span class="foundry-supervisor-attachment-chip" data-attachment-index="${index}">
                    <span class="foundry-supervisor-attachment-name">${_.escape(file.name)}</span>
                    <span class="foundry-supervisor-attachment-size">${format_file_size(file.size)}</span>
                    <button type="button" class="foundry-supervisor-attachment-remove" data-attachment-index="${index}" aria-label="Remove ${_.escape(file.name)}">×</button>
                </span>`,
        )
        .join("");
    $container.html(chips).show();
}

function add_attachments(files: FileList | File[]): void {
    for (const file of files) {
        const already = state.pending_attachments.some(
            (existing) => existing.name === file.name && existing.size === file.size,
        );
        if (!already) {
            state.pending_attachments.push(file);
        }
    }
    render_attachment_chips();
    update_send_button_state();
}

function remove_attachment(index: number): void {
    state.pending_attachments.splice(index, 1);
    render_attachment_chips();
    update_send_button_state();
}

function clear_attachments(): void {
    state.pending_attachments = [];
    render_attachment_chips();
    const file_input = document.getElementById("foundry-supervisor-file-input");
    if (file_input instanceof HTMLInputElement) {
        file_input.value = "";
    }
}

function update_send_button_state(): void {
    const textarea_value = String($("#foundry-supervisor-sidebar-input").val() ?? "").trim();
    const has_content = textarea_value.length > 0 || state.pending_attachments.length > 0;
    const disabled = state.sending_message || !has_content;
    const label = state.sending_message ? "⋯" : "↑";
    const title = state.sending_message
        ? "Sending…"
        : has_content
          ? "Send message"
          : "Type a message";
    $("#foundry-supervisor-sidebar-send").prop("disabled", disabled).text(label).attr("title", title);
    sync_live_row();
}

function clear_poll_timer(): void {
    if (state.poll_timer !== null) {
        window.clearTimeout(state.poll_timer);
        state.poll_timer = null;
    }
}

function schedule_poll(ms = POLL_INTERVAL_MS): void {
    clear_poll_timer();
    if (state.active_tab !== "ai" || !state.context) {
        return;
    }
    state.poll_timer = window.setTimeout(() => {
        void poll_session();
    }, ms);
}

function sync_ai_open_body_class(): void {
    $("body").toggleClass(SUPERVISOR_AI_OPEN_BODY_CLASS, state.active_tab === "ai");
}

function set_tab(tab: "users" | "ai"): void {
    state.active_tab = tab;
    const ai = tab === "ai";
    $("#right-sidebar-tab-users")
        .toggleClass("selected", !ai)
        .attr("aria-selected", (!ai).toString());
    $("#right-sidebar-tab-ai")
        .toggleClass("selected", ai)
        .attr("aria-selected", ai.toString());
    $('#right-sidebar [data-right-sidebar-panel="users"]').toggleClass("is-active", !ai);
    $('#right-sidebar [data-right-sidebar-panel="ai"]').toggleClass("is-active", ai);
    sync_ai_open_body_class();
    if (ai) {
        schedule_poll(150);
    } else {
        clear_poll_timer();
    }
}

function reset_topic_state(): void {
    state.session = null;
    state.current_plan_revision_id = "";
    state.after_id = 0;
    state.seen_event_ids = new Set<number>();
    state.request_in_flight = false;
    state.disconnected = false;
    state.poll_failure_count = 0;
    state.last_status_message = "";
    state.last_live_message = "";
    state.pending_user_echoes = new Map<string, number>();
    state.next_local_event_id = -1;
    state.task_registry = new Map<string, TaskEntry>();
    clear_thinking_preview();
}

function cleanup_turn_separators(): void {
    const timeline = timeline_selector().get(0);
    if (!timeline) {
        return;
    }
    const children = [...timeline.children];
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (!(node instanceof HTMLHRElement)) {
            continue;
        }
        const prev = children[i - 1];
        const next = children[i + 1];
        const should_remove = !prev || !next || prev instanceof HTMLHRElement || next instanceof HTMLHRElement;
        if (should_remove) {
            node.remove();
        }
    }
}

function append_local_user_echo(message: string, client_msg_id: string): void {
    if (!message.trim() || !client_msg_id.trim() || !state.context || !state.session) {
        return;
    }
    const local_event: SupervisorEvent = {
        id: state.next_local_event_id,
        topic_scope_id: state.context.topic_scope_id,
        session_id: state.session.session_id,
        ts: new Date().toISOString(),
        kind: "message",
        role: "user",
        author_id: "local-user",
        author_name: "You",
        content_md: message,
        payload: {local_echo: true},
        client_msg_id,
    };
    state.next_local_event_id -= 1;
    state.pending_user_echoes.set(client_msg_id, local_event.id);
    append_events([local_event]);
}

function remove_local_user_echo(client_msg_id: string): void {
    const local_id = state.pending_user_echoes.get(client_msg_id);
    if (local_id === undefined) {
        return;
    }
    state.pending_user_echoes.delete(client_msg_id);
    state.seen_event_ids.delete(local_id);
    timeline_selector().find(`[data-supervisor-event-id=\"${local_id}\"]`).remove();
    cleanup_turn_separators();
}

function switch_topic(context: TopicContext): void {
    const changed = state.context?.topic_scope_id !== context.topic_scope_id;
    state.context = context;
    if (!changed) {
        return;
    }
    reset_topic_state();
    render_shell(context);
    set_status_message("Connecting…");
}

function parse_events_from_response(data: unknown): SupervisorEvent[] {
    const root = as_record(data);
    if (!root) {
        return [];
    }
    const nested = as_record(root["raw"]);
    const values = Array.isArray(root["events"])
        ? root["events"]
        : Array.isArray(nested?.["events"])
          ? nested["events"]
          : [];
    const events: SupervisorEvent[] = [];
    for (const value of values) {
        const event = parse_event(value);
        if (event) {
            events.push(event);
        }
    }
    return events;
}

async function poll_session(): Promise<void> {
    if (!state.context || state.active_tab !== "ai") {
        return;
    }
    if (state.request_in_flight) {
        schedule_poll(POLL_INTERVAL_MS);
        return;
    }
    state.request_in_flight = true;
    const scope = state.context.topic_scope_id;
    await channel.get({
        url: `/json/foundry/topics/${encodeURIComponent(scope)}/supervisor/session`,
        data: {
            after_id: state.after_id,
            limit: 250,
        },
        success(data) {
            state.request_in_flight = false;
            state.disconnected = false;
            state.poll_failure_count = 0;
            if (state.last_live_message) {
                set_warning("");
            }
            const root = as_record(data);
            const session = parse_session(root?.["session"] ?? as_record(root?.["raw"])?.["session"]);
            if (session) {
                state.session = session;
                const engine = session_engine_label(session);
                set_status_message(
                    `Session ${session.session_id} · ${session.status}${engine ? ` · ${engine}` : ""}`,
                );
            }
            const task_summary = parse_task_summary(root?.["task_summary"] ?? as_record(root?.["raw"])?.["task_summary"]);
            sync_task_registry_from_summary(task_summary);
            const events = parse_events_from_response(data);
            append_events(events);
            sync_live_row();
            sync_task_dashboard();
            schedule_poll(POLL_INTERVAL_MS);
        },
        error() {
            state.request_in_flight = false;
            state.disconnected = true;
            state.poll_failure_count += 1;
            if (state.poll_failure_count >= POLL_WARNING_THRESHOLD) {
                set_warning("Live stream disconnected; polling fallback will continue.");
                set_status_message("Reconnecting…");
            }
            sync_live_row();
            const backoff = Math.min(6000, 1200 * 2 ** Math.max(0, state.poll_failure_count - 1));
            schedule_poll(backoff);
        },
    });
}

function build_topic_context_payload(context: TopicContext): Record<string, string | number> {
    const payload: Record<string, string | number> = {};
    if (Number.isInteger(context.stream_id)) {
        payload["stream_id"] = context.stream_id;
    }
    const stream_name = context.stream_name.trim();
    if (stream_name) {
        payload["stream_name"] = stream_name;
    }
    if (typeof context.topic === "string") {
        payload["topic"] = context.topic;
    }
    return payload;
}

function post_message(message: string): void {
    if (!state.context || state.sending_message) {
        return;
    }
    const trimmed = message.trim();
    const has_files = state.pending_attachments.length > 0;
    if (!trimmed && !has_files) {
        return;
    }
    const $input = $("#foundry-supervisor-sidebar-input");
    const original_draft = message;
    const sent_files = [...state.pending_attachments];
    state.sending_message = true;
    update_send_button_state();
    clear_thinking_preview();
    $input.val("");
    clear_attachments();
    const client_msg_id = make_client_msg_id();
    const echo_text = trimmed || `[${sent_files.map((f) => f.name).join(", ")}]`;
    append_local_user_echo(echo_text, client_msg_id);
    schedule_poll(90);
    const scope = state.context.topic_scope_id;
    const context_payload = build_topic_context_payload(state.context);

    const form = new FormData();
    form.append("message", trimmed);
    form.append("client_msg_id", client_msg_id);
    for (const [key, value] of Object.entries(context_payload)) {
        form.append(key, String(value));
    }
    for (const file of sent_files) {
        form.append("files", file, file.name);
    }

    const csrf_token = $('input[name="csrfmiddlewaretoken"]').val() ?? "";
    const url = `/json/foundry/topics/${encodeURIComponent(scope)}/supervisor/message`;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    if (typeof csrf_token === "string" && csrf_token) {
        xhr.setRequestHeader("X-CSRFToken", csrf_token);
    }
    xhr.onload = () => {
        state.sending_message = false;
        update_send_button_state();
        if (xhr.status >= 200 && xhr.status < 300) {
            set_warning("");
            try {
                const response_data: unknown = JSON.parse(xhr.responseText);
                const events = parse_events_from_response(response_data);
                append_events(events);
            } catch {
                /* response may not contain events */
            }
            sync_live_row();
            schedule_poll(100);
        } else {
            const raw_error = `${xhr.statusText} ${xhr.responseText}`.toLowerCase();
            const timed_out =
                xhr.status === 504 || raw_error.includes("timed out") || raw_error.includes("timeout");
            if (timed_out) {
                set_warning("Supervisor is still running this request. Polling for results…");
                schedule_poll(120);
            } else {
                remove_local_user_echo(client_msg_id);
                let error_msg = "Unable to send supervisor message";
                try {
                    const error_body = as_record(JSON.parse(xhr.responseText));
                    const server_msg = as_string(error_body?.["msg"]).trim();
                    if (server_msg) {
                        error_msg = server_msg;
                    }
                } catch {
                    /* use default */
                }
                set_warning(error_msg);
                const current_value = String($input.val() ?? "");
                if (!current_value.trim()) {
                    $input.val(original_draft);
                    $input.trigger("focus");
                }
            }
            sync_live_row();
        }
    };
    xhr.onerror = () => {
        state.sending_message = false;
        update_send_button_state();
        remove_local_user_echo(client_msg_id);
        set_warning("Network error sending supervisor message.");
        const current_value = String($input.val() ?? "");
        if (!current_value.trim()) {
            $input.val(original_draft);
            $input.trigger("focus");
        }
        sync_live_row();
    };
    xhr.send(form);
}

function open_ai_for_context(context: TopicContext): void {
    sidebar_ui.show_userlist_sidebar();
    $("body").removeClass("hide-right-sidebar");
    set_tab("ai");
    switch_topic(context);
    attach_timeline_wheel_listener();
    attach_panel_wheel_listener();
    void poll_session();
    setTimeout(() => {
        $("#foundry-supervisor-sidebar-input").trigger("focus");
    }, 0);
}

export function open_for_current_topic(): void {
    const context = current_topic_context() ?? state.context;
    if (!context) {
        ui_report.generic_embed_error("Open a stream topic first, then launch Supervisor AI.", 3500);
        return;
    }
    open_ai_for_context(context);
}

export function open_for_topic(stream_id: number, topic: string): void {
    const stream = stream_data.get_sub_by_id(stream_id);
    if (!stream || !topic.trim()) {
        ui_report.generic_embed_error("Unable to open Supervisor AI for this topic.", 3500);
        return;
    }
    open_ai_for_context({
        stream_id,
        stream_name: stream.name,
        topic,
        topic_scope_id: topic_scope_id_for(stream_id, topic),
    });
}

function maybe_refresh_topic_context(): void {
    if (state.active_tab !== "ai") {
        return;
    }
    const context = current_topic_context();
    if (!context) {
        return;
    }
    if (state.context?.topic_scope_id !== context.topic_scope_id) {
        open_ai_for_context(context);
    }
}

export function initialize(): void {
    if (state.initialized) {
        return;
    }
    state.initialized = true;

    $("body").on("click", "#right-sidebar-tab-users", (e) => {
        e.preventDefault();
        set_tab("users");
    });

    $("body").on("click", "#right-sidebar-tab-ai", (e) => {
        e.preventDefault();
        open_for_current_topic();
    });

    $("body").on("click", "#foundry-supervisor-sidebar-send", (e) => {
        e.preventDefault();
        const message = String($("#foundry-supervisor-sidebar-input").val() ?? "");
        post_message(message);
    });

    $("body").on("wheel", "#foundry-supervisor-sidebar-timeline", (e) => {
        confine_timeline_wheel(e);
    });

    $("body").on("scroll", "#foundry-supervisor-sidebar-timeline", () => {
        sync_scroll_bottom_button();
    });

    $("body").on("click", "#foundry-supervisor-scroll-bottom", (e) => {
        e.preventDefault();
        scroll_timeline_to_bottom();
        sync_scroll_bottom_button();
    });

    $("body").on("keydown", "#foundry-supervisor-sidebar-input", (e) => {
        if (e.key !== "Enter" || e.shiftKey) {
            return;
        }
        e.preventDefault();
        const message = String($("#foundry-supervisor-sidebar-input").val() ?? "");
        post_message(message);
    });

    $("body").on("input", "#foundry-supervisor-sidebar-input", () => {
        update_send_button_state();
    });

    $("body").on("click", "#foundry-supervisor-attach", (e) => {
        e.preventDefault();
        $("#foundry-supervisor-file-input").trigger("click");
    });

    $("body").on("change", "#foundry-supervisor-file-input", function () {
        const input = this instanceof HTMLInputElement ? this : undefined;
        if (input?.files && input.files.length > 0) {
            add_attachments(input.files);
            input.value = "";
        }
    });

    $("body").on("click", ".foundry-supervisor-attachment-remove", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const index_str = $(this).attr("data-attachment-index");
        if (index_str !== undefined) {
            const index = Number.parseInt(index_str, 10);
            if (Number.isFinite(index)) {
                remove_attachment(index);
            }
        }
    });

    $("body").on("click", "#foundry-supervisor-sidebar-root [data-foundry-markdown-copy]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
            const button = this instanceof HTMLButtonElement ? this : undefined;
            const block = button?.closest(".foundry-markdown-code");
            const text = block?.querySelector("pre code, pre")?.textContent ?? "";
            if (!text.trim()) {
                return;
            }
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
                ui_report.generic_embed_error("Clipboard API unavailable.", 2200);
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                if (button) {
                    button.innerHTML = '<i class="zulip-icon zulip-icon-check" aria-hidden="true"></i>';
                    window.setTimeout(() => {
                        if (button.isConnected) {
                            button.innerHTML = '<i class="zulip-icon zulip-icon-copy" aria-hidden="true"></i>';
                        }
                    }, 1800);
                }
            } catch {
                ui_report.generic_embed_error("Unable to copy code block.", 2200);
            }
        })();
    });

    $(window).on("hashchange", () => {
        maybe_refresh_topic_context();
    });

    sync_ai_open_body_class();
    render_empty_state("Open a stream topic and click AI to start the shared supervisor chat.");
}
