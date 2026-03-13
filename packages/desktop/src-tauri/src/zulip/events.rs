use std::time::Duration;

use tauri::Emitter;

use super::{is_auth_failure_message, sanitize_event_id, ZulipClient};

/// Start the event queue long-polling loop in a background task.
/// Events are emitted to the frontend via Tauri's event system.
pub async fn start_event_loop(
    app: tauri::AppHandle,
    client: ZulipClient,
    org_id: String,
    mut queue_id: String,
    mut last_event_id: i64,
) {
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(30);
    let event_id = sanitize_event_id(&org_id);

    loop {
        match client.get_events(&queue_id, last_event_id).await {
            Ok(events) => {
                // Reset backoff on success
                backoff = Duration::from_secs(1);

                for event in &events {
                    last_event_id = event.id;

                    // Skip heartbeat events
                    if event.event_type == "heartbeat" {
                        continue;
                    }

                    // Emit typed event to frontend
                    let event_name = format!("zulip:{}:{}", event_id, event.event_type);
                    if let Err(e) = app.emit(&event_name, &event.data) {
                        tracing::warn!(?e, event_type = %event.event_type, "Failed to emit event");
                    }
                }
            }
            Err(e) if e == "QUEUE_EXPIRED" => {
                tracing::warn!(org_id = %org_id, "Event queue expired, re-registering");

                match client.register_queue().await {
                    Ok(reg) => {
                        queue_id = reg.queue_id;
                        last_event_id = reg.last_event_id;

                        // Emit resync event so frontend can refresh state
                        let _ = app.emit(
                            &format!("zulip:{}:resync", event_id),
                            &serde_json::json!({
                                "subscriptions": reg.subscriptions,
                                "users": reg.realm_users,
                                "user_topics": reg.user_topics,
                                "unread_msgs": reg.unread_msgs,
                                "recent_private_conversations": reg.recent_private_conversations,
                            }),
                        );

                        tracing::info!(org_id = %org_id, "Event queue re-registered");
                    }
                    Err(e) => {
                        tracing::error!(?e, org_id = %org_id, "Failed to re-register queue");
                        let payload = if is_auth_failure_message(&e) {
                            serde_json::json!({"auth_invalid": true, "code": "UNAUTHORIZED", "error": e})
                        } else {
                            serde_json::json!({"error": e})
                        };
                        let _ = app.emit(&format!("zulip:{}:disconnected", event_id), &payload);
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
            Err(e) => {
                tracing::warn!(?e, org_id = %org_id, backoff = ?backoff, "Event poll error, retrying");

                if is_auth_failure_message(&e) {
                    let _ = app.emit(
                        &format!("zulip:{}:disconnected", event_id),
                        &serde_json::json!({"auth_invalid": true, "code": "UNAUTHORIZED", "error": e}),
                    );
                    break;
                }

                let _ = app.emit(
                    &format!("zulip:{}:connection_error", event_id),
                    &serde_json::json!({"error": e.to_string()}),
                );

                tokio::time::sleep(backoff).await;

                // Exponential backoff capped at max
                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}

// Tests for sanitize_event_id are in mod.rs since the function is shared.
