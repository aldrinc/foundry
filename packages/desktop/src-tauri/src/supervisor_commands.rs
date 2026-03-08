use tauri::State;

use crate::commands::get_client;
use crate::zulip::supervisor_types::*;
use crate::AppState;

/// Poll supervisor session state and events
#[tauri::command]
#[specta::specta]
pub async fn get_supervisor_session(
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    after_id: i64,
    limit: u32,
) -> Result<SupervisorSessionResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .get_supervisor_session(&topic_scope_id, after_id, limit)
        .await
}

/// Send a message to the supervisor
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn post_supervisor_message(
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    message: String,
    client_msg_id: String,
    stream_id: Option<u64>,
    stream_name: Option<String>,
    topic: Option<String>,
) -> Result<SupervisorMessageResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .post_supervisor_message(
            &topic_scope_id,
            &message,
            &client_msg_id,
            stream_id,
            stream_name.as_deref(),
            topic.as_deref(),
        )
        .await
}

/// Get task list for the supervisor dashboard
#[tauri::command]
#[specta::specta]
pub async fn get_supervisor_sidebar(
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
) -> Result<SupervisorSidebarResponse, String> {
    let client = get_client(&state, &org_id)?;
    client.get_supervisor_sidebar(&topic_scope_id).await
}

/// Control a task (pause/resume/cancel)
#[tauri::command]
#[specta::specta]
pub async fn control_supervisor_task(
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    task_id: String,
    action: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .control_supervisor_task(&topic_scope_id, &task_id, &action)
        .await
}

/// Reply to a task clarification question
#[tauri::command]
#[specta::specta]
pub async fn reply_to_task_clarification(
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    task_id: String,
    message: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .reply_to_task_clarification(&topic_scope_id, &task_id, &message)
        .await
}

/// Get available AI providers and their auth status
#[tauri::command]
#[specta::specta]
pub async fn get_meridian_providers(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<MeridianProvidersResponse, String> {
    let client = get_client(&state, &org_id)?;
    client.get_meridian_providers().await
}

/// Get events for a specific task
#[tauri::command]
#[specta::specta]
pub async fn get_task_events(
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    task_id: String,
    after_id: i64,
    limit: u32,
) -> Result<TaskEventsResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .get_task_events(&topic_scope_id, &task_id, after_id, limit)
        .await
}

/// Start the supervisor SSE event stream for a topic.
/// This connects to the Zulip server's SSE proxy endpoint and emits
/// Tauri events as new supervisor events arrive in real time.
#[tauri::command]
#[specta::specta]
pub async fn start_supervisor_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    after_id: i64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;

    // Stop any existing supervisor stream for this org
    {
        let mut orgs = state
            .orgs
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(org) = orgs.get_mut(&org_id) {
            if let Some(task) = org.supervisor_task.take() {
                task.abort();
            }
        }
    }

    // Spawn the SSE event loop as a background task
    let stream_org_id = org_id.clone();
    let task = tokio::spawn(async move {
        crate::zulip::supervisor_events::start_supervisor_stream(
            app,
            client,
            stream_org_id,
            topic_scope_id,
            after_id,
        )
        .await;
    });

    // Store the task handle so we can abort it later
    {
        let mut orgs = state
            .orgs
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(org) = orgs.get_mut(&org_id) {
            org.supervisor_task = Some(task);
        }
    }

    Ok(())
}

/// Stop the supervisor SSE event stream for an org.
#[tauri::command]
#[specta::specta]
pub async fn stop_supervisor_stream(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<(), String> {
    let mut orgs = state
        .orgs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(org) = orgs.get_mut(&org_id) {
        if let Some(task) = org.supervisor_task.take() {
            task.abort();
        }
    }
    Ok(())
}
