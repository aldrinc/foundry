use serde::Deserialize;
use tauri::State;

use crate::codex_oauth;
use crate::commands::{get_client, with_org_client};
use crate::zulip::supervisor_types::*;
use crate::AppState;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorMessageCommand {
    pub topic_scope_id: String,
    pub message: String,
    pub session_id: Option<String>,
    pub session_create_mode: Option<String>,
    pub session_title: Option<String>,
    pub client_msg_id: String,
    pub stream_id: Option<u64>,
    pub stream_name: Option<String>,
    pub topic: Option<String>,
}

/// Poll supervisor session state and events
#[tauri::command]
#[specta::specta]
pub async fn get_supervisor_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    session_id: Option<String>,
    after_id: i64,
    limit: u32,
) -> Result<SupervisorSessionResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .get_supervisor_session(&topic_scope_id, session_id.as_deref(), after_id, limit)
            .await
    })
    .await
}

/// Send a message to the supervisor
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn post_supervisor_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    request: SupervisorMessageCommand,
) -> Result<SupervisorMessageResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .post_supervisor_message(
                &request.topic_scope_id,
                &request.message,
                request.session_id.as_deref(),
                request.session_create_mode.as_deref(),
                request.session_title.as_deref(),
                &request.client_msg_id,
                request.stream_id,
                request.stream_name.as_deref(),
                request.topic.as_deref(),
            )
            .await
    })
    .await
}

/// Get task list for the supervisor dashboard
#[tauri::command]
#[specta::specta]
pub async fn get_supervisor_sidebar(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    session_id: Option<String>,
) -> Result<SupervisorSidebarResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .get_supervisor_sidebar(&topic_scope_id, session_id.as_deref())
            .await
    })
    .await
}

/// Control a task (pause/resume/cancel)
#[tauri::command]
#[specta::specta]
pub async fn control_supervisor_task(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    task_id: String,
    action: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .control_supervisor_task(&topic_scope_id, &task_id, &action)
            .await
    })
    .await
}

/// Reply to a task clarification question
#[tauri::command]
#[specta::specta]
pub async fn reply_to_task_clarification(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    task_id: String,
    message: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .reply_to_task_clarification(&topic_scope_id, &task_id, &message)
            .await
    })
    .await
}

/// Get available AI providers and their auth status
#[tauri::command]
#[specta::specta]
pub async fn get_foundry_providers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
) -> Result<FoundryProvidersResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.get_foundry_providers().await
    })
    .await
}

/// Connect a Foundry provider using an API key credential
#[tauri::command]
#[specta::specta]
pub async fn connect_foundry_provider(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    provider: String,
    api_key: String,
    label: Option<String>,
) -> Result<FoundryProviderCredentialResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .connect_foundry_provider(&provider, &api_key, label.as_deref())
            .await
    })
    .await
}

/// Disconnect a Foundry provider credential
#[tauri::command]
#[specta::specta]
pub async fn disconnect_foundry_provider(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    provider: String,
) -> Result<FoundryProviderCredentialResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.disconnect_foundry_provider(&provider).await
    })
    .await
}

/// Connect a Foundry provider using a desktop-native OAuth flow
#[tauri::command]
#[specta::specta]
pub async fn connect_foundry_provider_desktop_oauth(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    provider: String,
) -> Result<FoundryProviderCredentialResponse, String> {
    let normalized_provider = provider.trim().to_lowercase();
    let app_handle = app.clone();
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        match normalized_provider.as_str() {
            "codex" => codex_oauth::connect_codex_oauth(&app_handle, client).await,
            _ => Err(format!(
                "Desktop OAuth is not supported for provider '{}'",
                normalized_provider
            )),
        }
    })
    .await
}

/// Start a Foundry provider OAuth flow
#[tauri::command]
#[specta::specta]
pub async fn start_foundry_provider_oauth(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    provider: String,
    redirect_uri: Option<String>,
) -> Result<FoundryProviderOauthStartResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .start_foundry_provider_oauth(&provider, redirect_uri.as_deref())
            .await
    })
    .await
}

/// Get events for a specific task
#[tauri::command]
#[specta::specta]
pub async fn get_task_events(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    topic_scope_id: String,
    task_id: String,
    after_id: i64,
    limit: u32,
) -> Result<TaskEventsResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .get_task_events(&topic_scope_id, &task_id, after_id, limit)
            .await
    })
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
    session_id: Option<String>,
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
            session_id,
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
