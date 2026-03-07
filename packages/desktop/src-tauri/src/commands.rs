use tauri::State;

use crate::zulip::types::*;
use crate::zulip::ZulipClient;
use crate::AppState;

/// GET /api/v1/server_settings (unauthenticated)
/// Discovers server capabilities and authentication methods
#[tauri::command]
#[specta::specta]
pub async fn get_server_settings(url: String) -> Result<ServerSettings, String> {
    let client = ZulipClient::new(&url, "", "");
    client.server_settings().await
}

/// Authenticate with a Zulip server and start the event queue
#[tauri::command]
#[specta::specta]
pub async fn login(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    email: String,
    api_key: String,
) -> Result<LoginResult, String> {
    let client = ZulipClient::new(&url, &email, &api_key);

    // Validate credentials by fetching server settings
    let settings = client.server_settings().await?;

    // Register the event queue
    let reg = client.register_queue().await?;

    // Generate an org ID from the URL
    let org_id = url
        .replace("https://", "")
        .replace("http://", "")
        .replace('/', "_");

    // Start background event polling
    let event_client = client.clone();
    let event_org_id = org_id.clone();
    let event_queue_id = reg.queue_id.clone();
    let event_last_id = reg.last_event_id;

    let task = tokio::spawn(async move {
        crate::zulip::events::start_event_loop(
            app.clone(),
            event_client,
            event_org_id,
            event_queue_id,
            event_last_id,
        )
        .await;
    });

    // Store the org state
    {
        let mut orgs = state
            .orgs
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        orgs.insert(
            org_id.clone(),
            crate::OrgState {
                client,
                event_task: Some(task),
                queue_id: Some(reg.queue_id.clone()),
                supervisor_task: None,
            },
        );
    }

    Ok(LoginResult {
        org_id,
        realm_name: settings.realm_name,
        realm_icon: settings.realm_icon,
        queue_id: reg.queue_id,
        user_id: reg.user_id,
        subscriptions: reg.subscriptions,
        users: reg.realm_users,
    })
}

/// Disconnect from a Zulip server
#[tauri::command]
#[specta::specta]
pub async fn logout(state: State<'_, AppState>, org_id: String) -> Result<(), String> {
    let mut orgs = state
        .orgs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(org) = orgs.remove(&org_id) {
        if let Some(task) = org.event_task {
            task.abort();
        }
        if let Some(task) = org.supervisor_task {
            task.abort();
        }
    }
    Ok(())
}

/// Fetch messages with narrow filters
#[tauri::command]
#[specta::specta]
pub async fn get_messages(
    state: State<'_, AppState>,
    org_id: String,
    narrow: Vec<NarrowFilter>,
    anchor: String,
    num_before: u32,
    num_after: u32,
) -> Result<MessageResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .get_messages(&narrow, &anchor, num_before, num_after)
        .await
}

/// Send a message
#[tauri::command]
#[specta::specta]
pub async fn send_message(
    state: State<'_, AppState>,
    org_id: String,
    msg_type: String,
    to: String,
    content: String,
    topic: Option<String>,
) -> Result<SendResult, String> {
    let client = get_client(&state, &org_id)?;
    client
        .send_message(&msg_type, &to, &content, topic.as_deref())
        .await
}

/// Edit a message
#[tauri::command]
#[specta::specta]
pub async fn edit_message(
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
    content: Option<String>,
    topic: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .edit_message(message_id, content.as_deref(), topic.as_deref())
        .await
}

/// Delete a message
#[tauri::command]
#[specta::specta]
pub async fn delete_message(
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.delete_message(message_id).await
}

/// Add an emoji reaction
#[tauri::command]
#[specta::specta]
pub async fn add_reaction(
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
    emoji_name: String,
    emoji_code: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .add_reaction(message_id, &emoji_name, &emoji_code)
        .await
}

/// Remove an emoji reaction
#[tauri::command]
#[specta::specta]
pub async fn remove_reaction(
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
    emoji_name: String,
    emoji_code: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .remove_reaction(message_id, &emoji_name, &emoji_code)
        .await
}

/// Update own presence status
#[tauri::command]
#[specta::specta]
pub async fn update_presence(
    state: State<'_, AppState>,
    org_id: String,
    status: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.update_presence(&status).await
}

/// Send typing notification
/// `to` is a JSON string — either a JSON array of user IDs for DMs
/// or a single stream ID string for stream typing
#[tauri::command]
#[specta::specta]
pub async fn send_typing(
    state: State<'_, AppState>,
    org_id: String,
    op: String,
    typing_type: String,
    to: String,
    topic: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .send_typing(&op, &typing_type, &to, topic.as_deref())
        .await
}

/// Upload a file
#[tauri::command]
#[specta::specta]
pub async fn upload_file(
    state: State<'_, AppState>,
    org_id: String,
    file_path: String,
) -> Result<UploadResult, String> {
    let client = get_client(&state, &org_id)?;

    let file_bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload")
        .to_string();

    client.upload_file(file_bytes, &file_name).await
}

/// Update message flags (read, starred, etc.)
#[tauri::command]
#[specta::specta]
pub async fn update_message_flags(
    state: State<'_, AppState>,
    org_id: String,
    messages: Vec<u64>,
    op: String,
    flag: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.update_flags(&messages, &op, &flag).await
}

/// Mark all messages in a stream as read
#[tauri::command]
#[specta::specta]
pub async fn mark_stream_as_read(
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.mark_stream_as_read(stream_id).await
}

/// Mark all messages in a topic as read
#[tauri::command]
#[specta::specta]
pub async fn mark_topic_as_read(
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
    topic_name: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.mark_topic_as_read(stream_id, &topic_name).await
}

/// Get topics within a stream
#[tauri::command]
#[specta::specta]
pub async fn get_stream_topics(
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
) -> Result<Vec<Topic>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_stream_topics(stream_id).await
}

/// Subscribe to streams
#[tauri::command]
#[specta::specta]
pub async fn subscribe_stream(
    state: State<'_, AppState>,
    org_id: String,
    stream_names: Vec<String>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.subscribe(&stream_names).await
}

/// Unsubscribe from streams
#[tauri::command]
#[specta::specta]
pub async fn unsubscribe_stream(
    state: State<'_, AppState>,
    org_id: String,
    stream_names: Vec<String>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.unsubscribe(&stream_names).await
}

/// Update Zulip user settings (syncs to server)
/// `settings_json` is a JSON string with Zulip API key names, e.g. `{"enter_sends": true}`
#[tauri::command]
#[specta::specta]
pub async fn update_zulip_settings(
    state: State<'_, AppState>,
    org_id: String,
    settings_json: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.update_user_settings(&settings_json).await
}

/// Fetch current Zulip user settings from server
#[tauri::command]
#[specta::specta]
pub async fn get_zulip_settings(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<String, String> {
    let client = get_client(&state, &org_id)?;
    client.get_user_settings().await
}

/// Helper: Get a cloned ZulipClient for an org
pub fn get_client(state: &AppState, org_id: &str) -> Result<ZulipClient, String> {
    let orgs = state
        .orgs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let org = orgs
        .get(org_id)
        .ok_or_else(|| format!("Not connected to org: {}", org_id))?;
    Ok(org.client.clone())
}
