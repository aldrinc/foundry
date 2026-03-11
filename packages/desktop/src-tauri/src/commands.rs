use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde::de::DeserializeOwned;
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl};

use crate::server::load_desktop_settings;
use crate::zulip::types::*;
use crate::zulip::ZulipClient;
use crate::AppState;

const AUTH_CALLBACK_EVENT: &str = "deep-link://new-url";
const AUTH_WINDOW_LABEL_PREFIX: &str = "sso-auth-";
const FOUNDRY_SERVER_URL_KEY: &str = "foundry_server_url";
const DEFAULT_FOUNDRY_SERVER_URL: &str = "http://127.0.0.1:8090";
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

fn load_foundry_server_base_url(app: &AppHandle) -> Result<(String, bool), String> {
    let configured = crate::server::get_config(app.clone(), FOUNDRY_SERVER_URL_KEY.to_string())?;
    let Some(raw_value) = configured else {
        return Ok((DEFAULT_FOUNDRY_SERVER_URL.to_string(), false));
    };

    let parsed = serde_json::from_str::<String>(&raw_value).unwrap_or(raw_value);
    let normalized = parsed
        .trim()
        .trim_matches('"')
        .trim_end_matches('/')
        .to_string();
    if normalized.is_empty() {
        return Ok((DEFAULT_FOUNDRY_SERVER_URL.to_string(), false));
    }
    Ok((normalized, true))
}

async fn post_inbox_secretary_request<T: DeserializeOwned>(
    app: &AppHandle,
    client: &ZulipClient,
    path: &str,
    payload: serde_json::Value,
) -> Result<T, String> {
    let (base_url, configured) = load_foundry_server_base_url(app)?;
    let request_url = format!("{base_url}{path}");
    let http_client = client.build_external_client(Duration::from_secs(90))?;
    let response = http_client
        .post(&request_url)
        .json(&payload)
        .send()
        .await
        .map_err(|error| {
            if !configured && base_url == DEFAULT_FOUNDRY_SERVER_URL {
                format!(
                    "Inbox assistant backend is not configured. Set Desktop > Servers > Assistant backend URL, or run Foundry Server locally on {DEFAULT_FOUNDRY_SERVER_URL}. Original error: {error}"
                )
            } else {
                format!("Inbox assistant request failed: {error}")
            }
        })?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read inbox assistant response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Inbox assistant request failed ({}): {}",
            status,
            body.trim()
        ));
    }

    serde_json::from_str::<T>(&body).map_err(|error| {
        format!(
            "Invalid inbox assistant response: {error}. Body: {}",
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

/// Analyze unread conversations and return citation-backed inbox priorities.
#[tauri::command]
#[specta::specta]
pub async fn get_inbox_priorities(
    state: State<'_, AppState>,
    org_id: String,
    candidates: Vec<InboxPriorityCandidate>,
) -> Result<InboxPrioritiesResponse, String> {
    let client = get_client(&state, &org_id)?;
    let current_user_id = get_current_user_id(&state, &org_id)?;

    let mut ranked_candidates = candidates;
    rank_candidates(&mut ranked_candidates);

    if ranked_candidates.len() < MAX_PRIORITY_CANDIDATES {
        let discovered = discover_priority_candidates(&client, current_user_id, &ranked_candidates)
            .await
            .unwrap_or_default();
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
    let client = get_client(&state, &org_id)?;
    post_inbox_secretary_request(
        &app,
        &client,
        "/api/v1/desktop/inbox-secretary/session",
        serde_json::json!({
            "org_key": org_id,
            "realm_url": client.base_url.clone(),
            "user_email": client.email().to_string(),
        }),
    )
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
    let client = get_client(&state, &org_id)?;
    let current_user_id = get_current_user_id(&state, &org_id)?;
    post_inbox_secretary_request(
        &app,
        &client,
        "/api/v1/desktop/inbox-secretary/chat",
        serde_json::json!({
            "org_key": org_id,
            "realm_url": client.base_url.clone(),
            "user_email": client.email().to_string(),
            "api_key": client.api_key().to_string(),
            "current_user_id": current_user_id,
            "message": message,
        }),
    )
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
    let client = get_client(&state, &org_id)?;
    post_inbox_secretary_request(
        &app,
        &client,
        "/api/v1/desktop/inbox-secretary/feedback",
        serde_json::json!({
            "org_key": org_id,
            "realm_url": client.base_url.clone(),
            "user_email": client.email().to_string(),
            "item_key": item_key,
            "conversation_key": conversation_key,
            "action": action,
            "note": note.unwrap_or_default(),
        }),
    )
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
    client.upload_file(&file_path).await
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
        infer_priority_status, is_sso_callback_url, strip_html, truncate_text,
        InboxPriorityCandidate, PriorityMessageContext,
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
