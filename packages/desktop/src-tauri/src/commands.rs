use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{Emitter, Manager, State, Url, WebviewUrl};

use crate::server::load_desktop_settings;
use crate::zulip::types::*;
use crate::zulip::{is_auth_failure_message, sanitize_event_id, ZulipClient};
use crate::AppState;

const AUTH_CALLBACK_EVENT: &str = "deep-link://new-url";
const AUTH_WINDOW_LABEL_PREFIX: &str = "sso-auth-";
const FOUNDRY_CLOUD_LOGIN_TITLE: &str = "Foundry Cloud Login";
const MAX_PRIORITY_CANDIDATES: usize = 8;
const MAX_PRIORITY_MESSAGES: u32 = 8;
const MAX_DISCOVERY_MESSAGES: u32 = 80;
const MAX_PRIORITY_SUMMARY_CANDIDATES: usize = 4;
const MAX_PRIORITY_EXCERPT_LENGTH: usize = 220;
const MAX_PRIORITY_SUMMARY_LENGTH: usize = 280;
static AUTH_WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

#[derive(Debug, Clone)]
struct PriorityMessageContext {
    id: u64,
    sender_name: String,
    content: String,
    timestamp: i64,
}

pub(crate) fn next_auth_window_label() -> String {
    format!(
        "{AUTH_WINDOW_LABEL_PREFIX}{}",
        AUTH_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn looks_like_foundry_cloud_login_html(body: &str) -> bool {
    body.contains(FOUNDRY_CLOUD_LOGIN_TITLE)
}

async fn explain_server_settings_error(client: &ZulipClient, error: String) -> String {
    if !error.contains("404") {
        return error;
    }

    match client.get_unauth("/login").send().await {
        Ok(response) if response.status().is_success() => match response.text().await {
            Ok(body) if looks_like_foundry_cloud_login_html(&body) => {
                "This URL is a Foundry server control plane, not a tenant organization URL. Use your organization URL here.".to_string()
            }
            _ => error,
        },
        _ => error,
    }
}

fn is_sso_callback_url(url: &Url) -> bool {
    matches!(url.scheme(), "zulip" | "foundry")
        && (url.host_str() == Some("login") || url.path() == "/login")
}

pub(crate) fn close_auth_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(AUTH_WINDOW_LABEL_PREFIX) {
            let _ = window.close();
        }
    }
}

