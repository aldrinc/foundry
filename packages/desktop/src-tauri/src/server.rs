#[cfg(target_os = "macos")]
use std::process::Command;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;

use crate::zulip::types::{DesktopCapabilities, DesktopSettings, SavedServer, SavedServerStatus};
use crate::{AppState, SERVERS_KEY, SETTINGS_STORE};

const APP_SETTINGS_KEY: &str = "app_settings";

/// Load saved servers from persistent store
pub fn load_servers(app: &AppHandle) -> Vec<SavedServer> {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return vec![];
    };

    let value = store.get(SERVERS_KEY);
    match value {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_default(),
        None => vec![],
    }
}

/// Save servers to persistent store
fn save_servers(app: &AppHandle, servers: &[SavedServer]) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let value = serde_json::to_value(servers).map_err(|e| format!("Failed to serialize: {}", e))?;

    store.set(SERVERS_KEY, value);
    store.save().map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}

fn merge_desktop_settings(raw: Option<&serde_json::Value>) -> DesktopSettings {
    let mut settings = DesktopSettings::default();
    let Some(raw) = raw else {
        return settings;
    };
    let Some(obj) = raw.as_object() else {
        return settings;
    };

    macro_rules! bool_field {
        ($json:literal, $field:ident) => {
            if let Some(value) = obj.get($json).and_then(serde_json::Value::as_bool) {
                settings.$field = value;
            }
        };
    }

    macro_rules! string_field {
        ($json:literal, $field:ident) => {
            if let Some(value) = obj.get($json).and_then(serde_json::Value::as_str) {
                settings.$field = value.to_string();
            }
        };
    }

    bool_field!("startAtLogin", start_at_login);
    bool_field!("startMinimized", start_minimized);
    bool_field!("showTray", show_tray);
    bool_field!("quitOnClose", quit_on_close);
    bool_field!("autoUpdate", auto_update);
    bool_field!("betaUpdates", beta_updates);
    bool_field!("spellcheck", spellcheck);
    string_field!("customCSS", custom_css);
    string_field!("downloadLocation", download_location);
    bool_field!("useSystemProxy", use_system_proxy);
    bool_field!("manualProxy", manual_proxy);
    string_field!("pacUrl", pac_url);
    string_field!("proxyRules", proxy_rules);
    string_field!("bypassRules", bypass_rules);
    if let Some(values) = obj
        .get("trustedCertificates")
        .and_then(serde_json::Value::as_array)
    {
        settings.trusted_certificates = values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(ToString::to_string)
            .collect();
    }

    settings
}

fn upsert_desktop_settings(app: &AppHandle, settings: &DesktopSettings) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let mut root = store
        .get(APP_SETTINGS_KEY)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    root.insert(
        "startAtLogin".to_string(),
        serde_json::Value::Bool(settings.start_at_login),
    );
    root.insert(
        "startMinimized".to_string(),
        serde_json::Value::Bool(settings.start_minimized),
    );
    root.insert(
        "showTray".to_string(),
        serde_json::Value::Bool(settings.show_tray),
    );
    root.insert(
        "quitOnClose".to_string(),
        serde_json::Value::Bool(settings.quit_on_close),
    );
    root.insert(
        "autoUpdate".to_string(),
        serde_json::Value::Bool(settings.auto_update),
    );
    root.insert(
        "betaUpdates".to_string(),
        serde_json::Value::Bool(settings.beta_updates),
    );
    root.insert(
        "spellcheck".to_string(),
        serde_json::Value::Bool(settings.spellcheck),
    );
    root.insert(
        "customCSS".to_string(),
        serde_json::Value::String(settings.custom_css.clone()),
    );
    root.insert(
        "downloadLocation".to_string(),
        serde_json::Value::String(settings.download_location.clone()),
    );
    root.insert(
        "useSystemProxy".to_string(),
        serde_json::Value::Bool(settings.use_system_proxy),
    );
    root.insert(
        "manualProxy".to_string(),
        serde_json::Value::Bool(settings.manual_proxy),
    );
    root.insert(
        "pacUrl".to_string(),
        serde_json::Value::String(settings.pac_url.clone()),
    );
    root.insert(
        "proxyRules".to_string(),
        serde_json::Value::String(settings.proxy_rules.clone()),
    );
    root.insert(
        "bypassRules".to_string(),
        serde_json::Value::String(settings.bypass_rules.clone()),
    );
    root.insert(
        "trustedCertificates".to_string(),
        serde_json::Value::Array(
            settings
                .trusted_certificates
                .iter()
                .cloned()
                .map(serde_json::Value::String)
                .collect(),
        ),
    );

    store.set(APP_SETTINGS_KEY, serde_json::Value::Object(root));
    store.save().map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}

