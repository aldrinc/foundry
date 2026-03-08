pub mod api;
pub mod events;
pub mod supervisor_api;
pub mod supervisor_events;
pub mod supervisor_types;
pub mod types;

use std::time::Duration;

/// Sanitize an org_id for use in Tauri event names.
///
/// Tauri event names only allow alphanumeric characters, `-`, `/`, `:` and `_`.
/// org_ids are derived from server URLs and commonly contain dots (e.g. `chat.zulip.org`),
/// which must be replaced with underscores.
pub fn sanitize_event_id(org_id: &str) -> String {
    org_id.replace('.', "_")
}

/// HTTP client for Zulip REST API with connection pooling
#[derive(Clone)]
pub struct ZulipClient {
    client: reqwest::Client,
    pub base_url: String,
    email: String,
    api_key: String,
}

impl ZulipClient {
    pub fn new(base_url: &str, email: &str, api_key: &str) -> Self {
        let client = reqwest::Client::builder()
            .pool_max_idle_per_host(5)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            email: email.to_string(),
            api_key: api_key.to_string(),
        }
    }

    /// Build a GET request with authentication
    pub fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .get(format!("{}{}", self.base_url, path))
            .basic_auth(&self.email, Some(&self.api_key))
    }

    /// Build a POST request with authentication
    pub fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}{}", self.base_url, path))
            .basic_auth(&self.email, Some(&self.api_key))
    }

    /// Build a PATCH request with authentication
    pub fn patch(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .patch(format!("{}{}", self.base_url, path))
            .basic_auth(&self.email, Some(&self.api_key))
    }

    /// Build a DELETE request with authentication
    pub fn delete(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .delete(format!("{}{}", self.base_url, path))
            .basic_auth(&self.email, Some(&self.api_key))
    }

    /// Unauthenticated GET (for server_settings)
    pub fn get_unauth(&self, path: &str) -> reqwest::RequestBuilder {
        self.client.get(format!("{}{}", self.base_url, path))
    }

    /// Build an authenticated GET request for SSE streaming using a provided
    /// client (which should have no timeout set for long-lived connections).
    pub fn build_sse_request(
        &self,
        sse_client: &reqwest::Client,
        path: &str,
    ) -> reqwest::RequestBuilder {
        sse_client
            .get(format!("{}{}", self.base_url, path))
            .basic_auth(&self.email, Some(&self.api_key))
            .header("Accept", "text/event-stream")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── sanitize_event_id ──

    #[test]
    fn sanitize_replaces_dots_with_underscores() {
        assert_eq!(sanitize_event_id("chat.zulip.org"), "chat_zulip_org");
    }

    #[test]
    fn sanitize_handles_ip_based_org_ids() {
        // Real-world org_id derived from sslip.io-style URLs
        assert_eq!(
            sanitize_event_id("zulip-dev-live.5.161.60.86.sslip.io"),
            "zulip-dev-live_5_161_60_86_sslip_io"
        );
    }

    #[test]
    fn sanitize_preserves_already_valid_chars() {
        // Alphanumeric, hyphens, underscores, colons, slashes are all valid
        assert_eq!(
            sanitize_event_id("my-org_123:test/path"),
            "my-org_123:test/path"
        );
    }

    #[test]
    fn sanitize_handles_no_dots() {
        assert_eq!(sanitize_event_id("localhost"), "localhost");
    }

    #[test]
    fn sanitize_handles_consecutive_dots() {
        assert_eq!(sanitize_event_id("a..b...c"), "a__b___c");
    }

    #[test]
    fn sanitize_handles_empty_string() {
        assert_eq!(sanitize_event_id(""), "");
    }

    #[test]
    fn sanitized_supervisor_event_names_are_valid_for_tauri() {
        // Tauri only allows: alphanumeric, `-`, `/`, `:`, `_`
        let org_id = "zulip-dev-live.5.161.60.86.sslip.io";
        let event_id = sanitize_event_id(org_id);

        let event_names = [
            format!("supervisor:{}:connected", event_id),
            format!("supervisor:{}:disconnected", event_id),
            format!("supervisor:{}:events", event_id),
            format!("supervisor:{}:session", event_id),
            format!("zulip:{}:message", event_id),
            format!("zulip:{}:typing", event_id),
            format!("zulip:{}:resync", event_id),
            format!("zulip:{}:disconnected", event_id),
            format!("zulip:{}:connection_error", event_id),
        ];

        let valid_chars = |c: char| c.is_alphanumeric() || "-/:_".contains(c);

        for name in &event_names {
            assert!(
                name.chars().all(valid_chars),
                "Event name '{}' contains invalid characters for Tauri",
                name
            );
        }
    }

    #[test]
    fn sanitized_output_never_contains_dots() {
        let test_cases = [
            "chat.zulip.org",
            "192.168.1.1",
            "a.b.c.d.e.f",
            "no-dots-here",
            "",
            "single.",
            ".leading",
            "...",
        ];

        for input in &test_cases {
            let result = sanitize_event_id(input);
            assert!(
                !result.contains('.'),
                "sanitize_event_id({:?}) = {:?} still contains dots",
                input,
                result
            );
        }
    }
}