pub(crate) fn focus_main_window(app: &tauri::AppHandle) {
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

pub(crate) fn build_auth_window(
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
                current_user_id: reg.user_id,
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

async fn parse_inbox_assistant_response(
    response: reqwest::Response,
    operation: &str,
) -> Result<InboxSecretarySession, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read {operation} response: {error}"))?;
    if !status.is_success() {
        return Err(format!("{operation} failed ({}): {}", status, body.trim()));
    }

    serde_json::from_str::<InboxSecretarySession>(&body).map_err(|error| {
        format!(
            "Failed to parse {operation} response: {error}. Body: {}",
            body.trim()
        )
    })
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_html(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut tag = String::new();
    let mut in_tag = false;

    for ch in value.chars() {
        if in_tag {
            if ch == '>' {
                let normalized = tag.trim().to_ascii_lowercase();
                if matches!(
                    normalized.as_str(),
                    "br" | "br/" | "/p" | "/div" | "/li" | "/ul" | "/ol" | "/blockquote"
                ) {
                    output.push(' ');
                }
                tag.clear();
                in_tag = false;
            } else {
                tag.push(ch);
            }
            continue;
        }

        if ch == '<' {
            in_tag = true;
            continue;
        }

        output.push(ch);
    }

    collapse_whitespace(
        &output
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'"),
    )
}

fn truncate_text(value: &str, limit: usize) -> String {
    let normalized = collapse_whitespace(value);
    let char_count = normalized.chars().count();
    if char_count <= limit {
        return normalized;
    }

    normalized
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>()
        .trim_end()
        .to_string()
        + "..."
}

fn build_priority_narrow(candidate: &InboxPriorityCandidate) -> Result<Vec<NarrowFilter>, String> {
    if candidate.kind == "stream" {
        let stream_id = candidate
            .stream_id
            .ok_or_else(|| format!("Missing stream_id for candidate {}", candidate.id))?;
        let stream_operand = candidate
            .stream_name
            .as_ref()
            .filter(|name| !name.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| stream_id.to_string());
        let mut narrow = vec![NarrowFilter {
            operator: "stream".to_string(),
            operand: NarrowOperand::Text(stream_operand),
        }];
        if let Some(topic) = candidate
            .topic
            .as_ref()
            .filter(|topic| !topic.trim().is_empty())
        {
            narrow.push(NarrowFilter {
                operator: "topic".to_string(),
                operand: NarrowOperand::Text(topic.to_string()),
            });
        }
        return Ok(narrow);
    }

    let user_ids = candidate
        .user_ids
        .clone()
        .filter(|user_ids| !user_ids.is_empty())
        .ok_or_else(|| format!("Missing user_ids for candidate {}", candidate.id))?;

    Ok(vec![NarrowFilter {
        operator: "dm".to_string(),
        operand: NarrowOperand::UserIds(user_ids),
    }])
}

async fn fetch_priority_messages(
    client: &ZulipClient,
    candidate: &InboxPriorityCandidate,
) -> Result<Vec<PriorityMessageContext>, String> {
    let narrow = build_priority_narrow(candidate)?;
    let response = client
        .get_messages(&narrow, "newest", MAX_PRIORITY_MESSAGES, 0)
        .await?;

    Ok(response
        .messages
        .into_iter()
        .map(|message| PriorityMessageContext {
            id: message.id,
            sender_name: collapse_whitespace(&message.sender_full_name),
            content: truncate_text(&strip_html(&message.content), 1200),
            timestamp: message.timestamp as i64,
        })
        .collect())
}

fn status_rank(status: &str) -> u8 {
    match status {
        "needs_decision" => 4,
        "needs_reply" => 3,
        "follow_up" => 2,
        _ => 1,
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn infer_priority_status(
    candidate: &InboxPriorityCandidate,
    summary: &str,
    messages: &[PriorityMessageContext],
) -> String {
    if candidate.kind == "dm" {
        return "needs_reply".to_string();
    }

    let recent_text = messages
        .iter()
        .rev()
        .take(3)
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let haystack = format!("{} {}", summary, recent_text).to_ascii_lowercase();

    if contains_any(
        &haystack,
        &[
            "approve", "approval", "sign off", "sign-off", "decision", "decide", "confirm",
            "choose", "go ahead", "ship it", "launch",
        ],
    ) {
        return "needs_decision".to_string();
    }

    if haystack.contains('?')
        || contains_any(
            &haystack,
            &[
                "can you",
                "could you",
                "please",
                "let me know",
                "need your",
                "what do you think",
                "any update",
            ],
        )
    {
        return "needs_reply".to_string();
    }

    if contains_any(
        &haystack,
        &[
            "follow up",
            "follow-up",
            "next step",
            "action item",
            "todo",
            "to do",
            "blocked",
            "waiting on",
            "pending",
            "investigate",
        ],
    ) {
        return "follow_up".to_string();
    }

    "monitor".to_string()
}

fn build_priority_title(candidate: &InboxPriorityCandidate, status: &str, summary: &str) -> String {
    let topic_or_label = candidate
        .topic
        .as_ref()
        .filter(|topic| !topic.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| candidate.label.clone());

    if candidate.kind == "dm" {
        return match status {
            "needs_decision" => format!("Decision with {}", candidate.label),
            _ => format!("Reply to {}", candidate.label),
        };
    }

    if contains_any(
        &summary.to_ascii_lowercase(),
        &[
            "launch", "incident", "outage", "deploy", "review", "approval",
        ],
    ) {
        return truncate_text(summary, 72);
    }

    match status {
        "needs_decision" => format!("Decision needed: {}", topic_or_label),
        "needs_reply" => format!("Reply needed: {}", topic_or_label),
        "follow_up" => format!("Follow up: {}", topic_or_label),
        _ => topic_or_label,
    }
}

fn build_priority_summary(summary: Option<&str>, messages: &[PriorityMessageContext]) -> String {
    if let Some(summary) = summary.map(str::trim).filter(|summary| !summary.is_empty()) {
        return truncate_text(summary, MAX_PRIORITY_SUMMARY_LENGTH);
    }

    if let Some(message) = messages.last() {
        if !message.content.is_empty() {
            return truncate_text(&message.content, MAX_PRIORITY_SUMMARY_LENGTH);
        }
    }

    "Recent activity in this conversation may need your attention.".to_string()
}

fn build_priority_reason(
    candidate: &InboxPriorityCandidate,
    status: &str,
    messages: &[PriorityMessageContext],
) -> String {
    let latest_sender = messages
        .last()
        .map(|message| message.sender_name.as_str())
        .filter(|sender| !sender.is_empty())
        .unwrap_or("recent activity");

    let activity_label = if candidate.unread_count > 0 {
        format!("{} unread", candidate.unread_count)
    } else {
        "recent channel activity".to_string()
    };

    match status {
        "needs_decision" => format!(
            "{} surfaced a likely approval or decision request in {}.",
            latest_sender, activity_label
        ),
        "needs_reply" if candidate.kind == "dm" => format!(
            "Unread direct-message activity with {}. Latest context is from {}.",
            candidate.label, latest_sender
        ),
        "needs_reply" => format!(
            "{} looks like it needs a response in {}.",
            latest_sender, activity_label
        ),
        "follow_up" => format!(
            "{} looks like a follow-up thread in {}.",
            latest_sender, activity_label
        ),
        _ => format!(
            "Keeping this visible because {} changed recently.",
            candidate.label
        ),
    }
}

fn build_priority_citations(messages: &[PriorityMessageContext]) -> Vec<InboxPriorityCitation> {
    messages
        .iter()
        .rev()
        .filter(|message| !message.content.is_empty())
        .take(3)
        .map(|message| InboxPriorityCitation {
            message_id: message.id,
            sender_name: message.sender_name.clone(),
            excerpt: truncate_text(&message.content, MAX_PRIORITY_EXCERPT_LENGTH),
            timestamp: message.timestamp,
        })
        .collect()
}

fn rank_candidates(candidates: &mut Vec<InboxPriorityCandidate>) {
    candidates.sort_by(|left, right| {
        let left_has_unreads = left.unread_count > 0;
        let right_has_unreads = right.unread_count > 0;
        right_has_unreads
            .cmp(&left_has_unreads)
            .then_with(|| (right.kind == "dm").cmp(&(left.kind == "dm")))
            .then_with(|| right.unread_count.cmp(&left.unread_count))
            .then_with(|| right.last_message_id.cmp(&left.last_message_id))
    });
    candidates.truncate(MAX_PRIORITY_CANDIDATES);
}

async fn discover_priority_candidates(
    client: &ZulipClient,
    current_user_id: Option<u64>,
    existing_candidates: &[InboxPriorityCandidate],
) -> Result<Vec<InboxPriorityCandidate>, String> {
    let existing_ids = existing_candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<HashSet<_>>();

    let response = client
        .get_messages(&[], "newest", MAX_DISCOVERY_MESSAGES, 0)
        .await?;

    let mut candidates = HashMap::<String, InboxPriorityCandidate>::new();
    for message in response.messages.into_iter().rev() {
        if message.msg_type == "stream" {
            let Some(stream_id) = message.stream_id else {
                continue;
            };
            let DisplayRecipient::Stream(stream_name) = &message.display_recipient else {
                continue;
            };
            let topic = collapse_whitespace(&message.subject);
            if topic.is_empty() {
                continue;
            }
            let id = format!("stream:{stream_id}/topic:{topic}");
            if existing_ids.contains(&id) {
                continue;
            }
            candidates
                .entry(id.clone())
                .or_insert(InboxPriorityCandidate {
                    id: id.clone(),
                    narrow: id,
                    kind: "stream".to_string(),
                    label: format!("{stream_name} > {topic}"),
                    unread_count: 0,
                    last_message_id: message.id,
                    stream_id: Some(stream_id),
                    stream_name: Some(stream_name.clone()),
                    topic: Some(topic),
                    user_ids: None,
                });
            continue;
        }

        let DisplayRecipient::Users(users) = &message.display_recipient else {
            continue;
        };
        let mut other_users = users
            .iter()
            .filter(|user| Some(user.id) != current_user_id)
            .collect::<Vec<_>>();
        if other_users.is_empty() {
            continue;
        }
        other_users.sort_by(|left, right| left.id.cmp(&right.id));
        let user_ids = other_users.iter().map(|user| user.id).collect::<Vec<_>>();
        let id = format!(
            "dm:{}",
            user_ids
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(",")
        );
        if existing_ids.contains(&id) {
            continue;
        }
        let label = other_users
            .iter()
            .map(|user| collapse_whitespace(&user.full_name))
            .collect::<Vec<_>>()
            .join(", ");
        candidates
            .entry(id.clone())
            .or_insert(InboxPriorityCandidate {
                id: id.clone(),
                narrow: id,
                kind: "dm".to_string(),
                label,
                unread_count: 0,
                last_message_id: message.id,
                stream_id: None,
                stream_name: None,
                topic: None,
                user_ids: Some(user_ids),
            });
    }

    let mut discovered = candidates.into_values().collect::<Vec<_>>();
    rank_candidates(&mut discovered);
    Ok(discovered)
}

async fn analyze_priority_candidate(
    client: &ZulipClient,
    candidate: InboxPriorityCandidate,
    allow_ai_summary: bool,
) -> (InboxPriorityItem, bool) {
    let messages = fetch_priority_messages(client, &candidate)
        .await
        .unwrap_or_default();

    let ai_summary = if allow_ai_summary {
        match build_priority_narrow(&candidate) {
            Ok(narrow) => client.get_messages_summary(&narrow).await.ok(),
            Err(_) => None,
        }
    } else {
        None
    };

    let summary = build_priority_summary(ai_summary.as_deref(), &messages);
    let status = infer_priority_status(&candidate, &summary, &messages);
    let last_message_id = messages
        .last()
        .map(|message| message.id)
        .unwrap_or(candidate.last_message_id);
    let title = build_priority_title(&candidate, &status, &summary);
    let reason = build_priority_reason(&candidate, &status, &messages);
    let stream_name = candidate.stream_name.clone().unwrap_or_default();
    let topic = candidate.topic.clone().unwrap_or_default();
    let user_ids = candidate.user_ids.clone().unwrap_or_default();

    (
        InboxPriorityItem {
            candidate_id: candidate.id,
            narrow: candidate.narrow,
            kind: candidate.kind,
            label: candidate.label,
            stream_id: candidate.stream_id,
            stream_name,
            topic,
            user_ids,
            unread_count: candidate.unread_count,
            last_message_id,
            status: status.clone(),
            title,
            summary,
            reason,
            citations: build_priority_citations(&messages),
        },
        ai_summary.is_some(),
    )
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
    match client.server_settings().await {
        Ok(server_settings) => Ok(server_settings),
        Err(error) => Err(explain_server_settings_error(&client, error).await),
    }
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    narrow: Vec<NarrowFilter>,
    anchor: String,
    num_before: u32,
    num_after: u32,
) -> Result<MessageResponse, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .get_messages(&narrow, &anchor, num_before, num_after)
            .await
    })
    .await
}

/// Analyze unread conversations and return citation-backed inbox priorities.
#[tauri::command]
#[specta::specta]
pub async fn get_inbox_priorities(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    candidates: Vec<InboxPriorityCandidate>,
) -> Result<InboxPrioritiesResponse, String> {
    let client = get_client(state.inner(), &org_id)?;
    let current_user_id = get_current_user_id(&state, &org_id)?;

    let mut ranked_candidates = candidates;
    rank_candidates(&mut ranked_candidates);

    if ranked_candidates.len() < MAX_PRIORITY_CANDIDATES {
        let discovered = match discover_priority_candidates(
            &client,
            current_user_id,
            &ranked_candidates,
        )
        .await
        {
            Ok(candidates) => candidates,
            Err(error) => {
                handle_org_command_error(&app, state.inner(), &org_id, &error);
                return Err(error);
            }
        };
        ranked_candidates.extend(discovered);
        rank_candidates(&mut ranked_candidates);
    }

    let mut priorities = Vec::with_capacity(ranked_candidates.len());
    let mut used_ai = false;

    for (index, candidate) in ranked_candidates.into_iter().enumerate() {
        let allow_ai_summary = index < MAX_PRIORITY_SUMMARY_CANDIDATES;
        let (item, item_used_ai) =
            analyze_priority_candidate(&client, candidate, allow_ai_summary).await;
        used_ai |= item_used_ai;
        priorities.push(item);
    }

    priorities.sort_by(|left, right| {
        status_rank(&right.status)
            .cmp(&status_rank(&left.status))
            .then_with(|| (right.unread_count > 0).cmp(&(left.unread_count > 0)))
            .then_with(|| right.unread_count.cmp(&left.unread_count))
            .then_with(|| right.last_message_id.cmp(&left.last_message_id))
    });

    Ok(InboxPrioritiesResponse {
        priorities,
        used_ai,
        fallback_reason: if used_ai {
            String::new()
        } else {
            "summary_unavailable".to_string()
        },
    })
}

/// Load the current inbox secretary session from Foundry-server.
#[tauri::command]
#[specta::specta]
pub async fn get_inbox_assistant_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
) -> Result<InboxSecretarySession, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        let response = client
            .get("/api/v1/foundry/inbox/assistant/session")
            .send()
            .await
            .map_err(|error| format!("Failed to load inbox assistant session: {error}"))?;
        parse_inbox_assistant_response(response, "Inbox assistant session").await
    })
    .await
}

