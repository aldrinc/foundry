use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Emitter, Manager, State, Url, WebviewUrl};

use crate::server::load_desktop_settings;
use crate::zulip::types::*;
use crate::zulip::ZulipClient;
use crate::AppState;

const AUTH_CALLBACK_EVENT: &str = "deep-link://new-url";
const AUTH_WINDOW_LABEL_PREFIX: &str = "sso-auth-";
static AUTH_WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

fn next_auth_window_label() -> String {
    format!(
        "{AUTH_WINDOW_LABEL_PREFIX}{}",
        AUTH_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn is_sso_callback_url(url: &Url) -> bool {
    matches!(url.scheme(), "zulip" | "foundry")
        && (url.host_str() == Some("login") || url.path() == "/login")
}

fn close_auth_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(AUTH_WINDOW_LABEL_PREFIX) {
            let _ = window.close();
        }
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_sso_callback(app: tauri::AppHandle, callback_url: String) {
    let _ = app.emit(AUTH_CALLBACK_EVENT, vec![callback_url]);
    focus_main_window(&app);
    close_auth_windows(&app);
}

fn build_auth_window(
    app: &tauri::AppHandle,
    label: String,
    url: Url,
    features: Option<NewWindowFeatures>,
) -> Result<tauri::WebviewWindow, String> {
    let app_for_navigation = app.clone();
    let app_for_new_window = app.clone();

    let mut builder =
        tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.clone()))
            .title("Sign in")
            .inner_size(480.0, 720.0)
            .min_inner_size(420.0, 600.0)
            .center()
            .focused(true)
            .resizable(true)
            .on_document_title_changed(|window, title| {
                let _ = window.set_title(&title);
            })
            .on_navigation(move |next_url| {
                if !is_sso_callback_url(next_url) {
                    return true;
                }

                let callback_url = next_url.to_string();
                let app = app_for_navigation.clone();
                tauri::async_runtime::spawn(async move {
                    handle_sso_callback(app, callback_url);
                });
                false
            })
            .on_new_window(move |next_url, features| {
                match build_auth_window(
                    &app_for_new_window,
                    next_auth_window_label(),
                    next_url,
                    Some(features),
                ) {
                    Ok(window) => NewWindowResponse::Create { window },
                    Err(error) => {
                        tracing::warn!(?error, "Failed to open SSO popup window");
                        NewWindowResponse::Deny
                    }
                }
            });

    if let Some(features) = features {
        builder = builder.window_features(features);
    }

    builder
        .build()
        .map_err(|error| format!("Failed to open sign-in window: {error}"))
}

async fn connect_with_api_key(
    app: tauri::AppHandle,
    state: &AppState,
    url: &str,
    email: &str,
    api_key: &str,
) -> Result<LoginResult, String> {
    let settings = load_desktop_settings(&app)?;
    let client = ZulipClient::with_desktop_settings(url, email, api_key, settings)?;

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
        realm_url: if settings.realm_url.is_empty() {
            url.trim_end_matches('/').to_string()
        } else {
            settings.realm_url
        },
        queue_id: reg.queue_id,
        user_id: reg.user_id,
        subscriptions: reg.subscriptions,
        users: reg.realm_users,
        user_topics: reg.user_topics,
        unread_msgs: reg.unread_msgs,
        recent_private_conversations: reg.recent_private_conversations,
    })
}

/// GET /api/v1/server_settings (unauthenticated)
/// Discovers server capabilities and authentication methods
#[tauri::command]
#[specta::specta]
pub async fn get_server_settings(
    app: tauri::AppHandle,
    url: String,
) -> Result<ServerSettings, String> {
    let settings = load_desktop_settings(&app)?;
    let client = ZulipClient::with_desktop_settings(&url, "", "", settings)?;
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
    connect_with_api_key(app, state.inner(), &url, &email, &api_key).await
}

/// Exchange a password for an API key using Zulip's fetch_api_key endpoint
#[tauri::command]
#[specta::specta]
pub async fn fetch_api_key(
    app: tauri::AppHandle,
    url: String,
    username: String,
    password: String,
) -> Result<FetchApiKeyResult, String> {
    let settings = load_desktop_settings(&app)?;
    let client = ZulipClient::with_desktop_settings(&url, "", "", settings)?;
    client.fetch_api_key(&username, &password).await
}

/// Open an app-owned sign-in window for Zulip external authentication flows.
#[tauri::command]
#[specta::specta]
pub async fn open_external_auth_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed_url = Url::parse(&url).map_err(|error| format!("Invalid sign-in URL: {error}"))?;

    close_auth_windows(&app);
    focus_main_window(&app);
    build_auth_window(&app, next_auth_window_label(), parsed_url, None)?;

    Ok(())
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

/// Save bytes to a temporary file and return its path (for paste/drag-drop uploads)
#[tauri::command]
#[specta::specta]
pub async fn save_temp_file(file_name: String, data: Vec<u8>) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("foundry-uploads");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let sanitized = file_name.replace(['/', '\\', '\0'], "_");
    let temp_path = temp_dir.join(&sanitized);

    tokio::fs::write(&temp_path, &data)
        .await
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    temp_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid temp path".to_string())
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

/// Fetch an authenticated media URL and convert it to a data URL for the webview.
#[tauri::command]
#[specta::specta]
pub async fn fetch_authenticated_media_data_url(
    state: State<'_, AppState>,
    org_id: String,
    media_url: String,
) -> Result<String, String> {
    let client = get_client(&state, &org_id)?;
    client.fetch_authenticated_media_data_url(&media_url).await
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

/// Update one or more subscription properties for channels the user is subscribed to.
#[tauri::command]
#[specta::specta]
pub async fn update_subscription_properties(
    state: State<'_, AppState>,
    org_id: String,
    subscription_data: Vec<SubscriptionPropertyChange>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .update_subscription_properties(&subscription_data)
        .await
}

/// Update the current user's topic visibility policy within a channel.
#[tauri::command]
#[specta::specta]
pub async fn update_topic_visibility_policy(
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
    topic: String,
    visibility_policy: UserTopicVisibilityPolicy,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .update_topic_visibility_policy(stream_id, &topic, visibility_policy)
        .await
}

/// Move or rename all messages in a topic.
#[tauri::command]
#[specta::specta]
pub async fn move_topic(
    state: State<'_, AppState>,
    org_id: String,
    request: MoveTopicRequest,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.move_topic(&request).await
}

/// Resolve or unresolve all messages in a topic.
#[tauri::command]
#[specta::specta]
pub async fn set_topic_resolved(
    state: State<'_, AppState>,
    org_id: String,
    request: ResolveTopicRequest,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.set_topic_resolved(&request).await
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

#[cfg(test)]
mod tests {
    use super::is_sso_callback_url;
    use tauri::Url;

    #[test]
    fn recognizes_zulip_mobile_flow_callbacks() {
        let url = Url::parse("zulip://login?realm=https%3A%2F%2Fchat.example.invalid").unwrap();
        assert!(is_sso_callback_url(&url));
    }

    #[test]
    fn recognizes_foundry_mobile_flow_callbacks() {
        let url = Url::parse("foundry://login?realm=https%3A%2F%2Fchat.example.invalid").unwrap();
        assert!(is_sso_callback_url(&url));
    }

    #[test]
    fn ignores_regular_https_navigation() {
        let url = Url::parse("https://accounts.google.com/o/oauth2/auth").unwrap();
        assert!(!is_sso_callback_url(&url));
    }
}
