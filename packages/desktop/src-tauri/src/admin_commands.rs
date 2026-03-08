use tauri::State;

use crate::commands::get_client;
use crate::zulip::types::*;
use crate::AppState;

async fn read_upload_file(
    file_path: &str,
    fallback_name: &str,
) -> Result<(Vec<u8>, String), String> {
    let file_bytes = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let file_name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(fallback_name)
        .to_string();

    Ok((file_bytes, file_name))
}

/// Fetch the current set of users from the Zulip server.
#[tauri::command]
#[specta::specta]
pub async fn get_users(state: State<'_, AppState>, org_id: String) -> Result<Vec<User>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_users().await
}

/// Reactivate a deactivated user.
#[tauri::command]
#[specta::specta]
pub async fn reactivate_user(
    state: State<'_, AppState>,
    org_id: String,
    user_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.reactivate_user(user_id).await
}

/// Fetch presence data for the current organization.
#[tauri::command]
#[specta::specta]
pub async fn get_realm_presence(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<RealmPresenceResponse, String> {
    let client = get_client(&state, &org_id)?;
    client.get_realm_presence().await
}

/// Fetch a typed snapshot of organization settings and configured email domains.
#[tauri::command]
#[specta::specta]
pub async fn get_realm_settings(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<RealmSettingsSnapshot, String> {
    let client = get_client(&state, &org_id)?;
    client.get_realm_settings().await
}

/// Update organization-level settings using Zulip API key names.
/// `settings_json` is a JSON string such as `{"name":"Acme","invite_required":true}`.
#[tauri::command]
#[specta::specta]
pub async fn update_realm_settings(
    state: State<'_, AppState>,
    org_id: String,
    settings_json: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.update_realm_settings(&settings_json).await
}

/// Add a new organization email domain restriction.
#[tauri::command]
#[specta::specta]
pub async fn create_realm_domain(
    state: State<'_, AppState>,
    org_id: String,
    domain: String,
    allow_subdomains: bool,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.create_realm_domain(&domain, allow_subdomains).await
}

/// Update the subdomain policy for an organization email domain.
#[tauri::command]
#[specta::specta]
pub async fn update_realm_domain(
    state: State<'_, AppState>,
    org_id: String,
    domain: String,
    allow_subdomains: bool,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.update_realm_domain(&domain, allow_subdomains).await
}

/// Remove an organization email domain restriction.
#[tauri::command]
#[specta::specta]
pub async fn delete_realm_domain(
    state: State<'_, AppState>,
    org_id: String,
    domain: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.delete_realm_domain(&domain).await
}

/// Fetch all manageable invitations.
#[tauri::command]
#[specta::specta]
pub async fn get_invites(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<Vec<Invite>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_invites().await
}

/// Send email invitations.
#[tauri::command]
#[specta::specta]
pub async fn send_invites(
    state: State<'_, AppState>,
    org_id: String,
    invitee_emails: String,
    invite_expires_in_minutes: Option<u32>,
    invite_as: Option<u32>,
    stream_ids: Vec<u64>,
) -> Result<SendInvitesResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .send_invites(
            &invitee_emails,
            invite_expires_in_minutes,
            invite_as,
            &stream_ids,
        )
        .await
}

/// Revoke an email invitation.
#[tauri::command]
#[specta::specta]
pub async fn revoke_invite(
    state: State<'_, AppState>,
    org_id: String,
    invite_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.revoke_invite(invite_id).await
}

/// Resend an email invitation.
#[tauri::command]
#[specta::specta]
pub async fn resend_invite(
    state: State<'_, AppState>,
    org_id: String,
    invite_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.resend_invite(invite_id).await
}

/// Fetch user groups for the current organization.
#[tauri::command]
#[specta::specta]
pub async fn get_user_groups(
    state: State<'_, AppState>,
    org_id: String,
    include_deactivated_groups: bool,
) -> Result<Vec<UserGroup>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_user_groups(include_deactivated_groups).await
}

/// Create a user group.
#[tauri::command]
#[specta::specta]
pub async fn create_user_group(
    state: State<'_, AppState>,
    org_id: String,
    name: String,
    description: String,
    members: Vec<u64>,
) -> Result<CreateUserGroupResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .create_user_group(&name, &description, &members)
        .await
}

/// Update the metadata for a user group.
#[tauri::command]
#[specta::specta]
pub async fn update_user_group(
    state: State<'_, AppState>,
    org_id: String,
    user_group_id: u64,
    name: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .update_user_group(user_group_id, name.as_deref(), description.as_deref())
        .await
}

/// Deactivate a user group.
#[tauri::command]
#[specta::specta]
pub async fn deactivate_user_group(
    state: State<'_, AppState>,
    org_id: String,
    user_group_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.deactivate_user_group(user_group_id).await
}