/// Send a chat message to the inbox secretary and return the updated session.
#[tauri::command]
#[specta::specta]
pub async fn send_inbox_assistant_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    message: String,
) -> Result<InboxSecretarySession, String> {
    let current_user_id = get_current_user_id(&state, &org_id)?;
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        let mut params = vec![
            ("api_key", client.api_key().to_string()),
            ("message", message),
        ];
        if let Some(user_id) = current_user_id {
            params.push(("current_user_id", user_id.to_string()));
        }

        let response = client
            .post("/api/v1/foundry/inbox/assistant/chat")
            .form(&params)
            .send()
            .await
            .map_err(|error| format!("Failed to send inbox assistant message: {error}"))?;
        parse_inbox_assistant_response(response, "Inbox assistant message").await
    })
    .await
}

/// Persist user feedback against a secretary item and return the updated session.
#[tauri::command]
#[specta::specta]
pub async fn record_inbox_assistant_feedback(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    item_key: String,
    conversation_key: String,
    action: String,
    note: Option<String>,
) -> Result<InboxSecretarySession, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        let mut params = vec![
            ("item_key", item_key),
            ("conversation_key", conversation_key),
            ("action", action),
        ];
        if let Some(note) = note {
            params.push(("note", note));
        }

        let response = client
            .post("/api/v1/foundry/inbox/assistant/feedback")
            .form(&params)
            .send()
            .await
            .map_err(|error| format!("Failed to record inbox assistant feedback: {error}"))?;
        parse_inbox_assistant_response(response, "Inbox assistant feedback").await
    })
    .await
}

