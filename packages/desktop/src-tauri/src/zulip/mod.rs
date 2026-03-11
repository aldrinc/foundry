pub mod api;
pub mod events;
pub mod supervisor_api;
pub mod supervisor_events;
pub mod supervisor_types;
pub mod types;

use std::fs;
use std::time::Duration;

use reqwest::{Certificate, Client, ClientBuilder, NoProxy, Proxy};

use self::types::DesktopSettings;

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
    client: Client,
    pub base_url: String,
    email: String,
    api_key: String,
    desktop_settings: DesktopSettings,
}

impl ZulipClient {
    pub fn new(base_url: &str, email: &str, api_key: &str) -> Result<Self, String> {
        Self::with_desktop_settings(base_url, email, api_key, DesktopSettings::default())
    }

    pub fn with_desktop_settings(
        base_url: &str,
        email: &str,
        api_key: &str,
        desktop_settings: DesktopSettings,
    ) -> Result<Self, String> {
        let client = build_http_client(
            &desktop_settings,
            Some(Duration::from_secs(30)),
            Some(Duration::from_secs(10)),
            5,
        )?;

        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            email: email.to_string(),
            api_key: api_key.to_string(),
            desktop_settings,
        })
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

    /// Unauthenticated POST (for auth bootstrap endpoints like fetch_api_key)
    pub fn post_unauth(&self, path: &str) -> reqwest::RequestBuilder {
        self.client.post(format!("{}{}", self.base_url, path))
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

    pub fn build_sse_client(&self) -> Result<Client, String> {
        build_http_client(
            &self.desktop_settings,
            None,
            Some(Duration::from_secs(10)),
            1,
        )
    }

    pub fn build_external_client(&self, timeout: Duration) -> Result<Client, String> {
        build_http_client(
            &self.desktop_settings,
            Some(timeout),
            Some(Duration::from_secs(10)),
            5,
        )
    }

    pub fn email(&self) -> &str {
        &self.email
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }
}

fn build_http_client(
    settings: &DesktopSettings,
    timeout: Option<Duration>,
    connect_timeout: Option<Duration>,
    pool_max_idle_per_host: usize,
) -> Result<Client, String> {
    let mut builder = Client::builder()
        .pool_max_idle_per_host(pool_max_idle_per_host)
        .use_native_tls();

    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }

    if let Some(connect_timeout) = connect_timeout {
        builder = builder.connect_timeout(connect_timeout);
    }

    builder = apply_proxy_settings(builder, settings)?;
    builder = apply_certificate_settings(builder, settings)?;

    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

fn apply_proxy_settings(
    mut builder: ClientBuilder,
    settings: &DesktopSettings,
) -> Result<ClientBuilder, String> {
    if settings.manual_proxy {
        builder = builder.no_proxy();

        if !settings.pac_url.trim().is_empty() {
            tracing::warn!(
                pac_url = %settings.pac_url,
                "PAC proxy URLs are stored but not applied by the native Zulip client"
            );
        }

        let no_proxy = NoProxy::from_string(settings.bypass_rules.trim());
        let mut applied = 0usize;

        for entry in settings
            .proxy_rules
            .split(';')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
        {
            let (scope, raw_url) = entry
                .split_once('=')
                .map(|(scope, value)| (scope.trim(), value.trim()))
                .unwrap_or(("all", entry));
            let url = normalize_proxy_url(scope, raw_url)?;
            let proxy = match scope {
                "http" => {
                    Proxy::http(&url).map_err(|e| format!("Invalid HTTP proxy '{}': {}", url, e))?
                }
                "https" => Proxy::https(&url)
                    .map_err(|e| format!("Invalid HTTPS proxy '{}': {}", url, e))?,
                "all" | "*" => {
                    Proxy::all(&url).map_err(|e| format!("Invalid proxy '{}': {}", url, e))?
                }
                other => {
                    let fallback = normalize_proxy_url("all", raw_url)?;
                    tracing::warn!(
                        scope = %other,
                        proxy = %fallback,
                        "Unknown proxy rule scope, applying to all protocols"
                    );
                    Proxy::all(&fallback)
                        .map_err(|e| format!("Invalid proxy '{}': {}", fallback, e))?
                }
            }
            .no_proxy(no_proxy.clone());

            builder = builder.proxy(proxy);
            applied += 1;
        }

        if applied == 0 && !settings.pac_url.trim().is_empty() {
            tracing::warn!("Manual proxy mode enabled without supported proxyRules entries");
        }

        return Ok(builder);
    }

    if !settings.use_system_proxy {
        builder = builder.no_proxy();
    }

    Ok(builder)
}

fn apply_certificate_settings(
    mut builder: ClientBuilder,
    settings: &DesktopSettings,
) -> Result<ClientBuilder, String> {
    for path in &settings.trusted_certificates {
        let bytes = fs::read(path)
            .map_err(|e| format!("Failed to read trusted certificate '{}': {}", path, e))?;
        let certificate = Certificate::from_pem(&bytes)
            .or_else(|_| Certificate::from_der(&bytes))
            .map_err(|e| format!("Invalid trusted certificate '{}': {}", path, e))?;
        builder = builder.add_root_certificate(certificate);
    }

    Ok(builder)
}

fn normalize_proxy_url(scope: &str, raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Proxy rule URL is empty".to_string());
    }

    if trimmed.contains("://") {
        return Ok(trimmed.to_string());
    }

    let default_scheme = match scope {
        "https" => "https",
        "http" => "http",
        _ => "http",
    };

    Ok(format!("{}://{}", default_scheme, trimmed))
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
            sanitize_event_id("chat-dev.203.0.113.10.sslip.io"),
            "chat-dev_203_0_113_10_sslip_io"
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
        let org_id = "chat-dev.203.0.113.10.sslip.io";
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

    #[test]
    fn normalize_proxy_url_adds_scope_scheme() {
        assert_eq!(
            normalize_proxy_url("https", "proxy.example:8443").unwrap(),
            "https://proxy.example:8443"
        );
        assert_eq!(
            normalize_proxy_url("http", "http://proxy.example:8080").unwrap(),
            "http://proxy.example:8080"
        );
    }

    #[test]
    fn no_proxy_list_parses_from_comma_separated_rules() {
        let parsed = NoProxy::from_string("localhost,127.0.0.1,*.internal");
        assert!(parsed.is_some());
    }
}
