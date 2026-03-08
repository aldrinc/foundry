import $ from "jquery";
import _ from "lodash";

import * as channel from "./channel.ts";
import * as compose_state from "./compose_state.ts";
import * as dialog_widget from "./dialog_widget.ts";
import * as hash_util from "./hash_util.ts";
import * as markdown from "./markdown.ts";
import * as meridian_supervisor_sidebar from "./meridian_supervisor_sidebar.ts";
import * as narrow_state from "./narrow_state.ts";
import * as rendered_markdown from "./rendered_markdown.ts";
import * as stream_data from "./stream_data.ts";
import * as ui_report from "./ui_report.ts";

type MeridianTaskSummary = {
    task_id: string;
    title: string;
    status: string;
    provider: string;
    model: string;
    user_id: string;
    source_stream_name: string;
    source_topic_name: string;
    elapsed_seconds: number | undefined;
    preview_ready: boolean;
    preview_url: string;
    branch_name: string;
    worktree_path: string;
    container_name: string;
    container_runtime: string;
    result_text: string;
    error_text: string;
    blocked_reason: string;
    clarification_questions: string[];
    clarification_requested: boolean;
    approved: boolean;
    assigned_worker: string;
    assigned_role: string;
    assigned_by: string;
    directive_id: string;
    plan_revision_id: string;
    depends_on_task_ids: string[];
    file_claims: string[];
    area_claims: string[];
    artifacts: MeridianTaskArtifact[];
    approvals_pending: string[];
    approvals_required: string[];
    blockers: string[];
    turns_used: number | undefined;
    tokens_used: number | undefined;
    usd_estimate: number | undefined;
    last_heartbeat_at: string;
    last_meaningful_artifact: string;
    started_at: string;
    finished_at: string;
    created_at: string;
    updated_at: string;
};

type MeridianTaskArtifact = {
    kind: string;
    label: string;
    url: string;
    status: string;
};

type MeridianProviderAuthEntry = {
    provider: string;
    display_name: string;
    auth_modes: string[];
    oauth_configured: boolean;
    credential_connected: boolean;
    credential_auth_mode: string;
    credential_label: string;
    credential_updated_at: string;
};

type MeridianIntegrationEntry = {
    integration: string;
    display_name: string;
    auth_modes: string[];
    oauth_configured: boolean;
    tools: string[];
    notes: string;
    base_url: string;
    credential_connected: boolean;
    credential_auth_mode: string;
    credential_label: string;
    credential_updated_at: string;
};

type MeridianIntegrationPolicy = {
    auto_topic_transcript: boolean;
    auto_repo_context: boolean;
    allow_external_integrations: boolean;
    enabled_integrations: string[];
};

type MeridianSidebarPayload = {
    topic_scope_id: string;
    task_count: number;
    counts: Record<string, number>;
    tasks: MeridianTaskSummary[];
};

type MeridianTaskEvent = {
    id: number;
    task_id: string;
    ts: string;
    level: string;
    event_type: string;
    message: string;
    data: Record<string, unknown>;
};

type MeridianPlanRevision = {
    plan_revision_id: string;
    topic_scope_id: string;
    author_id: string;
    summary: string;
    objective: string;
    assumptions: string[];
    unknowns: string[];
    execution_steps: Record<string, unknown>[];
    candidate_parallel_seams: Record<string, unknown>[];
    approval_points: string[];
    status: string;
    source: Record<string, unknown>;
    created_at: string;
    updated_at: string;
};

type MeridianSupervisorContext = {
    soul: string;
    memory_tail: string;
    paths: Record<string, unknown>;
};

type TopicContext = {
    stream_id: number;
    stream_name: string;
    topic: string;
    topic_scope_id: string;
};

const SIDEBAR_POLL_MS = 2500;
const EVENTS_FALLBACK_POLL_MS = 3500;
const ENABLE_TASK_EVENT_STREAM = false;
const TASK_ROWS_LIMIT = 8;
const EVENT_ROWS_LIMIT = 300;
const AUTO_SCROLL_STICKY_DISTANCE_PX = 72;
const REPO_ID_STORAGE_KEY = "meridian.topic_task_repo_id";
const PROVIDER_STORAGE_KEY = "meridian.topic_task_provider";
const DEFAULT_REPO_ID = "";
const DEFAULT_PROVIDER = "codex";
const CREATE_TASK_MODAL_ID = "meridian-topic-create-task-modal";
const CREATE_TASK_MODAL_FORM_ID = "meridian-topic-create-task-form";
const PROVIDER_ACCOUNTS_MODAL_ID = "meridian-provider-accounts-modal";
const PROVIDER_ACCOUNTS_FORM_ID = "meridian-provider-accounts-form";
const SUPERVISOR_PLAN_MODAL_ID = "meridian-supervisor-plan-modal";
const SUPERVISOR_PLAN_FORM_ID = "meridian-supervisor-plan-form";
const OAUTH_POPUP_NAME = "meridian-provider-oauth";
const DIFF_MAX_RENDER_CHARS = 22000;
const SUPERVISOR_ROW_ID = "__meridian_supervisor__";

let sidebar_poll_timer: number | null = null;
let events_poll_timer: number | null = null;
let sidebar_request_in_flight = false;
let events_request_in_flight = false;
let task_details_request_task_id = "";
let create_request_in_flight = false;
let reply_request_in_flight = false;
let supervisor_plan_request_in_flight = false;
let supervisor_view_request_in_flight = false;
let supervisor_dispatch_request_in_flight = false;
let provider_auth_request_in_flight = false;
let integration_request_in_flight = false;
let task_events_stream: EventSource | null = null;
let task_events_stream_task_id = "";
let task_events_stream_disconnect_timer: number | null = null;
let pending_task_open_scope_id = "";
let provider_auth_entries: MeridianProviderAuthEntry[] = [];

type PendingOauthContinuation =
    | {
          mode: "create_task";
          context: TopicContext;
          instruction: string;
          task_title: string;
          repo_id: string;
          provider: string;
      }
    | {
          mode: "connect_only";
      };

let pending_oauth_continuation: PendingOauthContinuation | null = null;
let integration_entries: MeridianIntegrationEntry[] = [];
let integration_policy: MeridianIntegrationPolicy = {
    auto_topic_transcript: true,
    auto_repo_context: true,
    allow_external_integrations: true,
    enabled_integrations: [],
};

type MeridianTasksUiState = {
    topic_scope_id: string;
    selected_task_id: string;
    task_view_open: boolean;
    task_view_mode: "task" | "supervisor";
    task_follow_output: boolean;
    task_stream_mode: "chat" | "activity";
    event_after_id: number;
    event_rows: MeridianTaskEvent[];
    last_sidebar: MeridianSidebarPayload | null;
    sidebar_rows_signature: string;
    task_view_signature: string;
    task_view_rows_signature: string;
    supervisor_view_signature: string;
    supervisor_plan_revision: MeridianPlanRevision | null;
    supervisor_context: MeridianSupervisorContext | null;
    pending_reply_message: string;
    pending_reply_time: string;
    event_stream_connected: boolean;
    event_stream_disconnected: boolean;
    task_inline_error: string;
    task_review_mode: "unified" | "split";
    task_details_collapsed: boolean;
    task_inspector_open: boolean;
};

const state: MeridianTasksUiState = {
    topic_scope_id: "",
    selected_task_id: "",
    task_view_open: false,
    task_view_mode: "task",
    task_follow_output: true,
    task_stream_mode: "chat",
    event_after_id: 0,
    event_rows: [],
    last_sidebar: null,
    sidebar_rows_signature: "",
    task_view_signature: "",
    task_view_rows_signature: "",
    supervisor_view_signature: "",
    supervisor_plan_revision: null,
    supervisor_context: null,
    pending_reply_message: "",
    pending_reply_time: "",
    event_stream_connected: false,
    event_stream_disconnected: false,
    task_inline_error: "",
    task_review_mode: "unified",
    task_details_collapsed: true,
    task_inspector_open: false,
};

function normalized_event_type(event_type: string): string {
    return event_type.trim().toLowerCase();
}

function as_record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(value));
}

function as_record_or_json(value: unknown): Record<string, unknown> | undefined {
    const direct = as_record(value);
    if (direct) {
        return direct;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        return as_record(JSON.parse(trimmed));
    } catch {
        return undefined;
    }
}