/// Send a message
#[tauri::command]
#[specta::specta]
pub async fn send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    msg_type: String,
    to: String,
    content: String,
    topic: Option<String>,
) -> Result<SendResult, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .send_message(&msg_type, &to, &content, topic.as_deref())
            .await
    })
    .await
}

/// Edit a message
#[tauri::command]
#[specta::specta]
pub async fn edit_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
    content: Option<String>,
    topic: Option<String>,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .edit_message(message_id, content.as_deref(), topic.as_deref())
            .await
    })
    .await
}

/// Delete a message
#[tauri::command]
#[specta::specta]
pub async fn delete_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.delete_message(message_id).await
    })
    .await
}

/// Add an emoji reaction
#[tauri::command]
#[specta::specta]
pub async fn add_reaction(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
    emoji_name: String,
    emoji_code: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .add_reaction(message_id, &emoji_name, &emoji_code)
            .await
    })
    .await
}

/// Remove an emoji reaction
#[tauri::command]
#[specta::specta]
pub async fn remove_reaction(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    message_id: u64,
    emoji_name: String,
    emoji_code: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .remove_reaction(message_id, &emoji_name, &emoji_code)
            .await
    })
    .await
}

/// Update own presence status
#[tauri::command]
#[specta::specta]
pub async fn update_presence(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    status: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.update_presence(&status).await
    })
    .await
}

