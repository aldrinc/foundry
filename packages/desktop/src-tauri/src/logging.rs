use tracing_subscriber::{fmt, EnvFilter};

pub fn init(_app: &tauri::AppHandle) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            EnvFilter::new("zulip_lib=debug")
        } else {
            EnvFilter::new("zulip_lib=info")
        }
    });

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
}
