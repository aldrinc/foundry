use std::time::Duration;

use tauri::Emitter;

use super::{sanitize_event_id, ZulipClient};

/// Start a long-lived SSE connection to the supervisor session stream.
/// Events are parsed and emitted to the frontend via Tauri's event system.
/// Reconnects automatically with exponential backoff on disconnection.
pub async fn start_supervisor_stream(
    app: tauri::AppHandle,
    client: ZulipClient,
    org_id: String,
    topic_scope_id: String,
    initial_after_id: i64,
) {
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(30);
    let mut cursor = initial_after_id;

    // Create an HTTP client without a global timeout for SSE streaming.
    // The connection is long-lived; the server sends keepalives every ~15s.
    let sse_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(1)
        .build()
        .expect("Failed to create SSE client");

    let event_id = sanitize_event_id(&org_id);

    loop {
        let encoded_scope = urlencoding::encode(&topic_scope_id);
        let path = format!(
            "/api/v1/foundry/topics/{}/supervisor/session/stream?after_id={}",
            encoded_scope, cursor,
        );

        tracing::info!(
            org_id = %org_id,
            topic = %topic_scope_id,
            cursor,
            "Connecting supervisor SSE stream"
        );

        let result = client.build_sse_request(&sse_client, &path).send().await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                // Connected — notify frontend
                let _ = app.emit(
                    &format!("supervisor:{}:connected", event_id),
                    serde_json::json!({}),
                );
                backoff = Duration::from_secs(1);

                // Read the SSE stream chunk by chunk
                let mut buffer = String::new();
                let mut resp = resp;

                loop {
                    match resp.chunk().await {
                        Ok(Some(chunk)) => {
                            buffer.push_str(&String::from_utf8_lossy(&chunk));

                            // Process complete SSE frames (delimited by \n\n)
                            while let Some(pos) = buffer.find("\n\n") {
                                let frame = buffer[..pos].to_string();
                                buffer = buffer[pos + 2..].to_string();
                                process_sse_frame(&app, &org_id, &frame, &mut cursor);
                            }
                        }
                        Ok(None) => {
                            // Stream ended normally (server closed the connection)
                            tracing::info!(
                                org_id = %org_id,
                                "Supervisor SSE stream ended, will reconnect"
                            );
                            break;
                        }
                        Err(e) => {
                            tracing::warn!(
                                ?e,
                                org_id = %org_id,
                                "SSE stream read error, will reconnect"
                            );
                            break;
                        }
                    }
                }
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    org_id = %org_id,
                    status = %status,
                    body = %body.chars().take(500).collect::<String>(),
                    "SSE connection failed with HTTP error"
                );
            }
            Err(e) => {
                tracing::warn!(
                    ?e,
                    org_id = %org_id,
                    "SSE connection error"
                );
            }
        }

        // Emit disconnected event so frontend can show reconnecting state
        let _ = app.emit(
            &format!("supervisor:{}:disconnected", event_id),
            serde_json::json!({"error": "stream disconnected", "cursor": cursor}),
        );

        // Exponential backoff before reconnecting
        tracing::info!(
            org_id = %org_id,
            backoff_ms = backoff.as_millis(),
            "Reconnecting supervisor SSE after backoff"
        );
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

/// Parse an SSE frame and emit the appropriate Tauri events.
///
/// SSE frames consist of lines:
/// - `data: {...}` — JSON event data
/// - `: keepalive` or `: ` — comment/heartbeat, ignored
fn process_sse_frame(app: &tauri::AppHandle, org_id: &str, frame: &str, cursor: &mut i64) {
    let event_id = sanitize_event_id(org_id);

    for line in frame.lines() {
        // Skip SSE comments (keepalives)
        if line.starts_with(':') {
            continue;
        }

        // Parse data lines
        if let Some(data) = line.strip_prefix("data: ") {
            match serde_json::from_str::<serde_json::Value>(data) {
                Ok(value) => {
                    // Check if this is a periodic session_state snapshot
                    if value.get("type").and_then(|t| t.as_str()) == Some("session_state") {
                        let _ = app.emit(&format!("supervisor:{}:session", event_id), &value);
                    } else {
                        // Regular supervisor event — update cursor and emit
                        if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
                            if id > *cursor {
                                *cursor = id;
                            }
                        }
                        let _ = app.emit(&format!("supervisor:{}:events", event_id), &value);
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        ?e,
                        data_preview = %data.chars().take(200).collect::<String>(),
                        "Failed to parse SSE event data"
                    );
                }
            }
        }
    }
}

// Tests for sanitize_event_id are in mod.rs since the function is shared.