/// Send typing notification
/// `to` is a JSON string — either a JSON array of user IDs for DMs
/// or a single stream ID string for stream typing
#[tauri::command]
#[specta::specta]
pub async fn send_typing(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    op: String,
    typing_type: String,
    to: String,
    topic: Option<String>,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .send_typing(&op, &typing_type, &to, topic.as_deref())
            .await
    })
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    file_path: String,
) -> Result<UploadResult, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.upload_file(&file_path).await
    })
    .await
}

/// Fetch an authenticated media URL and convert it to a data URL for the webview.
#[tauri::command]
#[specta::specta]
pub async fn fetch_authenticated_media_data_url(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    media_url: String,
) -> Result<String, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.fetch_authenticated_media_data_url(&media_url).await
    })
    .await
}

/// Update message flags (read, starred, etc.)
#[tauri::command]
#[specta::specta]
pub async fn update_message_flags(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    messages: Vec<u64>,
    op: String,
    flag: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.update_flags(&messages, &op, &flag).await
    })
    .await
}

/// Mark all messages in a stream as read
#[tauri::command]
#[specta::specta]
pub async fn mark_stream_as_read(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.mark_stream_as_read(stream_id).await
    })
    .await
}

/// Mark all messages in a topic as read
#[tauri::command]
#[specta::specta]
pub async fn mark_topic_as_read(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
    topic_name: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.mark_topic_as_read(stream_id, &topic_name).await
    })
    .await
}