pub fn load_desktop_settings(app: &AppHandle) -> Result<DesktopSettings, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open store: {}", e))?;
    let raw = store.get(APP_SETTINGS_KEY);
    Ok(merge_desktop_settings(raw.as_ref()))
}

fn has_valid_updater_config(raw: Option<&serde_json::Value>) -> bool {
    let Some(raw) = raw else {
        return false;
    };

    let Ok(config) = serde_json::from_value::<tauri_plugin_updater::Config>(raw.clone()) else {
        return false;
    };

    !config.pubkey.trim().is_empty() && !config.endpoints.is_empty()
}

pub fn updater_is_configured(app: &AppHandle) -> bool {
    has_valid_updater_config(app.config().plugins.0.get("updater"))
}

/// Get all saved servers
#[tauri::command]
#[specta::specta]
pub fn get_servers(app: AppHandle) -> Result<Vec<SavedServer>, String> {
    Ok(load_servers(&app))
}

/// Get saved servers along with whether they are currently connected in this app session.
#[tauri::command]
#[specta::specta]
pub fn get_saved_server_statuses(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SavedServerStatus>, String> {
    let orgs = state
        .orgs
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let statuses = load_servers(&app)
        .into_iter()
        .map(|server| {
            let connected = orgs.contains_key(&server.id);
            SavedServerStatus {
                id: server.id.clone(),
                url: server.url,
                email: server.email,
                realm_name: server.realm_name,
                realm_icon: server.realm_icon,
                connected,
                org_id: connected.then_some(server.id),
            }
        })
        .collect();

    Ok(statuses)
}

/// Add a server to the saved list
#[tauri::command]
#[specta::specta]
pub fn add_server(app: AppHandle, server: SavedServer) -> Result<(), String> {
    let mut servers = load_servers(&app);

    // Remove existing with same ID to avoid duplicates
    servers.retain(|s| s.id != server.id);
    servers.push(server);

    save_servers(&app, &servers)
}

/// Remove a server from the saved list
#[tauri::command]
#[specta::specta]
pub fn remove_server(app: AppHandle, server_id: String) -> Result<(), String> {
    let mut servers = load_servers(&app);
    servers.retain(|s| s.id != server_id);
    save_servers(&app, &servers)
}

/// Return the native desktop settings contract as a typed object.
#[tauri::command]
#[specta::specta]
pub fn get_desktop_settings(app: AppHandle) -> Result<DesktopSettings, String> {
    load_desktop_settings(&app)
}

/// Persist the native desktop settings contract.
#[tauri::command]
#[specta::specta]
pub fn set_desktop_settings(
    app: AppHandle,
    settings: DesktopSettings,
) -> Result<DesktopSettings, String> {
    upsert_desktop_settings(&app, &settings)?;
    crate::apply_desktop_settings(&app, &settings)?;
    Ok(settings)
}

/// Update the platform unread badge count on the main window.
#[tauri::command]
#[specta::specta]
pub fn set_unread_badge_count(app: AppHandle, count: Option<i64>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not available".to_string())?;
    let tooltip = match count.filter(|value| *value > 0) {
        Some(value) => format!("Foundry ({value} unread)"),
        None => "Foundry".to_string(),
    };

    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        if let Err(error) = tray.set_tooltip(Some(tooltip)) {
            tracing::warn!(?error, "Failed to update tray tooltip");
        }
    }

    app.run_on_main_thread(move || {
        if let Err(error) = window.set_badge_count(count) {
            tracing::warn!(?error, "Failed to update badge count");
        }

        #[cfg(target_os = "macos")]
        {
            let badge_label = count
                .filter(|value| *value > 0)
                .map(|value| value.to_string());
            if let Err(error) = window.set_badge_label(badge_label) {
                tracing::warn!(?error, "Failed to update badge label");
            }
        }
    })
    .map_err(|e| format!("Failed to schedule unread badge update: {}", e))
}

