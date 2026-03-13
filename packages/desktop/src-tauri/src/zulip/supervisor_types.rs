use serde::{Deserialize, Serialize};

/// Metadata about the supervisor session engine
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct SupervisorSessionMetadata {
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub moltis_model: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub created_by_user_id: Option<String>,
    #[serde(default)]
    pub created_by_name: Option<String>,
    #[serde(default)]
    pub created_via: Option<String>,
}

/// A supervisor session tied to a topic scope
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorSession {
    pub session_id: String,
    pub topic_scope_id: String,
    pub status: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub metadata: SupervisorSessionMetadata,
}

/// A single event in the supervisor timeline
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorEvent {
    pub id: i64,
    pub topic_scope_id: String,
    pub session_id: String,
    pub ts: String,
    /// Event kind: "message", "thinking", "tool_call", "tool_result",
    /// "execution_result", "plan_draft", "assistant"
    pub kind: String,
    /// Role: "user", "assistant", "system"
    pub role: String,
    #[serde(default)]
    pub author_id: Option<String>,
    #[serde(default)]
    pub author_name: Option<String>,
    #[serde(default)]
    pub content_md: String,
    /// Polymorphic payload - structure varies by event kind
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub client_msg_id: Option<String>,
}

/// Response from GET /json/foundry/topics/{scope}/supervisor/session
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorSessionResponse {
    #[serde(default)]
    pub session: Option<SupervisorSession>,
    #[serde(default)]
    pub sessions: Vec<SupervisorSession>,
    #[serde(default)]
    pub events: Vec<SupervisorEvent>,
    #[serde(default)]
    pub task_summary: Option<SupervisorTaskSummary>,
    #[serde(default)]
    pub runtime_projection: Option<RuntimeProjection>,
}

/// Response from POST /json/foundry/topics/{scope}/supervisor/message
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorMessageResponse {
    #[serde(default)]
    pub session: Option<SupervisorSession>,
    #[serde(default)]
    pub sessions: Vec<SupervisorSession>,
    #[serde(default)]
    pub events: Vec<SupervisorEvent>,
    #[serde(default)]
    pub task_summary: Option<SupervisorTaskSummary>,
    #[serde(default)]
    pub runtime_projection: Option<RuntimeProjection>,
}

/// Condensed task dashboard state returned with supervisor session snapshots
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct SupervisorTaskSummary {
    #[serde(default)]
    pub active_plan_revision_id: Option<String>,
    #[serde(default)]
    pub filtered_plan_revision_id: Option<String>,
    #[serde(default)]
    pub tasks: Vec<SupervisorTask>,
    #[serde(default)]
    pub task_count: Option<u32>,
    #[serde(default)]
    pub counts: Option<serde_json::Value>,
    #[serde(default)]
    pub all_task_count: Option<u32>,
    #[serde(default)]
    pub all_counts: Option<serde_json::Value>,
    #[serde(default)]
    pub completion_follow_up_required: Option<bool>,
    #[serde(default)]
    pub completion_missing_evidence: Option<Vec<String>>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub runtime_state: Option<serde_json::Value>,
}

/// Typed projection of the orchestrator runtime payload.
/// Consumed by the desktop app for runtime-first UI surfaces.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct RuntimeProjection {
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub phase_reason: Option<String>,
    #[serde(default)]
    pub approval_required: Option<bool>,
    #[serde(default)]
    pub clarification_required: Option<bool>,
    #[serde(default)]
    pub execution_requested: Option<bool>,
    #[serde(default)]
    pub execution_prerequisites_ready: Option<bool>,
    #[serde(default)]
    pub execution_blockers: Option<Vec<String>>,
    #[serde(default)]
    pub completion_follow_up_required: Option<bool>,
    #[serde(default)]
    pub completion_missing_evidence: Option<Vec<String>>,
    #[serde(default)]
    pub observed_artifacts: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub repo_attachment: Option<serde_json::Value>,
    #[serde(default)]
    pub worker_backend_ready: Option<bool>,
    #[serde(default)]
    pub active_plan_revision_id: Option<String>,
    #[serde(default)]
    pub contract: Option<serde_json::Value>,
    #[serde(default)]
    pub runtime_state: Option<serde_json::Value>,
}

/// A task entry from the supervisor sidebar/dashboard
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorTask {
    pub task_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub assigned_role: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub activity: Option<String>,
    #[serde(default)]
    pub last_updated: Option<String>,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub turns_used: Option<u32>,
    #[serde(default)]
    pub tokens_used: Option<u64>,
    #[serde(default)]
    pub usd_estimate: Option<f64>,
    #[serde(default)]
    pub result_text: Option<String>,
    #[serde(default)]
    pub error_text: Option<String>,
    #[serde(default)]
    pub clarification_requested: bool,
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub artifacts: Vec<serde_json::Value>,
    #[serde(default)]
    pub blockers: Vec<String>,
}

/// Response from GET /json/foundry/topics/{scope}/sidebar
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SupervisorSidebarResponse {
    #[serde(default)]
    pub tasks: Vec<SupervisorTask>,
}

/// Task event from the task event stream
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TaskEvent {
    pub id: i64,
    pub task_id: String,
    pub ts: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub event_type: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Response from GET /json/foundry/topics/{scope}/tasks/{task_id}/events
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TaskEventsResponse {
    pub task_id: String,
    #[serde(default)]
    pub events: Vec<TaskEvent>,
}

/// A connected provider credential preview returned by the provider auth API
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FoundryProviderCredential {
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Provider authentication entry
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FoundryProviderAuth {
    pub provider: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub auth_modes: Vec<String>,
    #[serde(default)]
    pub oauth_configured: bool,
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub credential: Option<FoundryProviderCredential>,
    #[serde(default)]
    pub credential_status: Option<String>,
}

/// Response from GET /json/foundry/providers/auth
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FoundryProvidersResponse {
    #[serde(default)]
    pub providers: Vec<FoundryProviderAuth>,
}

/// Response from POST /json/foundry/providers/connect or /disconnect
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FoundryProviderCredentialResponse {
    pub provider: String,
    #[serde(default)]
    pub credential: Option<FoundryProviderCredential>,
}

/// Response from POST /json/foundry/providers/oauth/start
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FoundryProviderOauthStartResponse {
    pub provider: String,
    #[serde(default)]
    pub authorize_url: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub redirect_uri: Option<String>,
}