function as_string(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function as_number(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function as_bool(value: unknown): boolean {
    return value === true;
}

function as_string_list(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: string[] = [];
    for (const item of value) {
        const text = String(item ?? "").trim();
        if (text) {
            out.push(text);
        }
    }
    return out;
}

function as_artifact_list(value: unknown): MeridianTaskArtifact[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const artifacts: MeridianTaskArtifact[] = [];
    for (const item of value) {
        const record = as_record(item);
        if (!record) {
            continue;
        }
        const kind = as_string(record["kind"]).trim() || "artifact";
        const label = as_string(record["label"]).trim() || as_string(record["name"]).trim() || kind;
        const url = as_string(record["url"]).trim() || as_string(record["ref"]).trim();
        const status = as_string(record["status"]).trim() || "available";
        artifacts.push({kind, label, url, status});
    }
    return artifacts;
}

function parse_provider_auth_entries(data: unknown): MeridianProviderAuthEntry[] {
    const root = as_record(data);
    if (!root) {
        return [];
    }
    const raw_root = as_record(root["raw"]);
    const providers_raw: unknown[] = Array.isArray(root["providers"])
        ? root["providers"]
        : Array.isArray(raw_root?.["providers"])
          ? raw_root["providers"]
          : [];
    const entries: MeridianProviderAuthEntry[] = [];
    for (const value of providers_raw) {
        const item = as_record(value);
        if (!item) {
            continue;
        }
        const provider = normalize_provider(as_string(item["provider"]));
        const credential = as_record(item["credential"]);
        entries.push({
            provider,
            display_name: as_string(item["display_name"]).trim() || provider,
            auth_modes: as_string_list(item["auth_modes"]),
            oauth_configured: as_bool(item["oauth_configured"]),
            credential_connected: credential !== undefined && as_string(credential["status"]) === "active",
            credential_auth_mode: as_string(credential?.["auth_mode"]).trim(),
            credential_label: as_string(credential?.["label"]).trim(),
            credential_updated_at: as_string(credential?.["updated_at"]).trim(),
        });
    }
    return entries;
}

function parse_integration_policy(data: unknown): MeridianIntegrationPolicy {
    const root = as_record(data);
    const raw_root = as_record(root?.["raw"]);
    const policy_raw = as_record(root?.["policy"]) ?? as_record(raw_root?.["policy"]) ?? {};
    const enabled = as_string_list(policy_raw["enabled_integrations"]);
    return {
        auto_topic_transcript:
            policy_raw["auto_topic_transcript"] === undefined
                ? true
                : as_bool(policy_raw["auto_topic_transcript"]),
        auto_repo_context:
            policy_raw["auto_repo_context"] === undefined
                ? true
                : as_bool(policy_raw["auto_repo_context"]),
        allow_external_integrations:
            policy_raw["allow_external_integrations"] === undefined
                ? true
                : as_bool(policy_raw["allow_external_integrations"]),
        enabled_integrations: enabled.map((item) => item.trim().toLowerCase()).filter(Boolean),
    };
}

function parse_integration_entries(data: unknown): MeridianIntegrationEntry[] {
    const root = as_record(data);
    if (!root) {
        return [];
    }
    const raw_root = as_record(root["raw"]);
    const integrations_raw: unknown[] = Array.isArray(root["integrations"])
        ? root["integrations"]
        : Array.isArray(raw_root?.["integrations"])
          ? raw_root["integrations"]
          : [];
    const entries: MeridianIntegrationEntry[] = [];
    for (const value of integrations_raw) {
        const item = as_record(value);
        if (!item) {
            continue;
        }
        const integration = as_string(item["integration"]).trim().toLowerCase();
        if (!integration) {
            continue;
        }
        const credential = as_record(item["credential"]);
        entries.push({
            integration,
            display_name: as_string(item["display_name"]).trim() || integration,
            auth_modes: as_string_list(item["auth_modes"]).map((mode) => mode.toLowerCase()),
            oauth_configured: as_bool(item["oauth_configured"]),
            tools: as_string_list(item["tools"]),
            notes: as_string(item["notes"]).trim(),
            base_url: as_string(item["base_url"]).trim(),
            credential_connected: credential !== undefined && as_string(credential["status"]) === "active",
            credential_auth_mode: as_string(credential?.["auth_mode"]).trim(),
            credential_label: as_string(credential?.["label"]).trim(),
            credential_updated_at: as_string(credential?.["updated_at"]).trim(),
        });
    }
    return entries;
}

function parse_task_summary(value: unknown): MeridianTaskSummary | undefined {
    const item = as_record(value);
    if (!item) {
        return undefined;
    }
    const thread_ref = as_record(item["zulip_thread_ref"]);
    const task_id = as_string(item["task_id"]).trim();
    if (!task_id) {
        return undefined;
    }
    const options = as_record(item["options"]) ?? {};
    return {
        task_id,
        title: as_string(item["title"]).trim() || as_string(item["task_title"]).trim() || task_id,
        status: as_string(item["status"]).toLowerCase() || "queued",
        provider: as_string(item["provider"]),
        model:
            as_string(item["model"]).trim() ||
            as_string(options["model"]).trim() ||
            as_string(options["provider_model"]).trim() ||
            as_string(options["runtime_model"]).trim(),
        user_id: as_string(item["user_id"]),
        source_stream_name:
            as_string(item["source_stream_name"]) ||
            as_string(thread_ref?.["stream_name"]) ||
            as_string(thread_ref?.["stream"]),
        source_topic_name:
            as_string(item["source_topic_name"]) ||
            as_string(thread_ref?.["topic_name"]) ||
            as_string(thread_ref?.["topic"]),
        elapsed_seconds: as_number(item["elapsed_seconds"]),
        preview_ready: item["preview_ready"] === true,
        preview_url: as_string(item["preview_url"]),
        branch_name: as_string(item["branch_name"]),
        worktree_path: as_string(item["worktree_path"]),
        container_name: as_string(item["container_name"]),
        container_runtime: as_string(item["container_runtime"]),
        result_text: as_string(item["result_text"]),
        error_text: as_string(item["error_text"]),
        blocked_reason: as_string(item["blocked_reason"]),
        clarification_questions: as_string_list(item["clarification_questions"]),
        clarification_requested: item["clarification_requested"] === true,
        approved: item["approved"] === true,
        assigned_worker: as_string(item["assigned_worker"]).trim(),
        assigned_role: as_string(item["assigned_role"]).trim(),
        assigned_by: as_string(item["assigned_by"]).trim(),
        directive_id: as_string(item["directive_id"]).trim(),
        plan_revision_id: as_string(item["plan_revision_id"]).trim(),
        depends_on_task_ids: as_string_list(item["depends_on_task_ids"]),
        file_claims: as_string_list(item["file_claims"]),
        area_claims: as_string_list(item["area_claims"]),
        artifacts: as_artifact_list(item["artifacts"]),
        approvals_pending: as_string_list(item["approvals_pending"]),
        approvals_required: as_string_list(item["approvals_required"]),
        blockers: as_string_list(item["blockers"]),
        turns_used: as_number(item["turns_used"]),
        tokens_used: as_number(item["tokens_used"]),
        usd_estimate: as_number(item["usd_estimate"]),
        last_heartbeat_at: as_string(item["last_heartbeat_at"]),
        last_meaningful_artifact: as_string(item["last_meaningful_artifact"]),
        started_at: as_string(item["started_at"]),
        finished_at: as_string(item["finished_at"]),
        created_at: as_string(item["created_at"]),
        updated_at: as_string(item["updated_at"]),
    };
}

function parse_sidebar_payload(data: unknown): MeridianSidebarPayload | undefined {
    const root = as_record(data);
    if (!root) {
        return undefined;
    }
    const sidebar = as_record(root["sidebar"]);
    if (!sidebar) {
        return undefined;
    }

    const tasks_raw = Array.isArray(sidebar["tasks"]) ? sidebar["tasks"] : [];
    const tasks: MeridianTaskSummary[] = [];
    for (const value of tasks_raw) {
        const task = parse_task_summary(value);
        if (task) {
            tasks.push(task);
        }
    }

    const counts_raw = as_record(sidebar["counts"]) ?? {};
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(counts_raw)) {
        const numeric = as_number(value);
        if (numeric !== undefined) {
            counts[key] = numeric;
        }
    }

    return {
        topic_scope_id: as_string(sidebar["topic_scope_id"]),
        task_count: as_number(sidebar["task_count"]) ?? tasks.length,
        counts,
        tasks,
    };
}

function parse_plan_revision(value: unknown): MeridianPlanRevision | null {
    const item = as_record(value);
    if (!item) {
        return null;
    }
    const plan_revision_id = as_string(item["plan_revision_id"]).trim();
    if (!plan_revision_id) {
        return null;
    }
    return {
        plan_revision_id,
        topic_scope_id: as_string(item["topic_scope_id"]).trim(),
        author_id: as_string(item["author_id"]).trim(),
        summary: as_string(item["summary"]).trim(),
        objective: as_string(item["objective"]).trim(),
        assumptions: as_string_list(item["assumptions"]),
        unknowns: as_string_list(item["unknowns"]),
        execution_steps: Array.isArray(item["execution_steps"])
            ? (item["execution_steps"] as Record<string, unknown>[])
            : [],
        candidate_parallel_seams: Array.isArray(item["candidate_parallel_seams"])
            ? (item["candidate_parallel_seams"] as Record<string, unknown>[])
            : [],
        approval_points: as_string_list(item["approval_points"]),
        status: as_string(item["status"]).trim(),
        source: (as_record(item["source"]) ?? {}) as Record<string, unknown>,
        created_at: as_string(item["created_at"]).trim(),
        updated_at: as_string(item["updated_at"]).trim(),
    };
}

function parse_supervisor_context(value: unknown): MeridianSupervisorContext | null {
    const root = as_record(value);
    if (!root) {
        return null;
    }
    return {
        soul: as_string(root["soul"]),
        memory_tail: as_string(root["memory_tail"]),
        paths: (as_record(root["paths"]) ?? {}) as Record<string, unknown>,
    };
}

function parse_task_status_payload(data: unknown): MeridianTaskSummary | undefined {
    const root = as_record(data);
    if (!root) {
        return undefined;
    }
    const task =
        parse_task_summary(root["task"]) ??
        parse_task_summary(as_record(root["raw"])?.["task"]);
    if (!task) {
        return undefined;
    }
    return task;
}

function parse_timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function order_sidebar_tasks(tasks: MeridianTaskSummary[]): MeridianTaskSummary[] {
    return tasks.toSorted((left, right) => {
        const by_created = parse_timestamp(right.created_at) - parse_timestamp(left.created_at);
        if (by_created !== 0) {
            return by_created;
        }
        return left.task_id.localeCompare(right.task_id);
    });
}

function parse_task_event(value: unknown, fallback_task_id = ""): MeridianTaskEvent | undefined {
    const item = as_record(value);
    if (!item) {
        return undefined;
    }
    const event_id = as_number(item["id"]);
    const task_id = as_string(item["task_id"]).trim() || fallback_task_id.trim();
    if (event_id === undefined || !task_id) {
        return undefined;
    }
    return {
        id: event_id,
        task_id,
        ts: as_string(item["ts"]),
        level: as_string(item["level"]),
        event_type: as_string(item["event_type"]) || as_string(item["type"]),
        message: as_string(item["message"]) || as_string(item["text"]),
        data: as_record_or_json(item["data"]) ?? {},
    };
}

function parse_events(data: unknown): MeridianTaskEvent[] {
    const root = as_record(data);
    if (!root) {
        return [];
    }
    const root_task_id = as_string(root["task_id"]).trim();
    const nested_raw = as_record(root["raw"]);
    const events_raw = Array.isArray(root["events"])
        ? root["events"]
        : Array.isArray(nested_raw?.["events"])
          ? nested_raw["events"]
          : [];
    const events: MeridianTaskEvent[] = [];

    for (const value of events_raw) {
        const event = parse_task_event(value, root_task_id);
        if (event) {
            events.push(event);
        }
    }
    return events;
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

function ai_sidebar_tab_active(): boolean {
    return (
        $("#right-sidebar-tab-ai").hasClass("selected") &&
        $("#right-sidebar-ai-panel").hasClass("is-active")
    );
}

function find_sidebar_topic_row(context: TopicContext): JQuery {
    const stream_selector = `.narrow-filter[data-stream-id="${CSS.escape(
        context.stream_id.toString(),
    )}"]`;
    const topic_selector = `.topic-list-item[data-topic-name="${CSS.escape(context.topic)}"]`;
    const selector = `#stream_filters ${stream_selector} ${topic_selector}`;
    return $(selector).first();
}

function get_repo_id_preference(): string {
    const raw = window.localStorage.getItem(REPO_ID_STORAGE_KEY);
    const value = (raw ?? "").trim();
    return value || DEFAULT_REPO_ID;
}

function set_repo_id_preference(repo_id: string): void {
    const value = repo_id.trim();
    if (!value) {
        return;
    }
    window.localStorage.setItem(REPO_ID_STORAGE_KEY, value);
}

function normalize_provider(provider: string): string {
    const value = provider.trim().toLowerCase();
    if (value === "open_code") {
        return "opencode";
    }
    if (
        value === "claude" ||
        value === "claudecode" ||
        value === "claude_code" ||
        value === "cloud_code"
    ) {
        return "claude_code";
    }
    return value || DEFAULT_PROVIDER;
}

function get_provider_preference(): string {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    const value = normalize_provider(raw ?? "");
    return value || DEFAULT_PROVIDER;
}

function set_provider_preference(provider: string): void {
    const value = normalize_provider(provider);
    if (!value) {
        return;
    }
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, value);
}

const STATUS_LABELS: Record<string, string> = {
    queued: "QUEUED",
    running: "RUNNING",
    paused: "PAUSED",
    stalled: "STALLED",
    blocked_approval: "BLOCKED: APPROVAL",
    blocked_dependency: "BLOCKED: DEPENDENCY",
    blocked_information: "BLOCKED: INFO",
    at_risk: "AT RISK",
    done: "DONE",
    failed: "FAILED",
    canceled: "CANCELED",
};

function provider_default_model(provider: string): string {
    const normalized = normalize_provider(provider);
    if (normalized === "opencode") {
        return "fireworks/kimi-k2p5";
    }
    if (normalized === "claude_code") {
        return "claude-sonnet-4";
    }
    if (normalized === "codex") {
        return "gpt-5.2-2025-12-11";
    }
    return "";
}

function status_class(status: string): string {
    const normalized = status.trim().toLowerCase();
    if (normalized in STATUS_LABELS) {
        return normalized;
    }
    return "queued";
}

function status_label(status: string): string {
    return STATUS_LABELS[status_class(status)] ?? "QUEUED";
}

function task_is_active(status: string): boolean {
    const normalized = status_class(status);
    return normalized === "queued" || normalized === "running";
}

function task_can_pause(status: string): boolean {
    const normalized = status_class(status);
    return normalized === "queued" || normalized === "running";
}

function task_can_resume(status: string): boolean {
    const normalized = status_class(status);
    return [
        "paused",
        "stalled",
        "blocked_dependency",
        "blocked_information",
        "blocked_approval",
        "at_risk",
    ].includes(normalized);
}

function task_is_terminal(status: string): boolean {
    return ["done", "failed", "canceled"].includes(status_class(status));
}

function task_can_cancel(status: string): boolean {
    return !task_is_terminal(status);
}

function status_short_label(status: string): string {
    const normalized = status_class(status);
    if (normalized === "running") {
        return "RUN";
    }
    if (normalized === "paused") {
        return "PAUSE";
    }
    if (normalized === "stalled") {
        return "STALL";
    }
    if (normalized === "blocked_approval") {
        return "BLK-APR";
    }
    if (normalized === "blocked_dependency") {
        return "BLK-DEP";
    }
    if (normalized === "blocked_information") {
        return "BLK-INFO";
    }
    if (normalized === "at_risk") {
        return "RISK";
    }
    if (normalized === "queued") {
        return "Q";
    }
    if (normalized === "done") {
        return "DONE";
    }
    if (normalized === "failed") {
        return "ERR";
    }
    return "STOP";
}

function event_level_class(level: string): "info" | "warning" | "error" | "success" {
    const normalized = level.trim().toLowerCase();
    if (["error", "fatal", "failed"].includes(normalized)) {
        return "error";
    }
    if (["warn", "warning"].includes(normalized)) {
        return "warning";
    }
    if (["success", "ok", "complete", "completed", "done"].includes(normalized)) {
        return "success";
    }
    return "info";
}

function sidebar_rows_signature(tasks: MeridianTaskSummary[]): string {
    const supervisor_selected = state.task_view_open && state.task_view_mode === "supervisor";
    const task_sig = tasks
        .slice(0, TASK_ROWS_LIMIT)
        .map((task) => {
            const selected =
                state.task_view_open &&
                state.task_view_mode === "task" &&
                task.task_id === state.selected_task_id;
            return `${task.task_id}|${task.title}|${status_class(task.status)}|${selected}`;
        })
        .join("||");
    return `sup:${supervisor_selected}||${task_sig}`;
}

function format_elapsed(seconds: number | undefined): string {
    if (seconds === undefined) {
        return "0s";
    }
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    if (mins < 60) {
        return `${mins}m ${rem}s`;
    }
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
}

function format_event_time(iso_ts: string): string {
    if (!iso_ts) {
        return "";
    }
    const parsed = new Date(iso_ts);
    if (Number.isNaN(parsed.getTime())) {
        return iso_ts;
    }
    return parsed.toLocaleTimeString();
}

function infer_task_phase(task: MeridianTaskSummary, rows: MeridianTaskEvent[]): string {
    const status = status_class(task.status);
    if (status === "done") {
        return "Completed";
    }
    if (status === "failed") {
        return "Failed";
    }
    if (status === "canceled") {
        return "Canceled";
    }
    if (status === "paused") {
        return "Paused";
    }
    if (status === "stalled") {
        return "Stalled";
    }
    if (status === "blocked_approval") {
        return "Waiting for approval";
    }
    if (status === "blocked_dependency") {
        return "Blocked by dependency";
    }
    if (status === "blocked_information") {
        return "Needs clarification";
    }
    if (status === "at_risk") {
        return "At risk";
    }
    const latest = rows.at(-1);
    if (!latest) {
        return status === "running" ? "Starting" : "Queued";
    }
    const event_type = normalized_event_type(latest.event_type);
    if (event_type === "chat.user") {
        return "Steering";
    }
    if (event_type === "provider_command" || event_type.startsWith("command.")) {
        return "Running command";
    }
    if (
        event_type.startsWith("provider_") ||
        event_type.startsWith("provider.") ||
        event_type.startsWith("agent.")
    ) {
        return "Agent executing";
    }
    if (event_type.startsWith("preview_") || event_type.startsWith("preview.")) {
        return "Preparing preview";
    }
    if (event_type.startsWith("workspace_") || event_type.startsWith("workspace.")) {
        return "Preparing workspace";
    }
    if (event_type.startsWith("container.") || event_type.startsWith("container_")) {
        return "Preparing runtime";
    }
    if (event_type.startsWith("worktree.") || event_type.startsWith("worktree_")) {
        return "Preparing worktree";
    }
    return status === "running" ? "Running" : "Queued";
}

function ensure_task_view_container(): JQuery {
    let $view = $("#meridian-task-main-view");
    if ($view.length === 0) {
        $view = $("<div>")
            .attr("id", "meridian-task-main-view")
            .addClass("notdisplayed no-visible-focus-outlines")
            .attr("aria-live", "polite");
        $("#message_feed_container").append($view);
    }
    return $view;
}

function set_task_view_open_state(is_open: boolean): void {
    const $view = ensure_task_view_container();
    $view.toggleClass("notdisplayed", !is_open);
    $("body").toggleClass("meridian-task-main-view-open", is_open);
}

function hide_task_view(force = false): void {
    const was_open = state.task_view_open;
    close_selected_task_event_stream();
    pending_task_open_scope_id = "";
    state.task_view_open = false;
    state.task_view_mode = "task";
    state.task_view_signature = "";
    state.task_view_rows_signature = "";
    state.supervisor_view_signature = "";
    state.supervisor_plan_revision = null;
    state.supervisor_context = null;
    state.task_follow_output = true;
    state.pending_reply_message = "";
    state.pending_reply_time = "";
    state.event_stream_disconnected = false;
    state.task_inline_error = "";
    const $view = ensure_task_view_container();
    const was_visible = !$view.hasClass("notdisplayed");
    $view.addClass("notdisplayed");
    $view.empty();
    chat_dom_state = null;
    set_task_view_open_state(false);
    if (was_open || force || was_visible) {
        $view.trigger("meridian_task_view_hidden");
    }
}

function navigate_to_topic(stream_id: number, topic: string): void {
    const normalized_topic = topic.trim();
    if (!normalized_topic) {
        return;
    }
    const context = current_topic_context();
    if (context?.stream_id === stream_id && context.topic === normalized_topic) {
        return;
    }
    window.location.hash = hash_util.by_stream_topic_url(stream_id, normalized_topic);
}

function reset_task_stream_state(task_id = ""): void {
    close_selected_task_event_stream();
    state.selected_task_id = task_id.trim();
    state.task_view_mode = "task";
    state.task_stream_mode = "chat";
    state.event_after_id = 0;
    state.event_rows = [];
    state.task_follow_output = true;
    state.task_view_signature = "";
    state.task_view_rows_signature = "";
    state.supervisor_view_signature = "";
    state.supervisor_plan_revision = null;
    state.supervisor_context = null;
    state.pending_reply_message = "";
    state.pending_reply_time = "";
    state.event_stream_disconnected = false;
    state.task_inline_error = "";
    state.task_review_mode = "unified";
    state.task_details_collapsed = true;
    chat_dom_state = null;
}

function clear_sidebar_task_rows(topic_scope_id?: string): void {
    if (topic_scope_id) {
        $(
            `#stream_filters .meridian-topic-task-sublist[data-topic-scope-id="${CSS.escape(
                topic_scope_id,
            )}"]`,
        ).remove();
    } else {
        $("#stream_filters .meridian-topic-task-sublist").remove();
    }
    state.sidebar_rows_signature = "";
}

function build_sidebar_task_row_markup(
    context: TopicContext,
    task: MeridianTaskSummary,
): string {
    const status = status_class(task.status);
    const selected =
        state.task_view_open &&
        state.task_view_mode === "task" &&
        task.task_id === state.selected_task_id
            ? " meridian-task-selected"
            : "";
    const short_status = status_short_label(task.status);
    const topic_url = hash_util.by_stream_topic_url(context.stream_id, context.topic);
    return `
<li class="meridian-topic-task-item meridian-task-status-${status}${selected}" data-meridian-task-id="${_.escape(task.task_id)}">
    <a href="${_.escape(topic_url)}" class="meridian-topic-task-link" data-meridian-task-id="${_.escape(task.task_id)}" data-meridian-stream-id="${context.stream_id}" data-meridian-topic-name="${_.escape(context.topic)}" aria-label="${_.escape(task.title)}">
        <span class="meridian-topic-task-main">
            <span class="meridian-topic-task-dot"></span>
            <span class="meridian-topic-task-title">${_.escape(task.title)}</span>
        </span>
        <span class="meridian-topic-task-mini-status">${_.escape(short_status)}</span>
    </a>
</li>`;
}

function update_sidebar_task_row(
    context: TopicContext,
    $row: JQuery,
    task: MeridianTaskSummary,
): void {
    const status = status_class(task.status);
    const selected =
        state.task_view_open &&
        state.task_view_mode === "task" &&
        task.task_id === state.selected_task_id;
    const short_status = status_short_label(task.status);
    const topic_url = hash_util.by_stream_topic_url(context.stream_id, context.topic);
    $row.attr("data-meridian-task-id", task.task_id);
    $row.removeClass(
        [
            "meridian-task-status-running",
            "meridian-task-status-queued",
            "meridian-task-status-paused",
            "meridian-task-status-stalled",
            "meridian-task-status-blocked_approval",
            "meridian-task-status-blocked_dependency",
            "meridian-task-status-blocked_information",
            "meridian-task-status-at_risk",
            "meridian-task-status-done",
            "meridian-task-status-failed",
            "meridian-task-status-canceled",
            "meridian-task-selected",
        ].join(" "),
    );
    $row.addClass(`meridian-task-status-${status}`);
    if (selected) {
        $row.addClass("meridian-task-selected");
    }
    const $link = $row.find(".meridian-topic-task-link").first();
    $link.attr("data-meridian-task-id", task.task_id);
    $link.attr("data-meridian-stream-id", context.stream_id);
    $link.attr("data-meridian-topic-name", context.topic);
    $link.attr("href", topic_url);
    $link.attr("aria-label", task.title);
    $link.find(".meridian-topic-task-title").text(task.title);
    $link.find(".meridian-topic-task-mini-status").text(short_status);
}

function build_sidebar_supervisor_row_markup(context: TopicContext): string {
    const selected =
        state.task_view_open && state.task_view_mode === "supervisor"
            ? " meridian-task-selected"
            : "";
    const topic_url = hash_util.by_stream_topic_url(context.stream_id, context.topic);
    return `
<li class="meridian-topic-task-item meridian-topic-supervisor-item${selected}" data-meridian-task-id="${SUPERVISOR_ROW_ID}" data-meridian-supervisor="true">
    <a href="${_.escape(topic_url)}" class="meridian-topic-supervisor-link" data-meridian-stream-id="${context.stream_id}" data-meridian-topic-name="${_.escape(context.topic)}" aria-label="AI Supervisor">
        <span class="meridian-topic-task-main">
            <span class="meridian-topic-task-dot"></span>
            <span class="meridian-topic-task-title">AI Supervisor</span>
        </span>
        <span class="meridian-topic-task-mini-status">AI</span>
    </a>
</li>`;
}

function update_sidebar_supervisor_row(context: TopicContext, $row: JQuery): void {
    const selected =
        state.task_view_open && state.task_view_mode === "supervisor";
    const topic_url = hash_util.by_stream_topic_url(context.stream_id, context.topic);
    $row.attr("data-meridian-task-id", SUPERVISOR_ROW_ID);
    $row.attr("data-meridian-supervisor", "true");
    $row.toggleClass("meridian-task-selected", selected);
    const $link = $row.find(".meridian-topic-supervisor-link").first();
    $link.attr("href", topic_url);
    $link.attr("data-meridian-stream-id", context.stream_id);
    $link.attr("data-meridian-topic-name", context.topic);
}

function render_sidebar_task_rows(context: TopicContext, tasks: MeridianTaskSummary[]): void {
    const visible_tasks = tasks.slice(0, TASK_ROWS_LIMIT);

    const $topic_row = find_sidebar_topic_row(context);
    if ($topic_row.length === 0) {
        // Sidebar rows are rebuilt frequently; avoid tearing down/rebuilding our
        // task rows during those transitions because it causes visible flicker.
        return;
    }

    let $task_sublist = $topic_row.children(
        `.meridian-topic-task-sublist[data-topic-scope-id="${CSS.escape(context.topic_scope_id)}"]`,
    );
    if ($task_sublist.length === 0) {
        $topic_row.children(".meridian-topic-task-sublist").remove();
        $task_sublist = $("<ul>").addClass("meridian-topic-task-sublist");
        $task_sublist.attr("data-topic-scope-id", context.topic_scope_id);
        $topic_row.append($task_sublist);
    }

    const expected_ids = [SUPERVISOR_ROW_ID, ...visible_tasks.map((task) => task.task_id)];
    const dom_ids = $task_sublist
        .children(".meridian-topic-task-item")
        .toArray()
        .map((element) => ($(element).attr("data-meridian-task-id") ?? "").trim())
        .filter(Boolean);
    const signature = sidebar_rows_signature(visible_tasks);
    if (
        signature === state.sidebar_rows_signature &&
        dom_ids.join("||") === expected_ids.join("||")
    ) {
        return;
    }

    const order_matches = dom_ids.join("||") === expected_ids.join("||");
    if (order_matches) {
        const $supervisor = $task_sublist.children(
            `.meridian-topic-task-item[data-meridian-task-id="${SUPERVISOR_ROW_ID}"]`,
        );
        if ($supervisor.length > 0) {
            update_sidebar_supervisor_row(context, $supervisor);
        }
        for (const task of visible_tasks) {
            const $row = $task_sublist.children(
                `.meridian-topic-task-item[data-meridian-task-id="${_.escape(task.task_id)}"]`,
            );
            if ($row.length === 0) {
                continue;
            }
            update_sidebar_task_row(context, $row, task);
        }
        state.sidebar_rows_signature = signature;
        return;
    }

    const existing_rows = new Map<string, JQuery>();
    $task_sublist.children(".meridian-topic-task-item").each((_index, element) => {
        const id = ($(element).attr("data-meridian-task-id") ?? "").trim();
        if (id) {
            existing_rows.set(id, $(element));
        }
    });

    $task_sublist.empty();
    const supervisor_row = existing_rows.get(SUPERVISOR_ROW_ID) ?? $(build_sidebar_supervisor_row_markup(context));
    update_sidebar_supervisor_row(context, supervisor_row);
    $task_sublist.append(supervisor_row);
    for (const task of visible_tasks) {
        const existing = existing_rows.get(task.task_id);
        const $row = existing ?? $(build_sidebar_task_row_markup(context, task));
        update_sidebar_task_row(context, $row, task);
        $task_sublist.append($row);
    }

    state.sidebar_rows_signature = signature;
}

function task_link_stream_id($trigger: JQuery): number | undefined {
    const direct = $trigger.attr("data-meridian-stream-id");
    if (direct) {
        const parsed = Number.parseInt(direct, 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    const raw = $trigger
        .closest("li.topic-list-item")
        .closest("li.narrow-filter")
        .attr("data-stream-id");
    if (!raw) {
        return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
        return undefined;
    }
    return parsed;
}

function task_link_topic_name($trigger: JQuery): string | undefined {
    const direct = ($trigger.attr("data-meridian-topic-name") ?? "").trim();
    if (direct) {
        return direct;
    }
    const raw = ($trigger.closest("li.topic-list-item").attr("data-topic-name") ?? "").trim();
    if (!raw) {
        return undefined;
    }
    return raw;
}

function selected_task_from_sidebar(
    sidebar: MeridianSidebarPayload,
): MeridianTaskSummary | undefined {
    return (
        sidebar.tasks.find((task) => task.task_id === state.selected_task_id) ?? sidebar.tasks[0]
    );
}

type EventKind = "user" | "assistant" | "command" | "system" | "error";
type RenderableThreadEvent = {
    event_id: number;
    kind: EventKind;
    label: string;
    time: string;
    event_type: string;
    message: string;
    command: string;
    source: string;
    status: string;
    duration_ms: number | undefined;
    details: string;
    pending: boolean;
    merge_mode: "block" | "chunk";
};

function trim_repeated_chunk(existing: string, incoming: string): string {
    let next = incoming;
    if (!existing || !next) {
        return next;
    }
    if (existing.endsWith(next)) {
        return "";
    }
    if (next.length >= 80 && existing.includes(next)) {
        return "";
    }

    const overlap_limit = Math.min(existing.length, next.length, 2000);
    for (let size = overlap_limit; size >= 1; size -= 1) {
        if (existing.slice(-size) === next.slice(0, size)) {
            next = next.slice(size);
            break;
        }
    }
    if (!next) {
        return "";
    }
    return next;
}

function join_thread_text(existing: string, incoming: string): string {
    if (!existing) {
        return incoming;
    }
    if (!incoming) {
        return existing;
    }
    if (/\s$/.test(existing) || /^\s/.test(incoming)) {
        return `${existing}${incoming}`;
    }
    return `${existing}\n${incoming}`;
}

function merge_thread_text(existing: string, incoming: string): string {
    const left = existing;
    const right = incoming;
    const left_trimmed = left.trim();
    const right_trimmed = right.trim();
    if (!left_trimmed) {
        return right;
    }
    if (!right_trimmed) {
        return left;
    }
    if (
        left_trimmed === right_trimmed ||
        left_trimmed.endsWith(right_trimmed) ||
        left_trimmed.endsWith(`\n${right_trimmed}`) ||
        left_trimmed.includes(`\n${right_trimmed}\n`)
    ) {
        return left;
    }
    if (right_trimmed.startsWith(left_trimmed)) {
        return right;
    }
    if (left_trimmed.startsWith(right_trimmed)) {
        return left;
    }
    const min_overlap_length = 40;
    if (right_trimmed.length > min_overlap_length) {
        const right_prefix = right_trimmed.slice(0, 120).trim();
        const right_suffix = right_trimmed.slice(-120).trim();
        if (
            right_prefix &&
            right_suffix &&
            left_trimmed.includes(right_prefix) &&
            left_trimmed.includes(right_suffix)
        ) {
            return left;
        }
    }
    if (left_trimmed.length > min_overlap_length) {
        const left_prefix = left_trimmed.slice(0, 120).trim();
        const left_suffix = left_trimmed.slice(-120).trim();
        if (
            left_prefix &&
            left_suffix &&
            right_trimmed.includes(left_prefix) &&
            right_trimmed.includes(left_suffix)
        ) {
            return right;
        }
    }
    const trimmed = trim_repeated_chunk(left, right);
    if (!trimmed) {
        return left;
    }
    if (trimmed !== right) {
        return join_thread_text(left, trimmed);
    }
    return join_thread_text(left, right);
}

function event_kind(event: MeridianTaskEvent): EventKind {
    const event_type = normalized_event_type(event.event_type);
    if (event_type === "chat.user") {
        return "user";
    }
    if (
        event_type === "chat.assistant" ||
        event_type === "provider_stdout" ||
        event_type === "provider_output" ||
        event_type === "provider_assistant" ||
        event_type === "provider.delta" ||
        event_type === "provider.message" ||
        event_type === "provider.output" ||
        event_type === "provider.stdout" ||
        event_type === "agent.delta" ||
        event_type === "agent.message"
    ) {
        return "assistant";
    }
    if (
        event_type === "provider_command" ||
        event_type === "provider.command" ||
        event_type === "provider_tool" ||
        event_type === "provider.tool" ||
        event_type === "tool.call" ||
        event_type === "tool.result" ||
        event_type === "tool.output" ||
        event_type === "command.started" ||
        event_type === "command.output" ||
        event_type === "command.completed" ||
        event_type === "command_started" ||
        event_type === "command_output" ||
        event_type === "command_completed" ||
        event_type.includes("tool_call") ||
        event_type.includes("function_call") ||
        event_type.startsWith("command.")
    ) {
        return "command";
    }
    if (
        event_type === "provider_stderr" ||
        event_type === "provider.stderr" ||
        event_type === "task.failed" ||
        event_type === "task.dispatch_error" ||
        event_type === "preview.failed" ||
        event_type === "task_failed" ||
        event_type === "task_dispatch_error" ||
        event_type === "preview_share_error" ||
        event_level_class(event.level) === "error" ||
        event_type.endsWith(".error") ||
        event_type.endsWith("_error") ||
        event_type.includes("failed")
    ) {
        return "error";
    }
    if (event_type === "provider_thinking" || event_type.includes("reasoning")) {
        return "system";
    }
    return "system";
}

function event_label(event: MeridianTaskEvent): string {
    const event_type = normalized_event_type(event.event_type);
    if (event_type === "chat.user") {
        return "You";
    }
    if (event_type === "chat.system") {
        return "System";
    }
    if (event_type === "chat.assistant") {
        return "Agent";
    }
    if (
        event_type === "provider_stdout" ||
        event_type === "provider_output" ||
        event_type === "provider_assistant" ||
        event_type === "provider.message" ||
        event_type === "provider.output" ||
        event_type === "provider.stdout"
    ) {
        return "Agent";
    }
    if (event_type === "provider_thinking") {
        return "Reasoning";
    }
    if (event_type === "provider_stderr" || event_type === "provider.stderr") {
        return "Agent error";
    }
    if (
        event_type === "provider_command" ||
        event_type === "provider.command" ||
        event_type === "provider_tool" ||
        event_type === "provider.tool" ||
        event_type === "tool.call" ||
        event_type === "tool.result" ||
        event_type === "tool.output" ||
        event_type.includes("tool_call") ||
        event_type.includes("function_call")
    ) {
        return "Tool";
    }
    if (event_type === "provider_request") {
        return "Model";
    }
    if (event_type.startsWith("workspace_") || event_type.startsWith("workspace.")) {
        return "Workspace";
    }
    if (event_type.startsWith("worktree.") || event_type.startsWith("worktree_")) {
        return "Worktree";
    }
    if (event_type.startsWith("container.") || event_type.startsWith("container_")) {
        return "Container";
    }
    if (event_type.startsWith("preview_") || event_type.startsWith("preview.")) {
        return "Preview";
    }
    if (event_type.startsWith("task_action_") || event_type.startsWith("task.action.")) {
        return "Action";
    }
    if (event_type.startsWith("task_")) {
        return "Task";
    }
    if (event_type.startsWith("task.")) {
        return "Task";
    }
    return "System";
}

const MAX_EVENT_TEXT_PARTS = 18;
const MAX_EVENT_TEXT_DEPTH = 4;
const MAX_EVENT_TEXT_LENGTH = 7000;

function push_event_text(parts: string[], value: string): void {
    if (!value) {
        return;
    }
    const normalized = value.trim();
    if (!normalized || parts.includes(normalized)) {
        return;
    }
    if (parts.length < MAX_EVENT_TEXT_PARTS) {
        parts.push(normalized);
    }
}

function collect_event_text(value: unknown, parts: string[], depth = 0): void {
    if (parts.length >= MAX_EVENT_TEXT_PARTS || depth > MAX_EVENT_TEXT_DEPTH) {
        return;
    }

    if (typeof value === "string") {
        push_event_text(parts, value);
        return;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        push_event_text(parts, String(value));
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collect_event_text(item, parts, depth + 1);
            if (parts.length >= MAX_EVENT_TEXT_PARTS) {
                return;
            }
        }
        return;
    }

    const record = as_record(value);
    if (!record) {
        return;
    }

    const preferred_keys = [
        "text",
        "message",
        "output_text",
        "delta",
        "content",
        "summary",
        "detail",
        "reason",
        "error",
        "stderr",
        "stdout",
        "command",
    ];
    for (const key of preferred_keys) {
        if (!(key in record)) {
            continue;
        }
        collect_event_text(record[key], parts, depth + 1);
        if (parts.length >= MAX_EVENT_TEXT_PARTS) {
            return;
        }
    }

    if (parts.length > 0) {
        return;
    }

    for (const [key, item] of Object.entries(record).slice(0, 8)) {
        if (key === "id" || key.endsWith("_id")) {
            continue;
        }
        collect_event_text(item, parts, depth + 1);
        if (parts.length >= MAX_EVENT_TEXT_PARTS) {
            return;
        }
    }
}

function event_text(value: unknown): string {
    const parts: string[] = [];
    collect_event_text(value, parts);
    const joined = parts.join("\n").trim();
    if (!joined) {
        return "";
    }
    if (joined.length <= MAX_EVENT_TEXT_LENGTH) {
        return joined;
    }
    return `${joined.slice(0, MAX_EVENT_TEXT_LENGTH - 3).trimEnd()}...`;
}

function extract_event_body(event: MeridianTaskEvent): string {
    const event_type = normalized_event_type(event.event_type);
    const is_stream_chunk = is_stream_chunk_event_type(event_type);
    if (is_stream_chunk && event.message.length > 0) {
        return event.message;
    }
    const direct = event.message.trim();
    if (direct) {
        return direct;
    }

    const data = event.data;
    const nested_payload = as_record(data["payload"]) ?? {};
    const item_payload = as_record(data["item"]) ?? {};
    const delta_payload = as_record(data["delta"]) ?? {};
    const records = [data, nested_payload, item_payload, delta_payload];
    const prioritized_keys = [
        "command",
        "text",
        "output_text",
        "delta",
        "content",
        "detail",
        "reason",
        "summary",
        "status",
        "error",
        "stderr",
        "stdout",
        "preview_url",
        "preview_port",
        "name",
        "tool_name",
        "call_id",
    ];
    for (const record of records) {
        for (const key of prioritized_keys) {
            const value = record[key];
            if (is_stream_chunk && typeof value === "string" && value.length > 0) {
                return value;
            }
            const parsed = event_text(value);
            if (parsed) {
                return parsed;
            }
        }
    }

    if (
        event_type === "tool.call" ||
        event_type === "provider_command" ||
        event_type === "provider.command" ||
        event_type === "provider_tool" ||
        event_type === "provider.tool" ||
        event_type.includes("tool_call") ||
        event_type.includes("function_call")
    ) {
        const name = as_string(data["name"]) || as_string(item_payload["name"]) || "tool_call";
        const args =
            data["arguments"] ??
            item_payload["arguments"] ??
            data["input"] ??
            item_payload["input"];
        if (args !== undefined) {
            if (typeof args === "string" && args.trim()) {
                return `${name}: ${args.trim()}`;
            }
            try {
                return `${name}: ${JSON.stringify(args)}`;
            } catch {
                return name;
            }
        }
        return name;
    }

    if (event_type === "chat.system") {
        return "System update";
    }

    return event_text(data);
}

function format_event_type(event_type: string): string {
    const normalized = event_type.trim();
    if (!normalized) {
        return "event";
    }
    return normalized;
}

function is_stream_chunk_event_type(event_type: string): boolean {
    const normalized = normalized_event_type(event_type);
    return (
        normalized === "provider.delta" ||
        normalized === "provider_delta" ||
        normalized === "provider.stdout" ||
        normalized === "provider_stdout" ||
        normalized === "provider.output" ||
        normalized === "provider_output" ||
        normalized === "provider.message" ||
        normalized === "agent.message" ||
        normalized === "agent.delta" ||
        normalized === "agent_delta" ||
        normalized.endsWith(".delta")
    );
}

function collapse_exact_double(text: string): string {
    let normalized = text.trim();
    if (normalized.length < 8) {
        return normalized;
    }

    const exact_double = /^([\s\S]{80,}?)(?:\s*)\1$/.exec(normalized);
    if (exact_double?.[1]) {
        normalized = exact_double[1].trim();
    }

    if (normalized.length % 2 === 0) {
        const half = normalized.length / 2;
        const first = normalized.slice(0, half);
        const second = normalized.slice(half);
        if (first && first === second) {
            return first.trim();
        }
    }

    return normalized;
}

function renderable_event(event: MeridianTaskEvent): RenderableThreadEvent {
    const kind = event_kind(event);
    const merge_mode = is_stream_chunk_event_type(event.event_type) ? "chunk" : "block";
    const raw_body = extract_event_body(event);
    const normalized_body =
        merge_mode === "chunk"
            ? raw_body.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
            : normalize_message_text(kind, raw_body);
    const event_type = format_event_type(event.event_type);
    const status_text =
        as_string(event.data["status"]).trim() || as_string(event.data["phase"]).trim() || "";
    const source_text =
        as_string(event.data["source"]).trim() ||
        as_string(event.data["tool_name"]).trim() ||
        as_string(event.data["provider"]).trim() ||
        "";
    const duration_ms = as_number(event.data["duration_ms"]);
    let details = "";
    const detail_payload =
        event.data["payload"] ??
        event.data["item"] ??
        event.data["delta"] ??
        event.data["output"] ??
        event.data["arguments"];
    if (detail_payload !== undefined) {
        if (typeof detail_payload === "string") {
            details = detail_payload.trim();
        } else {
            try {
                details = JSON.stringify(detail_payload, undefined, 2);
            } catch {
                details = "";
            }
        }
    }
    if (!details && event.level.toLowerCase() === "error") {
        details = event_text(event.data);
    }
    return {
        event_id: event.id,
        kind,
        label: event_label(event),
        time: format_event_time(event.ts),
        event_type,
        message: merge_mode === "chunk" ? normalized_body : collapse_exact_double(normalized_body),
        command: as_string(event.data["command"]).trim(),
        source: source_text,
        status: status_text,
        duration_ms,
        details,
        pending: event.data["pending"] === true,
        merge_mode,
    };
}

function normalize_message_text(kind: EventKind, message: string): string {
    const text = message.trim();
    if (!text) {
        return text;
    }
    if (!["assistant", "system"].includes(kind)) {
        return text;
    }
    const lines = text.split("\n");
    if (lines.length < 4) {
        return text;
    }
    const first_line = lines[0]!.trim();
    if (!first_line) {
        return text;
    }
    for (let i = 1; i < lines.length - 1; i += 1) {
        if (lines[i]!.trim() !== first_line) {
            continue;
        }
        const head = lines.slice(0, i).join("\n").trim();
        const tail = lines.slice(i).join("\n").trim();
        if (!head || !tail) {
            continue;
        }
        if (head.includes(tail) || tail.length <= Math.floor(head.length * 0.7)) {
            return head;
        }
    }
    const lines_to_dedupe = text.split("\n");
    const seen_long_lines = new Set<string>();
    const unique_lines: string[] = [];
    for (const line of lines_to_dedupe) {
        const normalized = line.trim().replaceAll(/\s+/g, " ");
        if (normalized.length >= 72) {
            if (seen_long_lines.has(normalized)) {
                continue;
            }
            seen_long_lines.add(normalized);
        }
        unique_lines.push(line);
    }
    return unique_lines.join("\n").trim();
}

function thread_is_near_bottom(thread: HTMLElement): boolean {
    const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    return distance <= AUTO_SCROLL_STICKY_DISTANCE_PX;
}

function update_follow_output_ui(): void {
    const $button = $("#meridian-task-follow-button");
    if ($button.length === 0) {
        return;
    }
    if (state.task_follow_output) {
        $button.addClass("notdisplayed");
        return;
    }
    $button.removeClass("notdisplayed");
}

function compact_thread_events(rows: MeridianTaskEvent[]): RenderableThreadEvent[] {
    const compacted: RenderableThreadEvent[] = [];
    for (const event of rows) {
        const next = renderable_event(event);
        if (!next.message && next.kind !== "command") {
            next.message = next.event_type;
        }
        const previous = compacted.at(-1);
        const is_exact_duplicate =
            previous?.kind === next.kind &&
            previous?.event_type === next.event_type &&
            previous?.message === next.message &&
            !previous?.pending &&
            !next.pending;
        if (is_exact_duplicate) {
            if (!previous) {
                continue;
            }
            previous.event_id = next.event_id;
            previous.time = next.time;
            continue;
        }
        const can_merge_chat_blocks =
            previous?.kind === next.kind &&
            ["assistant", "user"].includes(next.kind) &&
            !previous.pending &&
            !next.pending &&
            previous.merge_mode === "block" &&
            next.merge_mode === "block";
        const can_merge_assistant_chunk =
            previous?.kind === next.kind &&
            next.kind === "assistant" &&
            !previous.pending &&
            !next.pending &&
            ((previous.merge_mode === "chunk" && next.merge_mode === "block") ||
                (previous.merge_mode === "block" && next.merge_mode === "chunk"));
        const can_merge_stream_chunks =
            previous?.kind === next.kind &&
            next.kind === "assistant" &&
            !previous.pending &&
            !next.pending &&
            previous.merge_mode === "chunk" &&
            next.merge_mode === "chunk";
        if (
            can_merge_chat_blocks ||
            can_merge_assistant_chunk ||
            (previous?.kind === next.kind &&
                previous.event_type === next.event_type &&
                next.kind === "system" &&
                previous.merge_mode === "block" &&
                next.merge_mode === "block")
        ) {
            previous.message = merge_thread_text(previous.message, next.message);
            previous.event_id = next.event_id;
            previous.time = next.time;
            continue;
        }
        if (can_merge_stream_chunks) {
            const merged_chunk = trim_repeated_chunk(previous.message, next.message);
            if (merged_chunk) {
                const needs_word_separator =
                    !/\s$/.test(previous.message) &&
                    !/^\s/.test(merged_chunk) &&
                    /[A-Za-z0-9`]$/.test(previous.message) &&
                    /^[A-Za-z0-9`]/.test(merged_chunk);
                previous.message = `${previous.message}${needs_word_separator ? " " : ""}${merged_chunk}`;
            }
            previous.event_id = next.event_id;
            previous.time = next.time;
            continue;
        }
        compacted.push(next);
    }
    return compacted;
}

function is_chat_event(event: MeridianTaskEvent): boolean {
    const kind = event_kind(event);
    if (kind === "assistant" || kind === "user" || kind === "error" || kind === "command") {
        return true;
    }

    const event_type = normalized_event_type(event.event_type);
    if (event_type === "chat.system") {
        return true;
    }
    return false;
}

function format_duration_ms(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
        return "";
    }
    if (value < 1000) {
        return `${value}ms`;
    }
    if (value < 60000) {
        return `${(value / 1000).toFixed(1)}s`;
    }
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

function render_markdown_message(message: string): string {
    try {
        const rendered = markdown.parse_non_message(sanitize_agent_markdown(message));
        return `<div class="meridian-thread-message meridian-thread-message-rendered rendered_markdown">${rendered}</div>`;
    } catch {
        return `<div class="meridian-thread-message">${_.escape(message)}</div>`;
    }
}

function sanitize_agent_markdown(message: string): string {
    let text = message.replace(/\r\n/g, "\n");
    // Some models accidentally merge the opening fence info string with the first command.
    // Repair common shell fences: ```bash cd ...  => ```bash\ncd ...
    text = text.replace(/```(bash|sh|zsh|shell)\s+(?=\S)/g, "```$1\n");
    text = text.replace(/```(bash|sh|zsh|shell)(?=[^\s\n])/g, "```$1\n");

    // If the assistant forgot to close a fence, auto-close so the rest of the message renders.
    const fence_count = (text.match(/(^|\\n)```/g) ?? []).length;
    if (fence_count % 2 === 1) {
        text = `${text.trimEnd()}\n\`\`\``;
    }
    return text;
}

function decorate_markdown_code_blocks(root: HTMLElement): void {
    const code_blocks = Array.from(root.querySelectorAll("pre"));
    for (const block of code_blocks) {
        const existing_parent = block.parentElement;
        if (!existing_parent) {
            continue;
        }
        let wrapper: HTMLElement;
        if (existing_parent.classList.contains("meridian-markdown-code")) {
            wrapper = existing_parent;
        } else {
            wrapper = document.createElement("div");
            wrapper.className = "meridian-markdown-code";
            existing_parent.replaceChild(wrapper, block);
            wrapper.append(block);
        }
        if (wrapper.querySelector("[data-meridian-markdown-copy]")) {
            continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "meridian-markdown-copy";
        button.setAttribute("data-meridian-markdown-copy", "1");
        button.setAttribute("aria-label", "Copy code block");
        button.textContent = "Copy";
        wrapper.append(button);
    }
}

function render_event_message(event: RenderableThreadEvent, mode: "chat" | "activity"): string {
    if (event.kind === "assistant" && mode === "chat" && event.message.trim()) {
        return render_markdown_message(event.message);
    }
    return `<div class="meridian-thread-message">${_.escape(event.message || "(no output)")}</div>`;
}

type ChatTurn = {
    key: string;
    user: RenderableThreadEvent | null;
    assistant_events: RenderableThreadEvent[];
    tool_events: RenderableThreadEvent[];
    system_events: RenderableThreadEvent[];
    error_events: RenderableThreadEvent[];
};

function create_chat_turn(index: number): ChatTurn {
    return {
        key: `turn-${index}`,
        user: null,
        assistant_events: [],
        tool_events: [],
        system_events: [],
        error_events: [],
    };
}

function chat_turn_has_content(turn: ChatTurn): boolean {
    return (
        turn.user !== null ||
        turn.assistant_events.length > 0 ||
        turn.tool_events.length > 0 ||
        turn.system_events.length > 0 ||
        turn.error_events.length > 0
    );
}

function find_chunk_replay_start(existing: string, incoming: string): number | undefined {
    if (existing.length < 160 || incoming.length < 120) {
        return undefined;
    }
    const anchor_length = 64;
    const candidate_offsets = [
        0,
        Math.floor(existing.length * 0.2),
        Math.floor(existing.length * 0.35),
        Math.floor(existing.length * 0.5),
    ];
    let best: number | undefined;
    for (const offset of candidate_offsets) {
        const anchor = existing.slice(offset, offset + anchor_length).trim();
        if (anchor.length < 48) {
            continue;
        }
        const index = incoming.indexOf(anchor);
        if (index <= 32) {
            continue;
        }
        if (best === undefined || index < best) {
            best = index;
        }
    }
    return best;
}

function append_assistant_message(
    existing: string,
    incoming: string,
    merge_mode: "block" | "chunk",
): string {
    const next = incoming.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (!next.trim()) {
        return existing;
    }
    if (!existing.trim()) {
        return next;
    }

    if (merge_mode === "chunk") {
        const normalized_existing = existing.replaceAll(/\s+/g, " ").trim().toLowerCase();
        const normalized_next = next.replaceAll(/\s+/g, " ").trim().toLowerCase();
        if (normalized_existing && normalized_next) {
            if (normalized_next.startsWith(normalized_existing) && next.length > existing.length) {
                return next;
            }
            if (
                normalized_next.includes(normalized_existing) &&
                normalized_next.length > Math.floor(normalized_existing.length * 1.05) &&
                next.length > existing.length
            ) {
                return next;
            }
            if (
                normalized_existing.includes(normalized_next) &&
                normalized_existing.length > Math.floor(normalized_next.length * 1.05)
            ) {
                return existing;
            }
        }
        if (normalized_existing && normalized_next && existing.length > 200 && next.length > 180) {
            const probe = normalized_existing.slice(0, 120);
            if (probe.length >= 72 && normalized_next.includes(probe)) {
                return existing;
            }
        }
        const replay_start = find_chunk_replay_start(existing, next);
        if (replay_start !== undefined) {
            const prefix = next.slice(0, replay_start).trim();
            if (!prefix) {
                return existing;
            }
            if (
                existing.includes(prefix) ||
                existing.replaceAll(/\s+/g, " ").includes(prefix.replaceAll(/\s+/g, " "))
            ) {
                return existing;
            }
            return merge_thread_text(existing, prefix);
        }
        if (next.trim() === existing.trim() || existing.endsWith(next)) {
            return existing;
        }
        if (next.startsWith(existing)) {
            return next;
        }
        const delta = trim_repeated_chunk(existing, next);
        if (!delta) {
            return existing;
        }
        const trimmed_delta = delta.trimStart();
        const prefer_newline_separator =
            /^(#{1,6}\s|[-*]\s|```)/.test(trimmed_delta) ||
            ((/[.!?:]$/.test(existing.trim()) || existing.endsWith(")")) &&
                /^[A-Z#`-]/.test(trimmed_delta));
        if (prefer_newline_separator && !/\n$/.test(existing)) {
            return `${existing}\n${trimmed_delta}`;
        }
        const needs_word_separator =
            !/\s$/.test(existing) &&
            !/^\s/.test(delta) &&
            /[A-Za-z0-9`]$/.test(existing) &&
            /^[A-Za-z0-9`]/.test(delta);
        return `${existing}${needs_word_separator ? " " : ""}${delta}`;
    }

    const normalized_existing = existing.replaceAll(/\s+/g, " ").trim().toLowerCase();
    const normalized_next = next.replaceAll(/\s+/g, " ").trim().toLowerCase();
    if (!normalized_existing) {
        return next;
    }
    if (!normalized_next) {
        return existing;
    }
    if (
        normalized_existing === normalized_next ||
        normalized_existing.includes(normalized_next) ||
        normalized_next.includes(normalized_existing)
    ) {
        return normalized_next.length > normalized_existing.length ? next : existing;
    }

    const min_length = Math.min(normalized_existing.length, normalized_next.length);
    const overlap_target = Math.min(220, Math.floor(min_length * 0.45));
    let prefix = 0;
    while (
        prefix < min_length &&
        normalized_existing.charCodeAt(prefix) === normalized_next.charCodeAt(prefix)
    ) {
        prefix += 1;
    }
    let suffix = 0;
    while (
        suffix < min_length &&
        normalized_existing.charCodeAt(normalized_existing.length - 1 - suffix) ===
            normalized_next.charCodeAt(normalized_next.length - 1 - suffix)
    ) {
        suffix += 1;
    }
    if (prefix >= overlap_target && suffix >= Math.min(90, Math.floor(min_length * 0.22))) {
        return normalized_next.length >= normalized_existing.length ? next : existing;
    }

    return merge_thread_text(existing, next);
}

function dedupe_assistant_message_text(message: string): string {
    const normalized = message
        .replaceAll("\r\n", "\n")
        .replaceAll("\r", "\n")
        .replaceAll(/([^\n])##\s/g, "$1\n## ")
        // Repair common "```bashcd ..." streaming joins into a valid fence.
        .replaceAll(/```(bash|sh|zsh|shell|console)(?=[A-Za-z0-9/])/g, "```$1\n")
        // If content leaks onto the same fence line ("```bash cd ..."), move it to the next line.
        .replaceAll(/```([a-zA-Z0-9_+-]+)[ \t]+(?=\S)/g, "```$1\n")
        // If a fence info string is immediately followed by content ("```json{"), insert a newline.
        .replaceAll(/```([a-zA-Z0-9_+-]+)(?=[^\\s\\n])/g, "```$1\n")
        .trim();
    if (!normalized) {
        return normalized;
    }

    const heading_sections = normalized.split(/\n(?=#{1,6}\s)/g);
    if (heading_sections.length > 1) {
        const seen_sections = new Set<string>();
        const unique_sections: string[] = [];
        for (const section of heading_sections) {
            const trimmed = section.trim();
            if (!trimmed) {
                continue;
            }
            const key = trimmed.replaceAll(/\s+/g, " ").replaceAll(/[`*_~]/g, "").toLowerCase();
            const is_short_heading =
                /^#{1,6}\s/.test(trimmed) &&
                trimmed.length < 140 &&
                trimmed.split("\n").filter((line) => line.trim()).length <= 2;
            if ((is_short_heading || key.length >= 72) && seen_sections.has(key)) {
                continue;
            }
            if (is_short_heading || key.length >= 72) {
                seen_sections.add(key);
            }
            unique_sections.push(trimmed);
        }
        if (unique_sections.length > 0) {
            return unique_sections.join("\n\n");
        }
    }

    const looks_like_markdown =
        /```/.test(normalized) ||
        /(^|\n)#{1,6}\s/.test(normalized) ||
        /(^|\n)[-*]\s/.test(normalized) ||
        /(^|\n)\d+\.\s/.test(normalized);
    if (!looks_like_markdown) {
        const sentence_split = normalized.split(/(?<=[.!?])\s+(?=[A-Za-z0-9#`])/g);
        if (sentence_split.length > 1) {
            const seen = new Set<string>();
            const kept: string[] = [];
            for (const sentence of sentence_split) {
                const trimmed = sentence.trim();
                if (!trimmed) {
                    continue;
                }
                const key = trimmed.replaceAll(/\s+/g, " ").replaceAll(/[`*_~]/g, "").toLowerCase();
                if (key.length >= 48 && seen.has(key)) {
                    continue;
                }
                if (key.length >= 48) {
                    seen.add(key);
                }
                kept.push(trimmed);
            }
            if (kept.length > 0) {
                return kept.join("\n");
            }
        }
    }

    const paragraph_split = normalized.split(/\n{2,}/g);
    if (paragraph_split.length > 1) {
        const seen_paragraphs = new Set<string>();
        const kept_paragraphs: string[] = [];
        for (const paragraph of paragraph_split) {
            const trimmed = paragraph.trim();
            if (!trimmed) {
                continue;
            }
            const key = trimmed.replaceAll(/\s+/g, " ").replaceAll(/[`*_~]/g, "").toLowerCase();
            if (key.length >= 72 && seen_paragraphs.has(key)) {
                continue;
            }
            if (key.length >= 72) {
                seen_paragraphs.add(key);
            }
            kept_paragraphs.push(trimmed);
        }
        if (kept_paragraphs.length > 0) {
            return kept_paragraphs.join("\n\n");
        }
    }

    const line_split = normalized.split("\n");
    if (line_split.length <= 1) {
        return normalized;
    }
    const seen_lines = new Set<string>();
    const unique_lines: string[] = [];
    for (const line of line_split) {
        const text = line.trim();
        if (!text) {
            unique_lines.push(line);
            continue;
        }
        const key = text.replaceAll(/\s+/g, " ").replaceAll(/[`*_~]/g, "").toLowerCase();
        if (key.length >= 56 && seen_lines.has(key)) {
            continue;
        }
        if (key.length >= 56) {
            seen_lines.add(key);
        }
        unique_lines.push(line);
    }
    return unique_lines.join("\n").trim();
}

function aggregate_assistant_event(
    events: RenderableThreadEvent[],
): RenderableThreadEvent | undefined {
    if (events.length === 0) {
        return undefined;
    }
    const stable_blocks = events.filter(
        (event) => event.merge_mode === "block" && event.message.trim().length > 0,
    );
    const source_events = stable_blocks.length > 0 ? [stable_blocks.at(-1)!] : events;
    const last = source_events.at(-1)!;
    let message = "";
    for (const event of source_events) {
        message = append_assistant_message(message, event.message, event.merge_mode);
    }
    if (!message.trim()) {
        message = last.message;
    }
    message = dedupe_assistant_message_text(message);
    return {
        ...last,
        pending: events.some((event) => event.pending),
        message: collapse_exact_double(message),
    };
}

function tool_event_title(event: RenderableThreadEvent): string {
    if (event.source.trim()) {
        return event.source.trim();
    }
    const event_type = normalized_event_type(event.event_type);
    if (event_type.includes("apply_patch")) {
        return "apply_patch";
    }
    if (event_type.includes("tool") || event_type.includes("function_call")) {
        return "Tool call";
    }
    if (event_type.startsWith("command.")) {
        return "Command";
    }
    return event.event_type || "Tool";
}

function tool_event_subtitle(event: RenderableThreadEvent): string {
    const parts: string[] = [];
    if (event.status.trim()) {
        parts.push(event.status.trim());
    }
    const duration = format_duration_ms(event.duration_ms);
    if (duration) {
        parts.push(duration);
    }
    if (parts.length === 0) {
        return event.time;
    }
    return `${parts.join(" · ")} · ${event.time}`;
}

function render_tool_event_card(event: RenderableThreadEvent): string {
    const title = _.escape(tool_event_title(event));
    const subtitle = _.escape(tool_event_subtitle(event));
    const command_or_output = _.escape(event.command || event.message || "(no output)");
    const details_markup = event.details
        ? `<details class="meridian-chat-tool-details"${state.task_details_collapsed ? "" : " open"}>
    <summary>Show details</summary>
    <pre class="meridian-chat-tool-details-body">${_.escape(event.details)}</pre>
</details>`
        : "";
    return `
<article class="meridian-chat-tool-card" id="meridian-task-event-${event.event_id}" data-component="basic-tool">
    <div class="meridian-chat-tool-head">
        <div>
            <div class="meridian-chat-tool-title">${title}</div>
            <div class="meridian-chat-tool-subtitle">${subtitle}</div>
        </div>
    </div>
    <pre class="meridian-chat-tool-command">${command_or_output}</pre>
    ${details_markup}
</article>`;
}

function build_chat_turns(rows: MeridianTaskEvent[]): ChatTurn[] {
    const source_rows = rows.filter((event) => is_chat_event(event));
    const rendered_rows = source_rows.map((event) => renderable_event(event));
    const turns: ChatTurn[] = [];
    let current = create_chat_turn(0);

    for (const event of rendered_rows) {
        if (event.kind === "user") {
            if (chat_turn_has_content(current)) {
                turns.push(current);
            }
            current = create_chat_turn(turns.length);
            current.user = event;
            continue;
        }
        if (!chat_turn_has_content(current)) {
            current = create_chat_turn(turns.length);
        }
        if (event.kind === "assistant") {
            current.assistant_events.push(event);
            continue;
        }
        if (event.kind === "command") {
            current.tool_events.push(event);
            continue;
        }
        if (event.kind === "error") {
            current.error_events.push(event);
            continue;
        }
        current.system_events.push(event);
    }
    if (chat_turn_has_content(current)) {
        turns.push(current);
    }
    return turns;
}

function render_chat_turn(turn: ChatTurn): string {
    const user_markup = turn.user
        ? `
<article class="meridian-chat-user" id="meridian-task-event-${turn.user.event_id}" data-component="user-message">
    <div class="meridian-chat-user-bubble">
        <div class="meridian-thread-message">${_.escape(turn.user.message || "(no output)")}</div>
    </div>
</article>`
        : "";
    const assistant = aggregate_assistant_event(turn.assistant_events);
    const assistant_markup = assistant
        ? `
<article class="meridian-chat-assistant" id="meridian-task-event-${assistant.event_id}" data-component="assistant-message">
    <div class="meridian-chat-assistant-meta">
        <span class="meridian-chat-assistant-label">Assistant</span>
        <span class="meridian-chat-assistant-time">${_.escape(assistant.time)}</span>
        <span class="meridian-chat-assistant-actions">
            <button type="button" class="meridian-thread-inline-action" data-meridian-thread-copy="${assistant.event_id}" aria-label="Copy assistant output">Copy</button>
        </span>
    </div>
    ${render_markdown_message(assistant.message)}
</article>`
        : "";
    const tool_markup = turn.tool_events.map((event) => render_tool_event_card(event)).join("");
    const system_markup = turn.system_events
        .map(
            (event) => `
<article class="meridian-chat-system" id="meridian-task-event-${event.event_id}">
    <div class="meridian-thread-message">${_.escape(event.message || event.event_type)}</div>
</article>`,
        )
        .join("");
    const error_markup = turn.error_events
        .map(
            (event) => `
<article class="meridian-chat-error" id="meridian-task-event-${event.event_id}">
    <div class="meridian-chat-error-head">
        <span>${_.escape(event.label)}</span>
    </div>
    <pre class="meridian-chat-error-body">${_.escape(event.message || event.details || event.event_type)}</pre>
</article>`,
        )
        .join("");
    return `
<section class="meridian-chat-turn" data-turn-id="${_.escape(turn.key)}">
    ${user_markup}
    ${assistant_markup}
    ${tool_markup}
    ${system_markup}
    ${error_markup}
</section>`;
}

function render_chat_rows(rows: MeridianTaskEvent[], is_running: boolean): string {
    const turns = build_chat_turns(rows);
    if (turns.length === 0) {
        return `
<div class="meridian-task-empty-events">
    ${is_running ? "Agent is running. Waiting for assistant output." : "Waiting for assistant output."}
</div>`;
    }
    const markup = turns.map((turn) => render_chat_turn(turn)).join("");
    if (!is_running) {
        return markup;
    }
    return `${markup}
<article class="meridian-chat-system meridian-thread-live-indicator-row" id="meridian-thread-live-indicator">
    <div class="meridian-thread-message">Assistant is running…</div>
</article>`;
}

function render_event_row(event: RenderableThreadEvent, mode: "chat" | "activity"): string {
    const {event_id, kind, label, time, event_type, command, pending} = event;
    const display_label = pending ? `${label} (sending...)` : label;
    const source_badge = event.source
        ? `<span class="meridian-thread-badge">${_.escape(event.source)}</span>`
        : "";
    const status_badge = event.status
        ? `<span class="meridian-thread-badge meridian-thread-badge-status">${_.escape(event.status)}</span>`
        : "";
    const duration_badge = event.duration_ms
        ? `<span class="meridian-thread-badge">${_.escape(format_duration_ms(event.duration_ms))}</span>`
        : "";
    const copy_button =
        kind === "assistant"
            ? `<button type="button" class="meridian-thread-inline-action" data-meridian-thread-copy="${event_id}" aria-label="Copy assistant output">Copy</button>`
            : "";
    const jump_button =
        mode === "chat"
            ? `<button type="button" class="meridian-thread-inline-action" data-meridian-jump-event="${event_id}" aria-label="Jump to activity event">Activity</button>`
            : "";
    const details_markup =
        mode === "activity" && event.details
            ? `
    <details class="meridian-thread-details"${state.task_details_collapsed ? "" : " open"}>
        <summary>Details</summary>
        <pre class="meridian-thread-details-body">${_.escape(event.details)}</pre>
    </details>`
            : "";

    if (kind === "command") {
        return `
<article class="meridian-thread-row meridian-thread-command" id="meridian-task-event-${event_id}">
    <div class="meridian-thread-meta">
        <div class="meridian-thread-meta-main">
            <span class="meridian-thread-label">${_.escape(display_label)}</span>
            <span class="meridian-thread-time">${_.escape(time)}</span>
        </div>
        <div class="meridian-thread-actions">
            ${source_badge}
            ${status_badge}
            ${duration_badge}
            ${jump_button}
        </div>
    </div>
    <pre class="meridian-thread-command-line">${_.escape(command || event.message)}</pre>
    <div class="meridian-thread-event-type">${_.escape(event_type)}</div>
    ${details_markup}
</article>`;
    }

    return `
<article class="meridian-thread-row meridian-thread-${_.escape(kind)}" id="meridian-task-event-${event_id}">
    <div class="meridian-thread-meta">
        <div class="meridian-thread-meta-main">
            <span class="meridian-thread-label">${_.escape(display_label)}</span>
            <span class="meridian-thread-time">${_.escape(time)}</span>
        </div>
        <div class="meridian-thread-actions">
            ${source_badge}
            ${status_badge}
            ${duration_badge}
            ${copy_button}
            ${jump_button}
        </div>
    </div>
    ${render_event_message(event, mode)}
    ${
        kind === "error" || kind === "system"
            ? `<div class="meridian-thread-event-type">${_.escape(event_type)}</div>`
            : ""
    }
    ${details_markup}
</article>`;
}

function render_thread_rows(
    rows: MeridianTaskEvent[],
    mode: "chat" | "activity",
    is_running: boolean,
): string {
    if (mode === "chat") {
        return render_chat_rows(rows, is_running);
    }

    const render_rows = compact_thread_events(rows);
    if (render_rows.length === 0) {
        return `
<div class="meridian-task-empty-events">
    ${is_running ? "Agent is running. Waiting for task activity." : "Waiting for task activity."}
</div>`;
    }
    const markup = render_rows.map((event) => render_event_row(event, mode)).join("");
    if (!is_running) {
        return markup;
    }
    return `${markup}
<article class="meridian-thread-row meridian-thread-system meridian-thread-live-indicator-row">
    <div class="meridian-thread-message">Agent is running…</div>
</article>`;
}

function count_text(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

type DiffDocument = {
    id: string;
    label: string;
    source: string;
    content: string;
};

function truncate_diff_text(value: string): string {
    if (value.length <= DIFF_MAX_RENDER_CHARS) {
        return value;
    }
    return `${value.slice(0, DIFF_MAX_RENDER_CHARS - 16).trimEnd()}\n... [truncated]`;
}

function extract_diff_block_from_text(value: string): string {
    if (!value) {
        return "";
    }
    const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (normalized.includes("diff --git ")) {
        return normalized.slice(normalized.indexOf("diff --git ")).trim();
    }
    if (normalized.includes("@@ ")) {
        return normalized.trim();
    }
    return "";
}

function extract_event_diff_text(event: MeridianTaskEvent): string {
    const records = [
        event.data,
        as_record(event.data["payload"]) ?? {},
        as_record(event.data["item"]) ?? {},
        as_record(event.data["delta"]) ?? {},
    ];
    for (const record of records) {
        const direct =
            as_string(record["diff"]).trim() ||
            as_string(record["patch"]).trim() ||
            as_string(record["git_diff"]).trim();
        const from_direct = extract_diff_block_from_text(direct);
        if (from_direct) {
            return truncate_diff_text(from_direct);
        }
    }

    const from_message = extract_diff_block_from_text(event.message);
    if (from_message) {
        return truncate_diff_text(from_message);
    }
    return "";
}

function collect_diff_documents(task: MeridianTaskSummary, rows: MeridianTaskEvent[]): DiffDocument[] {
    const docs: DiffDocument[] = [];

    for (const event of rows.toReversed()) {
        const content = extract_event_diff_text(event);
        if (!content) {
            continue;
        }
        docs.push({
            id: `event-${event.id}`,
            label: `Event ${event.id}`,
            source: event.event_type || "event",
            content,
        });
        if (docs.length >= 3) {
            break;
        }
    }

    for (const artifact of task.artifacts) {
        const kind = artifact.kind.trim().toLowerCase();
        if (!["diff", "patch"].includes(kind)) {
            continue;
        }
        docs.push({
            id: `artifact-${artifact.label}`,
            label: artifact.label || "diff artifact",
            source: artifact.url || kind,
            content: "",
        });
    }
    return docs;
}

function render_split_diff_table(diff_text: string): string {
    const lines = diff_text.split("\n");
    const rows: string[] = [];
    for (const line of lines) {
        if (line.startsWith("+++ ") || line.startsWith("--- ")) {
            rows.push(
                `<tr class="meridian-diff-row meridian-diff-meta"><td colspan="2">${_.escape(line)}</td></tr>`,
            );
            continue;
        }
        if (line.startsWith("+")) {
            rows.push(
                `<tr class="meridian-diff-row meridian-diff-add"><td class="meridian-diff-col-left"></td><td class="meridian-diff-col-right">${_.escape(line.slice(1))}</td></tr>`,
            );
            continue;
        }
        if (line.startsWith("-")) {
            rows.push(
                `<tr class="meridian-diff-row meridian-diff-del"><td class="meridian-diff-col-left">${_.escape(line.slice(1))}</td><td class="meridian-diff-col-right"></td></tr>`,
            );
            continue;
        }
        if (line.startsWith("diff --git ") || line.startsWith("@@ ")) {
            rows.push(
                `<tr class="meridian-diff-row meridian-diff-meta"><td colspan="2">${_.escape(line)}</td></tr>`,
            );
            continue;
        }
        rows.push(
            `<tr class="meridian-diff-row meridian-diff-context"><td class="meridian-diff-col-left">${_.escape(line)}</td><td class="meridian-diff-col-right">${_.escape(line)}</td></tr>`,
        );
    }
    return `<table class="meridian-diff-table"><tbody>${rows.join("")}</tbody></table>`;
}

function render_diff_document_markup(doc: DiffDocument, mode: "unified" | "split"): string {
    if (!doc.content) {
        return `<div class="meridian-task-review-empty">Diff content is stored as an artifact link. Open it from Evidence.</div>`;
    }
    if (mode === "split") {
        return render_split_diff_table(doc.content);
    }
    return `<pre class="meridian-diff-unified">${_.escape(doc.content)}</pre>`;
}

function summarize_task_result_text(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed.length <= 720) {
        return trimmed;
    }
    return `${trimmed.slice(0, 717).trimEnd()}...`;
}

function update_reply_composer_state(): void {
    const busy = reply_request_in_flight;
    const $input = $("#meridian-task-reply-input");
    const $send = $("#meridian-task-reply-send");
    if ($input.length > 0) {
        $input.prop("disabled", busy);
    }
    if ($send.length > 0) {
        $send.prop("disabled", busy);
        $send.text(busy ? "Sending..." : "Send");
    }
}

function autosize_reply_input(): void {
    const input = document.querySelector<HTMLTextAreaElement>("#meridian-task-reply-input");
    if (!input) {
        return;
    }
    input.style.height = "auto";
    const clamped_height = Math.min(Math.max(input.scrollHeight, 88), 320);
    input.style.height = `${clamped_height}px`;
}

function render_task_view_loading(task_id: string): void {
    if (!state.task_view_open) {
        return;
    }
    const $view = ensure_task_view_container();
    const label = _.escape(task_id || "task");
    const markup = `
<div class="meridian-task-session-shell meridian-task-loading-shell">
    <header class="meridian-task-session-header">
        <div class="meridian-task-session-title-row">
            <button type="button" class="meridian-action-button" id="meridian-task-view-back">Close</button>
            <div class="meridian-task-session-title-wrap">
                <div class="meridian-task-session-title">Loading task</div>
                <div class="meridian-task-id">${label}</div>
            </div>
            <span class="meridian-status-pill meridian-status-queued">SYNCING</span>
        </div>
    </header>
    <section class="meridian-task-thread-panel">
        <div class="meridian-task-view-log meridian-task-thread-log">
            <div class="meridian-task-empty-events meridian-task-loading-state">
                <div class="meridian-task-skeleton-line"></div>
                <div class="meridian-task-skeleton-line meridian-task-skeleton-line-short"></div>
                <div class="meridian-task-skeleton-line"></div>
                <div class="meridian-task-skeleton-label">Loading task state and event stream…</div>
            </div>
        </div>
    </section>
</div>
`;
    if ($view.html() !== markup) {
        $view.html(markup);
    }
    $view.removeClass("notdisplayed");
    set_task_view_open_state(true);
}

function render_supervisor_view_loading(context: TopicContext): void {
    if (!state.task_view_open) {
        return;
    }
    const $view = ensure_task_view_container();
    const label = _.escape(`${context.stream_name} · ${context.topic}`);
    const markup = `
<div class="meridian-task-session-shell meridian-supervisor-shell meridian-task-loading-shell">
    <header class="meridian-task-session-header">
        <div class="meridian-task-session-title-row">
            <button type="button" class="meridian-action-button" id="meridian-task-view-back">Close</button>
            <div class="meridian-task-session-title-wrap">
                <div class="meridian-task-session-title">Supervisor</div>
                <div class="meridian-task-id">${label}</div>
            </div>
            <span class="meridian-status-pill meridian-status-queued">SYNCING</span>
        </div>
        <div class="meridian-task-action-row">
            <button type="button" class="meridian-task-action-button button small rounded" id="meridian-supervisor-refresh">Refresh</button>
        </div>
    </header>
    <section class="meridian-task-thread-panel">
        <div class="meridian-task-view-log meridian-task-thread-log">
            <div class="meridian-task-empty-events meridian-task-loading-state">
                <div class="meridian-task-skeleton-line"></div>
                <div class="meridian-task-skeleton-line meridian-task-skeleton-line-short"></div>
                <div class="meridian-task-skeleton-line"></div>
                <div class="meridian-task-skeleton-label">Loading supervisor plan and context…</div>
            </div>
        </div>
    </section>
</div>
`;
    if ($view.html() !== markup) {
        $view.html(markup);
    }
    $view.removeClass("notdisplayed");
    set_task_view_open_state(true);
}

function render_supervisor_view(context: TopicContext, sidebar: MeridianSidebarPayload): void {
    if (!state.task_view_open || state.task_view_mode !== "supervisor") {
        return;
    }
    const $view = ensure_task_view_container();
    const plan = state.supervisor_plan_revision;
    const plan_id = plan?.plan_revision_id || "none";
    const plan_status = plan?.status || "draft";
    const plan_summary = plan?.summary || "";
    const plan_objective = plan?.objective || "";
    const assumptions = plan?.assumptions ?? [];
    const unknowns = plan?.unknowns ?? [];
    const approval_points = plan?.approval_points ?? [];
    const steps = plan?.execution_steps ?? [];
    const seams = plan?.candidate_parallel_seams ?? [];
    const recommended_raw = plan?.source?.["recommended_directives"];
    const recommended = Array.isArray(recommended_raw)
        ? (recommended_raw.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) as Record<
              string,
              unknown
          >[])
        : [];

    const signature = [
        context.topic_scope_id,
        plan_id,
        plan?.updated_at || "",
        String(steps.length),
        String(seams.length),
        String(unknowns.length),
        String(recommended.length),
        String(state.supervisor_context?.memory_tail.length ?? 0),
        String(sidebar.task_count),
    ].join("|");

    if (signature === state.supervisor_view_signature) {
        $view.removeClass("notdisplayed");
        set_task_view_open_state(true);
        return;
    }

    const steps_markup =
        steps.length > 0
            ? `<ol class="meridian-supervisor-step-list">${steps
                  .map((step) => {
                      const title = as_string(step["title"]).trim() || as_string(step["instruction"]).split("\n")[0] || "Step";
                      const kind = as_string(step["kind"]).trim() || "write";
                      const worker = as_string(step["assigned_worker"]).trim() || "auto";
                      const role = as_string(step["assigned_role"]).trim() || "writer";
                      const depends = as_string_list(step["depends_on"]).join(", ");
                      const instruction = as_string(step["instruction"]).trim();
                      const meta = [kind, `${worker}/${role}`, depends ? `depends: ${depends}` : ""]
                          .filter(Boolean)
                          .join(" · ");
                      return `<li class="meridian-supervisor-step">
    <div class="meridian-supervisor-step-title">${_.escape(title)}</div>
    <div class="meridian-supervisor-step-meta">${_.escape(meta)}</div>
    ${instruction ? `<pre class="meridian-supervisor-step-instruction">${_.escape(instruction)}</pre>` : ""}
</li>`;
                  })
                  .join("")}</ol>`
            : `<div class="meridian-supervisor-empty">No steps yet. Click Synthesize to create a plan from the topic transcript.</div>`;

    const seams_markup =
        seams.length > 0
            ? `<ul class="meridian-supervisor-seam-list">${seams
                  .map((seam) => {
                      const title = as_string(seam["title"]).trim() || as_string(seam["seam_id"]).trim() || "Seam";
                      const mode = as_string(seam["mode"]).trim();
                      const step_ids = as_string_list(seam["step_ids"]).join(", ");
                      const meta = [mode, step_ids ? `steps: ${step_ids}` : ""].filter(Boolean).join(" · ");
                      return `<li><div class="meridian-supervisor-seam-title">${_.escape(title)}</div><div class="meridian-supervisor-seam-meta">${_.escape(meta)}</div></li>`;
                  })
                  .join("")}</ul>`
            : `<div class="meridian-supervisor-empty">No parallel seams identified yet.</div>`;

    const unknowns_markup =
        unknowns.length > 0
            ? `<ul class="meridian-supervisor-bullet-list">${unknowns
                  .map((item) => `<li>${_.escape(item)}</li>`)
                  .join("")}</ul>`
            : `<div class="meridian-supervisor-empty">None</div>`;

    const approvals_markup =
        approval_points.length > 0
            ? `<ul class="meridian-supervisor-bullet-list">${approval_points
                  .map((item) => `<li>${_.escape(item)}</li>`)
                  .join("")}</ul>`
            : `<div class="meridian-supervisor-empty">None</div>`;

    const recommended_markup =
        recommended.length > 0
            ? `<ul class="meridian-supervisor-bullet-list">${recommended
                  .map((item) => {
                      const instruction = as_string(item["instruction"]).trim();
                      const worker = as_string(item["assigned_worker"]).trim();
                      const role = as_string(item["assigned_role"]).trim();
                      const meta = [worker, role].filter(Boolean).join(" / ");
                      return `<li><div class="meridian-supervisor-reco-instruction">${_.escape(instruction || "Directive")}</div>${meta ? `<div class="meridian-supervisor-reco-meta">${_.escape(meta)}</div>` : ""}</li>`;
                  })
                  .join("")}</ul>`
            : `<div class="meridian-supervisor-empty">None</div>`;

    const soul_text = state.supervisor_context?.soul || "";
    const memory_tail_text = state.supervisor_context?.memory_tail || "";

    const header_label = _.escape(`${context.stream_name} · ${context.topic}`);
    const markup = `
<div class="meridian-task-session-shell meridian-supervisor-shell">
    <header class="meridian-task-session-header">
        <div class="meridian-task-session-title-row">
            <button type="button" class="meridian-action-button" id="meridian-task-view-back">Close</button>
            <div class="meridian-task-session-title-wrap">
                <div class="meridian-task-session-title">Supervisor</div>
                <div class="meridian-task-id">${header_label}</div>
            </div>
            <span class="meridian-status-pill meridian-status-${_.escape(plan_status)}">${_.escape(plan_status || "draft")}</span>
        </div>
        <div class="meridian-task-action-row">
            <button type="button" class="meridian-task-action-button button small rounded" id="meridian-supervisor-refresh">Refresh</button>
            <button type="button" class="meridian-task-action-button button small rounded" id="meridian-supervisor-synthesize">Synthesize</button>
            <button type="button" class="meridian-task-action-button button small rounded" id="meridian-task-provider-accounts">Provider accounts</button>
        </div>
    </header>
    <div class="meridian-supervisor-body">
        <section class="meridian-supervisor-card">
            <div class="meridian-supervisor-card-header">
                <h3>Plan</h3>
                <div class="meridian-supervisor-plan-meta">
                    <span class="meridian-supervisor-chip">tasks: ${sidebar.task_count}</span>
                    <span class="meridian-supervisor-chip">plan: ${_.escape(plan_id)}</span>
                </div>
            </div>
            <label class="meridian-task-create-label" for="meridian-supervisor-summary-input">Summary</label>
            <input id="meridian-supervisor-summary-input" class="modal_text_input" maxlength="280" autocomplete="off" value="${_.escape(plan_summary)}" placeholder="Short summary for this plan revision" />
            <label class="meridian-task-create-label" for="meridian-supervisor-objective-input">Objective</label>
            <textarea id="meridian-supervisor-objective-input" class="modal_text_input meridian-task-create-textarea" rows="3" placeholder="What should the supervisor accomplish for this topic?">${_.escape(plan_objective)}</textarea>
            <div class="meridian-supervisor-plan-subgrid">
                <div>
                    <h4>Assumptions</h4>
                    ${
                        assumptions.length > 0
                            ? `<ul class="meridian-supervisor-bullet-list">${assumptions
                                  .map((item) => `<li>${_.escape(item)}</li>`)
                                  .join("")}</ul>`
                            : `<div class="meridian-supervisor-empty">None</div>`
                    }
                </div>
                <div>
                    <h4>Unknowns</h4>
                    ${unknowns_markup}
                </div>
                <div>
                    <h4>Approval points</h4>
                    ${approvals_markup}
                </div>
            </div>
        </section>

        <section class="meridian-supervisor-card">
            <h3>Work plan</h3>
            ${steps_markup}
        </section>

        <section class="meridian-supervisor-card">
            <h3>Parallel seams</h3>
            ${seams_markup}
        </section>

        <section class="meridian-supervisor-card">
            <h3>Recommended directives</h3>
            ${recommended_markup}
        </section>

        <section class="meridian-supervisor-card">
            <h3>Dispatch directive</h3>
            <label class="meridian-task-create-label" for="meridian-supervisor-directive-instruction">Instruction</label>
            <textarea id="meridian-supervisor-directive-instruction" class="modal_text_input meridian-task-create-textarea" rows="4" placeholder="Describe the directive the supervisor should assign to a worker"></textarea>
            <div class="meridian-task-two-col-grid">
                <div>
                    <label class="meridian-task-create-label" for="meridian-supervisor-directive-worker">Assigned worker</label>
                    <input id="meridian-supervisor-directive-worker" class="modal_text_input" value="worker-1" autocomplete="off" />
                </div>
                <div>
                    <label class="meridian-task-create-label" for="meridian-supervisor-directive-role">Role</label>
                    <select id="meridian-supervisor-directive-role" class="modal_text_input">
                        <option value="writer">writer</option>
                        <option value="read_only">read_only</option>
                        <option value="verify">verify</option>
                    </select>
                </div>
            </div>
            <button type="button" class="button rounded meridian-supervisor-dispatch-button" id="meridian-supervisor-dispatch">Dispatch</button>
        </section>

        <details class="meridian-supervisor-card meridian-supervisor-context" ${
            soul_text || memory_tail_text ? "" : "open"
        }>
            <summary>Supervisor context (soul + memory)</summary>
            <div class="meridian-supervisor-context-grid">
                <div>
                    <h4>Soul</h4>
                    <pre class="meridian-supervisor-context-pre">${_.escape(soul_text || "Loading…")}</pre>
                </div>
                <div>
                    <h4>Memory tail</h4>
                    <pre class="meridian-supervisor-context-pre">${_.escape(memory_tail_text || "Loading…")}</pre>
                </div>
            </div>
        </details>
    </div>
</div>
`;

    if ($view.html() !== markup) {
        $view.html(markup);
    }
    state.supervisor_view_signature = signature;
    $view.removeClass("notdisplayed");
    set_task_view_open_state(true);
}

function render_task_view(context: TopicContext, sidebar: MeridianSidebarPayload): void {
    if (!state.task_view_open || state.task_view_mode !== "task") {
        return;
    }
    const selected_task = selected_task_from_sidebar(sidebar);
    if (!selected_task) {
        render_task_view_loading(state.selected_task_id);
        return;
    }

    const rows = state.event_rows.slice(-EVENT_ROWS_LIMIT);
    const rows_with_pending = [...rows];
    if (state.pending_reply_message) {
        rows_with_pending.push({
            id: -1,
            task_id: selected_task.task_id,
            ts: state.pending_reply_time || new Date().toISOString(),
            level: "info",
            event_type: "chat.user",
            message: state.pending_reply_message,
            data: {pending: true},
        });
    }
    const task_status = status_class(selected_task.status);
    const is_running = task_status === "running";
    const can_stop = task_can_cancel(selected_task.status);
    const can_pause = task_can_pause(selected_task.status);
    const can_resume = task_can_resume(selected_task.status);
    const needs_approval = task_status === "blocked_approval" || !selected_task.approved;
    const has_clarification_questions = selected_task.clarification_questions.length > 0;
    const blocked_reason = selected_task.blocked_reason.trim();
    const active_stream_mode: "chat" = "chat";
    const phase_text = infer_task_phase(selected_task, rows_with_pending);
    const source_stream_name = selected_task.source_stream_name || context.stream_name;
    const source_topic_name = selected_task.source_topic_name || context.topic;
    const model_text = selected_task.model || provider_default_model(selected_task.provider) || "n/a";
    const summary_text = summarize_task_result_text(selected_task.result_text);
    const rows_with_fallback = [...rows_with_pending];
    let chat_rows = rows_with_fallback.filter((event) => is_chat_event(event));
    if (chat_rows.length === 0 && !task_is_active(selected_task.status)) {
        if (selected_task.result_text.trim()) {
            rows_with_fallback.push({
                id: -2,
                task_id: selected_task.task_id,
                ts: selected_task.updated_at || selected_task.finished_at || new Date().toISOString(),
                level: "info",
                event_type: "chat.assistant",
                message: selected_task.result_text.trim(),
                data: {source: "result_text"},
            });
        } else if (selected_task.error_text.trim()) {
            rows_with_fallback.push({
                id: -3,
                task_id: selected_task.task_id,
                ts: selected_task.updated_at || selected_task.finished_at || new Date().toISOString(),
                level: "error",
                event_type: "provider_stderr",
                message: selected_task.error_text.trim(),
                data: {source: "error_text"},
            });
        }
        chat_rows = rows_with_fallback.filter((event) => is_chat_event(event));
    }
    const chat_count_text = count_text(chat_rows.length, "message");
    const preview_markup = selected_task.preview_url
        ? `<a class="meridian-action-button meridian-task-preview-button" href="${_.escape(selected_task.preview_url)}" target="_blank" rel="noopener noreferrer">Open preview</a>`
        : '<span class="meridian-task-view-preview-pending">Preview pending</span>';
    const clarification_questions_markup = has_clarification_questions
        ? `<ul class="meridian-task-clarification-list">${selected_task.clarification_questions
              .map((question) => `<li>${_.escape(question)}</li>`)
              .join("")}</ul>`
        : "";
    const blocked_banner_markup = blocked_reason.length > 0
        ? `<div class="meridian-task-banner meridian-task-banner-warning">${_.escape(blocked_reason)}</div>`
        : "";
    const review_claims_markup = selected_task.file_claims.length > 0
        ? selected_task.file_claims.map((item) => `<code>${_.escape(item)}</code>`).join("")
        : '<span class="meridian-task-review-empty">None</span>';
    const review_areas_markup = selected_task.area_claims.length > 0
        ? selected_task.area_claims.map((item) => `<code>${_.escape(item)}</code>`).join("")
        : '<span class="meridian-task-review-empty">None</span>';
    const review_depends_markup = selected_task.depends_on_task_ids.length > 0
        ? selected_task.depends_on_task_ids
              .map((item) => `<span class="meridian-task-dependency-chip">${_.escape(item)}</span>`)
              .join("")
        : '<span class="meridian-task-review-empty">None</span>';
    const review_artifacts_markup = selected_task.artifacts.length > 0
        ? selected_task.artifacts
              .map((artifact) => {
                  if (artifact.url) {
                      return `<a class="meridian-task-artifact-link" href="${_.escape(artifact.url)}" target="_blank" rel="noopener noreferrer">${_.escape(artifact.label)}</a>`;
                  }
                  return `<span class="meridian-task-artifact-chip">${_.escape(artifact.label)}</span>`;
              })
              .join("")
        : '<span class="meridian-task-review-empty">None</span>';
    const approvals_pending_markup = selected_task.approvals_pending.length > 0
        ? selected_task.approvals_pending
              .map((item) => `<span class="meridian-task-dependency-chip">${_.escape(item)}</span>`)
              .join("")
        : '<span class="meridian-task-review-empty">None</span>';
    const blockers_markup = selected_task.blockers.length > 0
        ? selected_task.blockers
              .map((item) => `<span class="meridian-task-dependency-chip">${_.escape(item)}</span>`)
              .join("")
        : '<span class="meridian-task-review-empty">None</span>';
    const usage_turns = selected_task.turns_used ?? 0;
    const usage_tokens = selected_task.tokens_used ?? 0;
    const usage_cost = selected_task.usd_estimate ?? 0;
    const diff_docs = collect_diff_documents(selected_task, rows_with_fallback);
    const active_diff_doc = diff_docs[0];
    const diff_doc_markup = active_diff_doc
        ? render_diff_document_markup(active_diff_doc, state.task_review_mode)
        : '<div class="meridian-task-review-empty">No diff captured yet. Run activity that emits patch output or attach a diff artifact.</div>';
    const diff_sources_markup =
        diff_docs.length > 0
            ? diff_docs
                  .map(
                      (doc) =>
                          `<span class="meridian-task-dependency-chip" title="${_.escape(doc.source)}">${_.escape(doc.label)}</span>`,
                  )
                  .join("")
            : '<span class="meridian-task-review-empty">None</span>';

    const task_view_signature = [
        selected_task.task_id,
        selected_task.title,
        selected_task.status,
        selected_task.provider,
        selected_task.model,
        selected_task.preview_url,
        selected_task.user_id,
        selected_task.worktree_path,
        selected_task.container_name,
        selected_task.error_text,
        selected_task.blocked_reason,
        selected_task.clarification_questions.join("|"),
        String(selected_task.approved),
        selected_task.assigned_worker,
        selected_task.assigned_role,
        selected_task.plan_revision_id,
        selected_task.approvals_pending.join("|"),
        selected_task.blockers.join("|"),
        selected_task.last_meaningful_artifact,
        selected_task.artifacts
            .map((artifact) => `${artifact.kind}:${artifact.label}:${artifact.url}:${artifact.status}`)
            .join("|"),
        summary_text,
        source_stream_name,
        source_topic_name,
        active_stream_mode,
        state.task_review_mode,
        String(state.task_details_collapsed),
        state.pending_reply_message,
        String(reply_request_in_flight),
    ].join("||");

    const $view = ensure_task_view_container();
    const current_draft = String($("#meridian-task-reply-input").val() ?? "");
    const needs_full_render = task_view_signature !== state.task_view_signature;
    if (needs_full_render) {
        state.task_view_signature = task_view_signature;
        state.task_view_rows_signature = "";
        // The chat renderer caches turn signatures; full DOM rebuilds must reset that cache
        // or we can end up with a blank log when signatures are unchanged.
        chat_dom_state = null;
        $view.html(`
<div class="meridian-task-session-shell" data-meridian-task-id="${_.escape(selected_task.task_id)}">
    <header class="meridian-task-session-header">
        <div class="meridian-task-session-title-row">
            <button type="button" class="meridian-action-button" id="meridian-task-view-back">Close</button>
            <div class="meridian-task-session-title-wrap">
                <div class="meridian-task-session-title">${_.escape(selected_task.title)}</div>
                <div class="meridian-task-id">${_.escape(selected_task.task_id)}</div>
            </div>
            <span class="meridian-status-pill meridian-status-${status_class(selected_task.status)}">${_.escape(status_label(selected_task.status))}</span>
            ${is_running ? '<span class="meridian-task-live-indicator">Live</span>' : ""}
        </div>
        <div class="meridian-task-session-subtitle">${_.escape(source_stream_name)} · ${_.escape(source_topic_name)} · ${_.escape(selected_task.provider || "provider: n/a")} · ${_.escape(model_text)}</div>
        <div class="meridian-task-phase-row">
            <span class="meridian-task-phase-label">Phase</span>
            <span class="meridian-task-phase-value" id="meridian-task-phase-value">${_.escape(phase_text)}</span>
            <span class="meridian-task-event-chip" id="meridian-task-event-count">${rows_with_fallback.length} event${rows_with_fallback.length === 1 ? "" : "s"}</span>
            <span class="meridian-task-event-chip" id="meridian-task-elapsed-chip">${_.escape(format_elapsed(selected_task.elapsed_seconds))}</span>
            <span class="meridian-task-event-chip" id="meridian-task-branch-chip">${_.escape(selected_task.branch_name || "branch: pending")}</span>
            <span class="meridian-task-event-chip" id="meridian-task-approval-chip">${selected_task.approved ? "approved" : "approval pending"}</span>
        </div>
        ${blocked_banner_markup}
        ${
            selected_task.error_text
                ? `<div class="meridian-task-banner meridian-task-banner-error">${_.escape(selected_task.error_text)}</div>`
                : ""
        }
        ${
            has_clarification_questions
                ? `<details class="meridian-task-summary-details" open><summary>Clarification needed</summary>${clarification_questions_markup}</details>`
                : ""
        }
	        ${
	            summary_text
	                ? `<details class="meridian-task-summary-details"><summary>Latest run summary</summary><div class="meridian-task-banner meridian-task-banner-summary">${_.escape(summary_text)}</div></details>`
	                : ""
	        }
	        <div class="meridian-task-banner meridian-task-banner-warning meridian-task-banner-slot notdisplayed" id="meridian-task-stream-banner" role="status" aria-live="polite"></div>
	        <div class="meridian-task-banner meridian-task-banner-error meridian-task-banner-slot notdisplayed" id="meridian-task-inline-error-banner" role="alert"></div>
	        <div class="meridian-task-action-row">
            ${preview_markup}
            <button type="button" class="meridian-task-action-button button small rounded" data-meridian-task-action="status" aria-label="Refresh task status">Refresh</button>
            <button type="button" class="meridian-task-action-button button small rounded" id="meridian-task-supervisor-plan" aria-label="Synthesize plan and dispatch">Plan</button>
            <button type="button" class="meridian-task-action-button button small rounded" id="meridian-task-provider-accounts" aria-label="Manage provider accounts">Provider accounts</button>
            <button type="button" class="meridian-task-action-button button small rounded" data-meridian-task-action="approve" aria-label="Approve task" ${
                needs_approval ? "" : "disabled"
            }>Approve</button>
            <button type="button" class="meridian-task-action-button button small rounded" data-meridian-task-action="pause" aria-label="Pause task" ${
                can_pause ? "" : "disabled"
            }>Pause</button>
            <button type="button" class="meridian-task-action-button button small rounded" data-meridian-task-action="resume" aria-label="Resume task" ${
                can_resume ? "" : "disabled"
            }>Resume</button>
            <button type="button" class="meridian-task-action-button button small rounded" data-meridian-task-action="mark_at_risk" aria-label="Mark task at risk" ${
                task_status === "at_risk" || task_is_terminal(selected_task.status) ? "disabled" : ""
            }>Mark at risk</button>
            <button type="button" class="meridian-task-action-button button small rounded" data-meridian-task-action="resolve_clarification_prompt" aria-label="Resolve clarification" ${
                task_status === "blocked_information" ? "" : "disabled"
            }>Resolve clarification</button>
            <button type="button" id="meridian-task-header-stop" class="meridian-task-action-button button small rounded button-danger" data-meridian-task-action="cancel" ${
                can_stop ? "" : "disabled"
            }>Stop</button>
        </div>
    </header>
    <details class="meridian-task-inspector" id="meridian-task-inspector"${state.task_inspector_open ? " open" : ""}>
        <summary>
            <span class="meridian-task-inspector-label">Inspector</span>
            <span class="meridian-task-inspector-chips">
                <span class="meridian-task-inspector-chip">${_.escape(count_text(selected_task.approvals_pending.length, "approval"))} pending</span>
                <span class="meridian-task-inspector-chip">${_.escape(count_text(selected_task.blockers.length, "blocker"))}</span>
                <span class="meridian-task-inspector-chip">${_.escape(count_text(selected_task.artifacts.length, "artifact"))}</span>
            </span>
        </summary>
        <div class="meridian-task-inspector-grid">
            <section class="meridian-task-review-card">
                <h4>Supervisor</h4>
                <div class="meridian-task-review-grid">
                    <span>Assigned worker</span><span id="meridian-task-supervisor-worker">${_.escape(selected_task.assigned_worker || "auto")}</span>
                    <span>Assigned role</span><span id="meridian-task-supervisor-role">${_.escape(selected_task.assigned_role || "n/a")}</span>
                    <span>Assigned by</span><span id="meridian-task-supervisor-by">${_.escape(selected_task.assigned_by || "n/a")}</span>
                    <span>Directive</span><span id="meridian-task-supervisor-directive">${_.escape(selected_task.directive_id || "n/a")}</span>
                    <span>Plan revision</span><span id="meridian-task-supervisor-plan-revision">${_.escape(selected_task.plan_revision_id || "n/a")}</span>
                </div>
            </section>
            <section class="meridian-task-review-card">
                <h4>Claims</h4>
                <div class="meridian-task-chip-list" id="meridian-task-claims">${review_claims_markup}</div>
                <h5>Areas</h5>
                <div class="meridian-task-chip-list" id="meridian-task-areas">${review_areas_markup}</div>
                <h5>Depends on</h5>
                <div class="meridian-task-chip-list" id="meridian-task-depends">${review_depends_markup}</div>
            </section>
            <section class="meridian-task-review-card">
                <h4>Approvals</h4>
                <h5>Pending</h5>
                <div class="meridian-task-chip-list" id="meridian-task-approvals">${approvals_pending_markup}</div>
                <h5>Blockers</h5>
                <div class="meridian-task-chip-list" id="meridian-task-blockers">${blockers_markup}</div>
            </section>
            <section class="meridian-task-review-card">
                <h4>Evidence</h4>
                <div class="meridian-task-artifact-list" id="meridian-task-artifacts">${review_artifacts_markup}</div>
                <h5>Last meaningful artifact</h5>
                <div class="meridian-task-review-grid">
                    <span>Artifact</span><span id="meridian-task-last-artifact">${_.escape(selected_task.last_meaningful_artifact || "n/a")}</span>
                </div>
            </section>
            <section class="meridian-task-review-card">
                <h4>Diff review</h4>
                <div class="meridian-task-review-toolbar">
                    <button type="button" class="meridian-task-review-mode${
                        state.task_review_mode === "unified" ? " active" : ""
                    }" data-meridian-task-review-mode="unified" aria-label="Unified diff view">Unified</button>
                    <button type="button" class="meridian-task-review-mode${
                        state.task_review_mode === "split" ? " active" : ""
                    }" data-meridian-task-review-mode="split" aria-label="Split diff view">Split</button>
                </div>
                <div class="meridian-task-chip-list" id="meridian-task-diff-sources">${diff_sources_markup}</div>
                <div class="meridian-task-diff-shell" id="meridian-task-diff-shell">${diff_doc_markup}</div>
            </section>
            <section class="meridian-task-review-card">
                <h4>Runtime</h4>
                <div class="meridian-task-review-grid">
                    <span>Container</span><span id="meridian-task-runtime-container">${_.escape(selected_task.container_name || "pending")}</span>
                    <span>Worktree</span><span class="meridian-task-path-text" id="meridian-task-runtime-worktree">${_.escape(selected_task.worktree_path || "pending")}</span>
                    <span>Branch</span><span id="meridian-task-runtime-branch">${_.escape(selected_task.branch_name || "pending")}</span>
                    <span>Heartbeat</span><span id="meridian-task-runtime-heartbeat">${_.escape(selected_task.last_heartbeat_at || "n/a")}</span>
                </div>
            </section>
            <section class="meridian-task-review-card">
                <h4>Usage</h4>
                <div class="meridian-task-review-grid">
                    <span>Turns</span><span id="meridian-task-usage-turns">${usage_turns}</span>
                    <span>Tokens</span><span id="meridian-task-usage-tokens">${usage_tokens.toLocaleString()}</span>
                    <span>Cost</span><span id="meridian-task-usage-cost">$${usage_cost.toFixed(2)}</span>
                </div>
            </section>
        </div>
    </details>
    <div class="meridian-task-session-body">
        <section class="meridian-task-thread-panel">
            <div class="meridian-task-view-log-header">
                <span class="meridian-task-log-title">Agent stream</span>
                <div class="meridian-task-stream-detail-controls">
                    <button type="button" class="meridian-task-inline-detail-control" data-meridian-task-details-toggle="expand" aria-label="Expand all event details">Expand details</button>
                    <button type="button" class="meridian-task-inline-detail-control" data-meridian-task-details-toggle="collapse" aria-label="Collapse all event details">Collapse details</button>
                </div>
                <button type="button" class="meridian-task-follow-button notdisplayed" id="meridian-task-follow-button">Jump to latest</button>
                <span class="meridian-task-log-count" id="meridian-task-log-count">${chat_count_text}</span>
            </div>
            <div class="meridian-task-thread-log meridian-task-view-log" id="meridian-task-thread-log" role="log" aria-live="polite"></div>
        </section>
    </div>
    <footer class="meridian-task-reply-composer">
        <textarea id="meridian-task-reply-input" class="modal_text_input meridian-task-reply-textarea" rows="3" aria-label="Task reply input" placeholder="Ask the agent to change code, run checks, explain, or continue."></textarea>
        <div class="meridian-task-reply-actions">
            <button type="button" class="button small rounded" id="meridian-task-reply-send" ${
                reply_request_in_flight ? "disabled" : ""
            }>${reply_request_in_flight ? "Sending..." : "Send"}</button>
            <button type="button" class="button small rounded button-danger" id="meridian-task-inline-stop" ${
                can_stop ? "" : "disabled"
            }>Stop</button>
        </div>
    </footer>
</div>
`);
        if (current_draft) {
            $("#meridian-task-reply-input").val(current_draft);
        }
    }

    const event_count_text = count_text(rows_with_fallback.length, "event");
    const message_count_text = count_text(chat_rows.length, "message");
    $("#meridian-task-phase-value").text(phase_text);
    $("#meridian-task-event-count").text(event_count_text);
    $("#meridian-task-elapsed-chip").text(format_elapsed(selected_task.elapsed_seconds));
    $("#meridian-task-branch-chip").text(selected_task.branch_name || "branch: pending");
    $("#meridian-task-approval-chip").text(selected_task.approved ? "approved" : "approval pending");
    $("#meridian-task-log-count").text(message_count_text);
    $("#meridian-task-inline-stop").prop("disabled", !can_stop);
    $("#meridian-task-header-stop").prop("disabled", !can_stop);
    update_task_view_banners(is_running);
    update_reply_composer_state();

    $("#meridian-task-runtime-heartbeat").text(selected_task.last_heartbeat_at || "n/a");
    $("#meridian-task-usage-turns").text(String(usage_turns));
    $("#meridian-task-usage-tokens").text(usage_tokens.toLocaleString());
    $("#meridian-task-usage-cost").text(`$${usage_cost.toFixed(2)}`);

    const last_row = rows_with_fallback.at(-1);
    const rows_signature = [
        String(rows_with_fallback.length),
        String(last_row?.id ?? 0),
        active_stream_mode,
        String(state.pending_reply_message.length),
        String(state.task_details_collapsed),
    ].join("|");
    if (rows_signature !== state.task_view_rows_signature) {
        const should_stick_to_bottom = state.task_follow_output;
        const thread = document.querySelector<HTMLElement>("#meridian-task-thread-log");
        if (thread) {
            update_thread_log(thread, rows_with_fallback, active_stream_mode, is_running);
            if (should_stick_to_bottom) {
                thread.scrollTop = thread.scrollHeight;
            }
        }
        state.task_view_rows_signature = rows_signature;
    }
    update_follow_output_ui();
    autosize_reply_input();

    $view.removeClass("notdisplayed");
    set_task_view_open_state(true);
}

function update_task_view_banners(is_running: boolean): void {
    const stream_banner = document.querySelector<HTMLElement>("#meridian-task-stream-banner");
    if (stream_banner) {
        if (is_running && state.event_stream_disconnected) {
            stream_banner.textContent =
                "Live stream temporarily disconnected. Fallback polling is active.";
            stream_banner.classList.remove("notdisplayed");
        } else {
            stream_banner.textContent = "";
            stream_banner.classList.add("notdisplayed");
        }
    }

    const error_banner = document.querySelector<HTMLElement>("#meridian-task-inline-error-banner");
    if (error_banner) {
        const message = state.task_inline_error.trim();
        if (message && message !== "Live stream disconnected; polling fallback will continue.") {
            error_banner.textContent = message;
            error_banner.classList.remove("notdisplayed");
        } else {
            error_banner.textContent = "";
            error_banner.classList.add("notdisplayed");
        }
    }
}

function sync_task_view_banners(): void {
    const context = current_topic_context();
    if (!context || !state.task_view_open || !state.last_sidebar) {
        return;
    }
    const selected_task = selected_task_from_sidebar(state.last_sidebar);
    if (!selected_task) {
        return;
    }
    update_task_view_banners(status_class(selected_task.status) === "running");
}

type MeridianChatDomState = {
    task_id: string;
    turn_keys: string[];
    turn_signatures: Map<string, string>;
};

let chat_dom_state: MeridianChatDomState | null = null;

function chat_turn_signature(turn: ChatTurn): string {
    const user_id = turn.user ? String(turn.user.event_id) : "";
    const assistant_id = turn.assistant_events.at(-1)?.event_id ?? "";
    const assistant_len = turn.assistant_events.reduce(
        (total, event) => total + event.message.length,
        0,
    );
    const tool_ids = turn.tool_events.map((event) => event.event_id).join(",");
    const system_ids = turn.system_events.map((event) => event.event_id).join(",");
    const error_ids = turn.error_events.map((event) => event.event_id).join(",");
    return [
        user_id,
        String(assistant_id),
        String(assistant_len),
        tool_ids,
        system_ids,
        error_ids,
    ].join("|");
}

function decorate_rendered_markdown(root: HTMLElement): void {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".meridian-thread-message-rendered"));
    for (const node of nodes) {
        rendered_markdown.update_elements($(node));
        decorate_markdown_code_blocks(node);
    }
}

function ensure_chat_live_indicator(thread: HTMLElement, is_running: boolean): void {
    const indicator = thread.querySelector<HTMLElement>("#meridian-thread-live-indicator");
    if (!is_running) {
        indicator?.remove();
        return;
    }
    if (indicator) {
        return;
    }
    thread.insertAdjacentHTML(
        "beforeend",
        `<article class="meridian-chat-system meridian-thread-live-indicator-row" id="meridian-thread-live-indicator">
    <div class="meridian-thread-message">Assistant is running…</div>
</article>`,
    );
}

function full_render_thread(
    thread: HTMLElement,
    rows: MeridianTaskEvent[],
    mode: "chat" | "activity",
    is_running: boolean,
): void {
    thread.innerHTML = render_thread_rows(rows, mode, is_running);
    decorate_rendered_markdown(thread);
    chat_dom_state = null;
}

function update_chat_thread_incremental(
    thread: HTMLElement,
    rows: MeridianTaskEvent[],
    is_running: boolean,
): void {
    const task_id = state.selected_task_id;
    const turns = build_chat_turns(rows);
    if (turns.length === 0) {
        thread.innerHTML = render_chat_rows(rows, is_running);
        chat_dom_state = {task_id, turn_keys: [], turn_signatures: new Map()};
        return;
    }

    if (!chat_dom_state || chat_dom_state.task_id !== task_id) {
        thread.innerHTML = turns.map((turn) => render_chat_turn(turn)).join("");
        decorate_rendered_markdown(thread);
        chat_dom_state = {
            task_id,
            turn_keys: turns.map((turn) => turn.key),
            turn_signatures: new Map(turns.map((turn) => [turn.key, chat_turn_signature(turn)])),
        };
        ensure_chat_live_indicator(thread, is_running);
        return;
    }

    // If the task view DOM was rebuilt but signatures didn't change, the cached state
    // can cause us to skip rendering. Detect an empty log and repaint.
    if (!thread.querySelector("[data-turn-id]")) {
        thread.innerHTML = turns.map((turn) => render_chat_turn(turn)).join("");
        decorate_rendered_markdown(thread);
        chat_dom_state.turn_keys = turns.map((turn) => turn.key);
        chat_dom_state.turn_signatures = new Map(
            turns.map((turn) => [turn.key, chat_turn_signature(turn)]),
        );
        ensure_chat_live_indicator(thread, is_running);
        return;
    }

    // Remove extra turns if the stream shrank (e.g., pending message cleared).
    while (chat_dom_state.turn_keys.length > turns.length) {
        const removed = chat_dom_state.turn_keys.pop();
        if (!removed) {
            continue;
        }
        chat_dom_state.turn_signatures.delete(removed);
        thread.querySelector(`[data-turn-id="${removed}"]`)?.remove();
    }

    for (const [index, turn] of turns.entries()) {
        const expected_key = chat_dom_state.turn_keys[index];
        if (expected_key === undefined) {
            thread.insertAdjacentHTML("beforeend", render_chat_turn(turn));
            const appended = thread.querySelector<HTMLElement>(`[data-turn-id="${turn.key}"]`);
            if (appended) {
                decorate_rendered_markdown(appended);
            }
            chat_dom_state.turn_keys.push(turn.key);
            chat_dom_state.turn_signatures.set(turn.key, chat_turn_signature(turn));
            continue;
        }
        if (expected_key !== turn.key) {
            // Turn boundaries shifted; full render avoids partial corruption.
            thread.innerHTML = turns.map((next) => render_chat_turn(next)).join("");
            decorate_rendered_markdown(thread);
            chat_dom_state.turn_keys = turns.map((next) => next.key);
            chat_dom_state.turn_signatures = new Map(
                turns.map((next) => [next.key, chat_turn_signature(next)]),
            );
            ensure_chat_live_indicator(thread, is_running);
            return;
        }

        const signature = chat_turn_signature(turn);
        if (signature === chat_dom_state.turn_signatures.get(turn.key)) {
            continue;
        }
        const existing = thread.querySelector<HTMLElement>(`[data-turn-id="${turn.key}"]`);
        if (!existing) {
            full_render_thread(thread, rows, "chat", is_running);
            return;
        }
        existing.outerHTML = render_chat_turn(turn);
        const replacement = thread.querySelector<HTMLElement>(`[data-turn-id="${turn.key}"]`);
        if (replacement) {
            decorate_rendered_markdown(replacement);
        }
        chat_dom_state.turn_signatures.set(turn.key, signature);
    }

    ensure_chat_live_indicator(thread, is_running);
}

function update_thread_log(
    thread: HTMLElement,
    rows: MeridianTaskEvent[],
    mode: "chat" | "activity",
    is_running: boolean,
): void {
    if (mode !== "chat") {
        full_render_thread(thread, rows, mode, is_running);
        return;
    }
    update_chat_thread_incremental(thread, rows, is_running);
}

function reset_supervisor_view_state(): void {
    close_selected_task_event_stream();
    state.selected_task_id = "";
    state.task_view_mode = "supervisor";
    state.task_stream_mode = "chat";
    state.event_after_id = 0;
    state.event_rows = [];
    state.task_follow_output = true;
    state.task_view_signature = "";
    state.task_view_rows_signature = "";
    state.supervisor_view_signature = "";
    state.supervisor_plan_revision = null;
    state.supervisor_context = null;
    state.pending_reply_message = "";
    state.pending_reply_time = "";
    state.event_stream_disconnected = false;
    state.task_inline_error = "";
    chat_dom_state = null;
}

function select_task(
    task_id: string,
    opts: {open_view?: boolean; stream_id?: number; topic?: string} = {},
): void {
    const normalized = task_id.trim();
    if (!normalized) {
        return;
    }
    if (opts.open_view) {
        const context = current_topic_context();
        const target_stream_id = opts.stream_id ?? context?.stream_id;
        const target_topic = (opts.topic ?? context?.topic ?? "").trim();
        const stream_mismatch =
            target_stream_id !== undefined && context?.stream_id !== target_stream_id;
        const topic_mismatch = Boolean(target_topic && context?.topic !== target_topic);

        if (state.selected_task_id !== normalized) {
            reset_task_stream_state(normalized);
        }
        state.task_view_open = true;
        state.task_view_signature = "";
        state.task_view_rows_signature = "";
        set_task_view_open_state(true);
        render_task_view_loading(normalized);

        if (target_stream_id !== undefined && target_topic && (stream_mismatch || topic_mismatch)) {
            pending_task_open_scope_id = topic_scope_id_for(target_stream_id, target_topic);
            navigate_to_topic(target_stream_id, target_topic);
            return;
        }
        pending_task_open_scope_id = "";
        refresh_topic_sidebar(true);
        poll_selected_task_events(true);
        start_selected_task_event_stream();
        return;
    }
    state.selected_task_id = normalized;
}

function handle_error(prefix: string, xhr: JQuery.jqXHR<unknown>): void {
    const message = channel.xhr_error_message(prefix, xhr);
    ui_report.generic_embed_error(_.escape(message), 5000);
}

function choose_default_task(sidebar: MeridianSidebarPayload): string {
    const running = sidebar.tasks.find((task) => status_class(task.status) === "running");
    if (running) {
        return running.task_id;
    }
    return sidebar.tasks[0]?.task_id ?? "";
}

function single_task_sidebar(context: TopicContext, task: MeridianTaskSummary): MeridianSidebarPayload {
    return {
        topic_scope_id: context.topic_scope_id,
        task_count: 1,
        counts: {[status_class(task.status)]: 1},
        tasks: [task],
    };
}

function close_selected_task_event_stream(): void {
    if (task_events_stream) {
        task_events_stream.close();
        task_events_stream = null;
    }
    if (task_events_stream_disconnect_timer !== null) {
        window.clearTimeout(task_events_stream_disconnect_timer);
        task_events_stream_disconnect_timer = null;
    }
    task_events_stream_task_id = "";
    state.event_stream_connected = false;
    state.event_stream_disconnected = false;
}

function append_task_events(events: MeridianTaskEvent[]): void {
    if (events.length === 0) {
        return;
    }
    const seen_ids = new Set(state.event_rows.map((event) => event.id));
    const new_events: MeridianTaskEvent[] = [];
    let max_id = state.event_after_id;
    for (const event of events) {
        max_id = Math.max(max_id, event.id);
        if (seen_ids.has(event.id)) {
            continue;
        }
        seen_ids.add(event.id);
        new_events.push(event);
        state.event_rows.push(event);
    }
    state.event_after_id = max_id;
    let cleared_pending = false;
    if (state.pending_reply_message) {
        const normalized_pending = state.pending_reply_message.trim();
        const matched = events.some(
            (event) =>
                event.event_type.trim().toLowerCase() === "chat.user" &&
                extract_event_body(event).trim() === normalized_pending,
        );
        if (matched) {
            state.pending_reply_message = "";
            state.pending_reply_time = "";
            cleared_pending = true;
        }
    }
    if (new_events.length === 0 && !cleared_pending) {
        return;
    }
    if (state.event_rows.length > EVENT_ROWS_LIMIT) {
        state.event_rows = state.event_rows.slice(-EVENT_ROWS_LIMIT);
    }
    const context = current_topic_context();
    if (
        state.task_view_mode === "task" &&
        context &&
        state.last_sidebar &&
        context.topic_scope_id === state.topic_scope_id
    ) {
        render_task_view(context, state.last_sidebar);
    }

    const saw_terminal_signal = new_events.some((event) => {
        const event_type = normalized_event_type(event.event_type);
        return (
            event_type === "provider_complete" ||
            event_type === "task.completed" ||
            event_type === "task.done" ||
            event_type === "task.failed" ||
            event_type === "task.canceled" ||
            event_type === "task_completed" ||
            event_type === "task_done" ||
            event_type === "task_failed" ||
            event_type === "task_canceled"
        );
    });
    if (state.task_view_mode === "task" && saw_terminal_signal && context) {
        refresh_selected_task_details(context, false);
    }
}

function refresh_selected_task_details(context: TopicContext, show_error = false): void {
    const task_id = state.selected_task_id.trim();
    if (!task_id) {
        return;
    }
    if (task_details_request_task_id === task_id) {
        return;
    }
    task_details_request_task_id = task_id;

    channel.get({
        url: `/json/meridian/tasks/${encodeURIComponent(task_id)}`,
        success(data) {
            if (task_details_request_task_id === task_id) {
                task_details_request_task_id = "";
            }
            if (!state.task_view_open || state.selected_task_id !== task_id) {
                return;
            }
            state.task_inline_error = "";
            const task = parse_task_status_payload(data);
            if (!task) {
                return;
            }
            const synthetic_sidebar = single_task_sidebar(context, task);
            state.last_sidebar = synthetic_sidebar;
            render_task_view(context, synthetic_sidebar);
            if (task_is_active(task.status)) {
                poll_selected_task_events(false);
                start_selected_task_event_stream();
            }
        },
        error(xhr) {
            if (task_details_request_task_id === task_id) {
                task_details_request_task_id = "";
            }
            state.task_inline_error = channel.xhr_error_message("Unable to load task details", xhr);
            if (state.task_view_open && state.task_view_mode === "task" && state.last_sidebar) {
                render_task_view(context, state.last_sidebar);
            }
            if (show_error) {
                handle_error("Unable to load task details", xhr);
            }
        },
    });
}

function start_selected_task_event_stream(): void {
    if (!ENABLE_TASK_EVENT_STREAM) {
        close_selected_task_event_stream();
        return;
    }
    const context = current_topic_context();
    const task_id = state.selected_task_id.trim();
    if (!context || !task_id || !state.task_view_open) {
        close_selected_task_event_stream();
        return;
    }
    if (task_events_stream && task_events_stream_task_id === task_id) {
        return;
    }

    close_selected_task_event_stream();
    const url = `/json/meridian/tasks/${encodeURIComponent(task_id)}/events/stream?after_id=${state.event_after_id}`;
    const stream = new EventSource(url);
    task_events_stream = stream;
    task_events_stream_task_id = task_id;
    state.event_stream_connected = false;
    state.event_stream_disconnected = false;
    if (task_events_stream_disconnect_timer !== null) {
        window.clearTimeout(task_events_stream_disconnect_timer);
        task_events_stream_disconnect_timer = null;
    }

    stream.addEventListener("open", () => {
        if (task_events_stream_task_id === task_id) {
            state.event_stream_connected = true;
            state.event_stream_disconnected = false;
            if (task_events_stream_disconnect_timer !== null) {
                window.clearTimeout(task_events_stream_disconnect_timer);
                task_events_stream_disconnect_timer = null;
            }
            sync_task_view_banners();
        }
    });
    stream.addEventListener("message", (event) => {
        if (task_events_stream_task_id !== task_id || task_id !== state.selected_task_id) {
            return;
        }
        const item = as_record_or_json(event.data);
        if (!item) {
            return;
        }
        const parsed = parse_task_event(item, task_id);
        if (!parsed) {
            return;
        }
        append_task_events([parsed]);
    });
    stream.addEventListener("error", () => {
        if (task_events_stream_task_id !== task_id) {
            return;
        }
        state.event_stream_connected = false;
        if (!state.event_stream_disconnected && task_events_stream_disconnect_timer === null) {
            // Avoid banner flicker on transient reconnect attempts.
            task_events_stream_disconnect_timer = window.setTimeout(() => {
                task_events_stream_disconnect_timer = null;
                if (task_events_stream_task_id === task_id && !state.event_stream_connected) {
                    state.event_stream_disconnected = true;
                    sync_task_view_banners();
                }
            }, 1500);
        }
        if (stream.readyState === EventSource.CLOSED) {
            close_selected_task_event_stream();
            state.event_stream_disconnected = true;
            sync_task_view_banners();
        }
    });
}

function refresh_topic_sidebar(force = false): void {
    if (!force && ai_sidebar_tab_active() && !state.task_view_open) {
        // The dedicated AI sidebar has its own polling loop. Avoid a competing
        // topic-sidebar refresh loop while AI is active to reduce repaint/flicker.
        return;
    }

    const context = current_topic_context();
    const previous_scope = state.topic_scope_id;
    if (!context) {
        state.topic_scope_id = "";
        state.last_sidebar = null;
        close_selected_task_event_stream();
        reset_task_stream_state("");
        clear_sidebar_task_rows(previous_scope);
        hide_task_view(true);
        return;
    }

    const keep_open_for_pending_target =
        Boolean(pending_task_open_scope_id) &&
        pending_task_open_scope_id === context.topic_scope_id;

    if (state.topic_scope_id !== context.topic_scope_id) {
        clear_sidebar_task_rows(previous_scope);
        state.topic_scope_id = context.topic_scope_id;
        state.last_sidebar = null;
        state.sidebar_rows_signature = "";
        if (!state.task_view_open || !keep_open_for_pending_target) {
            close_selected_task_event_stream();
            reset_task_stream_state("");
            hide_task_view(true);
            pending_task_open_scope_id = "";
        } else {
            state.task_view_signature = "";
            state.task_view_rows_signature = "";
            if (state.task_view_mode === "supervisor") {
                render_supervisor_view_loading(context);
            } else {
                render_task_view_loading(state.selected_task_id);
            }
            pending_task_open_scope_id = "";
        }
    }

    if (sidebar_request_in_flight && !force) {
        return;
    }
    sidebar_request_in_flight = true;

    channel.get({
        url: `/json/meridian/topics/${encodeURIComponent(context.topic_scope_id)}/sidebar`,
        data: {limit: 100},
        success(data) {
            sidebar_request_in_flight = false;
            state.task_inline_error = "";
            const sidebar = parse_sidebar_payload(data);
            if (!sidebar) {
                return;
            }
            if (context.topic_scope_id !== state.topic_scope_id) {
                return;
            }
            const ordered_sidebar = {
                ...sidebar,
                tasks: order_sidebar_tasks(sidebar.tasks),
            };
            state.last_sidebar = ordered_sidebar;
            render_sidebar_task_rows(context, ordered_sidebar.tasks);
            if (!state.task_view_open) {
                if (ordered_sidebar.tasks.length > 0 && !state.selected_task_id) {
                    reset_task_stream_state(choose_default_task(ordered_sidebar));
                }
                return;
            }

            if (state.task_view_mode === "supervisor") {
                render_supervisor_view(context, ordered_sidebar);
                if (!state.supervisor_plan_revision || !state.supervisor_context) {
                    refresh_supervisor_view_data(false);
                }
                return;
            }

            if (ordered_sidebar.tasks.length === 0) {
                state.selected_task_id = "";
                hide_task_view(true);
                return;
            }

            const has_selected = ordered_sidebar.tasks.some(
                (task) => task.task_id === state.selected_task_id,
            );
            if (!state.selected_task_id && !state.task_view_open) {
                reset_task_stream_state(choose_default_task(ordered_sidebar));
            }

            if (has_selected) {
                render_task_view(context, ordered_sidebar);
            } else if (state.selected_task_id) {
                render_task_view_loading(state.selected_task_id);
                refresh_selected_task_details(context);
            } else {
                reset_task_stream_state(choose_default_task(ordered_sidebar));
                render_task_view(context, ordered_sidebar);
            }
            poll_selected_task_events(false);
            start_selected_task_event_stream();
        },
        error(xhr) {
            sidebar_request_in_flight = false;
            state.task_inline_error = channel.xhr_error_message("Unable to load topic tasks", xhr);
            if (state.task_view_open && state.last_sidebar) {
                if (state.task_view_mode === "supervisor") {
                    render_supervisor_view(context, state.last_sidebar);
                } else {
                    render_task_view(context, state.last_sidebar);
                }
            }
            handle_error("Unable to load topic tasks", xhr);
        },
    });
}

function refresh_supervisor_view_data(force = false): void {
    const context = current_topic_context();
    if (!context || !state.task_view_open || state.task_view_mode !== "supervisor") {
        return;
    }
    if (supervisor_view_request_in_flight && !force) {
        return;
    }
    supervisor_view_request_in_flight = true;
    channel.get({
        url: `/json/meridian/topics/${encodeURIComponent(context.topic_scope_id)}/plan/current`,
        success(data) {
            const root = as_record(data);
            const plan = parse_plan_revision(root?.["plan_revision"]);
            state.supervisor_plan_revision = plan;
            channel.get({
                url: "/json/meridian/supervisor/context",
                success(ctx_data) {
                    supervisor_view_request_in_flight = false;
                    const ctx_root = as_record(ctx_data);
                    state.supervisor_context = parse_supervisor_context(ctx_root);
                    state.supervisor_view_signature = "";
                    if (state.last_sidebar) {
                        render_supervisor_view(context, state.last_sidebar);
                    }
                },
                error(xhr) {
                    supervisor_view_request_in_flight = false;
                    state.task_inline_error = channel.xhr_error_message(
                        "Unable to load supervisor context",
                        xhr,
                    );
                    state.supervisor_view_signature = "";
                    if (state.last_sidebar) {
                        render_supervisor_view(context, state.last_sidebar);
                    }
                },
            });
        },
        error(xhr) {
            supervisor_view_request_in_flight = false;
            state.task_inline_error = channel.xhr_error_message("Unable to load supervisor plan", xhr);
            state.supervisor_view_signature = "";
            if (state.last_sidebar) {
                render_supervisor_view(context, state.last_sidebar);
            }
        },
    });
}

function submit_supervisor_synthesize_from_view(): void {
    const context = current_topic_context();
    if (!context || supervisor_plan_request_in_flight) {
        return;
    }
    const summary = String($("#meridian-supervisor-summary-input").val() ?? "").trim();
    const objective = String($("#meridian-supervisor-objective-input").val() ?? "").trim();
    supervisor_plan_request_in_flight = true;
    channel.post({
        url: `/json/meridian/topics/${encodeURIComponent(context.topic_scope_id)}/plan/synthesize`,
        data: {
            summary,
            objective,
            activate: true,
        },
        success(data) {
            supervisor_plan_request_in_flight = false;
            const root = as_record(data);
            const plan = parse_plan_revision(root?.["plan_revision"]);
            state.supervisor_plan_revision = plan;
            state.supervisor_view_signature = "";
            refresh_topic_sidebar(true);
            refresh_supervisor_view_data(true);
        },
        error(xhr) {
            supervisor_plan_request_in_flight = false;
            handle_error("Unable to synthesize plan", xhr);
        },
    });
}

function submit_supervisor_dispatch_from_view(): void {
    const context = current_topic_context();
    if (!context || supervisor_dispatch_request_in_flight) {
        return;
    }
    const instruction = String($("#meridian-supervisor-directive-instruction").val() ?? "").trim();
    if (!instruction) {
        ui_report.generic_embed_error("Directive instruction is required.", 3500);
        return;
    }
    const assigned_worker = String($("#meridian-supervisor-directive-worker").val() ?? "")
        .trim()
        .toLowerCase();
    const assigned_role = String($("#meridian-supervisor-directive-role").val() ?? "writer")
        .trim()
        .toLowerCase();
    const plan_revision_id = state.supervisor_plan_revision?.plan_revision_id || undefined;
    const directives = [
        {
            instruction,
            task_title: instruction.split("\n")[0] ?? "Supervisor directive",
            provider: get_provider_preference(),
            assigned_worker: assigned_worker || "worker-1",
            assigned_role: assigned_role || "writer",
            file_claims: [],
            area_claims: [],
        },
    ];
    supervisor_dispatch_request_in_flight = true;
    channel.post({
        url: `/json/meridian/topics/${encodeURIComponent(context.topic_scope_id)}/directives/dispatch`,
        data: {
            plan_revision_id,
            directives: JSON.stringify(directives),
            stream_id: context.stream_id,
            stream_name: context.stream_name,
            topic: context.topic,
        },
        success(dispatch_data) {
            supervisor_dispatch_request_in_flight = false;
            $("#meridian-supervisor-directive-instruction").val("");
            const dispatch_root = as_record(dispatch_data);
            const tasks_raw = Array.isArray(dispatch_root?.["tasks"]) ? dispatch_root["tasks"] : [];
            const first_task = parse_task_summary(tasks_raw[0]);
            if (first_task) {
                select_task(first_task.task_id, {
                    open_view: true,
                    stream_id: context.stream_id,
                    topic: context.topic,
                });
                return;
            }
            refresh_topic_sidebar(true);
        },
        error(xhr) {
            supervisor_dispatch_request_in_flight = false;
            handle_error("Unable to dispatch directive", xhr);
        },
    });
}

function poll_selected_task_events(force = false): void {
    const context = current_topic_context();
    if (!context || !state.selected_task_id || !state.task_view_open) {
        return;
    }
    if (!force && ENABLE_TASK_EVENT_STREAM && state.event_stream_connected) {
        return;
    }
    if (events_request_in_flight) {
        return;
    }
    events_request_in_flight = true;
    const task_id = state.selected_task_id;

    channel.get({
        url: `/json/meridian/tasks/${encodeURIComponent(task_id)}/events`,
        data: {after_id: state.event_after_id, limit: 250},
        success(data) {
            events_request_in_flight = false;
            if (task_id !== state.selected_task_id) {
                return;
            }
            state.task_inline_error = "";
            sync_task_view_banners();
            const events = parse_events(data);
            if (events.length === 0) {
                return;
            }
            append_task_events(events);
        },
        error(xhr) {
            events_request_in_flight = false;
            state.task_inline_error = channel.xhr_error_message("Unable to load task activity", xhr);
            const current_context = current_topic_context();
            if (state.task_view_mode === "task" && current_context && state.last_sidebar) {
                render_task_view(current_context, state.last_sidebar);
            }
        },
    });
}

function handle_create_task_success(context: TopicContext, data: unknown): void {
    const root = as_record(data);
    const task = parse_task_summary(as_record(root?.["task"]));
    const active_context = current_topic_context();
    if (task && active_context?.topic_scope_id === context.topic_scope_id) {
        select_task(task.task_id, {
            open_view: true,
            stream_id: context.stream_id,
            topic: context.topic,
        });
    }
}

function update_create_task_credential_placeholder(): void {
    const mode = String($("#meridian-topic-task-auth-mode-input").val() ?? "api_key")
        .trim()
        .toLowerCase();
    const placeholder =
        mode === "oauth"
            ? "Optional OAuth access token"
            : "Optional provider API key";
    $("#meridian-topic-task-credential-input").attr("placeholder", placeholder);
}

function update_create_task_provider_hint(): void {
    const provider = normalize_provider(
        String($("#meridian-topic-task-provider-input").val() ?? DEFAULT_PROVIDER),
    );
    const model = provider_default_model(provider) || "provider default";
    $("#meridian-topic-task-provider-hint").text(`Default model: ${model}`);
}

function start_provider_oauth(provider: string, continuation?: PendingOauthContinuation): void {
    const normalized_provider = normalize_provider(provider);
    create_request_in_flight = true;
    if (continuation) {
        pending_oauth_continuation = continuation;
    }
    channel.post({
        url: "/json/meridian/providers/oauth/start",
        data: {
            provider: normalized_provider,
            redirect_uri: `${window.location.origin}/json/meridian/providers/oauth/callback`,
        },
        success(data) {
            create_request_in_flight = false;
            const root = as_record(data);
            const authorize_url = as_string(root?.["authorize_url"]);
            if (!authorize_url) {
                ui_report.error(
                    "OAuth start did not return an authorization URL.",
                    undefined,
                    $("#dialog_error"),
                );
                return;
            }
            window.open(authorize_url, OAUTH_POPUP_NAME, "popup,width=560,height=760");
            ui_report.success(
                "OAuth window opened. Complete sign-in to continue.",
                $("#dialog_error"),
            );
        },
        error(xhr) {
            create_request_in_flight = false;
            pending_oauth_continuation = null;
            handle_error("Unable to start OAuth sign-in", xhr);
        },
    });
}

function provider_account_status_text(entry: MeridianProviderAuthEntry): string {
    if (!entry.credential_connected) {
        return "Not connected";
    }
    const mode = entry.credential_auth_mode || "api_key";
    const label = entry.credential_label || mode;
    return `Connected (${label})`;
}

function render_provider_accounts_markup(entries: MeridianProviderAuthEntry[]): string {
    if (entries.length === 0) {
        return '<div class="meridian-task-provider-accounts-empty">No providers available.</div>';
    }
    return entries
        .map((entry) => {
            const connected_class = entry.credential_connected
                ? " meridian-provider-connected"
                : "";
            const oauth_disabled = entry.oauth_configured ? "" : " disabled";
            const disconnect_disabled = entry.credential_connected ? "" : " disabled";
            const oauth_badge = entry.oauth_configured
                ? '<span class="meridian-provider-capability">OAuth</span>'
                : "";
            const api_key_badge = entry.auth_modes.includes("api_key")
                ? '<span class="meridian-provider-capability">API key</span>'
                : "";
            return `
<article class="meridian-provider-account${connected_class}" data-meridian-provider="${_.escape(entry.provider)}">
    <div class="meridian-provider-account-main">
        <div class="meridian-provider-account-title">${_.escape(entry.display_name)}</div>
        <div class="meridian-provider-account-status">${_.escape(provider_account_status_text(entry))}</div>
    </div>
    <div class="meridian-provider-account-caps">${oauth_badge}${api_key_badge}</div>
    <div class="meridian-provider-account-actions">
        <button type="button" class="button small rounded" data-meridian-provider-action="oauth" data-meridian-provider="${_.escape(entry.provider)}"${oauth_disabled}>OAuth sign-in</button>
        <button type="button" class="button small rounded" data-meridian-provider-action="disconnect" data-meridian-provider="${_.escape(entry.provider)}"${disconnect_disabled}>Disconnect</button>
    </div>
</article>`;
        })
        .join("");
}

function render_provider_accounts_loading(label = "Loading provider accounts…"): void {
    $(".meridian-provider-accounts-container").html(
        `<div class="meridian-task-provider-accounts-empty">${_.escape(label)}</div>`,
    );
}

function render_provider_accounts_error(label: string): void {
    $(".meridian-provider-accounts-container").html(
        `<div class="meridian-task-provider-accounts-error">${_.escape(label)}</div>`,
    );
}

function refresh_provider_auth_status(): void {
    if (provider_auth_request_in_flight) {
        return;
    }
    provider_auth_request_in_flight = true;
    render_provider_accounts_loading();
    channel.get({
        url: "/json/meridian/providers/auth",
        success(data) {
            provider_auth_request_in_flight = false;
            provider_auth_entries = parse_provider_auth_entries(data);
            $(".meridian-provider-accounts-container").html(
                render_provider_accounts_markup(provider_auth_entries),
            );
        },
        error(xhr) {
            provider_auth_request_in_flight = false;
            render_provider_accounts_error(channel.xhr_error_message("Unable to load provider auth", xhr));
        },
    });
}

function integration_account_status_text(entry: MeridianIntegrationEntry): string {
    if (!entry.credential_connected) {
        return "Not connected";
    }
    const mode = entry.credential_auth_mode || "api_key";
    const label = entry.credential_label || mode;
    return `Connected (${label})`;
}

function integration_is_enabled_by_policy(entry: MeridianIntegrationEntry): boolean {
    if (integration_policy.enabled_integrations.length === 0) {
        return true;
    }
    return integration_policy.enabled_integrations.includes(entry.integration);
}

function render_integration_accounts_markup(entries: MeridianIntegrationEntry[]): string {
    if (entries.length === 0) {
        return '<div class="meridian-task-provider-accounts-empty">No integrations available.</div>';
    }
    return entries
        .map((entry) => {
            const connected_class = entry.credential_connected ? " meridian-provider-connected" : "";
            const disconnect_disabled = entry.credential_connected ? "" : " disabled";
            const policy_checked = integration_is_enabled_by_policy(entry) ? " checked" : "";
            const notes = entry.notes ? `<div class="meridian-provider-account-status">${_.escape(entry.notes)}</div>` : "";
            const tools = entry.tools.length > 0 ? entry.tools.join(", ") : "No declared tools";
            const base = entry.base_url ? ` · ${entry.base_url}` : "";
            const caps = entry.auth_modes
                .map((mode) => `<span class="meridian-provider-capability">${_.escape(mode)}</span>`)
                .join("");
            return `
<article class="meridian-provider-account${connected_class}" data-meridian-integration="${_.escape(entry.integration)}">
    <div class="meridian-provider-account-main">
        <div class="meridian-provider-account-title">${_.escape(entry.display_name)}</div>
        <div class="meridian-provider-account-status">${_.escape(integration_account_status_text(entry))}</div>
    </div>
    ${notes}
    <div class="meridian-provider-account-status">${_.escape(`Tools: ${tools}${base}`)}</div>
    <div class="meridian-provider-account-caps">${caps}</div>
    <label class="meridian-task-create-label meridian-task-checkbox-row">
        <input type="checkbox" data-meridian-integration-enabled="${_.escape(entry.integration)}"${policy_checked} />
        Enable for supervisor tools
    </label>
    <div class="meridian-provider-account-actions">
        <button type="button" class="button small rounded" data-meridian-integration-action="disconnect" data-meridian-integration="${_.escape(entry.integration)}"${disconnect_disabled}>Disconnect</button>
    </div>
</article>`;
        })
        .join("");
}

function render_integration_accounts_loading(label = "Loading integrations…"): void {
    $(".meridian-integration-accounts-container").html(
        `<div class="meridian-task-provider-accounts-empty">${_.escape(label)}</div>`,
    );
}

function render_integration_accounts_error(label: string): void {
    $(".meridian-integration-accounts-container").html(
        `<div class="meridian-task-provider-accounts-error">${_.escape(label)}</div>`,
    );
}

function apply_integration_policy_controls(policy: MeridianIntegrationPolicy): void {
    $("#meridian-integration-policy-auto-transcript").prop("checked", policy.auto_topic_transcript);
    $("#meridian-integration-policy-auto-repo").prop("checked", policy.auto_repo_context);
    $("#meridian-integration-policy-allow-external").prop("checked", policy.allow_external_integrations);
}

function collect_enabled_integrations_from_dom(): string[] {
    const out: string[] = [];
    $("input[data-meridian-integration-enabled]:checked").each(function () {
        const value = String($(this).attr("data-meridian-integration-enabled") ?? "")
            .trim()
            .toLowerCase();
        if (value) {
            out.push(value);
        }
    });
    return _.uniq(out);
}

function refresh_integration_status(): void {
    if (integration_request_in_flight) {
        return;
    }
    integration_request_in_flight = true;
    render_integration_accounts_loading();
    channel.get({
        url: "/json/meridian/integrations/list",
        success(data) {
            integration_request_in_flight = false;
            integration_entries = parse_integration_entries(data);
            integration_policy = parse_integration_policy(data);
            const $select = $("#meridian-integration-provider");
            if ($select.length > 0 && integration_entries.length > 0) {
                const current = String($select.val() ?? "").trim().toLowerCase();
                const options = integration_entries
                    .map((entry) => {
                        const selected = current
                            ? current === entry.integration
                            : entry.integration === integration_entries[0]!.integration;
                        return `<option value="${_.escape(entry.integration)}"${selected ? " selected" : ""}>${_.escape(entry.display_name)}</option>`;
                    })
                    .join("");
                $select.html(options);
            }
            apply_integration_policy_controls(integration_policy);
            $(".meridian-integration-accounts-container").html(
                render_integration_accounts_markup(integration_entries),
            );
        },
        error(xhr) {
            integration_request_in_flight = false;
            render_integration_accounts_error(
                channel.xhr_error_message("Unable to load integrations", xhr),
            );
        },
    });
}

function save_integration_policy(): void {
    const policy: MeridianIntegrationPolicy = {
        auto_topic_transcript:
            $("#meridian-integration-policy-auto-transcript").prop("checked") === true,
        auto_repo_context: $("#meridian-integration-policy-auto-repo").prop("checked") === true,
        allow_external_integrations:
            $("#meridian-integration-policy-allow-external").prop("checked") === true,
        enabled_integrations: collect_enabled_integrations_from_dom(),
    };
    channel.post({
        url: "/json/meridian/integrations/policy",
        data: {
            policy: JSON.stringify(policy),
            merge: true,
        },
        success() {
            integration_policy = policy;
            ui_report.success("Integration policy saved.", $("#dialog_error"));
        },
        error(xhr) {
            handle_error("Unable to save integration policy", xhr);
        },
    });
}

function connect_integration_with_credential(
    integration: string,
    auth_mode: string,
    credential: string,
): void {
    const normalized_integration = integration.trim().toLowerCase();
    if (!normalized_integration) {
        return;
    }
    const normalized_mode = auth_mode.trim().toLowerCase();
    const trimmed_credential = credential.trim();
    if (!trimmed_credential) {
        ui_report.error("Enter a credential to connect the integration.", undefined, $("#dialog_error"));
        return;
    }
    const payload: Record<string, unknown> = {
        integration: normalized_integration,
        auth_mode: normalized_mode === "oauth" ? "oauth" : "api_key",
    };
    if (normalized_mode === "oauth") {
        payload["access_token"] = trimmed_credential;
    } else {
        payload["api_key"] = trimmed_credential;
    }
    channel.post({
        url: "/json/meridian/integrations/connect",
        data: payload,
        success() {
            ui_report.success("Integration connected.", $("#dialog_error"));
            refresh_integration_status();
        },
        error(xhr) {
            handle_error("Unable to connect integration", xhr);
        },
    });
}

function connect_provider_with_credential(provider: string, auth_mode: string, credential: string): void {
    const normalized_provider = normalize_provider(provider);
    const normalized_mode = auth_mode.trim().toLowerCase();
    const trimmed_credential = credential.trim();
    if (normalized_mode === "oauth" && !trimmed_credential) {
        start_provider_oauth(normalized_provider, {mode: "connect_only"});
        return;
    }
    if (!trimmed_credential) {
        ui_report.error("Enter a credential or choose OAuth mode.", undefined, $("#dialog_error"));
        return;
    }
    const payload: Record<string, unknown> = {
        provider: normalized_provider,
        auth_mode: normalized_mode === "oauth" ? "oauth" : "api_key",
    };
    if (normalized_mode === "oauth") {
        payload["access_token"] = trimmed_credential;
    } else {
        payload["api_key"] = trimmed_credential;
    }
    create_request_in_flight = true;
    channel.post({
        url: "/json/meridian/providers/connect",
        data: payload,
        success() {
            create_request_in_flight = false;
            ui_report.success("Provider account connected.", $("#dialog_error"));
            refresh_provider_auth_status();
        },
        error(xhr) {
            create_request_in_flight = false;
            handle_error("Unable to connect provider", xhr);
        },
    });
}

function connect_selected_provider_only(): void {
    const provider = normalize_provider(
        String($("#meridian-topic-task-provider-input").val() ?? DEFAULT_PROVIDER),
    );
    const auth_mode = String($("#meridian-topic-task-auth-mode-input").val() ?? "api_key")
        .trim()
        .toLowerCase();
    const credential = String($("#meridian-topic-task-credential-input").val() ?? "").trim();
    connect_provider_with_credential(provider, auth_mode, credential);
}

function submit_topic_task_creation(
    context: TopicContext,
    instruction: string,
    task_title: string,
    repo_id: string,
    provider: string,
): void {
    create_request_in_flight = true;
    dialog_widget.submit_api_request(
        channel.post,
        "/json/meridian/tasks/create",
        {
            stream_id: context.stream_id,
            stream_name: context.stream_name,
            topic: context.topic,
            instruction,
            repo_id,
            provider: normalize_provider(provider),
            task_title,
        },
        {
            failure_msg_html: "Unable to create task.",
            success_continuation(data) {
                create_request_in_flight = false;
                handle_create_task_success(context, data);
            },
            error_continuation() {
                create_request_in_flight = false;
            },
        },
    );
}

function split_csv_values(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function render_supervisor_plan_modal_content(context: TopicContext): string {
    return `
<form id="${SUPERVISOR_PLAN_FORM_ID}" class="meridian-task-create-modal-form">
    <div class="meridian-task-create-modal-topic">${_.escape(context.stream_name)} · ${_.escape(context.topic)}</div>
    <label for="meridian-supervisor-plan-summary" class="meridian-task-create-label">Plan summary (optional)</label>
    <input id="meridian-supervisor-plan-summary" class="modal_text_input" maxlength="280" autocomplete="off" placeholder="Short summary for this plan revision" />
    <label for="meridian-supervisor-plan-objective" class="meridian-task-create-label">Objective</label>
    <textarea id="meridian-supervisor-plan-objective" class="modal_text_input meridian-task-create-textarea" rows="4" placeholder="What should the supervisor accomplish for this topic?"></textarea>
    <label class="meridian-task-create-label meridian-task-checkbox-row"><input type="checkbox" id="meridian-supervisor-plan-activate" checked /> Activate synthesized revision</label>
    <hr />
    <label class="meridian-task-create-label meridian-task-checkbox-row"><input type="checkbox" id="meridian-supervisor-dispatch-enable" /> Dispatch one directive now</label>
    <label for="meridian-supervisor-directive-instruction" class="meridian-task-create-label">Directive instruction</label>
    <textarea id="meridian-supervisor-directive-instruction" class="modal_text_input meridian-task-create-textarea" rows="5" placeholder="Leave blank to only synthesize plan"></textarea>
    <div class="meridian-task-two-col-grid">
        <div>
            <label for="meridian-supervisor-directive-worker" class="meridian-task-create-label">Assigned worker</label>
            <input id="meridian-supervisor-directive-worker" class="modal_text_input" value="worker-1" autocomplete="off" />
        </div>
        <div>
            <label for="meridian-supervisor-directive-role" class="meridian-task-create-label">Role</label>
            <select id="meridian-supervisor-directive-role" class="modal_text_input">
                <option value="writer">writer</option>
                <option value="read_only">read_only</option>
                <option value="verify">verify</option>
            </select>
        </div>
    </div>
    <div class="meridian-task-two-col-grid">
        <div>
            <label for="meridian-supervisor-directive-file-claims" class="meridian-task-create-label">File claims (comma separated)</label>
            <input id="meridian-supervisor-directive-file-claims" class="modal_text_input" autocomplete="off" />
        </div>
        <div>
            <label for="meridian-supervisor-directive-area-claims" class="meridian-task-create-label">Area claims (comma separated)</label>
            <input id="meridian-supervisor-directive-area-claims" class="modal_text_input" autocomplete="off" />
        </div>
    </div>
</form>`;
}

export function launch_supervisor_plan_modal(context: TopicContext): void {
    dialog_widget.launch({
        id: SUPERVISOR_PLAN_MODAL_ID,
        form_id: SUPERVISOR_PLAN_FORM_ID,
        modal_title_text: "Supervisor plan + dispatch",
        modal_submit_button_text: "Run",
        modal_content_html: render_supervisor_plan_modal_content(context),
        on_show() {
            setTimeout(() => {
                $("#meridian-supervisor-plan-objective").trigger("focus");
            }, 0);
        },
        validate_input() {
            if (supervisor_plan_request_in_flight) {
                return false;
            }
            const dispatch_enabled = $("#meridian-supervisor-dispatch-enable").prop("checked") === true;
            const instruction = String($("#meridian-supervisor-directive-instruction").val() ?? "").trim();
            if (dispatch_enabled && !instruction) {
                ui_report.error("Directive instruction is required when dispatch is enabled.", undefined, $("#dialog_error"));
                return false;
            }
            return true;
        },
        on_click() {
            if (supervisor_plan_request_in_flight) {
                return;
            }

            const summary = String($("#meridian-supervisor-plan-summary").val() ?? "").trim();
            const objective = String($("#meridian-supervisor-plan-objective").val() ?? "").trim();
            const activate = $("#meridian-supervisor-plan-activate").prop("checked") === true;
            const dispatch_enabled = $("#meridian-supervisor-dispatch-enable").prop("checked") === true;
            const directive_instruction = String(
                $("#meridian-supervisor-directive-instruction").val() ?? "",
            ).trim();
            const assigned_worker = String($("#meridian-supervisor-directive-worker").val() ?? "")
                .trim()
                .toLowerCase();
            const assigned_role = String($("#meridian-supervisor-directive-role").val() ?? "writer")
                .trim()
                .toLowerCase();
            const file_claims = split_csv_values(
                String($("#meridian-supervisor-directive-file-claims").val() ?? ""),
            );
            const area_claims = split_csv_values(
                String($("#meridian-supervisor-directive-area-claims").val() ?? ""),
            );

            supervisor_plan_request_in_flight = true;
            channel.post({
                url: `/json/meridian/topics/${encodeURIComponent(context.topic_scope_id)}/plan/synthesize`,
                data: {
                    summary,
                    objective,
                    activate,
                },
                success(data) {
                    const root = as_record(data);
                    const plan_revision = as_record(root?.["plan_revision"]);
                    const plan_revision_id = as_string(plan_revision?.["plan_revision_id"]).trim();
                    if (!dispatch_enabled || !directive_instruction) {
                        supervisor_plan_request_in_flight = false;
                        ui_report.success(
                            plan_revision_id
                                ? `Plan synthesized: ${plan_revision_id}`
                                : "Plan synthesized.",
                            $("#dialog_error"),
                        );
                        refresh_topic_sidebar(true);
                        return;
                    }

                    const directives = [
                        {
                            instruction: directive_instruction,
                            task_title: directive_instruction.split("\n")[0] ?? "Supervisor directive",
                            provider: get_provider_preference(),
                            assigned_worker: assigned_worker || "worker-1",
                            assigned_role: assigned_role || "writer",
                            file_claims,
                            area_claims,
                        },
                    ];
                    channel.post({
                        url: `/json/meridian/topics/${encodeURIComponent(context.topic_scope_id)}/directives/dispatch`,
                        data: {
                            plan_revision_id: plan_revision_id || undefined,
                            directives: JSON.stringify(directives),
                            stream_id: context.stream_id,
                            stream_name: context.stream_name,
                            topic: context.topic,
                        },
                        success(dispatch_data) {
                            supervisor_plan_request_in_flight = false;
                            const dispatch_root = as_record(dispatch_data);
                            const tasks_raw = Array.isArray(dispatch_root?.["tasks"])
                                ? dispatch_root["tasks"]
                                : [];
                            const first_task = parse_task_summary(tasks_raw[0]);
                            ui_report.success("Directive dispatched.", $("#dialog_error"));
                            if (first_task) {
                                select_task(first_task.task_id, {
                                    open_view: true,
                                    stream_id: context.stream_id,
                                    topic: context.topic,
                                });
                                return;
                            }
                            refresh_topic_sidebar(true);
                        },
                        error(xhr) {
                            supervisor_plan_request_in_flight = false;
                            handle_error("Unable to dispatch directive", xhr);
                        },
                    });
                },
                error(xhr) {
                    supervisor_plan_request_in_flight = false;
                    handle_error("Unable to synthesize plan", xhr);
                },
            });
        },
    });
}

function render_provider_accounts_modal_content(): string {
    const selected_provider = get_provider_preference();
    return `
<form id="${PROVIDER_ACCOUNTS_FORM_ID}" class="meridian-task-create-modal-form">
    <label for="meridian-provider-accounts-provider" class="meridian-task-create-label">Provider</label>
    <select id="meridian-provider-accounts-provider" class="modal_text_input">
        <option value="codex" ${selected_provider === "codex" ? "selected" : ""}>Codex</option>
        <option value="claude_code" ${selected_provider === "claude_code" ? "selected" : ""}>Claude Code</option>
        <option value="opencode" ${selected_provider === "opencode" ? "selected" : ""}>OpenCode (Fireworks Kimi K2)</option>
    </select>
    <label for="meridian-provider-accounts-auth-mode" class="meridian-task-create-label">Credential mode</label>
    <select id="meridian-provider-accounts-auth-mode" class="modal_text_input">
        <option value="api_key">API key</option>
        <option value="oauth">OAuth token</option>
    </select>
    <label for="meridian-provider-accounts-credential" class="meridian-task-create-label">Credential (optional)</label>
    <input id="meridian-provider-accounts-credential" class="modal_text_input" autocomplete="off" placeholder="Optional provider API key" />
    <div class="meridian-task-provider-auth-actions">
        <button type="button" class="button small rounded" id="meridian-provider-accounts-connect">Connect account</button>
        <button type="button" class="button small rounded" id="meridian-provider-accounts-refresh">Refresh accounts</button>
    </div>
    <section class="meridian-task-provider-accounts meridian-provider-accounts-container">
        <div class="meridian-task-provider-accounts-empty">Loading provider accounts…</div>
    </section>
    <hr />
    <label for="meridian-integration-provider" class="meridian-task-create-label">Integration</label>
    <select id="meridian-integration-provider" class="modal_text_input">
        <option value="github">GitHub</option>
        <option value="forgejo">Forgejo</option>
        <option value="calcom">Cal.com</option>
    </select>
    <label for="meridian-integration-auth-mode" class="meridian-task-create-label">Integration credential mode</label>
    <select id="meridian-integration-auth-mode" class="modal_text_input">
        <option value="api_key">API key</option>
        <option value="oauth">OAuth token</option>
    </select>
    <label for="meridian-integration-credential" class="meridian-task-create-label">Integration credential (optional)</label>
    <input id="meridian-integration-credential" class="modal_text_input" autocomplete="off" placeholder="API key or access token" />
    <div class="meridian-task-provider-auth-actions">
        <button type="button" class="button small rounded" id="meridian-integration-connect">Connect integration</button>
        <button type="button" class="button small rounded" id="meridian-integration-refresh">Refresh integrations</button>
    </div>
    <label class="meridian-task-create-label meridian-task-checkbox-row"><input type="checkbox" id="meridian-integration-policy-auto-transcript" checked /> Auto-load topic transcript for supervisor</label>
    <label class="meridian-task-create-label meridian-task-checkbox-row"><input type="checkbox" id="meridian-integration-policy-auto-repo" checked /> Auto-include repo context and guidance</label>
    <label class="meridian-task-create-label meridian-task-checkbox-row"><input type="checkbox" id="meridian-integration-policy-allow-external" checked /> Allow connected integration tools in supervisor runs</label>
    <div class="meridian-task-provider-auth-actions">
        <button type="button" class="button small rounded" id="meridian-integration-policy-save">Save integration policy</button>
    </div>
    <section class="meridian-task-provider-accounts meridian-integration-accounts-container">
        <div class="meridian-task-provider-accounts-empty">Loading integrations…</div>
    </section>
</form>`;
}

function launch_provider_accounts_modal(): void {
    dialog_widget.launch({
        id: PROVIDER_ACCOUNTS_MODAL_ID,
        form_id: PROVIDER_ACCOUNTS_FORM_ID,
        modal_title_text: "Provider accounts",
        modal_submit_button_text: "Close",
        modal_content_html: render_provider_accounts_modal_content(),
        on_show() {
            refresh_provider_auth_status();
            refresh_integration_status();
            setTimeout(() => {
                $("#meridian-provider-accounts-provider").trigger("focus");
            }, 0);
        },
        validate_input() {
            return true;
        },
        on_click() {
            return;
        },
    });
}

function render_create_task_modal_content(context: TopicContext): string {
    const selected_provider = get_provider_preference();
    return `
<form id="${CREATE_TASK_MODAL_FORM_ID}" class="meridian-task-create-modal-form">
    <div class="meridian-task-create-modal-topic">${_.escape(context.stream_name)} · ${_.escape(context.topic)}</div>
    <label for="meridian-topic-task-title-input" class="meridian-task-create-label">Task title (optional)</label>
    <input id="meridian-topic-task-title-input" class="modal_text_input" maxlength="200" autocomplete="off" />
    <label for="meridian-topic-task-instruction-input" class="meridian-task-create-label">Instruction</label>
    <textarea id="meridian-topic-task-instruction-input" class="modal_text_input meridian-task-create-textarea" rows="6" placeholder="Describe what the agent should do for this topic"></textarea>
    <label for="meridian-topic-task-repo-input" class="meridian-task-create-label">Repo</label>
    <input id="meridian-topic-task-repo-input" class="modal_text_input" value="${_.escape(get_repo_id_preference())}" placeholder="owner/repo" autocomplete="off" />
    <label for="meridian-topic-task-provider-input" class="meridian-task-create-label">Provider</label>
    <select id="meridian-topic-task-provider-input" class="modal_text_input">
        <option value="codex" ${selected_provider === "codex" ? "selected" : ""}>Codex</option>
        <option value="claude_code" ${selected_provider === "claude_code" ? "selected" : ""}>Claude Code</option>
        <option value="opencode" ${selected_provider === "opencode" ? "selected" : ""}>OpenCode (Fireworks Kimi K2)</option>
    </select>
    <div id="meridian-topic-task-provider-hint" class="meridian-task-create-oauth-hint"></div>
    <label for="meridian-topic-task-auth-mode-input" class="meridian-task-create-label">Credential mode</label>
    <select id="meridian-topic-task-auth-mode-input" class="modal_text_input">
        <option value="api_key">API key</option>
        <option value="oauth">OAuth token</option>
    </select>
    <label for="meridian-topic-task-credential-input" class="meridian-task-create-label">Credential (optional)</label>
    <input id="meridian-topic-task-credential-input" class="modal_text_input" autocomplete="off" placeholder="Optional provider API key" />
    <div class="meridian-task-create-oauth-hint">Tip: choose OAuth mode and submit without a credential to launch provider sign-in.</div>
    <div class="meridian-task-provider-auth-actions">
        <button type="button" class="button small rounded" id="meridian-topic-task-connect-provider-only">Connect provider only</button>
        <button type="button" class="button small rounded" id="meridian-topic-task-refresh-provider-auth">Refresh accounts</button>
    </div>
    <section id="meridian-topic-task-provider-accounts" class="meridian-task-provider-accounts meridian-provider-accounts-container">
        <div class="meridian-task-provider-accounts-empty">Loading provider accounts…</div>
    </section>
</form>`;
}

export function launch_create_task_modal(context: TopicContext): void {
    if (create_request_in_flight) {
        return;
    }

    dialog_widget.launch({
        id: CREATE_TASK_MODAL_ID,
        form_id: CREATE_TASK_MODAL_FORM_ID,
        modal_title_text: "Create topic task",
        modal_submit_button_text: "Create task",
        modal_content_html: render_create_task_modal_content(context),
        on_show() {
            setTimeout(() => {
                $("#meridian-topic-task-instruction-input").trigger("focus");
            }, 0);
            update_create_task_credential_placeholder();
            $("body")
                .off("change.meridian_task_auth_mode", "#meridian-topic-task-auth-mode-input")
                .on("change.meridian_task_auth_mode", "#meridian-topic-task-auth-mode-input", () => {
                    update_create_task_credential_placeholder();
                });
            $("body")
                .off("change.meridian_task_provider", "#meridian-topic-task-provider-input")
                .on("change.meridian_task_provider", "#meridian-topic-task-provider-input", () => {
                    update_create_task_provider_hint();
                });
            update_create_task_provider_hint();
            provider_auth_entries = [];
            refresh_provider_auth_status();
        },
        validate_input() {
            const instruction = String(
                $("#meridian-topic-task-instruction-input").val() ?? "",
            ).trim();
            const repo_id = String($("#meridian-topic-task-repo-input").val() ?? "").trim();
            if (!instruction) {
                ui_report.error("Task instruction is required.", undefined, $("#dialog_error"));
                return false;
            }
            if (!repo_id) {
                ui_report.error("Repository is required.", undefined, $("#dialog_error"));
                return false;
            }
            return true;
        },
        on_click() {
            if (create_request_in_flight) {
                return;
            }

            const instruction = String(
                $("#meridian-topic-task-instruction-input").val() ?? "",
            ).trim();
            const title_source = String($("#meridian-topic-task-title-input").val() ?? "").trim();
            const task_title = title_source || instruction.split("\n")[0]!;
            const repo_id = String($("#meridian-topic-task-repo-input").val() ?? "").trim();
            const provider = normalize_provider(
                String($("#meridian-topic-task-provider-input").val() ?? DEFAULT_PROVIDER),
            );
            const auth_mode = String($("#meridian-topic-task-auth-mode-input").val() ?? "api_key")
                .trim()
                .toLowerCase();
            const credential = String($("#meridian-topic-task-credential-input").val() ?? "").trim();
            set_repo_id_preference(repo_id);
            set_provider_preference(provider);

            if (credential) {
                create_request_in_flight = true;
                const connect_payload: Record<string, unknown> = {
                    provider,
                    auth_mode: auth_mode === "oauth" ? "oauth" : "api_key",
                };
                if (auth_mode === "oauth") {
                    connect_payload["access_token"] = credential;
                } else {
                    connect_payload["api_key"] = credential;
                }
                channel.post({
                    url: "/json/meridian/providers/connect",
                    data: connect_payload,
                    success() {
                        submit_topic_task_creation(context, instruction, task_title, repo_id, provider);
                    },
                    error(xhr) {
                        create_request_in_flight = false;
                        handle_error("Unable to connect provider", xhr);
                    },
                });
                return;
            }
            if (auth_mode === "oauth") {
                pending_oauth_continuation = {
                    mode: "create_task",
                    context,
                    instruction,
                    task_title,
                    repo_id,
                    provider,
                };
                start_provider_oauth(provider, pending_oauth_continuation);
                return;
            }
            submit_topic_task_creation(context, instruction, task_title, repo_id, provider);
        },
    });
}

function submit_task_reply(message: string): void {
    const task_id = state.selected_task_id.trim();
    if (!task_id || reply_request_in_flight) {
        return;
    }
    const trimmed_message = message.trim();
    if (!trimmed_message) {
        return;
    }

    reply_request_in_flight = true;
    update_reply_composer_state();
    channel.post({
        url: `/json/meridian/tasks/${encodeURIComponent(task_id)}/reply`,
        data: {message: trimmed_message},
        success(data) {
            reply_request_in_flight = false;
            update_reply_composer_state();
            const root = as_record(data);
            const reply = as_record(root?.["reply"]);
            void reply;
            refresh_topic_sidebar(true);
            poll_selected_task_events(true);
            start_selected_task_event_stream();
        },
        error(xhr) {
            reply_request_in_flight = false;
            update_reply_composer_state();
            state.pending_reply_message = "";
            state.pending_reply_time = "";
            handle_error("Unable to send task message", xhr);
        },
    });
}

export function launch_create_task_modal_for_topic(stream_id: number, topic: string): void {
    // Task creation is supervisor-driven. Keep this entry point for legacy callers,
    // but route to the topic-level supervisor surface.
    open_supervisor_view_for_topic(stream_id, topic);
}

export function open_supervisor_view_for_topic(stream_id: number, topic: string): void {
    reset_supervisor_view_state();
    hide_task_view(true);
    meridian_supervisor_sidebar.open_for_topic(stream_id, topic);
}

function invoke_selected_task_action(action: string, extra: Record<string, unknown> = {}): void {
    const task_id = state.selected_task_id.trim();
    if (!task_id) {
        return;
    }
    const action_name = action.trim().toLowerCase();
    if (!action_name) {
        return;
    }
    if (action_name === "resolve_clarification_prompt") {
        const guidance = String($("#meridian-task-reply-input").val() ?? "").trim();
        if (!guidance) {
            ui_report.generic_embed_error(
                "Provide clarification guidance in the reply box, then click Resolve clarification.",
                4500,
            );
            return;
        }
        $("#meridian-task-reply-input").val("");
        invoke_selected_task_action("resolve_clarification", {note: guidance});
        return;
    }
    if (action_name === "mark_at_risk") {
        invoke_selected_task_action("mark_at_risk", {note: "manual mark_at_risk from task panel"});
        return;
    }
    channel.post({
        url: `/json/meridian/tasks/${encodeURIComponent(task_id)}/action`,
        data: {action: action_name, ...extra},
        success() {
            refresh_topic_sidebar(true);
            poll_selected_task_events(true);
            start_selected_task_event_stream();
        },
        error(xhr) {
            handle_error(`Unable to ${action_name} task`, xhr);
        },
    });
}

function submit_task_reply_from_ui(): void {
    const raw = String($("#meridian-task-reply-input").val() ?? "");
    const message = raw.trim();
    if (!message || reply_request_in_flight) {
        return;
    }
    state.pending_reply_message = message;
    state.pending_reply_time = new Date().toISOString();
    submit_task_reply(message);
    $("#meridian-task-reply-input").val("");
    const context = current_topic_context();
    if (state.task_view_mode === "task" && context && state.last_sidebar) {
        render_task_view(context, state.last_sidebar);
    }
}

function close_task_view(): void {
    hide_task_view(true);
}

export function initialize(): void {
    window.addEventListener("message", (event: MessageEvent) => {
        const data = as_record(event.data);
        if (!data || as_string(data["source"]) !== "meridian_oauth") {
            return;
        }
        const status = as_string(data["status"]);
        const detail = as_string(data["detail"]);
        if (status === "ok") {
            ui_report.generic_embed_error(
                _.escape(detail || "OAuth sign-in completed. Continue creating the task."),
                5000,
            );
            const continuation = pending_oauth_continuation;
            pending_oauth_continuation = null;
            if (continuation?.mode === "create_task") {
                submit_topic_task_creation(
                    continuation.context,
                    continuation.instruction,
                    continuation.task_title,
                    continuation.repo_id,
                    continuation.provider,
                );
                return;
            }
            if (continuation?.mode === "connect_only") {
                refresh_provider_auth_status();
                refresh_integration_status();
            }
            return;
        }
        if (status === "error") {
            pending_oauth_continuation = null;
            ui_report.generic_embed_error(
                _.escape(detail || "OAuth sign-in failed."),
                6000,
            );
        }
    });

    document.addEventListener("toggle", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLDetailsElement)) {
            return;
        }
        if (target.id !== "meridian-task-inspector") {
            return;
        }
        state.task_inspector_open = target.open;
    });

    $("body").on("click", "#meridian-task-view-back", (e) => {
        e.preventDefault();
        e.stopPropagation();
        close_task_view();
    });

    $("body").on("keydown", (event: JQuery.KeyDownEvent) => {
        if (event.key !== "Escape" || !state.task_view_open) {
            return;
        }
        if (!(event.target instanceof Element)) {
            close_task_view();
            return;
        }
        const $target = $(event.target);
        if ($target.is("input, textarea, [contenteditable='true']")) {
            return;
        }
        close_task_view();
    });

    $("body").on("click", ".meridian-topic-supervisor-link", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!(this instanceof HTMLElement)) {
            return;
        }
        const $trigger = $(this);
        const stream_id = task_link_stream_id($trigger);
        const topic = task_link_topic_name($trigger);
        if (stream_id === undefined || !topic) {
            return;
        }
        open_supervisor_view_for_topic(stream_id, topic);
    });

    $("body").on("keydown", ".meridian-topic-supervisor-link", function (e) {
        if (e.key !== "Enter" && e.key !== " ") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (!(this instanceof HTMLElement)) {
            return;
        }
        const $trigger = $(this);
        const stream_id = task_link_stream_id($trigger);
        const topic = task_link_topic_name($trigger);
        if (stream_id === undefined || !topic) {
            return;
        }
        open_supervisor_view_for_topic(stream_id, topic);
    });

    $("body").on("click", ".meridian-topic-task-link", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!(this instanceof HTMLElement)) {
            return;
        }
        const $trigger = $(this);
        const task_id = $trigger.attr("data-meridian-task-id") ?? "";
        const stream_id = task_link_stream_id($trigger);
        const topic = task_link_topic_name($trigger);
        const open_opts: {open_view: true; stream_id?: number; topic?: string} = {
            open_view: true,
        };
        if (stream_id !== undefined) {
            open_opts.stream_id = stream_id;
        }
        if (topic) {
            open_opts.topic = topic;
        }
        select_task(task_id, open_opts);
    });

    $("body").on("keydown", ".meridian-topic-task-link", function (e) {
        if (e.key !== "Enter" && e.key !== " ") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (!(this instanceof HTMLElement)) {
            return;
        }
        const $trigger = $(this);
        const task_id = $trigger.attr("data-meridian-task-id") ?? "";
        const stream_id = task_link_stream_id($trigger);
        const topic = task_link_topic_name($trigger);
        const open_opts: {open_view: true; stream_id?: number; topic?: string} = {
            open_view: true,
        };
        if (stream_id !== undefined) {
            open_opts.stream_id = stream_id;
        }
        if (topic) {
            open_opts.topic = topic;
        }
        select_task(task_id, open_opts);
    });

    $("body").on("click", ".meridian-task-action-button", function () {
        if ($(this).prop("disabled")) {
            return;
        }
        const action = $(this).attr("data-meridian-task-action") ?? "";
        invoke_selected_task_action(action);
    });

    $("body").on("click", "#meridian-task-provider-accounts", (e) => {
        e.preventDefault();
        e.stopPropagation();
        launch_provider_accounts_modal();
    });

    $("body").on("click", "#meridian-supervisor-refresh", (e) => {
        e.preventDefault();
        e.stopPropagation();
        refresh_topic_sidebar(true);
        refresh_supervisor_view_data(true);
    });

    $("body").on("click", "#meridian-supervisor-synthesize", (e) => {
        e.preventDefault();
        e.stopPropagation();
        submit_supervisor_synthesize_from_view();
    });

    $("body").on("click", "#meridian-supervisor-dispatch", (e) => {
        e.preventDefault();
        e.stopPropagation();
        submit_supervisor_dispatch_from_view();
    });

    $("body").on("click", "#meridian-task-supervisor-plan", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const context = current_topic_context();
        if (!context) {
            ui_report.generic_embed_error("Open a stream topic to synthesize a supervisor plan.", 3500);
            return;
        }
        open_supervisor_view_for_topic(context.stream_id, context.topic);
    });

    $("body").on("click", "#meridian-task-reply-send", (e) => {
        e.preventDefault();
        e.stopPropagation();
        submit_task_reply_from_ui();
    });

    $("body").on("click", "#meridian-task-inline-stop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ($("#meridian-task-inline-stop").prop("disabled")) {
            return;
        }
        invoke_selected_task_action("cancel");
    });

    $("body").on("keydown", "#meridian-task-reply-input", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            submit_task_reply_from_ui();
        }
    });

    $("body").on("input", "#meridian-task-reply-input", () => {
        autosize_reply_input();
    });

    $("body").on("click", "#meridian-topic-task-refresh-provider-auth", (e) => {
        e.preventDefault();
        e.stopPropagation();
        refresh_provider_auth_status();
    });

    $("body").on("click", "#meridian-provider-accounts-refresh", (e) => {
        e.preventDefault();
        e.stopPropagation();
        refresh_provider_auth_status();
    });

    $("body").on("click", "#meridian-integration-refresh", (e) => {
        e.preventDefault();
        e.stopPropagation();
        refresh_integration_status();
    });

    $("body").on("click", "#meridian-topic-task-connect-provider-only", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (create_request_in_flight) {
            return;
        }
        connect_selected_provider_only();
    });

    $("body").on("click", "#meridian-provider-accounts-connect", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (create_request_in_flight) {
            return;
        }
        const provider = normalize_provider(
            String($("#meridian-provider-accounts-provider").val() ?? DEFAULT_PROVIDER),
        );
        const auth_mode = String($("#meridian-provider-accounts-auth-mode").val() ?? "api_key")
            .trim()
            .toLowerCase();
        const credential = String($("#meridian-provider-accounts-credential").val() ?? "").trim();
        set_provider_preference(provider);
        connect_provider_with_credential(provider, auth_mode, credential);
    });

    $("body").on("click", "#meridian-integration-connect", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const integration = String($("#meridian-integration-provider").val() ?? "").trim();
        const auth_mode = String($("#meridian-integration-auth-mode").val() ?? "api_key")
            .trim()
            .toLowerCase();
        const credential = String($("#meridian-integration-credential").val() ?? "").trim();
        connect_integration_with_credential(integration, auth_mode, credential);
    });

    $("body").on("click", "#meridian-integration-policy-save", (e) => {
        e.preventDefault();
        e.stopPropagation();
        save_integration_policy();
    });

    $("body").on("click", "[data-meridian-provider-action]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (create_request_in_flight) {
            return;
        }
        const action = ($(this).attr("data-meridian-provider-action") ?? "").trim();
        const provider = normalize_provider($(this).attr("data-meridian-provider") ?? "");
        if (!provider) {
            return;
        }
        if (action === "oauth") {
            start_provider_oauth(provider, {mode: "connect_only"});
            return;
        }
        if (action !== "disconnect") {
            return;
        }
        create_request_in_flight = true;
        channel.post({
            url: "/json/meridian/providers/disconnect",
            data: {provider},
            success() {
                create_request_in_flight = false;
                ui_report.success("Provider account disconnected.", $("#dialog_error"));
                refresh_provider_auth_status();
            },
            error(xhr) {
                create_request_in_flight = false;
                handle_error("Unable to disconnect provider", xhr);
            },
        });
    });

    $("body").on("click", "[data-meridian-integration-action]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const action = ($(this).attr("data-meridian-integration-action") ?? "").trim();
        const integration = String($(this).attr("data-meridian-integration") ?? "")
            .trim()
            .toLowerCase();
        if (!integration || action !== "disconnect") {
            return;
        }
        channel.post({
            url: "/json/meridian/integrations/disconnect",
            data: {integration},
            success() {
                ui_report.success("Integration disconnected.", $("#dialog_error"));
                refresh_integration_status();
            },
            error(xhr) {
                handle_error("Unable to disconnect integration", xhr);
            },
        });
    });

    $("body").on("click", "[data-meridian-thread-copy]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
        const event_id = Number.parseInt($(this).attr("data-meridian-thread-copy") ?? "", 10);
        if (Number.isNaN(event_id)) {
            return;
        }
        const article = document.querySelector<HTMLElement>(`#meridian-task-event-${event_id}`);
        if (!article) {
            return;
        }
        const text = article.querySelector<HTMLElement>(".meridian-thread-message")?.textContent ?? "";
        if (!text.trim()) {
            return;
        }
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
            ui_report.generic_embed_error("Clipboard API unavailable.", 2200);
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            ui_report.generic_embed_error("Copied assistant output.", 1800);
        } catch {
            ui_report.generic_embed_error("Unable to copy output.", 2200);
        }
        })();
    });

    $("body").on("click", "[data-meridian-markdown-copy]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
            const button = this instanceof HTMLButtonElement ? this : undefined;
            const block = button?.closest(".meridian-markdown-code");
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
                    button.textContent = "Copied";
                    window.setTimeout(() => {
                        if (button.isConnected) {
                            button.textContent = "Copy";
                        }
                    }, 1800);
                }
            } catch {
                ui_report.generic_embed_error("Unable to copy code block.", 2200);
            }
        })();
    });

    $("body").on("click", "[data-meridian-jump-event]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const event_id = Number.parseInt($(this).attr("data-meridian-jump-event") ?? "", 10);
        if (Number.isNaN(event_id)) {
            return;
        }
        window.setTimeout(() => {
            const target = document.querySelector<HTMLElement>(`#meridian-task-event-${event_id}`);
            if (!target) {
                return;
            }
            target.scrollIntoView({block: "center"});
            target.classList.add("meridian-thread-row-highlight");
            window.setTimeout(() => {
                target.classList.remove("meridian-thread-row-highlight");
            }, 1200);
        }, 0);
    });

    $("body").on("click", "[data-meridian-task-details-toggle]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mode = ($(this).attr("data-meridian-task-details-toggle") ?? "").trim();
        if (mode !== "expand" && mode !== "collapse") {
            return;
        }
        const next_collapsed = mode !== "expand";
        if (next_collapsed === state.task_details_collapsed) {
            return;
        }
        state.task_details_collapsed = next_collapsed;
        state.task_view_rows_signature = "";
        const context = current_topic_context();
        if (context && state.last_sidebar) {
            render_task_view(context, state.last_sidebar);
        }
    });

    $("body").on("click", "[data-meridian-task-review-mode]", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mode = ($(this).attr("data-meridian-task-review-mode") ?? "").trim();
        if (mode !== "unified" && mode !== "split") {
            return;
        }
        if (state.task_review_mode === mode) {
            return;
        }
        state.task_review_mode = mode;
        state.task_view_signature = "";
        state.task_view_rows_signature = "";
        const context = current_topic_context();
        if (context && state.last_sidebar) {
            render_task_view(context, state.last_sidebar);
        }
    });

    $("body").on("keydown", "[data-meridian-task-review-mode]", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const next_mode = e.key === "ArrowRight" ? "split" : "unified";
        if (state.task_review_mode === next_mode) {
            return;
        }
        state.task_review_mode = next_mode;
        state.task_view_signature = "";
        const context = current_topic_context();
        if (context && state.last_sidebar) {
            render_task_view(context, state.last_sidebar);
        }
    });

    $("body").on("scroll", "#meridian-task-thread-log", function () {
        if (!(this instanceof HTMLElement)) {
            return;
        }
        const near_bottom = thread_is_near_bottom(this);
        if (near_bottom === state.task_follow_output) {
            return;
        }
        state.task_follow_output = near_bottom;
        update_follow_output_ui();
    });

    $("body").on("click", "#meridian-task-follow-button", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const thread = document.querySelector<HTMLElement>("#meridian-task-thread-log");
        if (!thread) {
            return;
        }
        state.task_follow_output = true;
        thread.scrollTop = thread.scrollHeight;
        update_follow_output_ui();
    });

    hide_task_view(true);

    $(window).on("hashchange.meridian_tasks", () => {
        const next_context = current_topic_context();
        const next_scope = next_context?.topic_scope_id ?? "";
        const previous_scope = state.topic_scope_id;
        const keep_open_for_pending_target =
            Boolean(pending_task_open_scope_id) && pending_task_open_scope_id === next_scope;

        if (!keep_open_for_pending_target && next_scope !== previous_scope && state.task_view_open) {
            hide_task_view(true);
            reset_task_stream_state("");
        }

        if (next_scope !== previous_scope) {
            clear_sidebar_task_rows(previous_scope);
            state.sidebar_rows_signature = "";
        }
        if (!state.task_view_open) {
            hide_task_view(true);
        }
        if (keep_open_for_pending_target) {
            pending_task_open_scope_id = "";
        }
        refresh_topic_sidebar(true);
    });

    sidebar_poll_timer = window.setInterval(() => {
        refresh_topic_sidebar(false);
    }, SIDEBAR_POLL_MS);

    events_poll_timer = window.setInterval(() => {
        poll_selected_task_events(false);
        if (ENABLE_TASK_EVENT_STREAM) {
            start_selected_task_event_stream();
        }
    }, EVENTS_FALLBACK_POLL_MS);

    refresh_topic_sidebar(true);
}

export function teardown_for_tests(): void {
    if (sidebar_poll_timer !== null) {
        window.clearInterval(sidebar_poll_timer);
        sidebar_poll_timer = null;
    }
    if (events_poll_timer !== null) {
        window.clearInterval(events_poll_timer);
        events_poll_timer = null;
    }
    state.topic_scope_id = "";
    state.selected_task_id = "";
    state.task_view_open = false;
    state.task_follow_output = true;
    state.task_stream_mode = "chat";
    state.event_after_id = 0;
    state.event_rows = [];
    state.last_sidebar = null;
    state.sidebar_rows_signature = "";
    state.task_view_signature = "";
    state.task_view_rows_signature = "";
    state.pending_reply_message = "";
    state.pending_reply_time = "";
    state.event_stream_connected = false;
    state.event_stream_disconnected = false;
    state.task_inline_error = "";
    state.task_review_mode = "unified";
    state.task_details_collapsed = true;
    sidebar_request_in_flight = false;
    events_request_in_flight = false;
    task_details_request_task_id = "";
    create_request_in_flight = false;
    reply_request_in_flight = false;
    provider_auth_request_in_flight = false;
    pending_task_open_scope_id = "";
    provider_auth_entries = [];
    pending_oauth_continuation = null;
    close_selected_task_event_stream();
    $(window).off("hashchange.meridian_tasks");
    clear_sidebar_task_rows();
    set_task_view_open_state(false);
    hide_task_view();
}

export const __test_hooks = {
    trim_repeated_chunk,
    merge_thread_text,
    compact_thread_events,
    render_thread_rows,
    render_split_diff_table,
    render_diff_document_markup,
};
