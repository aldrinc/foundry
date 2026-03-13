use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use reqwest::Url;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::Url as TauriUrl;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;

use crate::commands::{
    build_auth_window, close_auth_windows, focus_main_window, next_auth_window_label,
};
use crate::zulip::supervisor_types::FoundryProviderCredentialResponse;
use crate::zulip::ZulipClient;

const CODEX_OAUTH_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const CODEX_OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_CALLBACK_PATH: &str = "/auth/callback";
const CODEX_SCOPES: &[&str] = &["openid", "profile", "email", "offline_access"];
const CODEX_AUTH_WINDOW_TITLE: &str = "Codex Sign in";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Deserialize)]
struct StoredCodexAuth {
    #[serde(default)]
    auth_mode: String,
    #[serde(default)]
    tokens: StoredCodexTokens,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct StoredCodexTokens {
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    id_token: String,
    #[serde(default)]
    account_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TokenExchangeResponse {
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    id_token: String,
}

#[derive(Debug, Clone)]
struct CallbackPayload {
    code: String,
}

fn random_urlsafe(bytes: usize) -> Result<String, String> {
    let mut value = vec![0u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|error| format!("Failed to generate OAuth randomness: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn pkce_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn default_codex_auth_path() -> Option<PathBuf> {
    let codex_home = env::var("CODEX_HOME")
        .ok()
        .map(|value| value.trim().to_string());
    if let Some(home) = codex_home.filter(|value| !value.is_empty()) {
        return Some(Path::new(&home).join("auth.json"));
    }

    let home = env::var("HOME")
        .ok()
        .map(|value| value.trim().to_string())?;
    if home.is_empty() {
        return None;
    }

    Some(Path::new(&home).join(".codex").join("auth.json"))
}

fn extract_jwt_account_id(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?.trim();
    if payload.is_empty() {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(payload.as_bytes())
        .ok()
        .or_else(|| {
            let mut padded = payload.to_string();
            while padded.len() % 4 != 0 {
                padded.push('=');
            }
            base64::engine::general_purpose::URL_SAFE
                .decode(padded.as_bytes())
                .ok()
        })?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            claims
                .get("chatgpt_account_id")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn load_local_codex_tokens() -> Result<Option<StoredCodexTokens>, String> {
    let Some(path) = default_codex_auth_path() else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let payload = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read local Codex auth at {}: {error}",
            path.display()
        )
    })?;
    let parsed: StoredCodexAuth = serde_json::from_str(&payload).map_err(|error| {
        format!(
            "Failed to parse local Codex auth at {}: {error}",
            path.display()
        )
    })?;
    if parsed.auth_mode.trim() != "chatgpt" {
        return Ok(None);
    }
    if parsed.tokens.access_token.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(parsed.tokens))
}

fn oauth_success_html() -> &'static str {
    "<!doctype html><html><head><meta charset=\"utf-8\" /><title>Codex OAuth</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:24px;color:#111827}.card{max-width:560px;border:1px solid #d1d5db;border-radius:10px;padding:16px 18px;background:#fff}</style></head><body><div class=\"card\"><h2>Authentication complete</h2><p>You can close this window and continue in Foundry.</p></div></body></html>"
}

fn oauth_error_html(detail: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\" /><title>Codex OAuth</title><style>body{{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:24px;color:#111827}}.card{{max-width:560px;border:1px solid #d1d5db;border-radius:10px;padding:16px 18px;background:#fff}}.error{{color:#991b1b}}</style></head><body><div class=\"card\"><h2 class=\"error\">Authentication failed</h2><p>{}</p></div></body></html>",
        detail
    )
}

async fn write_http_response(
    socket: &mut tokio::net::TcpStream,
    status_line: &str,
    body: &str,
) -> Result<(), String> {
    let response = format!(
        "{status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    socket
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("Failed to write OAuth callback response: {error}"))?;
    socket
        .shutdown()
        .await
        .map_err(|error| format!("Failed to close OAuth callback response: {error}"))?;
    Ok(())
}

async fn wait_for_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<CallbackPayload, String> {
    let accept_result = timeout(CALLBACK_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "Timed out waiting for the Codex OAuth callback.".to_string())?;
    let (mut socket, _addr) =
        accept_result.map_err(|error| format!("Failed to accept OAuth callback: {error}"))?;

    let mut buffer = vec![0u8; 8192];
    let read_bytes = socket
        .read(&mut buffer)
        .await
        .map_err(|error| format!("Failed to read OAuth callback: {error}"))?;
    let request = String::from_utf8_lossy(&buffer[..read_bytes]).to_string();
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "OAuth callback request was empty.".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || target.is_empty() {
        let body = oauth_error_html("Invalid OAuth callback request.");
        let _ = write_http_response(&mut socket, "HTTP/1.1 400 Bad Request", &body).await;
        return Err("OAuth callback request was invalid.".to_string());
    }

    let callback_url = Url::parse(&format!("http://localhost{target}"))
        .map_err(|error| format!("Invalid OAuth callback URL: {error}"))?;
    if callback_url.path() != CODEX_CALLBACK_PATH {
        let body = oauth_error_html("Unexpected OAuth callback path.");
        let _ = write_http_response(&mut socket, "HTTP/1.1 400 Bad Request", &body).await;
        return Err("OAuth callback path was invalid.".to_string());
    }

    let params: HashMap<String, String> = callback_url.query_pairs().into_owned().collect();
    if let Some(error) = params
        .get("error")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let detail = params
            .get("error_description")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(error);
        let body = oauth_error_html(detail);
        let _ = write_http_response(&mut socket, "HTTP/1.1 400 Bad Request", &body).await;
        return Err(detail.to_string());
    }

    let state = params
        .get("state")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OAuth callback was missing state.".to_string())?;
    if state != expected_state {
        let body = oauth_error_html("OAuth state mismatch.");
        let _ = write_http_response(&mut socket, "HTTP/1.1 400 Bad Request", &body).await;
        return Err("OAuth state mismatch.".to_string());
    }

    let code = params
        .get("code")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OAuth callback was missing code.".to_string())?;

    let body = oauth_success_html();
    write_http_response(&mut socket, "HTTP/1.1 200 OK", body).await?;
    Ok(CallbackPayload {
        code: code.to_string(),
    })
}