/// Play the bundled desktop notification sound from the native layer.
#[tauri::command]
#[specta::specta]
pub fn play_notification_sound(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sound_path = _app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to resolve resource directory: {}", e))?
            .join("notifications")
            .join("default.wav");

        Command::new("afplay")
            .arg(&sound_path)
            .spawn()
            .map_err(|e| format!("Failed to launch notification sound: {}", e))?;
    }

    Ok(())
}

/// Report native/backend feature support for frontend planning and gating.
#[tauri::command]
#[specta::specta]
pub fn get_desktop_capabilities(app: AppHandle) -> DesktopCapabilities {
    DesktopCapabilities {
        multi_org: true,
        saved_server_status: true,
        uploads: true,
        typing_notifications: true,
        presence_updates: true,
        realm_presence: true,
        invites: true,
        user_groups: true,
        linkifiers: true,
        custom_emoji: true,
        bots: true,
        bot_api_key: true,
        spellcheck_settings: false,
        tray: true,
        badge_count: true,
        start_at_login: true,
        updater: updater_is_configured(&app),
        proxy_settings: true,
        custom_certificates: true,
        inline_notification_reply: false,
        directory_picker: true,
    }
}

/// Get app config value as JSON string (caller parses)
#[tauri::command]
#[specta::specta]
pub fn get_config(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    match store.get(&key) {
        Some(v) => Ok(Some(
            serde_json::to_string(&v).map_err(|e| format!("Serialize error: {}", e))?,
        )),
        None => Ok(None),
    }
}

/// Set app config value from JSON string (caller serializes)
#[tauri::command]
#[specta::specta]
pub fn set_config(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let parsed: serde_json::Value =
        serde_json::from_str(&value).map_err(|e| format!("Invalid JSON: {}", e))?;

    store.set(&key, parsed);
    store.save().map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_desktop_settings_reads_supported_subset() {
        let raw = serde_json::json!({
            "startAtLogin": true,
            "startMinimized": true,
            "showTray": false,
            "quitOnClose": true,
            "autoUpdate": false,
            "betaUpdates": true,
            "spellcheck": false,
            "customCSS": "body { color: red; }",
            "downloadLocation": "/tmp/downloads",
            "useSystemProxy": false,
            "manualProxy": true,
            "pacUrl": "https://proxy.example/pac",
            "proxyRules": "http=proxy.example:8080",
            "bypassRules": "localhost",
            "trustedCertificates": ["/tmp/foundry-dev.pem", "/tmp/foundry-root.der"]
        });

        let settings = merge_desktop_settings(Some(&raw));
        assert!(settings.start_at_login);
        assert!(settings.start_minimized);
        assert!(!settings.show_tray);
        assert!(settings.quit_on_close);
        assert!(!settings.auto_update);
        assert!(settings.beta_updates);
        assert!(!settings.spellcheck);
        assert_eq!(settings.custom_css, "body { color: red; }");
        assert_eq!(settings.download_location, "/tmp/downloads");
        assert!(!settings.use_system_proxy);
        assert!(settings.manual_proxy);
        assert_eq!(settings.pac_url, "https://proxy.example/pac");
        assert_eq!(settings.proxy_rules, "http=proxy.example:8080");
        assert_eq!(settings.bypass_rules, "localhost");
        assert_eq!(
            settings.trusted_certificates,
            vec![
                "/tmp/foundry-dev.pem".to_string(),
                "/tmp/foundry-root.der".to_string()
            ]
        );
    }

    #[test]
    fn merge_desktop_settings_defaults_when_missing() {
        let settings = merge_desktop_settings(None);
        assert_eq!(
            settings.start_at_login,
            DesktopSettings::default().start_at_login
        );
        assert_eq!(settings.show_tray, DesktopSettings::default().show_tray);
        assert_eq!(settings.download_location, "");
        assert!(settings.use_system_proxy);
    }

    #[test]
    fn updater_config_requires_endpoints_and_pubkey() {
        let valid = serde_json::json!({
            "endpoints": ["https://updates.example.com/latest.json"],
            "pubkey": "pubkey-value"
        });
        let missing_endpoints = serde_json::json!({
            "endpoints": [],
            "pubkey": "pubkey-value"
        });
        let missing_pubkey = serde_json::json!({
            "endpoints": ["https://updates.example.com/latest.json"],
            "pubkey": ""
        });

        assert!(has_valid_updater_config(Some(&valid)));
        assert!(!has_valid_updater_config(Some(&missing_endpoints)));
        assert!(!has_valid_updater_config(Some(&missing_pubkey)));
        assert!(!has_valid_updater_config(None));
    }
}
