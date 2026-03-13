use std::time::Duration;

use super::supervisor_types::*;
use super::types::*;
use super::ZulipClient;

const PROVIDER_AUTH_PATH: &str = "/api/v1/foundry/providers/auth";
const PROVIDER_CONNECT_PATH: &str = "/api/v1/foundry/providers/connect";
const PROVIDER_DISCONNECT_PATH: &str = "/api/v1/foundry/providers/disconnect";
const PROVIDER_OAUTH_START_PATH: &str = "/api/v1/foundry/providers/oauth/start";
const SUPERVISOR_MESSAGE_TIMEOUT: Duration = Duration::from_secs(120);

impl ZulipClient {
    /// POST /api/v1/foundry/inbox/priorities
    /// Analyze unread candidates and return citation-backed priorities.
    pub async fn get_inbox_priorities(
        &self,
        candidates: &[InboxPriorityCandidate],
    ) -> Result<InboxPrioritiesResponse, String> {
        let candidates_json = serde_json::to_string(candidates)
            .map_err(|e| format!("Failed to serialize inbox priority candidates: {}", e))?;

        let resp = self
            .post("/api/v1/foundry/inbox/priorities")
            .form(&[("candidates", candidates_json)])
            .send()
            .await
            .map_err(|e| format!("Failed to get inbox priorities: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Inbox priorities failed ({}): {}", status, body));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse inbox priorities response: {}", e))
    }

    /// GET /api/v1/foundry/topics/{scope}/supervisor/session
    /// Poll supervisor session state and events
    pub async fn get_supervisor_session(
        &self,
        topic_scope_id: &str,
        session_id: Option<&str>,
        after_id: i64,
        limit: u32,
    ) -> Result<SupervisorSessionResponse, String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/supervisor/session",
            urlencoding::encode(topic_scope_id)
        );

        let mut query = vec![
            ("after_id", after_id.to_string()),
            ("limit", limit.to_string()),
        ];
        if let Some(value) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
            query.push(("session_id", value.to_string()));
        }

        let resp = self
            .get(&path)
            .query(&query)
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
        session_id: Option<&str>,
        session_create_mode: Option<&str>,
        session_title: Option<&str>,
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
        if let Some(value) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("session_id", value.to_string()));
        }
        if let Some(value) = session_create_mode
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("session_create_mode", value.to_string()));
        }
        if let Some(value) = session_title
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("session_title", value.to_string()));
        }

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
            match self
                .post(&path)
                .timeout(SUPERVISOR_MESSAGE_TIMEOUT)
                .form(&params)
                .send()
                .await
            {
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
        session_id: Option<&str>,
    ) -> Result<SupervisorSidebarResponse, String> {
        let path = format!(
            "/api/v1/foundry/topics/{}/sidebar",
            urlencoding::encode(topic_scope_id)
        );

        let mut request = self.get(&path);
        if let Some(value) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
            request = request.query(&[("session_id", value)]);
        }
        let resp = request
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

    /// GET /api/v1/foundry/providers/auth
    /// Get available AI providers and their auth status
    pub async fn get_foundry_providers(&self) -> Result<FoundryProvidersResponse, String> {
        let resp = self
            .get(PROVIDER_AUTH_PATH)
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

    /// POST /api/v1/foundry/providers/connect
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
            .post(PROVIDER_CONNECT_PATH)
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

    /// POST /api/v1/foundry/providers/connect
    /// Connect a provider using OAuth token material
    pub async fn connect_foundry_provider_oauth(
        &self,
        provider: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        id_token: Option<&str>,
        account_id: Option<&str>,
        label: Option<&str>,
    ) -> Result<FoundryProviderCredentialResponse, String> {
        let mut params = vec![
            ("provider", provider.to_string()),
            ("auth_mode", "oauth".to_string()),
            ("access_token", access_token.to_string()),
        ];

        if let Some(value) = refresh_token
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("refresh_token", value.to_string()));
        }
        if let Some(value) = id_token.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("id_token", value.to_string()));
        }
        if let Some(value) = account_id.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("account_id", value.to_string()));
        }
        if let Some(value) = label.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("label", value.to_string()));
        }

        let resp = self
            .post(PROVIDER_CONNECT_PATH)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Failed to connect provider with OAuth: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Provider OAuth connect failed ({}): {}",
                status, body
            ));
        }

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse provider OAuth connect response: {}", e))
    }

    /// POST /api/v1/foundry/providers/disconnect
    /// Disconnect a provider credential
    pub async fn disconnect_foundry_provider(
        &self,
        provider: &str,
    ) -> Result<FoundryProviderCredentialResponse, String> {
        let resp = self
            .post(PROVIDER_DISCONNECT_PATH)
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

    /// POST /api/v1/foundry/providers/oauth/start
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
            .post(PROVIDER_OAUTH_START_PATH)
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

#[cfg(test)]
mod tests {
    use super::{
        PROVIDER_AUTH_PATH, PROVIDER_CONNECT_PATH, PROVIDER_DISCONNECT_PATH,
        PROVIDER_OAUTH_START_PATH,
    };

    #[test]
    fn provider_endpoints_use_api_v1_routes() {
        assert!(PROVIDER_AUTH_PATH.starts_with("/api/v1/"));
        assert!(PROVIDER_CONNECT_PATH.starts_with("/api/v1/"));
        assert!(PROVIDER_DISCONNECT_PATH.starts_with("/api/v1/"));
        assert!(PROVIDER_OAUTH_START_PATH.starts_with("/api/v1/"));
    }
}