/// Get topics within a stream
#[tauri::command]
#[specta::specta]
pub async fn get_stream_topics(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
) -> Result<Vec<Topic>, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.get_stream_topics(stream_id).await
    })
    .await
}

/// Subscribe to streams
#[tauri::command]
#[specta::specta]
pub async fn subscribe_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    stream_names: Vec<String>,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.subscribe(&stream_names).await
    })
    .await
}

/// Unsubscribe from streams
#[tauri::command]
#[specta::specta]
pub async fn unsubscribe_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    stream_names: Vec<String>,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.unsubscribe(&stream_names).await
    })
    .await
}

/// Update one or more subscription properties for channels the user is subscribed to.
#[tauri::command]
#[specta::specta]
pub async fn update_subscription_properties(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    subscription_data: Vec<SubscriptionPropertyChange>,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .update_subscription_properties(&subscription_data)
            .await
    })
    .await
}

/// Update the current user's topic visibility policy within a channel.
#[tauri::command]
#[specta::specta]
pub async fn update_topic_visibility_policy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    stream_id: u64,
    topic: String,
    visibility_policy: UserTopicVisibilityPolicy,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client
            .update_topic_visibility_policy(stream_id, &topic, visibility_policy)
            .await
    })
    .await
}

/// Move or rename all messages in a topic.
#[tauri::command]
#[specta::specta]
pub async fn move_topic(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    request: MoveTopicRequest,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.move_topic(&request).await
    })
    .await
}

/// Resolve or unresolve all messages in a topic.
#[tauri::command]
#[specta::specta]
pub async fn set_topic_resolved(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    request: ResolveTopicRequest,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.set_topic_resolved(&request).await
    })
    .await
}

/// Update Zulip user settings (syncs to server)
/// `settings_json` is a JSON string with Zulip API key names, e.g. `{"enter_sends": true}`
#[tauri::command]
#[specta::specta]
pub async fn update_zulip_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
    settings_json: String,
) -> Result<(), String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.update_user_settings(&settings_json).await
    })
    .await
}

/// Fetch current Zulip user settings from server
#[tauri::command]
#[specta::specta]
pub async fn get_zulip_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    org_id: String,
) -> Result<String, String> {
    with_org_client(&app, state.inner(), &org_id, move |client| async move {
        client.get_user_settings().await
    })
    .await
}

// ── Link preview ─────────────────────────────────────────────────────

/// OpenGraph link preview data returned to the frontend.
#[derive(Debug, Clone, Serialize, Type)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
}

/// Simple bounded cache for link previews (avoids fetching the same URL twice).
struct LinkPreviewCache {
    entries: HashMap<String, LinkPreview>,
    order: Vec<String>,
    max_size: usize,
}

impl LinkPreviewCache {
    fn new(max_size: usize) -> Self {
        Self {
            entries: HashMap::with_capacity(max_size),
            order: Vec::with_capacity(max_size),
            max_size,
        }
    }

    fn get(&self, url: &str) -> Option<&LinkPreview> {
        self.entries.get(url)
    }

    fn insert(&mut self, url: String, preview: LinkPreview) {
        if self.order.len() >= self.max_size {
            if let Some(oldest) = self.order.first().cloned() {
                self.entries.remove(&oldest);
                self.order.remove(0);
            }
        }
        self.order.push(url.clone());
        self.entries.insert(url, preview);
    }
}

static LINK_PREVIEW_CACHE: std::sync::LazyLock<StdMutex<LinkPreviewCache>> =
    std::sync::LazyLock::new(|| StdMutex::new(LinkPreviewCache::new(500)));

