use base64::Engine as _;
use serde::de::DeserializeOwned;
use serde::Deserialize;

use super::types::*;
use super::ZulipClient;

const RESOLVED_TOPIC_PREFIX: &str = "✔ ";

#[derive(Debug, Clone, serde::Deserialize)]
struct RealmSettingsRegisterResponse {
    queue_id: String,
    #[serde(flatten)]
    snapshot: RealmSettingsSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
struct MessageSummaryResponse {
    summary: String,
}

fn is_resolved_topic(topic_name: &str) -> bool {
    topic_name.starts_with(RESOLVED_TOPIC_PREFIX)
}

fn resolve_topic_name(topic_name: &str) -> String {
    if is_resolved_topic(topic_name) {
        topic_name.to_string()
    } else {
        format!("{RESOLVED_TOPIC_PREFIX}{topic_name}")
    }
}

fn unresolve_topic_name(topic_name: &str) -> String {
    if !is_resolved_topic(topic_name) {
        return topic_name.to_string();
    }

    let tail = &topic_name[RESOLVED_TOPIC_PREFIX.len()..];
    tail.trim_start_matches([' ', '✔']).to_string()
}

fn json_value_to_form_value(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::String(string) => string,
        other => other.to_string(),
    }
}

fn resolve_realm_media_url(base_url: &str, media_url: &str) -> Result<reqwest::Url, String> {
    let base = reqwest::Url::parse(base_url)
        .map_err(|e| format!("Invalid base URL '{}': {}", base_url, e))?;
    let resolved = if let Ok(absolute) = reqwest::Url::parse(media_url) {
        absolute
    } else {
        base.join(media_url)
            .map_err(|e| format!("Invalid media URL '{}': {}", media_url, e))?
    };

    let same_origin = resolved.scheme() == base.scheme()
        && resolved.host_str() == base.host_str()
        && resolved.port_or_known_default() == base.port_or_known_default();

    if !same_origin {
        return Err(format!(
            "Refusing to fetch media from a different origin: {}",
            resolved
        ));
    }

    Ok(resolved)
}

