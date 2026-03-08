use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::zulip::types::SavedServer;
use crate::{SERVERS_KEY, SETTINGS_STORE};

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

    let value = serde_json::to_value(servers)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    store.set(SERVERS_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}

/// Get all saved servers
#[tauri::command]
#[specta::specta]
pub fn get_servers(app: AppHandle) -> Result<Vec<SavedServer>, String> {
    Ok(load_servers(&app))
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
pub fn set_config(
    app: AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&value)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    store.set(&key, parsed);
    store
        .save()
        .map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}