/// Maximum body size to download when fetching a page for OG metadata (256 KB).
const LINK_PREVIEW_MAX_BODY: usize = 256 * 1024;

/// Parse OpenGraph `<meta property="og:..." content="...">` tags from raw HTML.
fn parse_og_tags(html: &str) -> HashMap<String, String> {
    let mut tags: HashMap<String, String> = HashMap::new();

    // Simple regex-free parser: scan for <meta and extract property/content pairs.
    // This is intentionally lightweight — no HTML parsing crate needed for OG extraction.
    let lower = html.to_lowercase();

    let mut pos = 0;
    while pos < lower.len() {
        // Find next <meta
        let Some(meta_start) = lower[pos..].find("<meta") else {
            break;
        };
        let meta_start = pos + meta_start;

        // Find the closing >
        let Some(tag_end) = lower[meta_start..].find('>') else {
            break;
        };
        let tag_end = meta_start + tag_end;

        let tag = &html[meta_start..=tag_end];
        let tag_lower = &lower[meta_start..=tag_end];

        // Extract property="..." or property='...'
        let property = extract_attr_value(tag, tag_lower, "property");
        let name = extract_attr_value(tag, tag_lower, "name");

        if let Some(content) = extract_attr_value(tag, tag_lower, "content") {
            if let Some(ref prop) = property {
                if prop.starts_with("og:") {
                    tags.insert(prop.clone(), content.clone());
                }
            }

            // Also handle <meta name="description"> as fallback
            if let Some(ref n) = name {
                if n == "description" && !tags.contains_key("og:description") {
                    tags.insert("meta:description".to_string(), content);
                }
            }
        }

        pos = tag_end + 1;
    }

    tags
}

/// Extract an HTML attribute value by name from a tag string.
fn extract_attr_value(tag: &str, tag_lower: &str, attr: &str) -> Option<String> {
    let search = format!("{}=", attr);
    let idx = tag_lower.find(&search)?;
    let after_eq = idx + search.len();
    let remaining = &tag[after_eq..];
    let trimmed = remaining.trim_start();

    if trimmed.starts_with('"') {
        let content = &trimmed[1..];
        let end = content.find('"')?;
        Some(html_decode_basic(&content[..end]))
    } else if trimmed.starts_with('\'') {
        let content = &trimmed[1..];
        let end = content.find('\'')?;
        Some(html_decode_basic(&content[..end]))
    } else {
        // Unquoted value — take until whitespace or >
        let end = trimmed
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(trimmed.len());
        Some(html_decode_basic(&trimmed[..end]))
    }
}

/// Decode common HTML entities.
fn html_decode_basic(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Extract `<title>` tag content as fallback.
fn extract_title_tag(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let after_open = lower[start..].find('>')?;
    let content_start = start + after_open + 1;
    let end = lower[content_start..].find("</title>")?;
    let title = html[content_start..content_start + end].trim();
    if title.is_empty() {
        None
    } else {
        Some(html_decode_basic(title))
    }
}

/// Fetch OpenGraph link preview metadata for a URL.
///
/// Downloads the first 256 KB of the page, parses OG meta tags, and returns
/// structured preview data. Results are cached in memory (up to 500 entries).
#[tauri::command]
#[specta::specta]
pub async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    // Check cache
    {
        let cache = LINK_PREVIEW_CACHE
            .lock()
            .map_err(|e| format!("Cache lock error: {}", e))?;
        if let Some(cached) = cache.get(&url) {
            return Ok(cached.clone());
        }
    }

    // Validate URL
    let parsed_url = reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Only http/https URLs are supported".to_string());
    }

    // Fetch the page with sensible limits
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("FoundryBot/1.0 (Link Preview)")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(parsed_url)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| format!("Fetch error: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    // Only parse HTML content types
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return Err("Not an HTML page".to_string());
    }

    // Read body with size limit
    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read error: {}", e))?;

    let body = if body_bytes.len() > LINK_PREVIEW_MAX_BODY {
        String::from_utf8_lossy(&body_bytes[..LINK_PREVIEW_MAX_BODY]).to_string()
    } else {
        String::from_utf8_lossy(&body_bytes).to_string()
    };

    // Parse OG tags
    let og = parse_og_tags(&body);

    let title = og
        .get("og:title")
        .cloned()
        .or_else(|| extract_title_tag(&body));

    let description = og
        .get("og:description")
        .cloned()
        .or_else(|| og.get("meta:description").cloned());

    let image_url = og.get("og:image").cloned();
    let site_name = og.get("og:site_name").cloned();

    let preview = LinkPreview {
        url: url.clone(),
        title,
        description,
        image_url,
        site_name,
    };

    // Store in cache
    {
        let mut cache = LINK_PREVIEW_CACHE
            .lock()
            .map_err(|e| format!("Cache lock error: {}", e))?;
        cache.insert(url, preview.clone());
    }

    Ok(preview)
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

