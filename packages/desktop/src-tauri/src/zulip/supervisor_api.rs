use std::time::Duration;

use super::supervisor_types::*;
use super::ZulipClient;

impl ZulipClient {
    /// GET /api/v1/foundry/topics/{scope}/supervisor/session
    /// Poll supervisor session state and events
    pub async fn get_supervisor_session(
        &self,
        topic_scope_id: &str,
        after_id: i64,
        limit: u32,
    ) -> Result<SupervisorSessionResponse, String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/supervisor/session",
            urlencoding::encode(topic_scope_id)
        );

        let resp = self
            .get(&path)
            .query(&[
                ("after_id", after_id.to_string()),
                ("limit", limit.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to poll supervisor session: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Supervisor session poll failed ({}): {}",
                status, body
            ));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse supervisor session response: {}", e))
    }

    /// POST /api/v1/foundry/topics/{scope}/supervisor/message
    /// Send a message to the supervisor
    pub async fn post_supervisor_message(
        &self,
        topic_scope_id: &str,
        message: &str,
        client_msg_id: &str,
        stream_id: Option<u64>,
        stream_name: Option<&str>,
        topic: Option<&str>,
    ) -> Result<SupervisorMessageResponse, String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/supervisor/message",
            urlencoding::encode(topic_scope_id)
        );

        let mut params: Vec<(&str, String)> = vec![
            ("message", message.to_string()),
            ("client_msg_id", client_msg_id.to_string()),
        ];

        if let Some(sid) = stream_id {
            params.push(("stream_id", sid.to_string()));
        }
        if let Some(sname) = stream_name {
            params.push(("stream_name", sname.to_string()));
        }
        if let Some(t) = topic {
            params.push(("topic", t.to_string()));
        }

        // The backend de-duplicates by client_msg_id, so one retry is safe if
        // the transport flakes after the request may already have been
        // accepted upstream.
        let mut attempt = 0;
        let resp = loop {
            match self.post(&path).form(&params).send().await {
                Ok(resp) => break resp,
                Err(error) if attempt == 0 => {
                    tracing::warn!(
                        ?error,
                        topic_scope_id = %topic_scope_id,
                        client_msg_id = %client_msg_id,
                        "Retrying supervisor message after transport error"
                    );
                    attempt += 1;
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                Err(error) => {
                    return Err(format!("Failed to send supervisor message: {}", error));
                }
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Supervisor message failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse supervisor message response: {}", e))
    }

    /// GET /api/v1/foundry/topics/{scope}/sidebar
    /// Get task list for the supervisor dashboard
    pub async fn get_supervisor_sidebar(
        &self,
        topic_scope_id: &str,
    ) -> Result<SupervisorSidebarResponse, String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/sidebar",
            urlencoding::encode(topic_scope_id)
        );

        let resp = self
            .get(&path)
            .send()
            .await
            .map_err(|e| format!("Failed to get supervisor sidebar: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Supervisor sidebar failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse supervisor sidebar response: {}", e))
    }

    /// POST /api/v1/foundry/topics/{scope}/tasks/{task_id}/control
    /// Control a task (pause/resume/cancel)
    pub async fn control_supervisor_task(
        &self,
        topic_scope_id: &str,
        task_id: &str,
        action: &str,
    ) -> Result<(), String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/tasks/{}/control",
            urlencoding::encode(topic_scope_id),
            urlencoding::encode(task_id)
        );

        let resp = self
            .post(&path)
            .form(&[("action", action)])
            .send()
            .await
            .map_err(|e| format!("Failed to control task: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Task control failed ({}): {}", status, body));
        }

        Ok(())
    }

    /// POST /api/v1/foundry/topics/{scope}/tasks/{task_id}/reply
    /// Reply to a task clarification question
    pub async fn reply_to_task_clarification(
        &self,
        topic_scope_id: &str,
        task_id: &str,
        message: &str,
    ) -> Result<(), String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/tasks/{}/reply",
            urlencoding::encode(topic_scope_id),
            urlencoding::encode(task_id)
        );

        let resp = self
            .post(&path)
            .form(&[("message", message)])
            .send()
            .await
            .map_err(|e| format!("Failed to reply to task: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Task reply failed ({}): {}", status, body));
        }

        Ok(())
    }

    /// GET /json/foundry/providers/auth
    /// Get available AI providers and their auth status
    pub async fn get_foundry_providers(&self) -> Result<FoundryProvidersResponse, String> {
        let resp = self
            .get("/json/foundry/providers/auth")
            .send()
            .await
            .map_err(|e| format!("Failed to get providers: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Providers request failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse providers response: {}", e))
    }

    /// POST /json/foundry/providers/connect
    /// Connect a provider using an API key credential
    pub async fn connect_foundry_provider(
        &self,
        provider: &str,
        api_key: &str,
        label: Option<&str>,
    ) -> Result<FoundryProviderCredentialResponse, String> {
        let mut params = vec![
            ("provider", provider.to_string()),
            ("auth_mode", "api_key".to_string()),
            ("api_key", api_key.to_string()),
        ];

        if let Some(value) = label.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("label", value.to_string()));
        }

        let resp = self
            .post("/json/foundry/providers/connect")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Failed to connect provider: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Provider connect failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse provider connect response: {}", e))
    }

    /// POST /json/foundry/providers/disconnect
    /// Disconnect a provider credential
    pub async fn disconnect_foundry_provider(
        &self,
        provider: &str,
    ) -> Result<FoundryProviderCredentialResponse, String> {
        let resp = self
            .post("/json/foundry/providers/disconnect")
            .form(&[("provider", provider)])
            .send()
            .await
            .map_err(|e| format!("Failed to disconnect provider: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Provider disconnect failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse provider disconnect response: {}", e))
    }

    /// POST /json/foundry/providers/oauth/start
    /// Start a provider OAuth flow and return the authorization URL
    pub async fn start_foundry_provider_oauth(
        &self,
        provider: &str,
        redirect_uri: Option<&str>,
    ) -> Result<FoundryProviderOauthStartResponse, String> {
        let mut params = vec![("provider", provider.to_string())];

        if let Some(value) = redirect_uri
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("redirect_uri", value.to_string()));
        }

        let resp = self
            .post("/json/foundry/providers/oauth/start")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Failed to start provider OAuth: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Provider OAuth start failed ({}): {}",
                status, body
            ));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse provider OAuth start response: {}", e))
    }

    /// GET /api/v1/foundry/topics/{scope}/tasks/{task_id}/events
    /// Get events for a specific task
    pub async fn get_task_events(
        &self,
        topic_scope_id: &str,
        task_id: &str,
        after_id: i64,
        limit: u32,
    ) -> Result<TaskEventsResponse, String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/tasks/{}/events",
            urlencoding::encode(topic_scope_id),
            urlencoding::encode(task_id)
        );

        let resp = self
            .get(&path)
            .query(&[
                ("after_id", after_id.to_string()),
                ("limit", limit.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to get task events: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Task events request failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse task events response: {}", e))
    }
}