async fn exchange_code_for_tokens(
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<StoredCodexTokens, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(CODEX_OAUTH_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", CODEX_OAUTH_CLIENT_ID),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|error| format!("Codex OAuth token exchange failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Codex OAuth token exchange failed ({status}): {body}"
        ));
    }

    let parsed: TokenExchangeResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse Codex OAuth token response: {error}"))?;
    if parsed.access_token.trim().is_empty() {
        return Err("Codex OAuth token response did not include an access token.".to_string());
    }

    let account_id = extract_jwt_account_id(&parsed.id_token)
        .or_else(|| extract_jwt_account_id(&parsed.access_token))
        .unwrap_or_default();

    Ok(StoredCodexTokens {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        id_token: parsed.id_token,
        account_id,
    })
}

async fn perform_codex_browser_oauth(app: &tauri::AppHandle) -> Result<StoredCodexTokens, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| {
        format!("Failed to start the local Codex OAuth callback server: {error}")
    })?;
    let callback_port = listener
        .local_addr()
        .map_err(|error| format!("Failed to resolve local Codex OAuth callback server: {error}"))?
        .port();
    let redirect_uri = format!("http://localhost:{callback_port}{CODEX_CALLBACK_PATH}");
    let state = random_urlsafe(24)?;
    let code_verifier = random_urlsafe(64)?;
    let code_challenge = pkce_code_challenge(&code_verifier);

    let mut authorize_url = Url::parse(CODEX_OAUTH_AUTHORIZE_URL)
        .map_err(|error| format!("Invalid Codex authorize URL: {error}"))?;
    authorize_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CODEX_OAUTH_CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", &CODEX_SCOPES.join(" "))
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true");

    let parsed_url = TauriUrl::parse(authorize_url.as_str())
        .map_err(|error| format!("Invalid Codex authorize URL: {error}"))?;

    close_auth_windows(app);
    focus_main_window(app);
    let window = build_auth_window(app, next_auth_window_label(), parsed_url, None)?;
    let _ = window.set_title(CODEX_AUTH_WINDOW_TITLE);

    let callback = wait_for_callback(listener, &state).await;
    match callback {
        Ok(payload) => {
            close_auth_windows(app);
            focus_main_window(app);
            exchange_code_for_tokens(&payload.code, &redirect_uri, &code_verifier).await
        }
        Err(error) => {
            close_auth_windows(app);
            focus_main_window(app);
            Err(error)
        }
    }
}

pub async fn connect_codex_oauth(
    app: &tauri::AppHandle,
    client: ZulipClient,
) -> Result<FoundryProviderCredentialResponse, String> {
    let tokens = match load_local_codex_tokens()? {
        Some(tokens) => tokens,
        None => perform_codex_browser_oauth(app).await?,
    };

    client
        .connect_foundry_provider_oauth(
            "codex",
            &tokens.access_token,
            if tokens.refresh_token.trim().is_empty() {
                None
            } else {
                Some(tokens.refresh_token.as_str())
            },
            if tokens.id_token.trim().is_empty() {
                None
            } else {
                Some(tokens.id_token.as_str())
            },
            if tokens.account_id.trim().is_empty() {
                None
            } else {
                Some(tokens.account_id.as_str())
            },
            Some("OAuth"),
        )
        .await
}

#[cfg(test)]
mod tests {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;

    use super::{extract_jwt_account_id, pkce_code_challenge};

    #[test]
    fn pkce_code_challenge_is_stable() {
        assert_eq!(
            pkce_code_challenge("abc123"),
            "bKE9UspwyIPg8LsQHkJaiehiTeUdstI5JZOvaoQRgJA"
        );
    }

    #[test]
    fn extract_jwt_account_id_reads_openai_claim_shape() {
        let payload = URL_SAFE_NO_PAD
            .encode(br#"{"https://api.openai.com/auth":{"chatgpt_account_id":"acct_123"}}"#);
        let token = format!("header.{payload}.sig");
        assert_eq!(extract_jwt_account_id(&token).as_deref(), Some("acct_123"));
    }
}