fn disconnect_org_session(state: &AppState, org_id: &str) -> Result<(), String> {
    let mut orgs = state
        .orgs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(org) = orgs.remove(org_id) {
        if let Some(task) = org.event_task {
            task.abort();
        }
        if let Some(task) = org.supervisor_task {
            task.abort();
        }
    }

    Ok(())
}

fn emit_auth_invalid_disconnect(app: &tauri::AppHandle, org_id: &str, error: &str) {
    let _ = app.emit(
        &format!("zulip:{}:disconnected", sanitize_event_id(org_id)),
        serde_json::json!({
            "auth_invalid": true,
            "code": "UNAUTHORIZED",
            "error": error,
        }),
    );
}

fn handle_org_command_error(app: &tauri::AppHandle, state: &AppState, org_id: &str, error: &str) {
    if !is_auth_failure_message(error) {
        return;
    }

    if let Err(disconnect_error) = disconnect_org_session(state, org_id) {
        tracing::warn!(
            ?disconnect_error,
            org_id = %org_id,
            "Failed to disconnect org after auth failure"
        );
    }

    emit_auth_invalid_disconnect(app, org_id, error);
}

pub async fn with_org_client<T, F, Fut>(
    app: &tauri::AppHandle,
    state: &AppState,
    org_id: &str,
    operation: F,
) -> Result<T, String>
where
    F: FnOnce(ZulipClient) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let client = get_client(state, org_id)?;
    match operation(client).await {
        Ok(value) => Ok(value),
        Err(error) => {
            handle_org_command_error(app, state, org_id, &error);
            Err(error)
        }
    }
}

fn get_current_user_id(state: &AppState, org_id: &str) -> Result<Option<u64>, String> {
    let orgs = state
        .orgs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let org = orgs
        .get(org_id)
        .ok_or_else(|| format!("Not connected to org: {}", org_id))?;
    Ok(org.current_user_id)
}

#[cfg(test)]
mod tests {
    use super::{
        infer_priority_status, is_sso_callback_url, looks_like_foundry_cloud_login_html,
        strip_html, truncate_text, InboxPriorityCandidate, PriorityMessageContext,
    };
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

    #[test]
    fn detects_foundry_cloud_login_markup() {
        assert!(looks_like_foundry_cloud_login_html(
            "<html><head><title>Foundry Cloud Login</title></head></html>"
        ));
        assert!(!looks_like_foundry_cloud_login_html(
            "<html><head><title>Log in | Zulip Dev</title></head></html>"
        ));
    }

    #[test]
    fn strips_html_and_decodes_common_entities() {
        assert_eq!(
            strip_html("<p>Hello&nbsp;<strong>world</strong> &amp; team</p>"),
            "Hello world & team"
        );
    }

    #[test]
    fn truncates_text_with_ellipsis() {
        assert_eq!(truncate_text("abcdef", 5), "ab...");
    }

    #[test]
    fn classifies_decision_requests() {
        let candidate = InboxPriorityCandidate {
            id: "stream:1/topic:launch".to_string(),
            narrow: "stream:1/topic:launch".to_string(),
            kind: "stream".to_string(),
            label: "general > launch".to_string(),
            unread_count: 2,
            last_message_id: 10,
            stream_id: Some(1),
            stream_name: Some("general".to_string()),
            topic: Some("launch".to_string()),
            user_ids: None,
        };
        let status = infer_priority_status(
            &candidate,
            "Need your approval before we launch tonight.",
            &[PriorityMessageContext {
                id: 10,
                sender_name: "Paul".to_string(),
                content: "Can you approve the launch?".to_string(),
                timestamp: 0,
            }],
        );
        assert_eq!(status, "needs_decision");
    }
}