impl ZulipClient {
    async fn register_queue_with<T>(
        &self,
        event_types: &[&str],
        fetch_event_types: &[&str],
    ) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        let event_types_json =
            serde_json::to_string(event_types).map_err(|e| format!("Serialize error: {}", e))?;
        let fetch_event_types_json = serde_json::to_string(fetch_event_types)
            .map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .post("/api/v1/register")
            .form(&[
                ("apply_markdown", "true".to_string()),
                ("client_gravatar", "true".to_string()),
                ("event_types", event_types_json),
                ("fetch_event_types", fetch_event_types_json),
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

    /// GET /api/v1/users — Fetch all users in the organization.
    pub async fn get_users(&self) -> Result<Vec<User>, String> {
        let resp = self
            .get("/api/v1/users")
            .send()
            .await
            .map_err(|e| format!("Get users failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get users failed: {}", body));
        }

        let users: UsersResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse users: {}", e))?;

        Ok(users.members)
    }

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

    /// POST /api/v1/fetch_api_key — exchange a password for an API key
    pub async fn fetch_api_key(
        &self,
        username: &str,
        password: &str,
    ) -> Result<FetchApiKeyResult, String> {
        let resp = self
            .post_unauth("/api/v1/fetch_api_key")
            .form(&[
                ("username", username.to_string()),
                ("password", password.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Fetch API key failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Fetch API key failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse fetch_api_key response: {}", e))
    }

    /// POST /api/v1/register — Register event queue and get initial state
    pub async fn register_queue(&self) -> Result<RegisterResponse, String> {
        let mut response: RegisterResponse = self
            .register_queue_with(
                &[
                    "message",
                    "typing",
                    "presence",
                    "reaction",
                    "subscription",
                    "update_message",
                    "delete_message",
                    "update_message_flags",
                    "realm",
                    "realm_domains",
                    "realm_user",
                    "user_topic",
                    "heartbeat",
                ],
                &[
                    "subscription",
                    "realm",
                    "realm_domains",
                    "realm_user",
                    "recent_private_conversations",
                    "user_topic",
                ],
            )
            .await?;

        if response.realm_users.is_empty() {
            match self.get_users().await {
                Ok(users) => {
                    response.realm_users = users;
                }
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        "Register queue returned no realm users and fallback user fetch failed"
                    );
                }
            }
        }

        Ok(response)
    }

    /// DELETE /api/v1/events — Delete a previously-registered event queue.
    pub async fn delete_queue(&self, queue_id: &str) -> Result<(), String> {
        let resp = self
            .delete("/api/v1/events")
            .form(&[("queue_id", queue_id.to_string())])
            .send()
            .await
            .map_err(|e| format!("Delete queue failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete queue failed: {}", body));
        }

        Ok(())
    }

    /// Fetch a typed snapshot of organization settings and email-domain rules.
    pub async fn get_realm_settings(&self) -> Result<RealmSettingsSnapshot, String> {
        let response: RealmSettingsRegisterResponse = self
            .register_queue_with(&["realm", "realm_domains"], &["realm", "realm_domains"])
            .await?;

        if let Err(error) = self.delete_queue(&response.queue_id).await {
            tracing::warn!(
                queue_id = %response.queue_id,
                error = %error,
                "Failed to delete temporary realm settings queue"
            );
        }

        Ok(response.snapshot)
    }

    /// PATCH /api/v1/realm — Update organization-level settings.
    pub async fn update_realm_settings(&self, settings_json: &str) -> Result<(), String> {
        let settings: std::collections::HashMap<String, serde_json::Value> =
            serde_json::from_str(settings_json)
                .map_err(|e| format!("Invalid realm settings JSON: {}", e))?;

        let params: Vec<(String, String)> = settings
            .into_iter()
            .map(|(key, value)| (key, json_value_to_form_value(value)))
            .collect();

        let resp = self
            .patch("/api/v1/realm")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Update realm settings failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update realm settings failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/realm/domains — Add an email domain restriction.
    pub async fn create_realm_domain(
        &self,
        domain: &str,
        allow_subdomains: bool,
    ) -> Result<(), String> {
        let resp = self
            .post("/api/v1/realm/domains")
            .form(&[
                ("domain", domain.to_string()),
                ("allow_subdomains", allow_subdomains.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Create realm domain failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Create realm domain failed: {}", body));
        }

        Ok(())
    }

    /// PATCH /api/v1/realm/domains/{domain} — Update the subdomain policy for a realm domain.
    pub async fn update_realm_domain(
        &self,
        domain: &str,
        allow_subdomains: bool,
    ) -> Result<(), String> {
        let resp = self
            .patch(&format!(
                "/api/v1/realm/domains/{}",
                urlencoding::encode(domain)
            ))
            .form(&[("allow_subdomains", allow_subdomains.to_string())])
            .send()
            .await
            .map_err(|e| format!("Update realm domain failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update realm domain failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/realm/domains/{domain} — Remove an email domain restriction.
    pub async fn delete_realm_domain(&self, domain: &str) -> Result<(), String> {
        let resp = self
            .delete(&format!(
                "/api/v1/realm/domains/{}",
                urlencoding::encode(domain)
            ))
            .send()
            .await
            .map_err(|e| format!("Delete realm domain failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete realm domain failed: {}", body));
        }

        Ok(())
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

    /// GET /api/v1/messages/summary — summarize a narrow if the server has AI enabled.
    pub async fn get_messages_summary(&self, narrow: &[NarrowFilter]) -> Result<String, String> {
        let narrow_json =
            serde_json::to_string(narrow).map_err(|e| format!("Narrow serialize error: {}", e))?;

        let resp = self
            .get("/api/v1/messages/summary")
            .query(&[("narrow", &narrow_json)])
            .send()
            .await
            .map_err(|e| format!("Get message summary failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get message summary failed: {}", body));
        }

        let summary: MessageSummaryResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse message summary response: {}", e))?;

        Ok(summary.summary)
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
    pub async fn update_flags(&self, messages: &[u64], op: &str, flag: &str) -> Result<(), String> {
        let messages_json =
            serde_json::to_string(messages).map_err(|e| format!("Serialize error: {}", e))?;

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

        let subscriptions_json =
            serde_json::to_string(&subscriptions).map_err(|e| format!("Serialize error: {}", e))?;

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
        let streams_json =
            serde_json::to_string(stream_names).map_err(|e| format!("Serialize error: {}", e))?;

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

    /// POST /api/v1/users/me/subscriptions/properties — Bulk update subscription properties.
    pub async fn update_subscription_properties(
        &self,
        subscription_data: &[SubscriptionPropertyChange],
    ) -> Result<(), String> {
        let payload = subscription_data
            .iter()
            .map(subscription_property_change_to_wire)
            .collect::<Result<Vec<_>, _>>()?;
        let payload_json =
            serde_json::to_string(&payload).map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .post("/api/v1/users/me/subscriptions/properties")
            .form(&[("subscription_data", payload_json.as_str())])
            .send()
            .await
            .map_err(|e| format!("Update subscription properties failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update subscription properties failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/user_topics — Set topic visibility for a user within a stream.
    pub async fn update_topic_visibility_policy(
        &self,
        stream_id: u64,
        topic: &str,
        visibility_policy: UserTopicVisibilityPolicy,
    ) -> Result<(), String> {
        let params = vec![
            ("stream_id".to_string(), stream_id.to_string()),
            ("topic".to_string(), topic.to_string()),
            (
                "visibility_policy".to_string(),
                visibility_policy.as_api_value().to_string(),
            ),
        ];

        let resp = self
            .post("/api/v1/user_topics")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Update topic visibility failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update topic visibility failed: {}", body));
        }

        Ok(())
    }

    /// PATCH /api/v1/messages/{id} — Move or rename an entire topic.
    pub async fn move_topic(&self, request: &MoveTopicRequest) -> Result<(), String> {
        let new_topic = request.new_topic.trim();
        if new_topic.is_empty() {
            return Err("New topic name cannot be empty".to_string());
        }

        let mut params = vec![
            ("topic".to_string(), new_topic.to_string()),
            ("propagate_mode".to_string(), "change_all".to_string()),
        ];

        if let Some(new_stream_id) = request.new_stream_id {
            params.push(("stream_id".to_string(), new_stream_id.to_string()));
        }
        if let Some(send_old) = request.send_notification_to_old_thread {
            params.push((
                "send_notification_to_old_thread".to_string(),
                send_old.to_string(),
            ));
        }
        if let Some(send_new) = request.send_notification_to_new_thread {
            params.push((
                "send_notification_to_new_thread".to_string(),
                send_new.to_string(),
            ));
        }

        let resp = self
            .patch(&format!("/api/v1/messages/{}", request.anchor_message_id))
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Move topic failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Move topic failed: {}", body));
        }

        Ok(())
    }

    /// PATCH /api/v1/messages/{id} — Resolve or unresolve an entire topic.
    pub async fn set_topic_resolved(&self, request: &ResolveTopicRequest) -> Result<(), String> {
        let next_topic = if request.resolved {
            resolve_topic_name(&request.topic_name)
        } else {
            unresolve_topic_name(&request.topic_name)
        };

        self.move_topic(&MoveTopicRequest {
            anchor_message_id: request.anchor_message_id,
            new_topic: next_topic,
            new_stream_id: None,
            send_notification_to_old_thread: request.send_notification_to_old_thread,
            send_notification_to_new_thread: request.send_notification_to_new_thread,
        })
        .await
    }

    /// POST /api/v1/presence — Update own presence
    pub async fn update_presence(&self, status: &str) -> Result<(), String> {
        let resp = self
            .post("/api/v1/users/me/presence")
            .form(&[("status", status), ("ping_only", "false")])
            .send()
            .await
            .map_err(|e| format!("Update presence failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update presence failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/realm/presence — Fetch presence information for all users.
    pub async fn get_realm_presence(&self) -> Result<RealmPresenceResponse, String> {
        let resp = self
            .get("/api/v1/realm/presence")
            .send()
            .await
            .map_err(|e| format!("Get presence failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get presence failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse presence response: {}", e))
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
            .map(|(k, v)| (k, json_value_to_form_value(v)))
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
    pub async fn upload_file(&self, file_path: &str) -> Result<UploadResult, String> {
        let part = reqwest::multipart::Part::file(file_path)
            .await
            .map_err(|e| format!("Failed to open upload file: {}", e))?;
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

    /// Fetch an authenticated media asset and return it as a data URL for the webview.
    pub async fn fetch_authenticated_media_data_url(
        &self,
        media_url: &str,
    ) -> Result<String, String> {
        let resolved_url = resolve_realm_media_url(&self.base_url, media_url)?;
        let resp = self
            .client
            .get(resolved_url.clone())
            .basic_auth(&self.email, Some(&self.api_key))
            .send()
            .await
            .map_err(|e| format!("Media fetch failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let preview = body.chars().take(200).collect::<String>();
            return Err(format!("Media fetch failed ({}): {}", status, preview));
        }

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or("application/octet-stream")
            .to_string();

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read media response: {}", e))?;

        Ok(format!(
            "data:{};base64,{}",
            content_type,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    /// POST /api/v1/users/{user_id}/reactivate
    pub async fn reactivate_user(&self, user_id: u64) -> Result<(), String> {
        let resp = self
            .post(&format!("/api/v1/users/{}/reactivate", user_id))
            .send()
            .await
            .map_err(|e| format!("Reactivate user failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Reactivate user failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/invites
    pub async fn get_invites(&self) -> Result<Vec<Invite>, String> {
        let resp = self
            .get("/api/v1/invites")
            .send()
            .await
            .map_err(|e| format!("Get invites failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get invites failed: {}", body));
        }

        let invites: InvitesResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse invites response: {}", e))?;

        Ok(invites.invites)
    }

    /// POST /api/v1/invites
    pub async fn send_invites(
        &self,
        invitee_emails: &str,
        invite_expires_in_minutes: Option<u32>,
        invite_as: Option<u32>,
        stream_ids: &[u64],
    ) -> Result<SendInvitesResponse, String> {
        let stream_ids_json =
            serde_json::to_string(stream_ids).map_err(|e| format!("Serialize error: {}", e))?;

        let mut params = vec![
            ("invitee_emails".to_string(), invitee_emails.to_string()),
            ("stream_ids".to_string(), stream_ids_json),
        ];

        if let Some(minutes) = invite_expires_in_minutes {
            params.push(("invite_expires_in_minutes".to_string(), minutes.to_string()));
        }

        if let Some(role) = invite_as {
            params.push(("invite_as".to_string(), role.to_string()));
        }

        let resp = self
            .post("/api/v1/invites")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Send invites failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Send invites failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse invite response: {}", e))
    }

    /// DELETE /api/v1/invites/{invite_id}
    pub async fn revoke_invite(&self, invite_id: u64) -> Result<(), String> {
        let resp = self
            .delete(&format!("/api/v1/invites/{}", invite_id))
            .send()
            .await
            .map_err(|e| format!("Revoke invite failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Revoke invite failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/invites/{invite_id}/resend
    pub async fn resend_invite(&self, invite_id: u64) -> Result<(), String> {
        let resp = self
            .post(&format!("/api/v1/invites/{}/resend", invite_id))
            .send()
            .await
            .map_err(|e| format!("Resend invite failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Resend invite failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/user_groups
    pub async fn get_user_groups(
        &self,
        include_deactivated_groups: bool,
    ) -> Result<Vec<UserGroup>, String> {
        let resp = self
            .get("/api/v1/user_groups")
            .query(&[(
                "include_deactivated_groups",
                include_deactivated_groups.to_string(),
            )])
            .send()
            .await
            .map_err(|e| format!("Get user groups failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get user groups failed: {}", body));
        }

        let user_groups: UserGroupsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse user groups response: {}", e))?;

        Ok(user_groups.user_groups)
    }

    /// POST /api/v1/user_groups/create
    pub async fn create_user_group(
        &self,
        name: &str,
        description: &str,
        members: &[u64],
    ) -> Result<CreateUserGroupResponse, String> {
        let members_json =
            serde_json::to_string(members).map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .post("/api/v1/user_groups/create")
            .form(&[
                ("name", name.to_string()),
                ("description", description.to_string()),
                ("members", members_json),
            ])
            .send()
            .await
            .map_err(|e| format!("Create user group failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Create user group failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse create user group response: {}", e))
    }

    /// PATCH /api/v1/user_groups/{user_group_id}
    pub async fn update_user_group(
        &self,
        user_group_id: u64,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<(), String> {
        let mut params = Vec::new();
        if let Some(name) = name {
            params.push(("name", name.to_string()));
        }
        if let Some(description) = description {
            params.push(("description", description.to_string()));
        }

        let resp = self
            .patch(&format!("/api/v1/user_groups/{}", user_group_id))
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Update user group failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update user group failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/user_groups/{user_group_id}/deactivate
    pub async fn deactivate_user_group(&self, user_group_id: u64) -> Result<(), String> {
        let resp = self
            .post(&format!("/api/v1/user_groups/{}/deactivate", user_group_id))
            .send()
            .await
            .map_err(|e| format!("Deactivate user group failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Deactivate user group failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/realm/linkifiers
    pub async fn get_linkifiers(&self) -> Result<Vec<Linkifier>, String> {
        let resp = self
            .get("/api/v1/realm/linkifiers")
            .send()
            .await
            .map_err(|e| format!("Get linkifiers failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get linkifiers failed: {}", body));
        }

        let linkifiers: LinkifiersResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse linkifiers response: {}", e))?;

        Ok(linkifiers.linkifiers)
    }

    /// PATCH /api/v1/realm/linkifiers
    pub async fn reorder_linkifiers(&self, ordered_linkifier_ids: &[u64]) -> Result<(), String> {
        let ids_json = serde_json::to_string(ordered_linkifier_ids)
            .map_err(|e| format!("Serialize error: {}", e))?;

        let resp = self
            .patch("/api/v1/realm/linkifiers")
            .form(&[("ordered_linkifier_ids", ids_json)])
            .send()
            .await
            .map_err(|e| format!("Reorder linkifiers failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Reorder linkifiers failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/realm/filters
    pub async fn create_linkifier(
        &self,
        pattern: &str,
        url_template: &str,
    ) -> Result<LinkifierCreateResponse, String> {
        let resp = self
            .post("/api/v1/realm/filters")
            .form(&[
                ("pattern", pattern.to_string()),
                ("url_template", url_template.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Create linkifier failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Create linkifier failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse create linkifier response: {}", e))
    }

    /// PATCH /api/v1/realm/filters/{filter_id}
    pub async fn update_linkifier(
        &self,
        filter_id: u64,
        pattern: &str,
        url_template: &str,
    ) -> Result<(), String> {
        let resp = self
            .patch(&format!("/api/v1/realm/filters/{}", filter_id))
            .form(&[
                ("pattern", pattern.to_string()),
                ("url_template", url_template.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Update linkifier failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Update linkifier failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/realm/filters/{filter_id}
    pub async fn delete_linkifier(&self, filter_id: u64) -> Result<(), String> {
        let resp = self
            .delete(&format!("/api/v1/realm/filters/{}", filter_id))
            .send()
            .await
            .map_err(|e| format!("Delete linkifier failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete linkifier failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/realm/emoji
    pub async fn get_realm_emoji(&self) -> Result<Vec<RealmEmoji>, String> {
        let resp = self
            .get("/api/v1/realm/emoji")
            .send()
            .await
            .map_err(|e| format!("Get custom emoji failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get custom emoji failed: {}", body));
        }

        let emoji: RealmEmojiResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse custom emoji response: {}", e))?;

        Ok(emoji.emoji.into_values().collect())
    }

    /// POST /api/v1/realm/emoji/{emoji_name}
    pub async fn upload_custom_emoji(
        &self,
        emoji_name: &str,
        file_bytes: Vec<u8>,
        file_name: &str,
    ) -> Result<(), String> {
        let part = reqwest::multipart::Part::bytes(file_bytes).file_name(file_name.to_string());
        let form = reqwest::multipart::Form::new().part("filename", part);

        let resp = self
            .post(&format!(
                "/api/v1/realm/emoji/{}",
                urlencoding::encode(emoji_name)
            ))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload custom emoji failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Upload custom emoji failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/realm/emoji/{emoji_name}
    pub async fn delete_custom_emoji(&self, emoji_name: &str) -> Result<(), String> {
        let resp = self
            .delete(&format!(
                "/api/v1/realm/emoji/{}",
                urlencoding::encode(emoji_name)
            ))
            .send()
            .await
            .map_err(|e| format!("Delete custom emoji failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete custom emoji failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/realm/icon
    pub async fn upload_realm_icon(
        &self,
        file_bytes: Vec<u8>,
        file_name: &str,
    ) -> Result<(), String> {
        let part = reqwest::multipart::Part::bytes(file_bytes).file_name(file_name.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self
            .post("/api/v1/realm/icon")
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload organization icon failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Upload organization icon failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/realm/icon
    pub async fn delete_realm_icon(&self) -> Result<(), String> {
        let resp = self
            .delete("/api/v1/realm/icon")
            .send()
            .await
            .map_err(|e| format!("Delete organization icon failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete organization icon failed: {}", body));
        }

        Ok(())
    }

    /// POST /api/v1/realm/logo
    pub async fn upload_realm_logo(
        &self,
        file_bytes: Vec<u8>,
        file_name: &str,
        night: bool,
    ) -> Result<(), String> {
        let part = reqwest::multipart::Part::bytes(file_bytes).file_name(file_name.to_string());
        let form = reqwest::multipart::Form::new()
            .text("night", night.to_string())
            .part("file", part);

        let resp = self
            .post("/api/v1/realm/logo")
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload organization logo failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Upload organization logo failed: {}", body));
        }

        Ok(())
    }

    /// DELETE /api/v1/realm/logo
    pub async fn delete_realm_logo(&self, night: bool) -> Result<(), String> {
        let resp = self
            .delete("/api/v1/realm/logo")
            .form(&[("night", night.to_string())])
            .send()
            .await
            .map_err(|e| format!("Delete organization logo failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Delete organization logo failed: {}", body));
        }

        Ok(())
    }

    /// GET /api/v1/bots
    pub async fn get_bots(&self) -> Result<Vec<Bot>, String> {
        let resp = self
            .get("/api/v1/bots")
            .send()
            .await
            .map_err(|e| format!("Get bots failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get bots failed: {}", body));
        }

        let bots: BotsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse bots response: {}", e))?;

        Ok(bots.bots)
    }

    /// POST /api/v1/bots
    pub async fn create_bot(
        &self,
        full_name: &str,
        short_name: &str,
        bot_type: u32,
        service_name: Option<&str>,
        payload_url: Option<&str>,
    ) -> Result<CreateBotResponse, String> {
        let mut params = vec![
            ("full_name".to_string(), full_name.to_string()),
            ("short_name".to_string(), short_name.to_string()),
            ("bot_type".to_string(), bot_type.to_string()),
        ];

        if let Some(service_name) = service_name {
            params.push(("service_name".to_string(), service_name.to_string()));
        }

        if let Some(payload_url) = payload_url {
            params.push(("payload_url".to_string(), payload_url.to_string()));
        }

        let resp = self
            .post("/api/v1/bots")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Create bot failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Create bot failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse create bot response: {}", e))
    }

    /// GET /api/v1/bots/{bot_id}/api_key
    pub async fn get_bot_api_key(&self, bot_id: u64) -> Result<BotApiKeyResponse, String> {
        let resp = self
            .get(&format!("/api/v1/bots/{}/api_key", bot_id))
            .send()
            .await
            .map_err(|e| format!("Get bot API key failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Get bot API key failed: {}", body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse bot API key response: {}", e))
    }
}

fn subscription_property_name(property: SubscriptionProperty) -> &'static str {
    match property {
        SubscriptionProperty::InHomeView => "in_home_view",
        SubscriptionProperty::IsMuted => "is_muted",
        SubscriptionProperty::Color => "color",
        SubscriptionProperty::DesktopNotifications => "desktop_notifications",
        SubscriptionProperty::AudibleNotifications => "audible_notifications",
        SubscriptionProperty::PushNotifications => "push_notifications",
        SubscriptionProperty::EmailNotifications => "email_notifications",
        SubscriptionProperty::PinToTop => "pin_to_top",
        SubscriptionProperty::WildcardMentionsNotify => "wildcard_mentions_notify",
    }
}

fn subscription_property_change_to_wire(
    change: &SubscriptionPropertyChange,
) -> Result<serde_json::Value, String> {
    let value = match (&change.property, &change.value) {
        (SubscriptionProperty::Color, SubscriptionPropertyValue::String(value)) => {
            serde_json::Value::String(value.clone())
        }
        (SubscriptionProperty::Color, _) => {
            return Err("Subscription property 'color' requires a string value".to_string());
        }
        (_, SubscriptionPropertyValue::Bool(value)) => serde_json::Value::Bool(*value),
        (_, SubscriptionPropertyValue::String(_)) => {
            return Err(format!(
                "Subscription property '{}' requires a boolean value",
                subscription_property_name(change.property)
            ));
        }
    };

    Ok(serde_json::json!({
        "stream_id": change.stream_id,
        "property": subscription_property_name(change.property),
        "value": value,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_topic_name_is_idempotent() {
        assert_eq!(resolve_topic_name("topic"), "✔ topic");
        assert_eq!(resolve_topic_name("✔ topic"), "✔ topic");
    }

    #[test]
    fn unresolve_topic_name_handles_canonical_prefix() {
        assert_eq!(unresolve_topic_name("topic"), "topic");
        assert_eq!(unresolve_topic_name("✔ topic"), "topic");
    }

    #[test]
    fn unresolve_topic_name_handles_overresolved_prefixes() {
        assert_eq!(unresolve_topic_name("✔ ✔✔ topic"), "topic");
    }

    #[test]
    fn preserves_json_shapes_when_building_form_values() {
        assert_eq!(
            json_value_to_form_value(serde_json::json!("plain text")),
            "plain text"
        );
        assert_eq!(json_value_to_form_value(serde_json::json!(true)), "true");
        assert_eq!(json_value_to_form_value(serde_json::json!(42)), "42");
        assert_eq!(
            json_value_to_form_value(serde_json::json!({"new": 5, "old": 2})),
            r#"{"new":5,"old":2}"#
        );
        assert_eq!(json_value_to_form_value(serde_json::Value::Null), "null");
    }

    #[test]
    fn resolves_relative_realm_media_urls() {
        let resolved = resolve_realm_media_url(
            "https://chat.example.invalid",
            "/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        )
        .unwrap();

        assert_eq!(
            resolved.as_str(),
            "https://chat.example.invalid/user_uploads/thumbnail/3/5b/file.png/840x560.webp"
        );
    }

    #[test]
    fn rejects_cross_origin_media_urls() {
        let error = resolve_realm_media_url(
            "https://chat.example.invalid",
            "https://example.com/user_uploads/file.png",
        )
        .unwrap_err();

        assert!(error.contains("different origin"));
    }

    #[test]
    fn serializes_subscription_property_changes_to_zulip_wire_shape() {
        let color_change = SubscriptionPropertyChange {
            stream_id: 7,
            property: SubscriptionProperty::Color,
            value: SubscriptionPropertyValue::String("#ffffff".to_string()),
        };
        let mute_change = SubscriptionPropertyChange {
            stream_id: 9,
            property: SubscriptionProperty::IsMuted,
            value: SubscriptionPropertyValue::Bool(true),
        };

        assert_eq!(
            subscription_property_change_to_wire(&color_change).unwrap(),
            serde_json::json!({
                "stream_id": 7,
                "property": "color",
                "value": "#ffffff",
            })
        );
        assert_eq!(
            subscription_property_change_to_wire(&mute_change).unwrap(),
            serde_json::json!({
                "stream_id": 9,
                "property": "is_muted",
                "value": true,
            })
        );
    }

    #[test]
    fn rejects_invalid_subscription_property_value_shapes() {
        let bad_color = SubscriptionPropertyChange {
            stream_id: 1,
            property: SubscriptionProperty::Color,
            value: SubscriptionPropertyValue::Bool(true),
        };
        let bad_boolean = SubscriptionPropertyChange {
            stream_id: 1,
            property: SubscriptionProperty::PinToTop,
            value: SubscriptionPropertyValue::String("true".to_string()),
        };

        assert_eq!(
            subscription_property_change_to_wire(&bad_color).unwrap_err(),
            "Subscription property 'color' requires a string value"
        );
        assert_eq!(
            subscription_property_change_to_wire(&bad_boolean).unwrap_err(),
            "Subscription property 'pin_to_top' requires a boolean value"
        );
    }

    #[test]
    fn user_topic_visibility_policy_round_trips_server_and_request_values() {
        let followed: UserTopicVisibilityPolicy = serde_json::from_value(serde_json::json!(3))
            .expect("server integer should deserialize");
        assert!(matches!(followed, UserTopicVisibilityPolicy::Followed));
        assert_eq!(followed.as_api_value(), 3);
        assert_eq!(
            serde_json::to_value(followed).unwrap(),
            serde_json::json!("Followed")
        );
        let followed_from_frontend: UserTopicVisibilityPolicy =
            serde_json::from_value(serde_json::json!("Followed"))
                .expect("frontend string should deserialize");
        assert!(matches!(
            followed_from_frontend,
            UserTopicVisibilityPolicy::Followed
        ));
    }
}
