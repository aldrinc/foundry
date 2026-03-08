use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Manager;

mod commands;
mod logging;
mod server;
mod supervisor_commands;
mod zulip;

/// Per-organization connection state
pub struct OrgState {
    pub client: zulip::ZulipClient,
    pub event_task: Option<tokio::task::JoinHandle<()>>,
    pub queue_id: Option<String>,
    pub supervisor_task: Option<tokio::task::JoinHandle<()>>,
}

/// Global app state shared across all commands
pub struct AppState {
    pub orgs: Mutex<HashMap<String, OrgState>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            orgs: Mutex::new(HashMap::new()),
        }
    }
}

/// Settings store constants
pub const SETTINGS_STORE: &str = "foundry.settings.dat";
pub const SERVERS_KEY: &str = "servers";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = create_specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when a second instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_mcp_bridge::init())
        .manage(AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            // Initialize logging
            logging::init(app.handle());

            tracing::info!("Foundry Desktop starting");

            // Create the main window
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                initialize(handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Foundry Desktop");
}

/// Create the specta builder with all commands registered
fn create_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::get_server_settings,
        commands::login,
        commands::logout,
        commands::get_messages,
        commands::send_message,
        commands::edit_message,
        commands::delete_message,
        commands::add_reaction,
        commands::remove_reaction,
        commands::update_presence,
        commands::send_typing,
        commands::upload_file,
        commands::update_message_flags,
        commands::mark_stream_as_read,
        commands::mark_topic_as_read,
        commands::get_stream_topics,
        commands::subscribe_stream,
        commands::unsubscribe_stream,
        commands::update_zulip_settings,
        commands::get_zulip_settings,
        server::get_servers,
        server::add_server,
        server::remove_server,
        server::get_config,
        server::set_config,
        // Meridian supervisor commands
        supervisor_commands::get_supervisor_session,
        supervisor_commands::post_supervisor_message,
        supervisor_commands::get_supervisor_sidebar,
        supervisor_commands::control_supervisor_task,
        supervisor_commands::reply_to_task_clarification,
        supervisor_commands::get_meridian_providers,
        supervisor_commands::get_task_events,
        supervisor_commands::start_supervisor_stream,
        supervisor_commands::stop_supervisor_stream,
    ])
}

async fn initialize(app: tauri::AppHandle) {
    tracing::info!("Initializing app");

    // Load saved server configs
    let servers = server::load_servers(&app);
    tracing::info!(count = servers.len(), "Loaded saved servers");

    // Create main window
    let window =
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .visible(false)
            .build();

    match window {
        Ok(win) => {
            // Platform-specific window customization
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                let _ = win.set_title_bar_style(TitleBarStyle::Overlay);
            }

            let _ = win.show();
            tracing::info!("Main window created and shown");
        }
        Err(e) => {
            tracing::error!(?e, "Failed to create main window");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_bindings() {
        let builder = create_specta_builder();
        builder
            .export(
                specta_typescript::Typescript::default()
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                "../src/bindings.ts",
            )
            .expect("Failed to export TypeScript bindings");
    }
}
