use super::types::*;
use super::ZulipClient;

impl ZulipClient {
    /// GET /api/v1/server_settings (unauthenticated)
    pub async fn server_settings(&self) -> Result<ServerSettings, String> {
        let resp = self
            .get_unauth("/api/v1/server_settings")
            .send()
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned status: {}", resp.status()));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))
    }

    /// POST /api/v1/register — Register event queue and get initial state
    pub async fn register_queue(&self) -> Result<RegisterResponse, String> {
        let resp = self
            .post("/api/v1/register")
            .form(&[
                ("apply_markdown", "true"),
                ("client_gravatar", "true"),
                (
                    "event_types",
                    r#"["message","typing","presence","reaction","subscription","update_message","delete_message","update_message_flags","realm_user","heartbeat"]"#,
                ),
                (
                    "fetch_event_types",
                    r#"["subscription","realm_user"]"#,
                ),
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to register queue: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Register failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse register response: {}", e))
    }

    /// GET /api/v1/events — Long-poll for events
    pub async fn get_events(
        &self,
        queue_id: &str,
        last_event_id: i64,
    ) -> Result<Vec<Event>, String> {
        let resp = self
            .get("/api/v1/events")
            .query(&[
                ("queue_id", queue_id),
                ("last_event_id", &last_event_id.to_string()),
            ])
            .timeout(std::time::Duration::from_secs(90))
            .send()
            .await
            .map_err(|e| format!("Events poll failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            if body.contains("BAD_EVENT_QUEUE_ID") {
                return Err("QUEUE_EXPIRED".to_string());
            }
            return Err(format!("Events failed: {}", body));
        }

        let events_resp: EventsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse events: {}", e))?;

        Ok(events_resp.events)
    }

    /// GET /api/v1/messages — Fetch messages with narrow
    pub async fn get_messages(
        &self,
        narrow: &[NarrowFilter],
        anchor: &str,
        num_before: u32,
        num_after: u32,
    ) -> Result<MessageResponse, String> {
        let narrow_json =
            serde_json::to_string(narrow).map_err(|e| format!("Narrow serialize error: {}", e))?;

        let resp = self
            .get("/api/v1/messages")
            .query(&[
                ("anchor", anchor),
                ("num_before", &num_before.to_string()),
                ("num_after", &num_after.to_string()),
                ("apply_markdown", "true"),
                ("client_gravatar", "true"),
                ("narrow", &narrow_json),
            ])
            .send()
            .await
            .map_err(|e| format!("Get messages failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get messages failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse messages: {}", e))
    }

    /// POST /api/v1/messages — Send a message
    pub async fn send_message(
        &self,
        msg_type: &str,
        to: &str,
        content: &str,
        topic: Option<&str>,
    ) -> Result<SendResult, String> {
        let mut params = vec![
            ("type", msg_type.to_string()),
            ("to", to.to_string()),
            ("content", content.to_string()),
        ];

        if let Some(topic) = topic {
            params.push(("topic", topic.to_string()));
        }

        let resp = self
            .post("/api/v1/messages")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Send message failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Send message failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse send result: {}", e))
    }

    /// PATCH /api/v1/messages/{id} — Edit a message
    pub async fn edit_message(
        &self,
        message_id: u64,
        content: Option<&str>,
        topic: Option<&str>,
    ) -> Result<(), String> {
        let mut params = vec![];
        if let Some(content) = content {
            params.push(("content", content.to_string()));
        }
        if let Some(topic) = topic {
            params.push(("topic", topic.to_string()));
        }

        let resp = self
            .patch(&format!("/api/v1/messages/{}", message_id))
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Edit message failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Edit message failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/messages/{id}
    pub async fn delete_message(&self, message_id: u64) -> Result<(), String> {
        let resp = self
            .delete(&format!("/api/v1/messages/{}", message_id))
            .send()
            .await
            .map_err(|e| format!("Delete message failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete message failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/messages/{id}/reactions — Add reaction
    pub async fn add_reaction(
        &self,
        message_id: u64,
        emoji_name: &str,
        emoji_code: &str,
    ) -> Result<(), String> {
        let resp = self
            .post(&format!("/api/v1/messages/{}/reactions", message_id))
            .form(&[
                ("emoji_name", emoji_name),
                ("emoji_code", emoji_code),
                ("reaction_type", "unicode_emoji"),
            ])
            .send()
            .await
            .map_err(|e| format!("Add reaction failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Add reaction failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/messages/{id}/reactions — Remove reaction
    pub async fn remove_reaction(
        &self,
        message_id: u64,
        emoji_name: &str,
        emoji_code: &str,
    ) -> Result<(), String> {
        let resp = self
            .delete(&format!("/api/v1/messages/{}/reactions", message_id))
            .form(&[
                ("emoji_name", emoji_name),
                ("emoji_code", emoji_code),
                ("reaction_type", "unicode_emoji"),
            ])
            .send()
            .await
            .map_err(|e| format!("Remove reaction failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Remove reaction failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/messages/flags — Update message flags
    pub async fn update_flags(
        &self,
        messages: &[u64],
        op: &str,
        flag: &str,
    ) -> Result<(), String> {
        let messages_json = serde_json::to_string(messages)
            .map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .post("/api/v1/messages/flags")
            .form(&[
                ("messages", messages_json.as_str()),
                ("op", op),
                ("flag", flag),
            ])
            .send()
            .await
            .map_err(|e| format!("Update flags failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update flags failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/mark_stream_as_read
    pub async fn mark_stream_as_read(&self, stream_id: u64) -> Result<(), String> {
        let resp = self
            .post("/api/v1/mark_stream_as_read")
            .form(&[("stream_id", stream_id.to_string())])
            .send()
            .await
            .map_err(|e| format!("Mark stream read failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Mark stream read failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/mark_topic_as_read
    pub async fn mark_topic_as_read(&self, stream_id: u64, topic_name: &str) -> Result<(), String> {
        let resp = self
            .post("/api/v1/mark_topic_as_read")
            .form(&[
                ("stream_id", &stream_id.to_string()),
                ("topic_name", &topic_name.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Mark topic read failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Mark topic read failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/users/me/{stream_id}/topics
    pub async fn get_stream_topics(&self, stream_id: u64) -> Result<Vec<Topic>, String> {
        let resp = self
            .get(&format!("/api/v1/users/me/{}/topics", stream_id))
            .send()
            .await
            .map_err(|e| format!("Get topics failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // Truncate HTML responses for cleaner error messages
            let body_preview = if body.starts_with("<!") || body.starts_with("<html") {
                format!("Server returned HTML (status {})", status)
            } else {
                body.chars().take(200).collect::<String>()
            };
            return Err(format!("Get topics failed ({}): {}", status, body_preview));
        }

        let topics: TopicsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse topics: {}", e))?;

        Ok(topics.topics)
    }

    /// POST /api/v1/users/me/subscriptions — Subscribe to streams
    pub async fn subscribe(&self, stream_names: &[String]) -> Result<(), String> {
        let subscriptions: Vec<serde_json::Value> = stream_names
            .iter()
            .map(|name| serde_json::json!({"name": name}))
            .collect();

        let subscriptions_json = serde_json::to_string(&subscriptions)
            .map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .post("/api/v1/users/me/subscriptions")
            .form(&[("subscriptions", subscriptions_json.as_str())])
            .send()
            .await
            .map_err(|e| format!("Subscribe failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Subscribe failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/users/me/subscriptions — Unsubscribe from streams
    pub async fn unsubscribe(&self, stream_names: &[String]) -> Result<(), String> {
        let streams_json = serde_json::to_string(stream_names)
            .map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .delete("/api/v1/users/me/subscriptions")
            .form(&[("subscriptions", streams_json.as_str())])
            .send()
            .await
            .map_err(|e| format!("Unsubscribe failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Unsubscribe failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/presence — Update own presence
    pub async fn update_presence(&self, status: &str) -> Result<(), String> {
        let resp = self
            .post("/api/v1/users/me/presence")
            .form(&[
                ("status", status),
                ("ping_only", "false"),
            ])
            .send()
            .await
            .map_err(|e| format!("Update presence failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update presence failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/typing — Send typing notification
    /// `to` is a JSON string of user IDs or a stream ID
    pub async fn send_typing(
        &self,
        op: &str,
        typing_type: &str,
        to: &str,
        topic: Option<&str>,
    ) -> Result<(), String> {
        let mut params = vec![
            ("op".to_string(), op.to_string()),
            ("type".to_string(), typing_type.to_string()),
            ("to".to_string(), to.to_string()),
        ];

        if let Some(topic) = topic {
            params.push(("topic".to_string(), topic.to_string()));
        }

        let resp = self
            .post("/api/v1/typing")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Send typing failed: {}", e))?;

        if !resp.status().is_success() {
            // Typing failures are non-critical, log but don't error
            tracing::warn!("Send typing failed: {}", resp.status());
        }

        Ok(())
    }

    /// PATCH /api/v1/settings — Update user settings
    /// `settings_json` is a JSON string like `{"enter_sends": true, "twenty_four_hour_time": false}`
    pub async fn update_user_settings(&self, settings_json: &str) -> Result<(), String> {
        let settings: std::collections::HashMap<String, serde_json::Value> =
            serde_json::from_str(settings_json)
                .map_err(|e| format!("Invalid settings JSON: {}", e))?;

        let params: Vec<(String, String)> = settings
            .into_iter()
            .map(|(k, v)| (k, v.to_string().trim_matches('"').to_string()))
            .collect();

        let resp = self
            .patch("/api/v1/settings")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Update settings failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update settings failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/settings — Fetch current user settings
    pub async fn get_user_settings(&self) -> Result<String, String> {
        let resp = self
            .get("/api/v1/settings")
            .send()
            .await
            .map_err(|e| format!("Get settings failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get settings failed: {}", body));
        }

        resp.text()
            .await
            .map_err(|e| format!("Failed to read settings response: {}", e))
    }

    /// POST /api/v1/user_uploads — Upload a file
    pub async fn upload_file(&self, file_bytes: Vec<u8>, file_name: &str) -> Result<UploadResult, String> {
        let part = reqwest::multipart::Part::bytes(file_bytes)
            .file_name(file_name.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self
            .post("/api/v1/user_uploads")
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Upload failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse upload result: {}", e))
    }
}
