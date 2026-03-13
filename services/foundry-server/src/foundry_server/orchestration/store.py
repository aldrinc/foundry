#!/usr/bin/env python3
import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

TASK_STATUSES = {
    "queued",
    "running",
    "paused",
    "stalled",
    "blocked_approval",
    "blocked_dependency",
    "blocked_information",
    "at_risk",
    "done",
    "failed",
    "canceled",
}
TERMINAL_TASK_STATUSES = {"done", "failed", "canceled"}
REPO_SCOPE_MAPPING_USER_ID = "__repo_scope__"
WORKER_SESSION_STATUSES = {
    "queued",
    "running",
    "blocked",
    "waiting_input",
    "paused",
    "completed",
    "failed",
    "canceled",
    # Agent-Orchestrator parity session states (kept alongside legacy states).
    "spawning",
    "working",
    "pr_open",
    "ci_failed",
    "review_pending",
    "changes_requested",
    "approved",
    "mergeable",
    "merged",
    "cleanup",
    "needs_input",
    "stuck",
    "errored",
    "killed",
    "done",
    "terminated",
}
WORKER_SESSION_ACTIVITIES = {
    "active",
    "ready",
    "waiting_input",
    "blocked",
    "exited",
}


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_topic_scope_id(value: str) -> str:
    return _normalize_text(value).lower()


def normalize_provider_id(value: str) -> str:
    normalized = _normalize_text(value).lower()
    aliases = {
        "open_code": "opencode",
        "claude": "claude_code",
        "claudecode": "claude_code",
        "cloud_code": "claude_code",
    }
    return aliases.get(normalized, normalized)


def provider_storage_ids(value: str) -> List[str]:
    normalized = normalize_provider_id(value)
    if normalized == "claude_code":
        return ["claude_code", "cloud_code"]
    return [normalized] if normalized else []


def normalize_integration_id(value: str) -> str:
    normalized = _normalize_text(value).lower()
    aliases = {
        "forjo": "forgejo",
        "gitea": "forgejo",
        "cal.com": "calcom",
        "cal_com": "calcom",
    }
    return aliases.get(normalized, normalized)


def _parse_json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_json_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except Exception:
            return [text]
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    return []


def derive_topic_scope_id(
    *,
    zulip_thread_ref: Optional[Dict[str, Any]],
    repo_id: str,
    user_id: str,
) -> str:
    ref = zulip_thread_ref or {}
    stream = _normalize_text(ref.get("stream"))
    stream_id = _normalize_text(ref.get("stream_id"))
    topic = _normalize_text(ref.get("topic") or ref.get("subject"))
    message_type = _normalize_text(ref.get("message_type")).lower()

    if topic and stream_id:
        return normalize_topic_scope_id(f"stream_id:{stream_id}:topic:{topic}")
    if topic and stream:
        return normalize_topic_scope_id(f"stream:{stream}:topic:{topic}")

    dm_candidates: List[str] = []
    for key in ("recipient_emails", "emails", "users"):
        raw = ref.get(key)
        if isinstance(raw, list):
            dm_candidates.extend(_normalize_text(item).lower() for item in raw if _normalize_text(item))
    if not dm_candidates:
        recipients = ref.get("recipients")
        if isinstance(recipients, list):
            for entry in recipients:
                if isinstance(entry, dict):
                    email = _normalize_text(entry.get("email") or entry.get("user") or entry.get("id"))
                    if email:
                        dm_candidates.append(email.lower())
                else:
                    email = _normalize_text(entry)
                    if email:
                        dm_candidates.append(email.lower())
    if dm_candidates:
        unique = sorted(set(dm_candidates))
        return normalize_topic_scope_id(f"dm:{','.join(unique)}")

    if message_type == "private":
        sender = _normalize_text(ref.get("sender_email") or user_id).lower() or "unknown"
        return normalize_topic_scope_id(f"dm:{sender}")

    message_id = _normalize_text(ref.get("message_id") or ref.get("id"))
    if message_id:
        return normalize_topic_scope_id(f"message:{message_id}")

    return normalize_topic_scope_id(f"repo:{repo_id}")


def derive_task_title(instruction: str, options: Dict[str, Any]) -> str:
    for key in ("task_title", "title", "name"):
        candidate = _normalize_text(options.get(key))
        if candidate:
            return candidate[:160]
    first_line = _normalize_text((instruction or "").splitlines()[0] if instruction else "")
    return (first_line or "Task")[:160]


@dataclass
class WorkspaceMapping:
    user_id: str
    repo_id: str
    repo_url: Optional[str]
    workspace_name: str
    workspace_owner: str
    workspace_id: Optional[str]
    created_at: str
    updated_at: str


@dataclass
class TopicRepoBinding:
    topic_scope_id: str
    repo_id: str
    repo_url: Optional[str]
    source: str
    confidence: str
    metadata: Dict[str, Any]
    created_at: str
    updated_at: str


@dataclass
class TaskRecord:
    task_id: str
    user_id: str
    repo_id: str
    repo_url: Optional[str]
    provider: str
    instruction: str
    zulip_thread_ref: Dict[str, Any]
    options: Dict[str, Any]
    topic_scope_id: str
    status: str
    cancel_requested: bool
    workspace_id: Optional[str]
    workspace_name: Optional[str]
    branch_name: Optional[str]
    worktree_path: Optional[str]
    container_name: Optional[str]
    container_runtime: Optional[str]
    preview_port: Optional[int]
    preview_url: Optional[str]
    created_at: str
    updated_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    worker_id: Optional[str]
    assigned_worker: Optional[str]
    assigned_role: Optional[str]
    assigned_by: Optional[str]
    directive_id: Optional[str]
    plan_revision_id: Optional[str]
    result_text: Optional[str]
    error_text: Optional[str]
    blocked_reason: Optional[str]
    clarification_questions: List[str]
    clarification_requested: bool
    approved: bool


@dataclass
class WorkerSessionRecord:
    worker_session_id: str
    task_id: str
    topic_scope_id: str
    status: str
    activity: str
    provider: str
    assigned_worker: Optional[str]
    assigned_role: Optional[str]
    workspace_id: Optional[str]
    workspace_name: Optional[str]
    branch_name: Optional[str]
    worktree_path: Optional[str]
    container_name: Optional[str]
    container_runtime: Optional[str]
    runtime_handle: Dict[str, Any]
    attach_info: Dict[str, Any]
    pr_url: Optional[str]
    ci_status: Optional[str]
    review_status: Optional[str]
    mergeability: Optional[str]
    last_event_type: Optional[str]
    last_event_ts: Optional[str]
    restored_at: Optional[str]
    metadata: Dict[str, Any]
    created_at: str
    updated_at: str


@dataclass
class PlanRevisionRecord:
    plan_revision_id: str
    topic_scope_id: str
    session_id: str
    author_id: Optional[str]
    summary: str
    objective: str
    assumptions: List[str]
    unknowns: List[str]
    execution_steps: List[Dict[str, Any]]
    candidate_parallel_seams: List[Dict[str, Any]]
    approval_points: List[str]
    status: str
    source: Dict[str, Any]
    created_at: str
    updated_at: str


@dataclass
class ProviderCredentialRecord:
    user_id: str
    provider: str
    auth_mode: str
    label: Optional[str]
    secret: Dict[str, Any]
    metadata: Dict[str, Any]
    status: str
    created_at: str
    updated_at: str


@dataclass
class ProviderOAuthStateRecord:
    state: str
    user_id: str
    provider: str
    redirect_uri: Optional[str]
    scopes: List[str]
    metadata: Dict[str, Any]
    code_verifier: Optional[str]
    created_at: str
    expires_at: str
    consumed_at: Optional[str]


@dataclass
class IntegrationCredentialRecord:
    user_id: str
    integration: str
    auth_mode: str
    label: Optional[str]
    secret: Dict[str, Any]
    metadata: Dict[str, Any]
    status: str
    created_at: str
    updated_at: str


@dataclass
class IntegrationPolicyRecord:
    user_id: str
    policy: Dict[str, Any]
    created_at: str
    updated_at: str


@dataclass
class SupervisorSessionRecord:
    session_id: str
    topic_scope_id: str
    status: str
    metadata: Dict[str, Any]
    created_at: str
    updated_at: str


@dataclass
class SupervisorEventRecord:
    id: int
    topic_scope_id: str
    session_id: str
    ts: str
    kind: str
    role: str
    author_id: Optional[str]
    author_name: Optional[str]
    content_md: str
    payload: Dict[str, Any]
    client_msg_id: Optional[str]


class TaskStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._lifecycle_policy: Optional[Any] = None
        self._init_db()

    @staticmethod
    def now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=30000;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def set_lifecycle_policy(self, policy: Optional[Any]) -> None:
        self._lifecycle_policy = policy

    def _policy_allows_transition(self, current_status: str, next_status: str) -> bool:
        policy = self._lifecycle_policy
        if policy is None:
            return True
        can_transition = getattr(policy, "can_transition", None)
        if not callable(can_transition):
            return True
        return bool(can_transition(current_status, next_status))

    def _policy_is_strict(self) -> bool:
        policy = self._lifecycle_policy
        if policy is None:
            return False
        strict = getattr(policy, "strict_transitions", False)
        return bool(strict)

    def _enforce_transition(
        self,
        *,
        conn: sqlite3.Connection,
        task_id: str,
        next_status: str,
    ) -> Optional[str]:
        row = conn.execute("SELECT status FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if row is None:
            return None
        current_status = str(row["status"] or "").strip().lower()
        target_status = str(next_status or "").strip().lower()
        if not target_status:
            raise ValueError("next_status cannot be empty")
        if current_status == target_status:
            return current_status
        if self._policy_allows_transition(current_status, target_status):
            return current_status
        detail = f"lifecycle transition blocked by policy: {current_status} -> {target_status}"
        if self._policy_is_strict():
            raise ValueError(detail)
        return current_status

    @staticmethod
    def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
        existing = conn.execute(f"PRAGMA table_info({table})").fetchall()
        names = {str(row["name"]) for row in existing}
        if column not in names:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    @staticmethod
    def _rebuild_supervisor_sessions_table_if_needed(conn: sqlite3.Connection) -> None:
        indexes = conn.execute("PRAGMA index_list(supervisor_sessions)").fetchall()
        scope_is_unique = False
        for index in indexes:
            if not int(index["unique"] or 0):
                continue
            columns = conn.execute(
                f"PRAGMA index_info({str(index['name'])})"
            ).fetchall()
            column_names = [str(row["name"] or "") for row in columns]
            if column_names == ["topic_scope_id"]:
                scope_is_unique = True
                break
        if not scope_is_unique:
            return

        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("ALTER TABLE supervisor_sessions RENAME TO supervisor_sessions_legacy")
        conn.executescript(
            """
            CREATE TABLE supervisor_sessions (
                session_id TEXT PRIMARY KEY,
                topic_scope_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_supervisor_sessions_scope
                ON supervisor_sessions(topic_scope_id);
            CREATE INDEX IF NOT EXISTS idx_supervisor_sessions_scope_updated
                ON supervisor_sessions(topic_scope_id, updated_at DESC);
            """
        )
        conn.execute(
            """
            INSERT INTO supervisor_sessions (
                session_id, topic_scope_id, status, metadata_json, created_at, updated_at
            )
            SELECT session_id, topic_scope_id, status, metadata_json, created_at, updated_at
            FROM supervisor_sessions_legacy
            """
        )
        conn.execute("DROP TABLE supervisor_sessions_legacy")
        conn.execute("PRAGMA foreign_keys=ON")

    @staticmethod
    def _ensure_supervisor_event_dedupe_index(conn: sqlite3.Connection) -> None:
        indexes = conn.execute("PRAGMA index_list(supervisor_events)").fetchall()
        topic_client_unique = False
        topic_session_client_unique = False
        for index in indexes:
            name = str(index["name"] or "")
            if not int(index["unique"] or 0):
                continue
            columns = conn.execute(f"PRAGMA index_info({name})").fetchall()
            column_names = [str(row["name"] or "") for row in columns]
            if column_names == ["topic_scope_id", "client_msg_id"]:
                topic_client_unique = True
            if column_names == ["topic_scope_id", "session_id", "client_msg_id"]:
                topic_session_client_unique = True
        if topic_client_unique:
            conn.execute("DROP INDEX IF EXISTS idx_supervisor_events_scope_client_msg")
        if not topic_session_client_unique:
            conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisor_events_scope_session_client_msg
                    ON supervisor_events(topic_scope_id, session_id, client_msg_id)
                """
            )

    @staticmethod
    def _rebuild_supervisor_events_table_if_needed(conn: sqlite3.Connection) -> None:
        foreign_keys = conn.execute("PRAGMA foreign_key_list(supervisor_events)").fetchall()
        if foreign_keys:
            target_table = str(foreign_keys[0]["table"] or "")
            target_column = str(foreign_keys[0]["to"] or "")
            source_column = str(foreign_keys[0]["from"] or "")
            if (
                len(foreign_keys) == 1
                and target_table == "supervisor_sessions"
                and source_column == "session_id"
                and target_column == "session_id"
            ):
                return

        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("ALTER TABLE supervisor_events RENAME TO supervisor_events_legacy")
        conn.executescript(
            """
            CREATE TABLE supervisor_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_scope_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                ts TEXT NOT NULL,
                kind TEXT NOT NULL,
                role TEXT NOT NULL,
                author_id TEXT,
                author_name TEXT,
                content_md TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{}',
                client_msg_id TEXT,
                FOREIGN KEY(session_id) REFERENCES supervisor_sessions(session_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_supervisor_events_scope_id
                ON supervisor_events(topic_scope_id, id);
            CREATE INDEX IF NOT EXISTS idx_supervisor_events_scope_ts
                ON supervisor_events(topic_scope_id, ts);
            """
        )
        conn.execute(
            """
            INSERT INTO supervisor_events (
                id,
                topic_scope_id,
                session_id,
                ts,
                kind,
                role,
                author_id,
                author_name,
                content_md,
                payload_json,
                client_msg_id
            )
            SELECT
                id,
                topic_scope_id,
                session_id,
                ts,
                kind,
                role,
                author_id,
                author_name,
                content_md,
                payload_json,
                client_msg_id
            FROM supervisor_events_legacy
            """
        )
        conn.execute("DROP TABLE supervisor_events_legacy")
        conn.execute("PRAGMA foreign_keys=ON")

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS workspace_mappings (
                    user_id TEXT NOT NULL,
                    repo_id TEXT NOT NULL,
                    repo_url TEXT,
                    workspace_name TEXT NOT NULL,
                    workspace_owner TEXT NOT NULL,
                    workspace_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, repo_id)
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_mappings_workspace_id
                    ON workspace_mappings(workspace_id);

                CREATE TABLE IF NOT EXISTS topic_repo_bindings (
                    topic_scope_id TEXT PRIMARY KEY,
                    repo_id TEXT NOT NULL,
                    repo_url TEXT,
                    source TEXT NOT NULL,
                    confidence TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_topic_repo_bindings_repo_id
                    ON topic_repo_bindings(repo_id);

                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    repo_id TEXT NOT NULL,
                    repo_url TEXT,
                    provider TEXT NOT NULL,
                    instruction TEXT NOT NULL,
                    zulip_thread_ref TEXT NOT NULL,
                    options_json TEXT NOT NULL,
                    topic_scope_id TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    workspace_id TEXT,
                    workspace_name TEXT,
                    branch_name TEXT,
                    worktree_path TEXT,
                    container_name TEXT,
                    container_runtime TEXT,
                    preview_port INTEGER,
                    preview_url TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    worker_id TEXT,
                    assigned_worker TEXT,
                    assigned_role TEXT,
                    assigned_by TEXT,
                    directive_id TEXT,
                    plan_revision_id TEXT,
                    result_text TEXT,
                    error_text TEXT,
                    blocked_reason TEXT,
                    clarification_questions_json TEXT,
                    clarification_requested INTEGER NOT NULL DEFAULT 0,
                    approved INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_tasks_status_created
                    ON tasks(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status
                    ON tasks(workspace_id, status);

                CREATE TABLE IF NOT EXISTS task_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    ts TEXT NOT NULL,
                    level TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    data TEXT,
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_task_events_task_id_id
                    ON task_events(task_id, id);

                CREATE TABLE IF NOT EXISTS worker_sessions (
                    worker_session_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL UNIQUE,
                    topic_scope_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    activity TEXT NOT NULL DEFAULT 'ready',
                    provider TEXT NOT NULL,
                    assigned_worker TEXT,
                    assigned_role TEXT,
                    workspace_id TEXT,
                    workspace_name TEXT,
                    branch_name TEXT,
                    worktree_path TEXT,
                    container_name TEXT,
                    container_runtime TEXT,
                    runtime_handle_json TEXT NOT NULL DEFAULT '{}',
                    attach_info_json TEXT NOT NULL DEFAULT '{}',
                    pr_url TEXT,
                    ci_status TEXT,
                    review_status TEXT,
                    mergeability TEXT,
                    last_event_type TEXT,
                    last_event_ts TEXT,
                    restored_at TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_worker_sessions_topic_updated
                    ON worker_sessions(topic_scope_id, updated_at);
                CREATE INDEX IF NOT EXISTS idx_worker_sessions_status_updated
                    ON worker_sessions(status, updated_at);

                CREATE TABLE IF NOT EXISTS plan_revisions (
                    plan_revision_id TEXT PRIMARY KEY,
                    topic_scope_id TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    author_id TEXT,
                    summary TEXT NOT NULL DEFAULT '',
                    objective TEXT NOT NULL DEFAULT '',
                    assumptions_json TEXT NOT NULL DEFAULT '[]',
                    unknowns_json TEXT NOT NULL DEFAULT '[]',
                    execution_steps_json TEXT NOT NULL DEFAULT '[]',
                    candidate_parallel_seams_json TEXT NOT NULL DEFAULT '[]',
                    approval_points_json TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'active',
                    source_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_plan_revisions_topic_created
                    ON plan_revisions(topic_scope_id, created_at);

                CREATE TABLE IF NOT EXISTS provider_credentials (
                    user_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    auth_mode TEXT NOT NULL DEFAULT 'api_key',
                    label TEXT,
                    secret_json TEXT NOT NULL DEFAULT '{}',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, provider)
                );
                CREATE INDEX IF NOT EXISTS idx_provider_credentials_user_status
                    ON provider_credentials(user_id, status, updated_at);

                CREATE TABLE IF NOT EXISTS provider_oauth_states (
                    state TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    redirect_uri TEXT,
                    scopes_json TEXT NOT NULL DEFAULT '[]',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    code_verifier TEXT,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consumed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_user_provider
                    ON provider_oauth_states(user_id, provider, created_at);

                CREATE TABLE IF NOT EXISTS integration_credentials (
                    user_id TEXT NOT NULL,
                    integration TEXT NOT NULL,
                    auth_mode TEXT NOT NULL DEFAULT 'api_key',
                    label TEXT,
                    secret_json TEXT NOT NULL DEFAULT '{}',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, integration)
                );
                CREATE INDEX IF NOT EXISTS idx_integration_credentials_user_status
                    ON integration_credentials(user_id, status, updated_at);

                CREATE TABLE IF NOT EXISTS integration_policies (
                    user_id TEXT PRIMARY KEY,
                    policy_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS supervisor_sessions (
                    session_id TEXT PRIMARY KEY,
                    topic_scope_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'idle',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_supervisor_sessions_scope
                    ON supervisor_sessions(topic_scope_id);
                CREATE INDEX IF NOT EXISTS idx_supervisor_sessions_scope_updated
                    ON supervisor_sessions(topic_scope_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS supervisor_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_scope_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    ts TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    role TEXT NOT NULL,
                    author_id TEXT,
                    author_name TEXT,
                    content_md TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    client_msg_id TEXT,
                    FOREIGN KEY(session_id) REFERENCES supervisor_sessions(session_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_supervisor_events_scope_id
                    ON supervisor_events(topic_scope_id, id);
                CREATE INDEX IF NOT EXISTS idx_supervisor_events_scope_ts
                    ON supervisor_events(topic_scope_id, ts);
                """
            )
            self._rebuild_supervisor_sessions_table_if_needed(conn)
            self._rebuild_supervisor_events_table_if_needed(conn)
            self._ensure_supervisor_event_dedupe_index(conn)
            self._ensure_column(conn, "plan_revisions", "session_id", "TEXT NOT NULL DEFAULT ''")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_plan_revisions_topic_session_created
                    ON plan_revisions(topic_scope_id, session_id, created_at)
                """
            )
            self._ensure_column(conn, "tasks", "topic_scope_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "tasks", "container_name", "TEXT")
            self._ensure_column(conn, "tasks", "container_runtime", "TEXT")
            self._ensure_column(conn, "tasks", "assigned_worker", "TEXT")
            self._ensure_column(conn, "tasks", "assigned_role", "TEXT")
            self._ensure_column(conn, "tasks", "assigned_by", "TEXT")
            self._ensure_column(conn, "tasks", "directive_id", "TEXT")
            self._ensure_column(conn, "tasks", "plan_revision_id", "TEXT")
            self._ensure_column(conn, "tasks", "blocked_reason", "TEXT")
            self._ensure_column(conn, "tasks", "clarification_questions_json", "TEXT")
            self._ensure_column(
                conn, "tasks", "clarification_requested", "INTEGER NOT NULL DEFAULT 0"
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tasks_topic_scope_created
                    ON tasks(topic_scope_id, created_at)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tasks_plan_revision
                    ON tasks(plan_revision_id, created_at)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tasks_directive
                    ON tasks(directive_id, created_at)
                """
            )
            self._ensure_column(
                conn,
                "worker_sessions",
                "runtime_handle_json",
                "TEXT NOT NULL DEFAULT '{}'",
            )
            self._ensure_column(
                conn,
                "worker_sessions",
                "attach_info_json",
                "TEXT NOT NULL DEFAULT '{}'",
            )
            self._ensure_column(
                conn,
                "worker_sessions",
                "metadata_json",
                "TEXT NOT NULL DEFAULT '{}'",
            )
            self._ensure_column(conn, "worker_sessions", "restored_at", "TEXT")
            self._backfill_topic_scope_ids(conn)

    def _backfill_topic_scope_ids(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute(
            """
            SELECT task_id, user_id, repo_id, zulip_thread_ref, topic_scope_id
            FROM tasks
            WHERE topic_scope_id IS NULL OR topic_scope_id = ''
            """
        ).fetchall()
        if not rows:
            return
        ts = self.now_iso()
        for row in rows:
            task_id = str(row["task_id"])
            user_id = _normalize_text(row["user_id"])
            repo_id = _normalize_text(row["repo_id"])
            thread_raw = row["zulip_thread_ref"]
            try:
                thread_ref = json.loads(thread_raw or "{}")
            except Exception:
                thread_ref = {}
            topic_scope_id = derive_topic_scope_id(
                zulip_thread_ref=thread_ref if isinstance(thread_ref, dict) else {},
                repo_id=repo_id,
                user_id=user_id,
            )
            conn.execute(
                "UPDATE tasks SET topic_scope_id=?, updated_at=? WHERE task_id=?",
                (topic_scope_id, ts, task_id),
            )

    @staticmethod
    def _row_to_workspace(row: sqlite3.Row) -> WorkspaceMapping:
        return WorkspaceMapping(
            user_id=str(row["user_id"]),
            repo_id=str(row["repo_id"]),
            repo_url=row["repo_url"],
            workspace_name=str(row["workspace_name"]),
            workspace_owner=str(row["workspace_owner"]),
            workspace_id=row["workspace_id"],
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_topic_repo_binding(row: sqlite3.Row) -> TopicRepoBinding:
        return TopicRepoBinding(
            topic_scope_id=normalize_topic_scope_id(row["topic_scope_id"] or ""),
            repo_id=str(row["repo_id"]),
            repo_url=row["repo_url"],
            source=str(row["source"] or ""),
            confidence=str(row["confidence"] or ""),
            metadata=_parse_json_object(row["metadata_json"] or "{}"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> TaskRecord:
        preview_port_value = row["preview_port"]
        preview_port: Optional[int]
        if preview_port_value is None:
            preview_port = None
        else:
            preview_port = int(preview_port_value)
        zulip_thread_ref = _parse_json_object(row["zulip_thread_ref"])
        options = _parse_json_object(row["options_json"])
        clarification_questions = _parse_json_string_list(
            row["clarification_questions_json"] or "[]"
        )
        topic_scope_id = normalize_topic_scope_id(row["topic_scope_id"] or "")
        if not topic_scope_id:
            topic_scope_id = derive_topic_scope_id(
                zulip_thread_ref=zulip_thread_ref,
                repo_id=str(row["repo_id"]),
                user_id=str(row["user_id"]),
            )
        return TaskRecord(
            task_id=str(row["task_id"]),
            user_id=str(row["user_id"]),
            repo_id=str(row["repo_id"]),
            repo_url=row["repo_url"],
            provider=str(row["provider"]),
            instruction=str(row["instruction"]),
            zulip_thread_ref=zulip_thread_ref,
            options=options,
            topic_scope_id=topic_scope_id,
            status=str(row["status"]),
            cancel_requested=bool(row["cancel_requested"]),
            workspace_id=row["workspace_id"],
            workspace_name=row["workspace_name"],
            branch_name=row["branch_name"],
            worktree_path=row["worktree_path"],
            container_name=row["container_name"],
            container_runtime=row["container_runtime"],
            preview_port=preview_port,
            preview_url=row["preview_url"],
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            worker_id=row["worker_id"],
            assigned_worker=row["assigned_worker"],
            assigned_role=row["assigned_role"],
            assigned_by=row["assigned_by"],
            directive_id=row["directive_id"],
            plan_revision_id=row["plan_revision_id"],
            result_text=row["result_text"],
            error_text=row["error_text"],
            blocked_reason=row["blocked_reason"],
            clarification_questions=clarification_questions,
            clarification_requested=bool(row["clarification_requested"]),
            approved=bool(row["approved"]),
        )

    @staticmethod
    def _row_to_worker_session(row: sqlite3.Row) -> WorkerSessionRecord:
        return WorkerSessionRecord(
            worker_session_id=str(row["worker_session_id"]),
            task_id=str(row["task_id"]),
            topic_scope_id=normalize_topic_scope_id(row["topic_scope_id"] or ""),
            status=str(row["status"] or "queued"),
            activity=str(row["activity"] or "ready"),
            provider=normalize_provider_id(row["provider"] or ""),
            assigned_worker=row["assigned_worker"],
            assigned_role=row["assigned_role"],
            workspace_id=row["workspace_id"],
            workspace_name=row["workspace_name"],
            branch_name=row["branch_name"],
            worktree_path=row["worktree_path"],
            container_name=row["container_name"],
            container_runtime=row["container_runtime"],
            runtime_handle=_parse_json_object(row["runtime_handle_json"] or "{}"),
            attach_info=_parse_json_object(row["attach_info_json"] or "{}"),
            pr_url=row["pr_url"],
            ci_status=row["ci_status"],
            review_status=row["review_status"],
            mergeability=row["mergeability"],
            last_event_type=row["last_event_type"],
            last_event_ts=row["last_event_ts"],
            restored_at=row["restored_at"],
            metadata=_parse_json_object(row["metadata_json"] or "{}"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_plan_revision(row: sqlite3.Row) -> PlanRevisionRecord:
        assumptions = _parse_json_string_list(row["assumptions_json"] or "[]")
        unknowns = _parse_json_string_list(row["unknowns_json"] or "[]")
        approval_points = _parse_json_string_list(row["approval_points_json"] or "[]")
        execution_steps_raw = row["execution_steps_json"] or "[]"
        parallel_seams_raw = row["candidate_parallel_seams_json"] or "[]"
        source_raw = row["source_json"] or "{}"

        try:
            execution_steps = json.loads(execution_steps_raw)
        except Exception:
            execution_steps = []
        if not isinstance(execution_steps, list):
            execution_steps = []
        execution_steps = [item for item in execution_steps if isinstance(item, dict)]

        try:
            parallel_seams = json.loads(parallel_seams_raw)
        except Exception:
            parallel_seams = []
        if not isinstance(parallel_seams, list):
            parallel_seams = []
        parallel_seams = [item for item in parallel_seams if isinstance(item, dict)]

        source = _parse_json_object(source_raw)

        return PlanRevisionRecord(
            plan_revision_id=str(row["plan_revision_id"]),
            topic_scope_id=normalize_topic_scope_id(row["topic_scope_id"] or ""),
            session_id=str(row["session_id"] or "").strip(),
            author_id=row["author_id"],
            summary=str(row["summary"] or ""),
            objective=str(row["objective"] or ""),
            assumptions=assumptions,
            unknowns=unknowns,
            execution_steps=execution_steps,
            candidate_parallel_seams=parallel_seams,
            approval_points=approval_points,
            status=str(row["status"] or "active"),
            source=source,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_provider_credential(row: sqlite3.Row) -> ProviderCredentialRecord:
        secret = _parse_json_object(row["secret_json"] or "{}")
        metadata = _parse_json_object(row["metadata_json"] or "{}")
        return ProviderCredentialRecord(
            user_id=str(row["user_id"]),
            provider=normalize_provider_id(row["provider"] or ""),
            auth_mode=str(row["auth_mode"] or "api_key"),
            label=row["label"],
            secret=secret,
            metadata=metadata,
            status=str(row["status"] or "active"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_provider_oauth_state(row: sqlite3.Row) -> ProviderOAuthStateRecord:
        return ProviderOAuthStateRecord(
            state=str(row["state"]),
            user_id=str(row["user_id"]),
            provider=normalize_provider_id(row["provider"] or ""),
            redirect_uri=row["redirect_uri"],
            scopes=_parse_json_string_list(row["scopes_json"] or "[]"),
            metadata=_parse_json_object(row["metadata_json"] or "{}"),
            code_verifier=row["code_verifier"],
            created_at=str(row["created_at"]),
            expires_at=str(row["expires_at"]),
            consumed_at=row["consumed_at"],
        )

    @staticmethod
    def _row_to_integration_credential(row: sqlite3.Row) -> IntegrationCredentialRecord:
        secret = _parse_json_object(row["secret_json"] or "{}")
        metadata = _parse_json_object(row["metadata_json"] or "{}")
        return IntegrationCredentialRecord(
            user_id=str(row["user_id"]),
            integration=normalize_integration_id(row["integration"] or ""),
            auth_mode=str(row["auth_mode"] or "api_key"),
            label=row["label"],
            secret=secret,
            metadata=metadata,
            status=str(row["status"] or "active"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_integration_policy(row: sqlite3.Row) -> IntegrationPolicyRecord:
        return IntegrationPolicyRecord(
            user_id=str(row["user_id"]),
            policy=_parse_json_object(row["policy_json"] or "{}"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_supervisor_session(row: sqlite3.Row) -> SupervisorSessionRecord:
        return SupervisorSessionRecord(
            session_id=str(row["session_id"]),
            topic_scope_id=normalize_topic_scope_id(row["topic_scope_id"] or ""),
            status=str(row["status"] or "idle"),
            metadata=_parse_json_object(row["metadata_json"] or "{}"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _row_to_supervisor_event(row: sqlite3.Row) -> SupervisorEventRecord:
        return SupervisorEventRecord(
            id=int(row["id"]),
            topic_scope_id=normalize_topic_scope_id(row["topic_scope_id"] or ""),
            session_id=str(row["session_id"]),
            ts=str(row["ts"]),
            kind=str(row["kind"] or "message"),
            role=str(row["role"] or "assistant"),
            author_id=row["author_id"],
            author_name=row["author_name"],
            content_md=str(row["content_md"] or ""),
            payload=_parse_json_object(row["payload_json"] or "{}"),
            client_msg_id=row["client_msg_id"],
        )

    def upsert_workspace_mapping(
        self,
        *,
        user_id: str,
        repo_id: str,
        repo_url: Optional[str],
        workspace_name: str,
        workspace_owner: str,
        workspace_id: Optional[str] = None,
    ) -> WorkspaceMapping:
        ts = self.now_iso()
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT workspace_id FROM workspace_mappings WHERE user_id=? AND repo_id=?",
                (user_id, repo_id),
            ).fetchone()
            existing_id = None if existing is None else existing["workspace_id"]
            effective_workspace_id = workspace_id or existing_id
            conn.execute(
                """
                INSERT INTO workspace_mappings (
                    user_id, repo_id, repo_url, workspace_name, workspace_owner,
                    workspace_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, repo_id) DO UPDATE SET
                    repo_url=excluded.repo_url,
                    workspace_name=excluded.workspace_name,
                    workspace_owner=excluded.workspace_owner,
                    workspace_id=excluded.workspace_id,
                    updated_at=excluded.updated_at
                """,
                (
                    user_id,
                    repo_id,
                    repo_url,
                    workspace_name,
                    workspace_owner,
                    effective_workspace_id,
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM workspace_mappings WHERE user_id=? AND repo_id=?",
                (user_id, repo_id),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist workspace mapping")
        return self._row_to_workspace(row)

    def get_workspace_mapping(self, user_id: str, repo_id: str) -> Optional[WorkspaceMapping]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM workspace_mappings WHERE user_id=? AND repo_id=?",
                (user_id, repo_id),
            ).fetchone()
        return None if row is None else self._row_to_workspace(row)

    def set_workspace_identity(
        self,
        *,
        user_id: str,
        repo_id: str,
        workspace_id: str,
    ) -> Optional[WorkspaceMapping]:
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE workspace_mappings
                SET workspace_id=?, updated_at=?
                WHERE user_id=? AND repo_id=?
                """,
                (workspace_id, ts, user_id, repo_id),
            )
            row = conn.execute(
                "SELECT * FROM workspace_mappings WHERE user_id=? AND repo_id=?",
                (user_id, repo_id),
            ).fetchone()
        return None if row is None else self._row_to_workspace(row)

    def list_workspace_mappings(self, scope: Optional[str] = None) -> List[WorkspaceMapping]:
        normalized_scope = _normalize_text(scope).lower()
        if normalized_scope == "repo":
            sql = "SELECT * FROM workspace_mappings WHERE user_id=? ORDER BY updated_at DESC"
            args: tuple[Any, ...] = (REPO_SCOPE_MAPPING_USER_ID,)
        elif normalized_scope == "user_repo":
            sql = "SELECT * FROM workspace_mappings WHERE user_id!=? ORDER BY updated_at DESC"
            args = (REPO_SCOPE_MAPPING_USER_ID,)
        else:
            sql = "SELECT * FROM workspace_mappings ORDER BY updated_at DESC"
            args = ()

        with self._connect() as conn:
            rows = conn.execute(sql, args).fetchall()
        return [self._row_to_workspace(row) for row in rows]

    def upsert_topic_repo_binding(
        self,
        *,
        topic_scope_id: str,
        repo_id: str,
        repo_url: Optional[str],
        source: str,
        confidence: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> TopicRepoBinding:
        scope = normalize_topic_scope_id(topic_scope_id)
        rid = _normalize_text(repo_id)
        if not scope:
            raise ValueError("topic_scope_id cannot be empty")
        if not rid:
            raise ValueError("repo_id cannot be empty")
        ts = self.now_iso()
        payload = metadata if isinstance(metadata, dict) else {}
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO topic_repo_bindings (
                    topic_scope_id, repo_id, repo_url, source, confidence, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(topic_scope_id) DO UPDATE SET
                    repo_id=excluded.repo_id,
                    repo_url=excluded.repo_url,
                    source=excluded.source,
                    confidence=excluded.confidence,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    scope,
                    rid,
                    repo_url,
                    _normalize_text(source) or "explicit_input",
                    _normalize_text(confidence) or "high",
                    json.dumps(payload, ensure_ascii=True),
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM topic_repo_bindings WHERE topic_scope_id=?",
                (scope,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist topic repo binding")
        return self._row_to_topic_repo_binding(row)

    def get_topic_repo_binding(self, topic_scope_id: str) -> Optional[TopicRepoBinding]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM topic_repo_bindings WHERE topic_scope_id=?",
                (scope,),
            ).fetchone()
        return None if row is None else self._row_to_topic_repo_binding(row)

    def create_task(
        self,
        *,
        user_id: str,
        repo_id: str,
        repo_url: Optional[str],
        provider: str,
        instruction: str,
        zulip_thread_ref: Dict[str, Any],
        options: Dict[str, Any],
        topic_scope_id: Optional[str] = None,
        assigned_worker: Optional[str] = None,
        assigned_role: Optional[str] = None,
        assigned_by: Optional[str] = None,
        directive_id: Optional[str] = None,
        plan_revision_id: Optional[str] = None,
    ) -> TaskRecord:
        clean_instruction = (instruction or "").strip()
        if not clean_instruction:
            raise ValueError("instruction cannot be empty")
        clean_options = options if isinstance(options, dict) else {}
        effective_topic_scope_id = normalize_topic_scope_id(topic_scope_id or "")
        if not effective_topic_scope_id:
            effective_topic_scope_id = derive_topic_scope_id(
                zulip_thread_ref=zulip_thread_ref if isinstance(zulip_thread_ref, dict) else {},
                repo_id=repo_id,
                user_id=user_id,
            )

        task_id = f"task_{uuid.uuid4().hex[:12]}"
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (
                    task_id, user_id, repo_id, repo_url, provider, instruction,
                    zulip_thread_ref, options_json, topic_scope_id, status,
                    assigned_worker, assigned_role, assigned_by, directive_id, plan_revision_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    user_id,
                    repo_id,
                    repo_url,
                    provider,
                    clean_instruction,
                    json.dumps(zulip_thread_ref or {}, ensure_ascii=True),
                    json.dumps(clean_options, ensure_ascii=True),
                    effective_topic_scope_id,
                    (assigned_worker or "").strip() or None,
                    (assigned_role or "").strip() or None,
                    (assigned_by or "").strip() or None,
                    (directive_id or "").strip() or None,
                    (plan_revision_id or "").strip() or None,
                    ts,
                    ts,
                ),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if row is None:
            raise RuntimeError("failed to persist task")

        self.append_event(
            task_id,
            level="info",
            event_type="task_created",
            message=f"Task queued for provider '{provider}'",
            data={
                "repo_id": repo_id,
                "user_id": user_id,
                "topic_scope_id": effective_topic_scope_id,
                "task_title": derive_task_title(clean_instruction, clean_options),
                "assigned_worker": (assigned_worker or "").strip() or None,
                "assigned_role": (assigned_role or "").strip() or None,
                "assigned_by": (assigned_by or "").strip() or None,
                "directive_id": (directive_id or "").strip() or None,
                "plan_revision_id": (plan_revision_id or "").strip() or None,
            },
        )
        created = self._row_to_task(row)
        self.upsert_worker_session_from_task(
            created,
            session_status="queued",
            activity="ready",
            last_event_type="task_created",
            last_event_ts=ts,
            runtime_handle={},
            attach_info={},
            metadata_patch={"created_from": "task.create"},
        )
        return created

    @staticmethod
    def _derive_worker_session_state(task: TaskRecord) -> Tuple[str, str]:
        status = str(task.status or "").strip().lower()
        if status == "queued":
            return "queued", "ready"
        if status == "running":
            return "running", "active"
        if status == "blocked_information":
            return "waiting_input", "waiting_input"
        if status in {"blocked_dependency", "blocked_approval", "stalled", "at_risk"}:
            return "blocked", "blocked"
        if status == "paused":
            return "paused", "blocked"
        if status == "done":
            return "completed", "exited"
        if status == "failed":
            return "failed", "exited"
        if status == "canceled":
            return "canceled", "exited"
        return "queued", "ready"

    def get_worker_session_by_task_id(self, task_id: str) -> Optional[WorkerSessionRecord]:
        tid = _normalize_text(task_id)
        if not tid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM worker_sessions WHERE task_id=?",
                (tid,),
            ).fetchone()
        return None if row is None else self._row_to_worker_session(row)

    def get_worker_session(self, worker_session_id: str) -> Optional[WorkerSessionRecord]:
        sid = _normalize_text(worker_session_id)
        if not sid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM worker_sessions WHERE worker_session_id=?",
                (sid,),
            ).fetchone()
        return None if row is None else self._row_to_worker_session(row)

    def list_worker_sessions_for_topic(
        self,
        topic_scope_id: str,
        *,
        limit: int = 200,
    ) -> List[WorkerSessionRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return []
        bounded = max(1, min(int(limit), 2000))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM worker_sessions
                WHERE topic_scope_id=?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (scope, bounded),
            ).fetchall()
        return [self._row_to_worker_session(row) for row in rows]

    def list_worker_sessions(
        self,
        *,
        statuses: Optional[List[str]] = None,
        limit: int = 500,
    ) -> List[WorkerSessionRecord]:
        wanted = [str(item).strip().lower() for item in (statuses or []) if str(item).strip()]
        wanted = [item for item in wanted if item in WORKER_SESSION_STATUSES]
        bounded = max(1, min(int(limit), 2000))
        with self._connect() as conn:
            if not wanted:
                rows = conn.execute(
                    """
                    SELECT *
                    FROM worker_sessions
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (bounded,),
                ).fetchall()
            else:
                placeholders = ",".join("?" for _ in wanted)
                args: List[Any] = [*wanted, bounded]
                rows = conn.execute(
                    f"""
                    SELECT *
                    FROM worker_sessions
                    WHERE status IN ({placeholders})
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    tuple(args),
                ).fetchall()
        return [self._row_to_worker_session(row) for row in rows]

    def upsert_worker_session_from_task(
        self,
        task: TaskRecord,
        *,
        session_status: Optional[str] = None,
        activity: Optional[str] = None,
        last_event_type: Optional[str] = None,
        last_event_ts: Optional[str] = None,
        runtime_handle: Optional[Dict[str, Any]] = None,
        attach_info: Optional[Dict[str, Any]] = None,
        pr_url: Optional[str] = None,
        ci_status: Optional[str] = None,
        review_status: Optional[str] = None,
        mergeability: Optional[str] = None,
        restored_at: Optional[str] = None,
        metadata_patch: Optional[Dict[str, Any]] = None,
    ) -> WorkerSessionRecord:
        task_session_status, task_activity = self._derive_worker_session_state(task)
        effective_status = str(session_status or task_session_status).strip().lower()
        if effective_status not in WORKER_SESSION_STATUSES:
            effective_status = task_session_status
        effective_activity = str(activity or task_activity).strip().lower()
        if effective_activity not in WORKER_SESSION_ACTIVITIES:
            effective_activity = task_activity

        worker_session_id = f"ws_{task.task_id}"
        ts = self.now_iso()
        existing = self.get_worker_session_by_task_id(task.task_id)
        existing_metadata = existing.metadata if existing is not None else {}
        merged_metadata = dict(existing_metadata)
        if isinstance(metadata_patch, dict):
            merged_metadata.update(metadata_patch)

        runtime_obj = (
            runtime_handle
            if isinstance(runtime_handle, dict)
            else (existing.runtime_handle if existing is not None else {})
        )
        attach_obj = (
            attach_info
            if isinstance(attach_info, dict)
            else (existing.attach_info if existing is not None else {})
        )

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO worker_sessions (
                    worker_session_id, task_id, topic_scope_id, status, activity, provider,
                    assigned_worker, assigned_role, workspace_id, workspace_name,
                    branch_name, worktree_path, container_name, container_runtime,
                    runtime_handle_json, attach_info_json, pr_url, ci_status, review_status,
                    mergeability, last_event_type, last_event_ts, restored_at, metadata_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    worker_session_id=excluded.worker_session_id,
                    topic_scope_id=excluded.topic_scope_id,
                    status=excluded.status,
                    activity=excluded.activity,
                    provider=excluded.provider,
                    assigned_worker=excluded.assigned_worker,
                    assigned_role=excluded.assigned_role,
                    workspace_id=excluded.workspace_id,
                    workspace_name=excluded.workspace_name,
                    branch_name=excluded.branch_name,
                    worktree_path=excluded.worktree_path,
                    container_name=excluded.container_name,
                    container_runtime=excluded.container_runtime,
                    runtime_handle_json=excluded.runtime_handle_json,
                    attach_info_json=excluded.attach_info_json,
                    pr_url=excluded.pr_url,
                    ci_status=excluded.ci_status,
                    review_status=excluded.review_status,
                    mergeability=excluded.mergeability,
                    last_event_type=excluded.last_event_type,
                    last_event_ts=excluded.last_event_ts,
                    restored_at=excluded.restored_at,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    worker_session_id,
                    task.task_id,
                    normalize_topic_scope_id(task.topic_scope_id),
                    effective_status,
                    effective_activity,
                    normalize_provider_id(task.provider),
                    (task.assigned_worker or "").strip() or None,
                    (task.assigned_role or "").strip() or None,
                    task.workspace_id,
                    task.workspace_name,
                    task.branch_name,
                    task.worktree_path,
                    task.container_name,
                    task.container_runtime,
                    json.dumps(runtime_obj, ensure_ascii=True),
                    json.dumps(attach_obj, ensure_ascii=True),
                    (pr_url if pr_url is not None else (existing.pr_url if existing else None)),
                    (
                        ci_status
                        if ci_status is not None
                        else (existing.ci_status if existing is not None else None)
                    ),
                    (
                        review_status
                        if review_status is not None
                        else (existing.review_status if existing is not None else None)
                    ),
                    (
                        mergeability
                        if mergeability is not None
                        else (existing.mergeability if existing is not None else None)
                    ),
                    (
                        last_event_type
                        if last_event_type is not None
                        else (existing.last_event_type if existing is not None else None)
                    ),
                    (
                        last_event_ts
                        if last_event_ts is not None
                        else (existing.last_event_ts if existing is not None else None)
                    ),
                    restored_at if restored_at is not None else (existing.restored_at if existing else None),
                    json.dumps(merged_metadata, ensure_ascii=True),
                    (existing.created_at if existing is not None else ts),
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM worker_sessions WHERE task_id=?",
                (task.task_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist worker session")
        return self._row_to_worker_session(row)

    def update_worker_session(
        self,
        *,
        worker_session_id: str,
        status: Optional[str] = None,
        activity: Optional[str] = None,
        pr_url: Optional[str] = None,
        ci_status: Optional[str] = None,
        review_status: Optional[str] = None,
        mergeability: Optional[str] = None,
        last_event_type: Optional[str] = None,
        last_event_ts: Optional[str] = None,
        restored_at: Optional[str] = None,
        runtime_handle: Optional[Dict[str, Any]] = None,
        attach_info: Optional[Dict[str, Any]] = None,
        metadata_patch: Optional[Dict[str, Any]] = None,
    ) -> Optional[WorkerSessionRecord]:
        current = self.get_worker_session(worker_session_id)
        if current is None:
            return None
        ts = self.now_iso()

        next_status = str(status or current.status).strip().lower()
        if next_status not in WORKER_SESSION_STATUSES:
            next_status = current.status
        next_activity = str(activity or current.activity).strip().lower()
        if next_activity not in WORKER_SESSION_ACTIVITIES:
            next_activity = current.activity

        next_runtime = dict(current.runtime_handle)
        if isinstance(runtime_handle, dict):
            next_runtime = dict(runtime_handle)
        next_attach = dict(current.attach_info)
        if isinstance(attach_info, dict):
            next_attach = dict(attach_info)
        next_meta = dict(current.metadata)
        if isinstance(metadata_patch, dict):
            next_meta.update(metadata_patch)

        with self._connect() as conn:
            conn.execute(
                """
                UPDATE worker_sessions
                SET
                    status=?,
                    activity=?,
                    pr_url=?,
                    ci_status=?,
                    review_status=?,
                    mergeability=?,
                    last_event_type=?,
                    last_event_ts=?,
                    restored_at=?,
                    runtime_handle_json=?,
                    attach_info_json=?,
                    metadata_json=?,
                    updated_at=?
                WHERE worker_session_id=?
                """,
                (
                    next_status,
                    next_activity,
                    pr_url if pr_url is not None else current.pr_url,
                    ci_status if ci_status is not None else current.ci_status,
                    review_status if review_status is not None else current.review_status,
                    mergeability if mergeability is not None else current.mergeability,
                    last_event_type if last_event_type is not None else current.last_event_type,
                    last_event_ts if last_event_ts is not None else current.last_event_ts,
                    restored_at if restored_at is not None else current.restored_at,
                    json.dumps(next_runtime, ensure_ascii=True),
                    json.dumps(next_attach, ensure_ascii=True),
                    json.dumps(next_meta, ensure_ascii=True),
                    ts,
                    worker_session_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM worker_sessions WHERE worker_session_id=?",
                (worker_session_id,),
            ).fetchone()
        return None if row is None else self._row_to_worker_session(row)

    def update_task_instruction_and_options(
        self,
        *,
        task_id: str,
        instruction: str,
        options: Dict[str, Any],
    ) -> Optional[TaskRecord]:
        clean_instruction = (instruction or "").strip()
        if not clean_instruction:
            raise ValueError("instruction cannot be empty")
        clean_options = options if isinstance(options, dict) else {}
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET instruction=?, options_json=?, updated_at=?
                WHERE task_id=?
                """,
                (clean_instruction, json.dumps(clean_options, ensure_ascii=True), ts, task_id),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def clear_cancel_requested(
        self,
        *,
        task_id: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> Optional[TaskRecord]:
        ts = self.now_iso()
        with self._connect() as conn:
            if options is None:
                conn.execute(
                    "UPDATE tasks SET cancel_requested=0, updated_at=? WHERE task_id=?",
                    (ts, task_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE tasks
                    SET cancel_requested=0, options_json=?, updated_at=?
                    WHERE task_id=?
                    """,
                    (json.dumps(options, ensure_ascii=True), ts, task_id),
                )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def requeue_task(
        self,
        *,
        task_id: str,
        instruction: str,
        options: Dict[str, Any],
    ) -> Optional[TaskRecord]:
        clean_instruction = (instruction or "").strip()
        if not clean_instruction:
            raise ValueError("instruction cannot be empty")
        clean_options = options if isinstance(options, dict) else {}
        ts = self.now_iso()
        with self._connect() as conn:
            existing_status = self._enforce_transition(
                conn=conn,
                task_id=task_id,
                next_status="queued",
            )
            if existing_status is None:
                return None
            conn.execute(
                """
                UPDATE tasks
                SET
                    status='queued',
                    instruction=?,
                    options_json=?,
                    cancel_requested=0,
                    preview_port=NULL,
                    preview_url=NULL,
                    result_text=NULL,
                    error_text=NULL,
                    blocked_reason=NULL,
                    clarification_questions_json='[]',
                    clarification_requested=0,
                    worker_id=NULL,
                    started_at=NULL,
                    finished_at=NULL,
                    updated_at=?
                WHERE task_id=?
                """,
                (clean_instruction, json.dumps(clean_options, ensure_ascii=True), ts, task_id),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def get_task(self, task_id: str) -> Optional[TaskRecord]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def list_queued_tasks(self, limit: int = 100) -> List[TaskRecord]:
        bounded = max(1, min(int(limit), 1000))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM tasks
                WHERE status='queued'
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (bounded,),
            ).fetchall()
        return [self._row_to_task(row) for row in rows]

    @staticmethod
    def _task_claims(task: TaskRecord) -> Tuple[List[str], List[str]]:
        options = task.options if isinstance(task.options, dict) else {}
        raw_files = options.get("file_claims") or []
        raw_areas = options.get("area_claims") or []
        file_claims = [str(item).strip().lower() for item in raw_files if str(item).strip()]
        area_claims = [str(item).strip().lower() for item in raw_areas if str(item).strip()]
        return file_claims, area_claims

    @staticmethod
    def _task_claim_role(task: TaskRecord) -> str:
        options = task.options if isinstance(task.options, dict) else {}
        role = str(task.assigned_role or options.get("assigned_role") or "").strip().lower()
        aliases = {
            "read": "read_only",
            "readonly": "read_only",
            "explorer": "read_only",
            "review": "verify",
            "reviewer": "verify",
        }
        normalized = aliases.get(role, role)
        return normalized or "writer"

    @classmethod
    def _task_claim_mode(cls, task: TaskRecord) -> str:
        options = task.options if isinstance(task.options, dict) else {}
        explicit = str(options.get("claim_mode") or "").strip().lower()
        if explicit in {"shared", "readonly_shared", "nonexclusive"}:
            return "shared"
        if explicit in {"exclusive", "writer", "write"}:
            return "exclusive"
        role = cls._task_claim_role(task)
        if role in {"read_only", "verify"}:
            return "shared"
        return "exclusive"

    def dependencies_for_task(self, task: TaskRecord) -> List[str]:
        options = task.options if isinstance(task.options, dict) else {}
        raw = options.get("depends_on_task_ids") or []
        return [str(item).strip() for item in raw if str(item).strip()]

    def dependencies_satisfied(self, task: TaskRecord) -> Tuple[bool, List[str]]:
        pending: List[str] = []
        for dependency_task_id in self.dependencies_for_task(task):
            dependency = self.get_task(dependency_task_id)
            if dependency is None or dependency.status != "done":
                pending.append(dependency_task_id)
        return (len(pending) == 0, pending)

    def find_claim_conflicts(self, task: TaskRecord) -> Dict[str, Any]:
        candidate_files, candidate_areas = self._task_claims(task)
        if not candidate_files and not candidate_areas:
            return {"conflict": False, "file_conflicts": [], "area_conflicts": []}
        candidate_mode = self._task_claim_mode(task)

        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM tasks
                WHERE repo_id=?
                  AND task_id!=?
                  AND status IN ('running', 'paused', 'stalled', 'blocked_information', 'blocked_dependency', 'blocked_approval')
                """,
                (task.repo_id, task.task_id),
            ).fetchall()

        file_conflicts: List[Dict[str, Any]] = []
        area_conflicts: List[Dict[str, Any]] = []
        candidate_file_set = set(candidate_files)
        candidate_area_set = set(candidate_areas)

        for row in rows:
            running_task = self._row_to_task(row)
            running_mode = self._task_claim_mode(running_task)
            if candidate_mode == "shared" and running_mode == "shared":
                continue
            running_files, running_areas = self._task_claims(running_task)
            shared_files = sorted(candidate_file_set.intersection(running_files))
            shared_areas = sorted(candidate_area_set.intersection(running_areas))
            if shared_files:
                file_conflicts.append(
                    {
                        "task_id": running_task.task_id,
                        "status": running_task.status,
                        "shared_file_claims": shared_files,
                    }
                )
            if shared_areas:
                area_conflicts.append(
                    {
                        "task_id": running_task.task_id,
                        "status": running_task.status,
                        "shared_area_claims": shared_areas,
                    }
                )

        return {
            "conflict": bool(file_conflicts or area_conflicts),
            "file_conflicts": file_conflicts,
            "area_conflicts": area_conflicts,
        }

    def set_task_status(
        self,
        *,
        task_id: str,
        status: str,
        blocked_reason: Optional[str] = None,
        clarification_questions: Optional[List[str]] = None,
        clear_cancel_requested: bool = False,
        clear_finished_at: bool = True,
    ) -> Optional[TaskRecord]:
        if status not in TASK_STATUSES:
            raise ValueError(f"unsupported task status: {status}")
        if status in TERMINAL_TASK_STATUSES:
            return self.finish_task(task_id=task_id, status=status)

        ts = self.now_iso()
        questions_json = json.dumps(
            [str(item).strip() for item in (clarification_questions or []) if str(item).strip()],
            ensure_ascii=True,
        )
        clarification_requested = 1 if status == "blocked_information" else 0
        with self._connect() as conn:
            existing_status = self._enforce_transition(
                conn=conn,
                task_id=task_id,
                next_status=status,
            )
            if existing_status is None:
                return None
            conn.execute(
                """
                UPDATE tasks
                SET
                    status=?,
                    blocked_reason=?,
                    clarification_questions_json=?,
                    clarification_requested=?,
                    cancel_requested=CASE WHEN ? THEN 0 ELSE cancel_requested END,
                    finished_at=CASE WHEN ? THEN NULL ELSE finished_at END,
                    updated_at=?
                WHERE task_id=?
                """,
                (
                    status,
                    (blocked_reason or "").strip() or None,
                    questions_json,
                    clarification_requested,
                    1 if clear_cancel_requested else 0,
                    1 if clear_finished_at else 0,
                    ts,
                    task_id,
                ),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def request_clarification(
        self,
        *,
        task_id: str,
        reason: str,
        questions: List[str],
        actor: Optional[Dict[str, Any]] = None,
    ) -> Optional[TaskRecord]:
        ts = self.now_iso()
        clean_reason = (reason or "").strip() or "additional information required"
        clean_questions = [str(item).strip() for item in (questions or []) if str(item).strip()]
        with self._connect() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            if row is None:
                return None
            current_status = str(row["status"])
            if current_status in TERMINAL_TASK_STATUSES:
                task_row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
                return None if task_row is None else self._row_to_task(task_row)
            self._enforce_transition(
                conn=conn,
                task_id=task_id,
                next_status="blocked_information",
            )

            conn.execute(
                """
                UPDATE tasks
                SET
                    status='blocked_information',
                    cancel_requested=CASE WHEN status='running' THEN 1 ELSE cancel_requested END,
                    blocked_reason=?,
                    clarification_questions_json=?,
                    clarification_requested=1,
                    finished_at=NULL,
                    updated_at=?
                WHERE task_id=?
                """,
                (
                    clean_reason,
                    json.dumps(clean_questions, ensure_ascii=True),
                    ts,
                    task_id,
                ),
            )
            task_row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()

        if task_row is None:
            return None

        data: Dict[str, Any] = {"reason": clean_reason, "questions": clean_questions}
        if actor:
            data["actor"] = actor
        self.append_event(
            task_id,
            level="warning",
            event_type="needs_clarification",
            message=clean_reason,
            data=data,
        )
        return self._row_to_task(task_row)

    def resolve_clarification(
        self,
        *,
        task_id: str,
        guidance: str,
        actor: Optional[Dict[str, Any]] = None,
    ) -> Optional[TaskRecord]:
        clean_guidance = (guidance or "").strip()
        ts = self.now_iso()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status, options_json FROM tasks WHERE task_id=?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            self._enforce_transition(
                conn=conn,
                task_id=task_id,
                next_status="queued",
            )

            options = _parse_json_object(row["options_json"])
            history_raw = options.get("clarification_history") or []
            history: List[Dict[str, Any]]
            if isinstance(history_raw, list):
                history = [item for item in history_raw if isinstance(item, dict)]
            else:
                history = []
            entry: Dict[str, Any] = {"ts": ts, "guidance": clean_guidance}
            if actor:
                entry["actor"] = actor
            history.append(entry)
            options["clarification_history"] = history[-50:]

            conn.execute(
                """
                UPDATE tasks
                SET
                    status='queued',
                    options_json=?,
                    cancel_requested=0,
                    blocked_reason=NULL,
                    clarification_questions_json='[]',
                    clarification_requested=0,
                    finished_at=NULL,
                    updated_at=?
                WHERE task_id=?
                """,
                (json.dumps(options, ensure_ascii=True), ts, task_id),
            )
            task_row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if task_row is None:
            return None
        self.append_event(
            task_id,
            level="info",
            event_type="clarification_resolved",
            message=clean_guidance[:2000] or "clarification resolved; task re-queued",
            data={"actor": actor or {}},
        )
        return self._row_to_task(task_row)

    @staticmethod
    def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
        text = _normalize_text(value)
        if not text:
            return None
        try:
            return datetime.fromisoformat(text)
        except Exception:
            return None

    @classmethod
    def _elapsed_seconds_for_task(cls, task: TaskRecord) -> Optional[int]:
        start = cls._parse_iso_datetime(task.started_at or task.created_at)
        if start is None:
            return None
        end = cls._parse_iso_datetime(task.finished_at) or datetime.now(timezone.utc)
        delta = int((end - start).total_seconds())
        return max(0, delta)

    def list_tasks_for_topic(
        self,
        topic_scope_id: str,
        *,
        limit: int = 200,
        statuses: Optional[List[str]] = None,
        plan_revision_id: Optional[str] = None,
    ) -> List[TaskRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return []

        bounded = max(1, min(int(limit), 500))
        wanted = [str(v).strip().lower() for v in (statuses or []) if str(v).strip()]
        wanted = [v for v in wanted if v in TASK_STATUSES]
        plan_id = str(plan_revision_id or "").strip()

        filters = ["topic_scope_id = ?"]
        args: List[Any] = [scope]
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            filters.append(f"status IN ({placeholders})")
            args.extend(wanted)
        if plan_id:
            filters.append("plan_revision_id = ?")
            args.append(plan_id)

        sql = (
            "SELECT * FROM tasks "
            f"WHERE {' AND '.join(filters)} "
            "ORDER BY created_at DESC LIMIT ?"
        )
        args.append(bounded)

        with self._connect() as conn:
            rows = conn.execute(sql, tuple(args)).fetchall()
        return [self._row_to_task(row) for row in rows]

    def list_tasks_by_status(
        self,
        *,
        statuses: List[str],
        limit: int = 200,
    ) -> List[TaskRecord]:
        wanted = [str(item).strip().lower() for item in statuses if str(item).strip()]
        wanted = [item for item in wanted if item in TASK_STATUSES]
        if not wanted:
            return []
        bounded = max(1, min(int(limit), 2000))
        placeholders = ",".join("?" for _ in wanted)
        sql = (
            "SELECT * FROM tasks "
            f"WHERE status IN ({placeholders}) "
            "ORDER BY updated_at ASC "
            "LIMIT ?"
        )
        args: List[Any] = list(wanted)
        args.append(bounded)
        with self._connect() as conn:
            rows = conn.execute(sql, tuple(args)).fetchall()
        return [self._row_to_task(row) for row in rows]

    def list_topic_events(
        self,
        topic_scope_id: str,
        *,
        after_id: int = 0,
        limit: int = 200,
        event_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return []

        bounded = max(1, min(int(limit), 2000))
        filters = ["t.topic_scope_id = ?", "e.id > ?"]
        args: List[Any] = [scope, max(0, int(after_id or 0))]

        wanted = [str(v).strip() for v in (event_types or []) if str(v).strip()]
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            filters.append(f"e.event_type IN ({placeholders})")
            args.extend(wanted)

        sql = (
            "SELECT e.id, e.task_id, e.ts, e.level, e.event_type, e.message, e.data "
            "FROM task_events e "
            "JOIN tasks t ON t.task_id = e.task_id "
            f"WHERE {' AND '.join(filters)} "
            "ORDER BY e.id ASC LIMIT ?"
        )
        args.append(bounded)

        with self._connect() as conn:
            rows = conn.execute(sql, tuple(args)).fetchall()

        out: List[Dict[str, Any]] = []
        for row in rows:
            data_raw = row["data"]
            out.append(
                {
                    "id": int(row["id"]),
                    "task_id": str(row["task_id"]),
                    "ts": str(row["ts"]),
                    "level": str(row["level"]),
                    "event_type": str(row["event_type"]),
                    "message": str(row["message"]),
                    "data": json.loads(data_raw or "{}"),
                }
            )
        return out

    def get_topic_sidebar(
        self,
        topic_scope_id: str,
        *,
        limit: int = 200,
        plan_revision_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        tasks = self.list_tasks_for_topic(topic_scope_id, limit=limit, plan_revision_id=plan_revision_id)
        counts: Dict[str, int] = {status: 0 for status in sorted(TASK_STATUSES)}
        rows: List[Dict[str, Any]] = []

        for task in tasks:
            counts[task.status] = counts.get(task.status, 0) + 1
            rows.append(
                {
                    "task_id": task.task_id,
                    "title": derive_task_title(task.instruction, task.options),
                    "status": task.status,
                    "provider": task.provider,
                    "user_id": task.user_id,
                    "elapsed_seconds": self._elapsed_seconds_for_task(task),
                    "created_at": task.created_at,
                    "updated_at": task.updated_at,
                    "started_at": task.started_at,
                    "finished_at": task.finished_at,
                    "branch_name": task.branch_name,
                    "worktree_path": task.worktree_path,
                    "container_name": task.container_name,
                    "container_runtime": task.container_runtime,
                    "result_text": task.result_text,
                    "error_text": task.error_text,
                    "preview_ready": bool(task.preview_url),
                    "preview_url": task.preview_url,
                    "failed": task.status == "failed",
                }
            )

        return {
            "topic_scope_id": normalize_topic_scope_id(topic_scope_id),
            "plan_revision_id": str(plan_revision_id or "").strip() or None,
            "task_count": len(rows),
            "counts": counts,
            "tasks": rows,
        }

    def get_or_create_supervisor_session(
        self,
        *,
        topic_scope_id: str,
        session_id: Optional[str] = None,
        status: str = "idle",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SupervisorSessionRecord:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            raise ValueError("topic_scope_id is required")
        ts = self.now_iso()
        clean_status = _normalize_text(status).lower() or "idle"
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        with self._connect() as conn:
            row = None
            requested_session_id = _normalize_text(session_id)
            if requested_session_id:
                row = conn.execute(
                    """
                    SELECT * FROM supervisor_sessions
                    WHERE topic_scope_id=? AND session_id=?
                    """,
                    (scope, requested_session_id),
                ).fetchone()
            if row is None:
                row = conn.execute(
                    """
                    SELECT * FROM supervisor_sessions
                    WHERE topic_scope_id=?
                    ORDER BY updated_at DESC, created_at DESC
                    LIMIT 1
                    """,
                    (scope,),
                ).fetchone()
            if row is None:
                session_id = f"sup_{uuid.uuid4().hex[:12]}"
                conn.execute(
                    """
                    INSERT INTO supervisor_sessions (
                        session_id, topic_scope_id, status, metadata_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        scope,
                        clean_status,
                        json.dumps(metadata_obj, ensure_ascii=True),
                        ts,
                        ts,
                    ),
                )
                row = conn.execute(
                    "SELECT * FROM supervisor_sessions WHERE session_id=?",
                    (session_id,),
                ).fetchone()
            else:
                conn.execute(
                    "UPDATE supervisor_sessions SET updated_at=? WHERE session_id=?",
                    (ts, str(row["session_id"])),
                )
                row = conn.execute(
                    "SELECT * FROM supervisor_sessions WHERE session_id=?",
                    (str(row["session_id"]),),
                ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist supervisor session")
        return self._row_to_supervisor_session(row)

    def create_supervisor_session(
        self,
        *,
        topic_scope_id: str,
        status: str = "idle",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SupervisorSessionRecord:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            raise ValueError("topic_scope_id is required")
        ts = self.now_iso()
        clean_status = _normalize_text(status).lower() or "idle"
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        session_id = f"sup_{uuid.uuid4().hex[:12]}"
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO supervisor_sessions (
                    session_id, topic_scope_id, status, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    scope,
                    clean_status,
                    json.dumps(metadata_obj, ensure_ascii=True),
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM supervisor_sessions WHERE session_id=?",
                (session_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist supervisor session")
        return self._row_to_supervisor_session(row)

    def get_supervisor_session(self, topic_scope_id: str) -> Optional[SupervisorSessionRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM supervisor_sessions
                WHERE topic_scope_id=?
                ORDER BY updated_at DESC, created_at DESC
                LIMIT 1
                """,
                (scope,),
            ).fetchone()
        return None if row is None else self._row_to_supervisor_session(row)

    def get_supervisor_session_by_id(self, session_id: str) -> Optional[SupervisorSessionRecord]:
        sid = _normalize_text(session_id)
        if not sid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM supervisor_sessions WHERE session_id=?",
                (sid,),
            ).fetchone()
        return None if row is None else self._row_to_supervisor_session(row)

    def list_supervisor_sessions(
        self,
        *,
        topic_scope_id: str,
        limit: int = 50,
    ) -> List[SupervisorSessionRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return []
        bounded = max(1, min(int(limit), 500))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM supervisor_sessions
                WHERE topic_scope_id=?
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?
                """,
                (scope, bounded),
            ).fetchall()
        return [self._row_to_supervisor_session(row) for row in rows]

    def update_supervisor_session(
        self,
        *,
        topic_scope_id: Optional[str] = None,
        session_id: Optional[str] = None,
        status: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[SupervisorSessionRecord]:
        scope = normalize_topic_scope_id(topic_scope_id or "")
        sid = _normalize_text(session_id)
        target: Optional[SupervisorSessionRecord]
        if sid:
            target = self.get_supervisor_session_by_id(sid)
        elif scope:
            target = self.get_supervisor_session(scope)
        else:
            target = None
        if target is None:
            return None
        ts = self.now_iso()
        assignments: List[str] = ["updated_at=?"]
        args: List[Any] = [ts]
        if status is not None:
            assignments.append("status=?")
            args.append(_normalize_text(status).lower() or "idle")
        if metadata is not None:
            assignments.append("metadata_json=?")
            args.append(json.dumps(metadata if isinstance(metadata, dict) else {}, ensure_ascii=True))
        args.append(target.session_id)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE supervisor_sessions SET {', '.join(assignments)} WHERE session_id=?",
                tuple(args),
            )
            row = conn.execute(
                "SELECT * FROM supervisor_sessions WHERE session_id=?",
                (target.session_id,),
            ).fetchone()
        return None if row is None else self._row_to_supervisor_session(row)

    def reset_supervisor_session(
        self,
        *,
        topic_scope_id: str,
        session_id: Optional[str] = None,
        clear_events: bool = True,
    ) -> SupervisorSessionRecord:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            raise ValueError("topic_scope_id is required")
        current = self.get_or_create_supervisor_session(topic_scope_id=scope, session_id=session_id)
        metadata = current.metadata if isinstance(current.metadata, dict) else {}
        reset_counter_raw = metadata.get("reset_counter")
        try:
            reset_counter = int(reset_counter_raw)
        except Exception:
            reset_counter = 0
        reset_counter = max(0, reset_counter) + 1
        next_metadata: Dict[str, Any] = {"reset_counter": reset_counter}
        for key in ("engine", "moltis_model", "moltis_model_requested"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                next_metadata[key] = value.strip()
        ts = self.now_iso()
        with self._connect() as conn:
            if clear_events:
                conn.execute(
                    "DELETE FROM supervisor_events WHERE topic_scope_id=? AND session_id=?",
                    (scope, current.session_id),
                )
            conn.execute(
                """
                UPDATE supervisor_sessions
                SET status='idle', metadata_json=?, updated_at=?
                WHERE session_id=?
                """,
                (
                    json.dumps(next_metadata, ensure_ascii=True),
                    ts,
                    current.session_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM supervisor_sessions WHERE session_id=?",
                (current.session_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to reset supervisor session")
        return self._row_to_supervisor_session(row)

    def get_supervisor_event_by_client_msg_id(
        self,
        *,
        topic_scope_id: str,
        client_msg_id: str,
        session_id: Optional[str] = None,
    ) -> Optional[SupervisorEventRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        dedupe_key = _normalize_text(client_msg_id)
        if not scope or not dedupe_key:
            return None
        sid = _normalize_text(session_id)
        with self._connect() as conn:
            if sid:
                row = conn.execute(
                    """
                    SELECT *
                    FROM supervisor_events
                    WHERE topic_scope_id=? AND session_id=? AND client_msg_id=?
                    LIMIT 1
                    """,
                    (scope, sid, dedupe_key),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT *
                    FROM supervisor_events
                    WHERE topic_scope_id=? AND client_msg_id=?
                    LIMIT 1
                    """,
                    (scope, dedupe_key),
                ).fetchone()
        return None if row is None else self._row_to_supervisor_event(row)

    def append_supervisor_event(
        self,
        *,
        topic_scope_id: str,
        session_id: str,
        kind: str,
        role: str,
        content_md: str,
        payload: Optional[Dict[str, Any]] = None,
        author_id: Optional[str] = None,
        author_name: Optional[str] = None,
        client_msg_id: Optional[str] = None,
    ) -> SupervisorEventRecord:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            raise ValueError("topic_scope_id is required")
        sid = _normalize_text(session_id)
        if not sid:
            raise ValueError("session_id is required")
        clean_kind = _normalize_text(kind).lower() or "message"
        clean_role = _normalize_text(role).lower() or "assistant"
        dedupe_key = _normalize_text(client_msg_id) or None

        if dedupe_key:
            existing = self.get_supervisor_event_by_client_msg_id(
                topic_scope_id=scope,
                client_msg_id=dedupe_key,
                session_id=sid,
            )
            if existing is not None:
                return existing

        ts = self.now_iso()
        payload_obj = payload if isinstance(payload, dict) else {}
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO supervisor_events (
                    topic_scope_id, session_id, ts, kind, role, author_id, author_name,
                    content_md, payload_json, client_msg_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scope,
                    sid,
                    ts,
                    clean_kind,
                    clean_role,
                    _normalize_text(author_id) or None,
                    _normalize_text(author_name) or None,
                    str(content_md or ""),
                    json.dumps(payload_obj, ensure_ascii=True),
                    dedupe_key,
                ),
            )
            row = conn.execute(
                "SELECT * FROM supervisor_events WHERE id = last_insert_rowid()"
            ).fetchone()
            conn.execute(
                """
                UPDATE supervisor_sessions
                SET updated_at=?, status=CASE WHEN status='idle' THEN 'active' ELSE status END
                WHERE session_id=?
                """,
                (ts, sid),
            )
        if row is None:
            raise RuntimeError("failed to persist supervisor event")
        return self._row_to_supervisor_event(row)

    def list_supervisor_events(
        self,
        *,
        topic_scope_id: str,
        session_id: Optional[str] = None,
        after_id: int = 0,
        limit: int = 200,
        kinds: Optional[List[str]] = None,
    ) -> List[SupervisorEventRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return []
        bounded = max(1, min(int(limit), 2000))
        filters = ["topic_scope_id = ?", "id > ?"]
        args: List[Any] = [scope, max(0, int(after_id or 0))]
        sid = _normalize_text(session_id)
        if sid:
            filters.append("session_id = ?")
            args.append(sid)

        wanted = [str(item).strip().lower() for item in (kinds or []) if str(item).strip()]
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            filters.append(f"kind IN ({placeholders})")
            args.extend(wanted)

        sql = (
            "SELECT * FROM supervisor_events "
            f"WHERE {' AND '.join(filters)} "
            "ORDER BY id ASC LIMIT ?"
        )
        args.append(bounded)
        with self._connect() as conn:
            rows = conn.execute(sql, tuple(args)).fetchall()
        return [self._row_to_supervisor_event(row) for row in rows]

    def latest_supervisor_event_ids_by_session(
        self,
        *,
        topic_scope_id: str,
        session_ids: Optional[List[str]] = None,
    ) -> Dict[str, int]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return {}
        wanted = [_normalize_text(item) for item in (session_ids or []) if _normalize_text(item)]
        filters = ["topic_scope_id = ?"]
        args: List[Any] = [scope]
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            filters.append(f"session_id IN ({placeholders})")
            args.extend(wanted)
        sql = (
            "SELECT session_id, MAX(id) AS last_message_id "
            "FROM supervisor_events "
            f"WHERE {' AND '.join(filters)} "
            "GROUP BY session_id"
        )
        with self._connect() as conn:
            rows = conn.execute(sql, tuple(args)).fetchall()
        out: Dict[str, int] = {}
        for row in rows:
            session_id = _normalize_text(row["session_id"])
            if not session_id:
                continue
            try:
                out[session_id] = int(row["last_message_id"])
            except Exception:
                continue
        return out

    def create_plan_revision(
        self,
        *,
        topic_scope_id: str,
        session_id: Optional[str] = None,
        author_id: Optional[str],
        summary: str,
        objective: str,
        assumptions: List[str],
        unknowns: List[str],
        execution_steps: List[Dict[str, Any]],
        candidate_parallel_seams: List[Dict[str, Any]],
        approval_points: List[str],
        source: Optional[Dict[str, Any]] = None,
        status: str = "active",
        plan_revision_id: Optional[str] = None,
    ) -> PlanRevisionRecord:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            raise ValueError("topic_scope_id is required")
        sid = _normalize_text(session_id)
        revision_id = (plan_revision_id or "").strip() or f"plan_{uuid.uuid4().hex[:12]}"
        ts = self.now_iso()
        assumptions_clean = [str(item).strip() for item in assumptions if str(item).strip()]
        unknowns_clean = [str(item).strip() for item in unknowns if str(item).strip()]
        approval_points_clean = [str(item).strip() for item in approval_points if str(item).strip()]
        steps_clean = [item for item in execution_steps if isinstance(item, dict)]
        seams_clean = [item for item in candidate_parallel_seams if isinstance(item, dict)]
        source_obj = source if isinstance(source, dict) else {}

        with self._connect() as conn:
            if status == "active":
                conn.execute(
                    """
                    UPDATE plan_revisions
                    SET status='superseded', updated_at=?
                    WHERE topic_scope_id=? AND status='active'
                    """,
                    (ts, scope),
                )
            conn.execute(
                """
                INSERT INTO plan_revisions (
                    plan_revision_id, topic_scope_id, session_id, author_id, summary, objective,
                    assumptions_json, unknowns_json, execution_steps_json,
                    candidate_parallel_seams_json, approval_points_json,
                    status, source_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    revision_id,
                    scope,
                    sid,
                    (author_id or "").strip() or None,
                    (summary or "").strip(),
                    (objective or "").strip(),
                    json.dumps(assumptions_clean, ensure_ascii=True),
                    json.dumps(unknowns_clean, ensure_ascii=True),
                    json.dumps(steps_clean, ensure_ascii=True),
                    json.dumps(seams_clean, ensure_ascii=True),
                    json.dumps(approval_points_clean, ensure_ascii=True),
                    (status or "active").strip() or "active",
                    json.dumps(source_obj, ensure_ascii=True),
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM plan_revisions WHERE plan_revision_id=?",
                (revision_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist plan revision")
        return self._row_to_plan_revision(row)

    def list_plan_revisions(
        self,
        *,
        topic_scope_id: str,
        session_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[PlanRevisionRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return []
        bounded = max(1, min(int(limit), 500))
        sid = _normalize_text(session_id)
        with self._connect() as conn:
            if sid:
                rows = conn.execute(
                    """
                    SELECT * FROM plan_revisions
                    WHERE topic_scope_id=? AND session_id=?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (scope, sid, bounded),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM plan_revisions
                    WHERE topic_scope_id=?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (scope, bounded),
                ).fetchall()
        return [self._row_to_plan_revision(row) for row in rows]

    def get_plan_revision(self, plan_revision_id: str) -> Optional[PlanRevisionRecord]:
        pid = (plan_revision_id or "").strip()
        if not pid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM plan_revisions WHERE plan_revision_id=?",
                (pid,),
            ).fetchone()
        return None if row is None else self._row_to_plan_revision(row)

    def get_active_plan_revision(
        self,
        topic_scope_id: str,
        session_id: Optional[str] = None,
    ) -> Optional[PlanRevisionRecord]:
        scope = normalize_topic_scope_id(topic_scope_id)
        if not scope:
            return None
        sid = _normalize_text(session_id)
        with self._connect() as conn:
            if sid:
                row = conn.execute(
                    """
                    SELECT * FROM plan_revisions
                    WHERE topic_scope_id=? AND status='active'
                    ORDER BY
                        CASE
                            WHEN session_id=? THEN 0
                            WHEN session_id='' THEN 1
                            ELSE 2
                        END,
                        created_at DESC
                    LIMIT 1
                    """,
                    (scope, sid),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT * FROM plan_revisions
                    WHERE topic_scope_id=? AND status='active'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (scope,),
                ).fetchone()
        return None if row is None else self._row_to_plan_revision(row)

    def upsert_provider_credential(
        self,
        *,
        user_id: str,
        provider: str,
        auth_mode: str,
        secret: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
        label: Optional[str] = None,
        status: str = "active",
    ) -> ProviderCredentialRecord:
        uid = _normalize_text(user_id).lower()
        provider_id = normalize_provider_id(provider)
        if not uid:
            raise ValueError("user_id is required")
        if not provider_id:
            raise ValueError("provider is required")
        mode = _normalize_text(auth_mode).lower()
        if mode not in {"api_key", "oauth"}:
            raise ValueError("auth_mode must be one of: api_key, oauth")
        state = _normalize_text(status).lower() or "active"
        if state not in {"active", "revoked"}:
            raise ValueError("status must be one of: active, revoked")
        secret_obj = secret if isinstance(secret, dict) else {}
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        ts = self.now_iso()
        storage_ids = provider_storage_ids(provider_id)
        with self._connect() as conn:
            if provider_id == "claude_code":
                conn.execute(
                    """
                    UPDATE provider_credentials
                    SET provider='claude_code'
                    WHERE user_id=? AND provider='cloud_code'
                    """,
                    (uid,),
                )
            conn.execute(
                """
                INSERT INTO provider_credentials (
                    user_id, provider, auth_mode, label, secret_json, metadata_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, provider) DO UPDATE SET
                    auth_mode=excluded.auth_mode,
                    label=excluded.label,
                    secret_json=excluded.secret_json,
                    metadata_json=excluded.metadata_json,
                    status=excluded.status,
                    updated_at=excluded.updated_at
                """,
                (
                    uid,
                    provider_id,
                    mode,
                    _normalize_text(label) or None,
                    json.dumps(secret_obj, ensure_ascii=True),
                    json.dumps(metadata_obj, ensure_ascii=True),
                    state,
                    ts,
                    ts,
                ),
            )
            placeholders = ",".join("?" for _ in storage_ids)
            row = conn.execute(
                f"SELECT * FROM provider_credentials WHERE user_id=? AND provider IN ({placeholders}) ORDER BY updated_at DESC LIMIT 1",
                (uid, *storage_ids),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist provider credential")
        return self._row_to_provider_credential(row)

    def get_provider_credential(
        self,
        *,
        user_id: str,
        provider: str,
        include_revoked: bool = False,
    ) -> Optional[ProviderCredentialRecord]:
        uid = _normalize_text(user_id).lower()
        provider_id = normalize_provider_id(provider)
        if not uid or not provider_id:
            return None
        storage_ids = provider_storage_ids(provider_id)
        placeholders = ",".join("?" for _ in storage_ids)
        sql = (
            f"SELECT * FROM provider_credentials WHERE user_id=? AND provider IN ({placeholders})"
        )
        args: List[Any] = [uid, *storage_ids]
        if not include_revoked:
            sql += " AND status='active'"
        sql += " ORDER BY updated_at DESC LIMIT 1"
        with self._connect() as conn:
            row = conn.execute(sql, tuple(args)).fetchone()
        return None if row is None else self._row_to_provider_credential(row)

    def list_provider_credentials(
        self,
        *,
        user_id: str,
        include_revoked: bool = False,
    ) -> List[ProviderCredentialRecord]:
        uid = _normalize_text(user_id).lower()
        if not uid:
            return []
        sql = (
            "SELECT * FROM provider_credentials WHERE user_id=? "
            + ("ORDER BY provider ASC" if include_revoked else "AND status='active' ORDER BY provider ASC")
        )
        with self._connect() as conn:
            rows = conn.execute(sql, (uid,)).fetchall()
        return [self._row_to_provider_credential(row) for row in rows]

    def revoke_provider_credential(
        self,
        *,
        user_id: str,
        provider: str,
    ) -> Optional[ProviderCredentialRecord]:
        uid = _normalize_text(user_id).lower()
        provider_id = normalize_provider_id(provider)
        if not uid or not provider_id:
            return None
        ts = self.now_iso()
        storage_ids = provider_storage_ids(provider_id)
        placeholders = ",".join("?" for _ in storage_ids)
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE provider_credentials
                SET status='revoked', secret_json='{{}}', updated_at=?
                WHERE user_id=? AND provider IN ({placeholders})
                """,
                (ts, uid, *storage_ids),
            )
            row = conn.execute(
                f"SELECT * FROM provider_credentials WHERE user_id=? AND provider IN ({placeholders}) ORDER BY updated_at DESC LIMIT 1",
                (uid, *storage_ids),
            ).fetchone()
        return None if row is None else self._row_to_provider_credential(row)

    def create_provider_oauth_state(
        self,
        *,
        state: str,
        user_id: str,
        provider: str,
        redirect_uri: Optional[str],
        scopes: List[str],
        metadata: Optional[Dict[str, Any]] = None,
        code_verifier: Optional[str] = None,
        expires_at: str,
    ) -> ProviderOAuthStateRecord:
        token = _normalize_text(state)
        uid = _normalize_text(user_id).lower()
        provider_id = normalize_provider_id(provider)
        if not token:
            raise ValueError("state is required")
        if not uid:
            raise ValueError("user_id is required")
        if not provider_id:
            raise ValueError("provider is required")
        scopes_clean = [str(item).strip() for item in scopes if str(item).strip()]
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO provider_oauth_states (
                    state, user_id, provider, redirect_uri, scopes_json,
                    metadata_json, code_verifier, created_at, expires_at, consumed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    token,
                    uid,
                    provider_id,
                    _normalize_text(redirect_uri) or None,
                    json.dumps(scopes_clean, ensure_ascii=True),
                    json.dumps(metadata_obj, ensure_ascii=True),
                    _normalize_text(code_verifier) or None,
                    ts,
                    _normalize_text(expires_at),
                ),
            )
            row = conn.execute(
                "SELECT * FROM provider_oauth_states WHERE state=?",
                (token,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist oauth state")
        return self._row_to_provider_oauth_state(row)

    def get_provider_oauth_state(
        self,
        *,
        state: str,
        include_consumed: bool = False,
    ) -> Optional[ProviderOAuthStateRecord]:
        token = _normalize_text(state)
        if not token:
            return None
        sql = "SELECT * FROM provider_oauth_states WHERE state=?"
        args: List[Any] = [token]
        if not include_consumed:
            sql += " AND consumed_at IS NULL"
        with self._connect() as conn:
            row = conn.execute(sql, tuple(args)).fetchone()
        return None if row is None else self._row_to_provider_oauth_state(row)

    def consume_provider_oauth_state(
        self,
        *,
        state: str,
    ) -> Optional[ProviderOAuthStateRecord]:
        token = _normalize_text(state)
        if not token:
            return None
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE provider_oauth_states
                SET consumed_at=COALESCE(consumed_at, ?)
                WHERE state=?
                """,
                (ts, token),
            )
            row = conn.execute(
                "SELECT * FROM provider_oauth_states WHERE state=?",
                (token,),
            ).fetchone()
        return None if row is None else self._row_to_provider_oauth_state(row)

    def upsert_integration_credential(
        self,
        *,
        user_id: str,
        integration: str,
        auth_mode: str,
        secret: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
        label: Optional[str] = None,
        status: str = "active",
    ) -> IntegrationCredentialRecord:
        uid = _normalize_text(user_id).lower()
        integration_id = normalize_integration_id(integration)
        if not uid:
            raise ValueError("user_id is required")
        if not integration_id:
            raise ValueError("integration is required")
        mode = _normalize_text(auth_mode).lower() or "api_key"
        if mode not in {"api_key", "oauth"}:
            raise ValueError("auth_mode must be one of: api_key, oauth")
        state = _normalize_text(status).lower() or "active"
        if state not in {"active", "revoked"}:
            raise ValueError("status must be one of: active, revoked")
        secret_obj = secret if isinstance(secret, dict) else {}
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO integration_credentials (
                    user_id, integration, auth_mode, label, secret_json, metadata_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, integration) DO UPDATE SET
                    auth_mode=excluded.auth_mode,
                    label=excluded.label,
                    secret_json=excluded.secret_json,
                    metadata_json=excluded.metadata_json,
                    status=excluded.status,
                    updated_at=excluded.updated_at
                """,
                (
                    uid,
                    integration_id,
                    mode,
                    _normalize_text(label) or None,
                    json.dumps(secret_obj, ensure_ascii=True),
                    json.dumps(metadata_obj, ensure_ascii=True),
                    state,
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM integration_credentials WHERE user_id=? AND integration=?",
                (uid, integration_id),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist integration credential")
        return self._row_to_integration_credential(row)

    def get_integration_credential(
        self,
        *,
        user_id: str,
        integration: str,
        include_revoked: bool = False,
    ) -> Optional[IntegrationCredentialRecord]:
        uid = _normalize_text(user_id).lower()
        integration_id = normalize_integration_id(integration)
        if not uid or not integration_id:
            return None
        sql = "SELECT * FROM integration_credentials WHERE user_id=? AND integration=?"
        args: List[Any] = [uid, integration_id]
        if not include_revoked:
            sql += " AND status='active'"
        with self._connect() as conn:
            row = conn.execute(sql, tuple(args)).fetchone()
        return None if row is None else self._row_to_integration_credential(row)

    def list_integration_credentials(
        self,
        *,
        user_id: str,
        include_revoked: bool = False,
    ) -> List[IntegrationCredentialRecord]:
        uid = _normalize_text(user_id).lower()
        if not uid:
            return []
        sql = (
            "SELECT * FROM integration_credentials WHERE user_id=? "
            + (
                "ORDER BY integration ASC"
                if include_revoked
                else "AND status='active' ORDER BY integration ASC"
            )
        )
        with self._connect() as conn:
            rows = conn.execute(sql, (uid,)).fetchall()
        return [self._row_to_integration_credential(row) for row in rows]

    def revoke_integration_credential(
        self,
        *,
        user_id: str,
        integration: str,
    ) -> Optional[IntegrationCredentialRecord]:
        uid = _normalize_text(user_id).lower()
        integration_id = normalize_integration_id(integration)
        if not uid or not integration_id:
            return None
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE integration_credentials
                SET status='revoked', secret_json='{}', updated_at=?
                WHERE user_id=? AND integration=?
                """,
                (ts, uid, integration_id),
            )
            row = conn.execute(
                "SELECT * FROM integration_credentials WHERE user_id=? AND integration=?",
                (uid, integration_id),
            ).fetchone()
        return None if row is None else self._row_to_integration_credential(row)

    def upsert_integration_policy(
        self,
        *,
        user_id: str,
        policy: Dict[str, Any],
    ) -> IntegrationPolicyRecord:
        uid = _normalize_text(user_id).lower()
        if not uid:
            raise ValueError("user_id is required")
        policy_obj = policy if isinstance(policy, dict) else {}
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO integration_policies (user_id, policy_json, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    policy_json=excluded.policy_json,
                    updated_at=excluded.updated_at
                """,
                (
                    uid,
                    json.dumps(policy_obj, ensure_ascii=True),
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM integration_policies WHERE user_id=?",
                (uid,),
            ).fetchone()
        if row is None:
            raise RuntimeError("failed to persist integration policy")
        return self._row_to_integration_policy(row)

    def get_integration_policy(
        self,
        *,
        user_id: str,
    ) -> Optional[IntegrationPolicyRecord]:
        uid = _normalize_text(user_id).lower()
        if not uid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM integration_policies WHERE user_id=?",
                (uid,),
            ).fetchone()
        return None if row is None else self._row_to_integration_policy(row)

    def claim_task(
        self,
        *,
        task_id: str,
        worker_id: str,
        workspace_id: str,
        workspace_name: str,
        branch_name: str,
        worktree_path: str,
        container_name: Optional[str] = None,
        container_runtime: Optional[str] = None,
    ) -> bool:
        ts = self.now_iso()
        with self._connect() as conn:
            current = conn.execute("SELECT status FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            if current is None:
                return False
            current_status = str(current["status"] or "").strip().lower()
            if not self._policy_allows_transition(current_status, "running"):
                if self._policy_is_strict():
                    raise ValueError(
                        f"lifecycle transition blocked by policy: {current_status} -> running"
                    )
                return False
            cur = conn.execute(
                """
                UPDATE tasks
                SET
                    status='running',
                    workspace_id=?,
                    workspace_name=?,
                    branch_name=?,
                    worktree_path=?,
                    container_name=?,
                    container_runtime=?,
                    started_at=COALESCE(started_at, ?),
                    worker_id=?,
                    updated_at=?
                WHERE task_id=? AND status='queued'
                """,
                (
                    workspace_id,
                    workspace_name,
                    branch_name,
                    worktree_path,
                    container_name,
                    container_runtime,
                    ts,
                    worker_id,
                    ts,
                    task_id,
                ),
            )
            changed = cur.rowcount
        return bool(changed)

    def request_cancel(self, task_id: str) -> Optional[TaskRecord]:
        ts = self.now_iso()
        with self._connect() as conn:
            row = conn.execute("SELECT status FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            if row is None:
                return None
            status = str(row["status"])
            if status == "queued":
                self._enforce_transition(
                    conn=conn,
                    task_id=task_id,
                    next_status="canceled",
                )
                conn.execute(
                    """
                    UPDATE tasks
                    SET status='canceled', cancel_requested=1, finished_at=?, updated_at=?
                    WHERE task_id=?
                    """,
                    (ts, ts, task_id),
                )
            elif status == "running":
                conn.execute(
                    """
                    UPDATE tasks
                    SET cancel_requested=1, updated_at=?
                    WHERE task_id=?
                    """,
                    (ts, task_id),
                )
            task_row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()

        if task_row is None:
            return None

        self.append_event(
            task_id,
            level="warning",
            event_type="task_cancel_requested",
            message="Cancel requested",
        )
        return self._row_to_task(task_row)

    def set_task_approved(self, task_id: str) -> Optional[TaskRecord]:
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET approved=1, updated_at=? WHERE task_id=?",
                (ts, task_id),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if row is None:
            return None
        self.append_event(
            task_id,
            level="info",
            event_type="task_approved",
            message="Task approved for downstream actions",
        )
        return self._row_to_task(row)

    def finish_task(
        self,
        *,
        task_id: str,
        status: str,
        result_text: Optional[str] = None,
        error_text: Optional[str] = None,
    ) -> Optional[TaskRecord]:
        if status not in TASK_STATUSES:
            raise ValueError(f"unsupported task status: {status}")
        ts = self.now_iso()
        with self._connect() as conn:
            existing = self._enforce_transition(
                conn=conn,
                task_id=task_id,
                next_status=status,
            )
            if existing is None:
                return None
            conn.execute(
                """
                UPDATE tasks
                SET status=?, result_text=?, error_text=?, finished_at=?, updated_at=?
                WHERE task_id=?
                """,
                (status, result_text, error_text, ts, ts, task_id),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def mark_task_preview(
        self,
        *,
        task_id: str,
        preview_port: int,
        preview_url: Optional[str],
    ) -> Optional[TaskRecord]:
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET preview_port=?, preview_url=?, updated_at=?
                WHERE task_id=?
                """,
                (int(preview_port), preview_url, ts, task_id),
            )
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return None if row is None else self._row_to_task(row)

    def count_running_tasks_for_workspace(self, workspace_id: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM tasks
                WHERE workspace_id=? AND status='running'
                """,
                (workspace_id,),
            ).fetchone()
        return int(row["c"] if row else 0)

    def list_running_workspace_ids(self) -> List[str]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT workspace_id
                FROM tasks
                WHERE status='running' AND workspace_id IS NOT NULL AND workspace_id != ''
                """
            ).fetchall()
        return [str(row["workspace_id"]) for row in rows if row["workspace_id"]]

    def list_running_tasks_for_workspace(self, workspace_id: str) -> List[TaskRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM tasks
                WHERE workspace_id=? AND status='running'
                ORDER BY started_at ASC
                """,
                (workspace_id,),
            ).fetchall()
        return [self._row_to_task(row) for row in rows]

    def append_event(
        self,
        task_id: str,
        *,
        level: str,
        event_type: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        ts = self.now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO task_events (task_id, ts, level, event_type, message, data)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    ts,
                    level,
                    event_type,
                    message,
                    json.dumps(data or {}, ensure_ascii=True) if data is not None else None,
                ),
            )
            conn.execute(
                "UPDATE tasks SET updated_at=? WHERE task_id=?",
                (ts, task_id),
            )

    def list_events(
        self,
        task_id: str,
        *,
        after_id: int = 0,
        limit: int = 200,
        event_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        bounded = max(1, min(int(limit), 2000))
        filters = ["task_id = ?", "id > ?"]
        args: List[Any] = [task_id, max(0, int(after_id or 0))]

        wanted = [str(v).strip() for v in (event_types or []) if str(v).strip()]
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            filters.append(f"event_type IN ({placeholders})")
            args.extend(wanted)

        sql = (
            "SELECT id, task_id, ts, level, event_type, message, data "
            "FROM task_events "
            f"WHERE {' AND '.join(filters)} "
            "ORDER BY id ASC LIMIT ?"
        )
        args.append(bounded)

        with self._connect() as conn:
            rows = conn.execute(sql, tuple(args)).fetchall()

        out: List[Dict[str, Any]] = []
        for row in rows:
            data_raw = row["data"]
            out.append(
                {
                    "id": int(row["id"]),
                    "task_id": str(row["task_id"]),
                    "ts": str(row["ts"]),
                    "level": str(row["level"]),
                    "event_type": str(row["event_type"]),
                    "message": str(row["message"]),
                    "data": json.loads(data_raw or "{}"),
                }
            )
        return out


def workspace_to_dict(item: WorkspaceMapping) -> Dict[str, Any]:
    scope = "repo" if item.user_id == REPO_SCOPE_MAPPING_USER_ID else "user_repo"
    return {
        "user_id": item.user_id,
        "scope": scope,
        "mapping_user_id": item.user_id,
        "repo_id": item.repo_id,
        "repo_url": item.repo_url,
        "workspace_name": item.workspace_name,
        "workspace_owner": item.workspace_owner,
        "workspace_id": item.workspace_id,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def task_to_dict(item: TaskRecord) -> Dict[str, Any]:
    options = item.options if isinstance(item.options, dict) else {}
    model = (
        str(options.get("model") or "").strip()
        or str(options.get("provider_model") or "").strip()
        or str(options.get("runtime_model") or "").strip()
    )
    depends_on_task_ids = [
        str(value).strip()
        for value in (options.get("depends_on_task_ids") or [])
        if str(value).strip()
    ]
    file_claims = [
        str(value).strip()
        for value in (options.get("file_claims") or [])
        if str(value).strip()
    ]
    area_claims = [
        str(value).strip()
        for value in (options.get("area_claims") or [])
        if str(value).strip()
    ]
    return {
        "task_id": item.task_id,
        "user_id": item.user_id,
        "repo_id": item.repo_id,
        "repo_url": item.repo_url,
        "provider": item.provider,
        "model": model,
        "instruction": item.instruction,
        "zulip_thread_ref": item.zulip_thread_ref,
        "options": item.options,
        "topic_scope_id": item.topic_scope_id,
        "task_title": derive_task_title(item.instruction, item.options),
        "status": item.status,
        "cancel_requested": item.cancel_requested,
        "workspace_id": item.workspace_id,
        "workspace_name": item.workspace_name,
        "branch_name": item.branch_name,
        "worktree_path": item.worktree_path,
        "container_name": item.container_name,
        "container_runtime": item.container_runtime,
        "preview_port": item.preview_port,
        "preview_url": item.preview_url,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "started_at": item.started_at,
        "finished_at": item.finished_at,
        "worker_id": item.worker_id,
        "assigned_worker": item.assigned_worker,
        "assigned_role": item.assigned_role,
        "assigned_by": item.assigned_by,
        "directive_id": item.directive_id,
        "plan_revision_id": item.plan_revision_id,
        "result_text": item.result_text,
        "error_text": item.error_text,
        "blocked_reason": item.blocked_reason,
        "clarification_questions": item.clarification_questions,
        "clarification_requested": item.clarification_requested,
        "depends_on_task_ids": depends_on_task_ids,
        "file_claims": file_claims,
        "area_claims": area_claims,
        "approved": item.approved,
    }


def worker_session_to_dict(item: WorkerSessionRecord) -> Dict[str, Any]:
    return {
        "worker_session_id": item.worker_session_id,
        "task_id": item.task_id,
        "topic_scope_id": item.topic_scope_id,
        "status": item.status,
        "activity": item.activity,
        "provider": item.provider,
        "assigned_worker": item.assigned_worker,
        "assigned_role": item.assigned_role,
        "workspace_id": item.workspace_id,
        "workspace_name": item.workspace_name,
        "branch_name": item.branch_name,
        "worktree_path": item.worktree_path,
        "container_name": item.container_name,
        "container_runtime": item.container_runtime,
        "runtime_handle": item.runtime_handle,
        "attach_info": item.attach_info,
        "pr_url": item.pr_url,
        "ci_status": item.ci_status,
        "review_status": item.review_status,
        "mergeability": item.mergeability,
        "last_event_type": item.last_event_type,
        "last_event_ts": item.last_event_ts,
        "restored_at": item.restored_at,
        "metadata": item.metadata,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def plan_revision_to_dict(item: PlanRevisionRecord) -> Dict[str, Any]:
    return {
        "plan_revision_id": item.plan_revision_id,
        "topic_scope_id": item.topic_scope_id,
        "session_id": item.session_id,
        "author_id": item.author_id,
        "summary": item.summary,
        "objective": item.objective,
        "assumptions": item.assumptions,
        "unknowns": item.unknowns,
        "execution_steps": item.execution_steps,
        "candidate_parallel_seams": item.candidate_parallel_seams,
        "approval_points": item.approval_points,
        "status": item.status,
        "source": item.source,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _masked_secret_value(value: str) -> str:
    raw = str(value or "").strip()
    if len(raw) <= 6:
        return "*" * len(raw)
    return f"{raw[:3]}...{raw[-3:]}"


def provider_credential_to_dict(
    item: ProviderCredentialRecord,
    *,
    include_secret: bool = False,
) -> Dict[str, Any]:
    out = {
        "user_id": item.user_id,
        "provider": item.provider,
        "auth_mode": item.auth_mode,
        "label": item.label,
        "metadata": item.metadata,
        "status": item.status,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }
    if include_secret:
        out["secret"] = item.secret
    else:
        preview: Dict[str, Any] = {}
        for key in ("api_key", "access_token", "refresh_token"):
            raw = str(item.secret.get(key) or "").strip()
            if raw:
                preview[key] = _masked_secret_value(raw)
        if preview:
            out["secret_preview"] = preview
    return out


def integration_credential_to_dict(
    item: IntegrationCredentialRecord,
    *,
    include_secret: bool = False,
) -> Dict[str, Any]:
    out = {
        "user_id": item.user_id,
        "integration": item.integration,
        "auth_mode": item.auth_mode,
        "label": item.label,
        "metadata": item.metadata,
        "status": item.status,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }
    if include_secret:
        out["secret"] = item.secret
    else:
        preview: Dict[str, Any] = {}
        for key in ("api_key", "access_token", "refresh_token", "token"):
            raw = str(item.secret.get(key) or "").strip()
            if raw:
                preview[key] = _masked_secret_value(raw)
        if preview:
            out["secret_preview"] = preview
    return out


def integration_policy_to_dict(item: IntegrationPolicyRecord) -> Dict[str, Any]:
    return {
        "user_id": item.user_id,
        "policy": item.policy,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def supervisor_session_to_dict(item: SupervisorSessionRecord) -> Dict[str, Any]:
    return {
        "session_id": item.session_id,
        "topic_scope_id": item.topic_scope_id,
        "status": item.status,
        "metadata": item.metadata,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def supervisor_event_to_dict(item: SupervisorEventRecord) -> Dict[str, Any]:
    return {
        "id": item.id,
        "topic_scope_id": item.topic_scope_id,
        "session_id": item.session_id,
        "ts": item.ts,
        "kind": item.kind,
        "role": item.role,
        "author_id": item.author_id,
        "author_name": item.author_name,
        "content_md": item.content_md,
        "payload": item.payload,
        "client_msg_id": item.client_msg_id,
    }
