use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;

mod admin_commands;
mod codex_oauth;
mod commands;
mod logging;
mod server;
mod supervisor_commands;
mod zulip;

/// Per-organization connection state
pub struct OrgState {
    pub client: zulip::ZulipClient,
    pub current_user_id: Option<u64>,
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

pub const TRAY_ID: &str = "foundry-tray";
const TRAY_MENU_SHOW: &str = "tray-show";
const TRAY_MENU_QUIT: &str = "tray-quit";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = create_specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when a second instance is launched
            show_main_window(app);
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .on_menu_event(|app, event| match event.id().0.as_str() {
            TRAY_MENU_SHOW => show_main_window(app),
            TRAY_MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let Ok(settings) = server::load_desktop_settings(window.app_handle()) else {
                    return;
                };

                if settings.quit_on_close {
                    return;
                }

                api.prevent_close();

                if settings.show_tray {
                    let _ = window.hide();
                } else {
                    let _ = window.minimize();
                }
            }
        })
        .manage(AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            if server::updater_is_configured(app.handle()) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            } else {
                tracing::info!(
                    "Updater plugin disabled because no valid updater config is present"
                );
            }
            builder.mount_events(app);

            // Initialize logging
            logging::init(app.handle());

            tracing::info!("Foundry Desktop starting");

            setup_tray(app.handle())?;
            let settings = server::load_desktop_settings(app.handle())?;
            apply_desktop_settings(app.handle(), &settings)?;

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
        commands::fetch_api_key,
        commands::open_external_auth_window,
        commands::logout,
        commands::get_messages,
        commands::get_inbox_priorities,
        commands::get_inbox_assistant_session,
        commands::send_inbox_assistant_message,
        commands::record_inbox_assistant_feedback,
        commands::send_message,
        commands::edit_message,
        commands::delete_message,
        commands::add_reaction,
        commands::remove_reaction,
        commands::update_presence,
        commands::send_typing,
        commands::save_temp_file,
        commands::get_file_size_bytes,
        commands::upload_file,
        commands::fetch_authenticated_media_data_url,
        commands::get_saved_snippets,
        commands::create_saved_snippet,
        commands::update_saved_snippet,
        commands::delete_saved_snippet,
        commands::create_call_link,
        commands::update_message_flags,
        commands::mark_stream_as_read,
        commands::mark_topic_as_read,
        commands::get_stream_topics,
        commands::subscribe_stream,
        commands::unsubscribe_stream,
        commands::update_subscription_properties,
        commands::update_topic_visibility_policy,
        commands::move_topic,
        commands::set_topic_resolved,
        commands::update_zulip_settings,
        commands::get_zulip_settings,
        commands::fetch_link_preview,
        admin_commands::get_users,
        admin_commands::reactivate_user,
        admin_commands::get_realm_presence,
        admin_commands::get_realm_settings,
        admin_commands::update_realm_settings,
        admin_commands::create_realm_domain,
        admin_commands::update_realm_domain,
        admin_commands::delete_realm_domain,
        admin_commands::get_invites,
        admin_commands::send_invites,
        admin_commands::revoke_invite,
        admin_commands::resend_invite,
        admin_commands::get_user_groups,
        admin_commands::create_user_group,
        admin_commands::update_user_group,
        admin_commands::deactivate_user_group,
        admin_commands::get_linkifiers,
        admin_commands::reorder_linkifiers,
        admin_commands::create_linkifier,
        admin_commands::update_linkifier,
        admin_commands::delete_linkifier,
        admin_commands::get_realm_emoji,
        admin_commands::upload_custom_emoji,
        admin_commands::delete_custom_emoji,
        admin_commands::upload_realm_icon,
        admin_commands::delete_realm_icon,
        admin_commands::upload_realm_logo,
        admin_commands::delete_realm_logo,
        admin_commands::get_bots,
        admin_commands::create_bot,
        admin_commands::get_bot_api_key,
        server::get_servers,
        server::get_saved_server_statuses,
        server::add_server,
        server::remove_server,
        server::get_desktop_settings,
        server::set_desktop_settings,
        server::get_desktop_capabilities,
        server::set_unread_badge_count,
        server::play_notification_sound,
        server::get_config,
        server::set_config,
        // Foundry supervisor commands
        supervisor_commands::get_supervisor_session,
        supervisor_commands::post_supervisor_message,
        supervisor_commands::get_supervisor_sidebar,
        supervisor_commands::control_supervisor_task,
        supervisor_commands::reply_to_task_clarification,
        supervisor_commands::get_foundry_providers,
        supervisor_commands::connect_foundry_provider,
        supervisor_commands::disconnect_foundry_provider,
        supervisor_commands::connect_foundry_provider_desktop_oauth,
        supervisor_commands::start_foundry_provider_oauth,
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

            match server::load_desktop_settings(&app) {
                Ok(settings) if settings.start_minimized && settings.show_tray => {
                    tracing::info!("Main window created and left hidden due to startMinimized");
                }
                Ok(settings) if settings.start_minimized => {
                    let _ = win.show();
                    let _ = win.minimize();
                    tracing::info!("Main window created and minimized");
                }
                Ok(_) => {
                    let _ = win.show();
                    tracing::info!("Main window created and shown");
                }
                Err(error) => {
                    tracing::warn!(%error, "Failed to load desktop settings during init");
                    let _ = win.show();
                    tracing::info!("Main window created and shown");
                }
            }
        }
        Err(e) => {
            tracing::error!(?e, "Failed to create main window");
        }
    }
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }

    let menu = MenuBuilder::new(app)
        .text(TRAY_MENU_SHOW, "Show Foundry")
        .separator()
        .text(TRAY_MENU_QUIT, "Quit Foundry")
        .build()?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Foundry")
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    let _tray = tray.build(app)?;

    Ok(())
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        #[cfg(target_os = "macos")]
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.set_focus();
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));

        let focus_window = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = focus_window.show();
            let _ = focus_window.unminimize();
            let _ = focus_window.set_focus();
            let _ = focus_window.set_always_on_top(false);
            #[cfg(target_os = "macos")]
            let _ = focus_window.set_visible_on_all_workspaces(false);
            let _ = focus_window.request_user_attention(None);
        });
    }
}

pub fn apply_desktop_settings(
    app: &tauri::AppHandle,
    settings: &zulip::types::DesktopSettings,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(settings.show_tray)
            .map_err(|e| format!("Failed to update tray visibility: {}", e))?;
    }

    let autolaunch = app.autolaunch();
    if settings.start_at_login {
        autolaunch
            .enable()
            .map_err(|e| format!("Failed to enable start at login: {}", e))?;
    } else {
        autolaunch
            .disable()
            .map_err(|e| format!("Failed to disable start at login: {}", e))?;
    }

    Ok(())
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