/// Fetch all realm linkifiers.
#[tauri::command]
#[specta::specta]
pub async fn get_linkifiers(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<Vec<Linkifier>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_linkifiers().await
}

/// Change linkifier evaluation order.
#[tauri::command]
#[specta::specta]
pub async fn reorder_linkifiers(
    state: State<'_, AppState>,
    org_id: String,
    ordered_linkifier_ids: Vec<u64>,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.reorder_linkifiers(&ordered_linkifier_ids).await
}

/// Create a linkifier.
#[tauri::command]
#[specta::specta]
pub async fn create_linkifier(
    state: State<'_, AppState>,
    org_id: String,
    pattern: String,
    url_template: String,
) -> Result<LinkifierCreateResponse, String> {
    let client = get_client(&state, &org_id)?;
    client.create_linkifier(&pattern, &url_template).await
}

/// Update a linkifier.
#[tauri::command]
#[specta::specta]
pub async fn update_linkifier(
    state: State<'_, AppState>,
    org_id: String,
    filter_id: u64,
    pattern: String,
    url_template: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client
        .update_linkifier(filter_id, &pattern, &url_template)
        .await
}

/// Delete a linkifier.
#[tauri::command]
#[specta::specta]
pub async fn delete_linkifier(
    state: State<'_, AppState>,
    org_id: String,
    filter_id: u64,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.delete_linkifier(filter_id).await
}

/// Fetch custom emoji for the organization.
#[tauri::command]
#[specta::specta]
pub async fn get_realm_emoji(
    state: State<'_, AppState>,
    org_id: String,
) -> Result<Vec<RealmEmoji>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_realm_emoji().await
}

/// Upload a custom emoji asset.
#[tauri::command]
#[specta::specta]
pub async fn upload_custom_emoji(
    state: State<'_, AppState>,
    org_id: String,
    emoji_name: String,
    file_path: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    let (file_bytes, file_name) = read_upload_file(&file_path, "emoji").await?;

    client
        .upload_custom_emoji(&emoji_name, file_bytes, &file_name)
        .await
}

/// Deactivate a custom emoji.
#[tauri::command]
#[specta::specta]
pub async fn delete_custom_emoji(
    state: State<'_, AppState>,
    org_id: String,
    emoji_name: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.delete_custom_emoji(&emoji_name).await
}

/// Upload an organization icon asset.
#[tauri::command]
#[specta::specta]
pub async fn upload_realm_icon(
    state: State<'_, AppState>,
    org_id: String,
    file_path: String,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    let (file_bytes, file_name) = read_upload_file(&file_path, "icon").await?;
    client.upload_realm_icon(file_bytes, &file_name).await
}

/// Reset the organization icon to the default source.
#[tauri::command]
#[specta::specta]
pub async fn delete_realm_icon(state: State<'_, AppState>, org_id: String) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.delete_realm_icon().await
}

/// Upload a light or dark organization logo asset.
#[tauri::command]
#[specta::specta]
pub async fn upload_realm_logo(
    state: State<'_, AppState>,
    org_id: String,
    file_path: String,
    night: bool,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    let (file_bytes, file_name) = read_upload_file(&file_path, "logo").await?;
    client
        .upload_realm_logo(file_bytes, &file_name, night)
        .await
}

/// Reset the light or dark organization logo to the default source.
#[tauri::command]
#[specta::specta]
pub async fn delete_realm_logo(
    state: State<'_, AppState>,
    org_id: String,
    night: bool,
) -> Result<(), String> {
    let client = get_client(&state, &org_id)?;
    client.delete_realm_logo(night).await
}

/// Fetch bots the current user can administer.
#[tauri::command]
#[specta::specta]
pub async fn get_bots(state: State<'_, AppState>, org_id: String) -> Result<Vec<Bot>, String> {
    let client = get_client(&state, &org_id)?;
    client.get_bots().await
}

/// Create a bot or integration user.
#[tauri::command]
#[specta::specta]
pub async fn create_bot(
    state: State<'_, AppState>,
    org_id: String,
    full_name: String,
    short_name: String,
    bot_type: u32,
    service_name: Option<String>,
    payload_url: Option<String>,
) -> Result<CreateBotResponse, String> {
    let client = get_client(&state, &org_id)?;
    client
        .create_bot(
            &full_name,
            &short_name,
            bot_type,
            service_name.as_deref(),
            payload_url.as_deref(),
        )
        .await
}

/// Fetch the API key for a bot.
#[tauri::command]
#[specta::specta]
pub async fn get_bot_api_key(
    state: State<'_, AppState>,
    org_id: String,
    bot_id: u64,
) -> Result<BotApiKeyResponse, String> {
    let client = get_client(&state, &org_id)?;
    client.get_bot_api_key(bot_id).await
}
