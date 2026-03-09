use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Server settings returned by GET /api/v1/server_settings (unauthenticated)
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ServerSettings {
    pub zulip_version: String,
    pub zulip_feature_level: u32,
    pub push_notifications_enabled: bool,
    #[serde(default)]
    pub realm_name: String,
    #[serde(default)]
    pub realm_icon: String,
    #[serde(default)]
    pub realm_description: String,
    #[serde(default)]
    pub realm_url: String,
    #[serde(default)]
    pub email_auth_enabled: bool,
    #[serde(default = "default_true")]
    pub require_email_format_usernames: bool,
    #[serde(default)]
    pub authentication_methods: AuthMethods,
    #[serde(default)]
    pub external_authentication_methods: Vec<ExternalAuthenticationMethod>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct AuthMethods {
    #[serde(default)]
    pub password: bool,
    #[serde(default)]
    pub email: bool,
    #[serde(default)]
    pub google: bool,
    #[serde(default)]
    pub github: bool,
    #[serde(default)]
    pub ldap: bool,
    #[serde(default)]
    pub dev: bool,
    #[serde(default, rename = "remoteuser")]
    pub remote_user: bool,
    #[serde(default)]
    pub gitlab: bool,
    #[serde(default)]
    pub azuread: bool,
    #[serde(default)]
    pub apple: bool,
    #[serde(default)]
    pub saml: bool,
    #[serde(default, rename = "openid connect")]
    pub openid_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ExternalAuthenticationMethod {
    pub name: String,
    pub display_name: String,
    pub display_icon: Option<String>,
    pub login_url: String,
    pub signup_url: String,
}

fn default_true() -> bool {
    true
}

/// Result of POST /api/v1/fetch_api_key
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FetchApiKeyResult {
    pub api_key: String,
    pub email: String,
    #[serde(default)]
    pub user_id: Option<u64>,
}

/// Result of POST /api/v1/register
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RegisterResponse {
    pub queue_id: String,
    pub last_event_id: i64,
    pub zulip_version: String,
    pub zulip_feature_level: u32,
    /// The logged-in user's ID (returned by Zulip register API)
    #[serde(default)]
    pub user_id: Option<u64>,
    #[serde(default)]
    pub subscriptions: Vec<Subscription>,
    #[serde(default)]
    pub realm_users: Vec<User>,
    #[serde(default)]
    pub user_topics: Vec<UserTopic>,
    #[serde(default)]
    pub unread_msgs: UnreadMessages,
    #[serde(default)]
    pub recent_private_conversations: Vec<RecentPrivateConversation>,
    pub max_message_length: Option<u32>,
}

/// Result of login flow
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LoginResult {
    pub org_id: String,
    pub realm_name: String,
    pub realm_icon: String,
    pub realm_url: String,
    pub queue_id: String,
    /// The logged-in user's ID (from Zulip register response)
    pub user_id: Option<u64>,
    pub subscriptions: Vec<Subscription>,
    pub users: Vec<User>,
    pub user_topics: Vec<UserTopic>,
    pub unread_msgs: UnreadMessages,
    pub recent_private_conversations: Vec<RecentPrivateConversation>,
}

/// Recent DM/group-DM metadata returned by Zulip register.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RecentPrivateConversation {
    #[serde(default)]
    pub user_ids: Vec<u64>,
    pub max_message_id: u64,
}

/// Aggregated unread metadata returned by Zulip register.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct UnreadMessages {
    #[serde(default)]
    pub count: u64,
    #[serde(default)]
    pub pms: Vec<UnreadDirectMessage>,
    #[serde(default)]
    pub streams: Vec<UnreadStream>,
    #[serde(default)]
    pub huddles: Vec<UnreadGroupDirectMessage>,
    #[serde(default)]
    pub mentions: Vec<u64>,
    #[serde(default)]
    pub old_unreads_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UnreadDirectMessage {
    pub other_user_id: Option<u64>,
    pub sender_id: Option<u64>,
    #[serde(default)]
    pub unread_message_ids: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UnreadStream {
    pub topic: String,
    pub stream_id: u64,
    #[serde(default)]
    pub unread_message_ids: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UnreadGroupDirectMessage {
    pub user_ids_string: String,
    #[serde(default)]
    pub unread_message_ids: Vec<u64>,
}

/// Stream/channel subscription
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Subscription {
    pub stream_id: u64,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub invite_only: bool,
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub pin_to_top: bool,
    #[serde(default)]
    pub desktop_notifications: Option<bool>,
    #[serde(default)]
    pub audible_notifications: Option<bool>,
    #[serde(default)]
    pub push_notifications: Option<bool>,
    #[serde(default)]
    pub email_notifications: Option<bool>,
    #[serde(default)]
    pub wildcard_mentions_notify: Option<bool>,
    #[serde(default)]
    pub in_home_view: Option<bool>,
}

/// Per-topic user visibility state returned by Zulip.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UserTopic {
    pub stream_id: u64,
    pub topic_name: String,
    pub last_updated: i64,
    pub visibility_policy: UserTopicVisibilityPolicy,
}

/// Stream topic visibility policy in Zulip.
#[derive(Debug, Clone, Copy, specta::Type)]
pub enum UserTopicVisibilityPolicy {
    Inherit,
    Muted,
    Unmuted,
    Followed,
}

impl UserTopicVisibilityPolicy {
    pub fn as_api_value(self) -> i32 {
        match self {
            Self::Inherit => 0,
            Self::Muted => 1,
            Self::Unmuted => 2,
            Self::Followed => 3,
        }
    }
}

impl Serialize for UserTopicVisibilityPolicy {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let value = match self {
            Self::Inherit => "Inherit",
            Self::Muted => "Muted",
            Self::Unmuted => "Unmuted",
            Self::Followed => "Followed",
        };
        serializer.serialize_str(value)
    }
}

impl<'de> Deserialize<'de> for UserTopicVisibilityPolicy {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value {
            serde_json::Value::Number(number) => match number.as_i64() {
                Some(0) => Ok(Self::Inherit),
                Some(1) => Ok(Self::Muted),
                Some(2) => Ok(Self::Unmuted),
                Some(3) => Ok(Self::Followed),
                Some(other) => Err(serde::de::Error::custom(format!(
                    "unknown user topic visibility policy: {other}"
                ))),
                None => Err(serde::de::Error::custom(
                    "user topic visibility policy must be an integer",
                )),
            },
            serde_json::Value::String(string) => match string.as_str() {
                "inherit" | "Inherit" => Ok(Self::Inherit),
                "muted" | "Muted" => Ok(Self::Muted),
                "unmuted" | "Unmuted" => Ok(Self::Unmuted),
                "followed" | "Followed" => Ok(Self::Followed),
                _ => Err(serde::de::Error::custom(format!(
                    "unknown user topic visibility policy: {string}"
                ))),
            },
            _ => Err(serde::de::Error::custom(
                "user topic visibility policy must be an integer or string",
            )),
        }
    }
}

/// Subscription property names accepted by Zulip's bulk subscription settings API.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionProperty {
    InHomeView,
    IsMuted,
    Color,
    DesktopNotifications,
    AudibleNotifications,
    PushNotifications,
    EmailNotifications,
    PinToTop,
    WildcardMentionsNotify,
}

/// Property value union accepted by Zulip's subscription settings API.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum SubscriptionPropertyValue {
    Bool(bool),
    String(String),
}

/// Single bulk subscription property update request.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SubscriptionPropertyChange {
    pub stream_id: u64,
    pub property: SubscriptionProperty,
    pub value: SubscriptionPropertyValue,
}

/// User profile
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct User {
    pub user_id: u64,
    pub email: String,
    pub full_name: String,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub timezone: String,
    pub role: Option<u32>,
}

/// Display recipient — either a stream name (string) or list of users (DMs)
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum DisplayRecipient {
    Stream(String),
    Users(Vec<DisplayRecipientUser>),
}

/// User in a DM display_recipient
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DisplayRecipientUser {
    pub id: u64,
    pub email: String,
    pub full_name: String,
}

/// A Zulip message
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Message {
    pub id: u64,
    pub sender_id: u64,
    pub sender_full_name: String,
    pub sender_email: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub subject: String,
    pub timestamp: u64,
    pub stream_id: Option<u64>,
    #[serde(default)]
    pub flags: Vec<String>,
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    pub avatar_url: Option<String>,
    pub display_recipient: DisplayRecipient,
}

/// GET /api/v1/messages response
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MessageResponse {
    pub messages: Vec<Message>,
    pub found_newest: bool,
    pub found_oldest: bool,
    pub found_anchor: bool,
}

/// Emoji reaction
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Reaction {
    pub emoji_name: String,
    pub emoji_code: String,
    pub reaction_type: String,
    pub user_id: u64,
}

/// Narrow operand — either a text string or a list of user IDs
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum NarrowOperand {
    Text(String),
    UserIds(Vec<u64>),
}

/// Narrow filter for message queries
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct NarrowFilter {
    pub operator: String,
    pub operand: NarrowOperand,
}

/// Topic within a stream
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Topic {
    pub name: String,
    pub max_id: u64,
}

/// Request to move or rename all messages in a topic.
///
/// `anchor_message_id` can be any message in the topic; callers typically use
/// the topic's `max_id` from `GET /users/me/{stream_id}/topics`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MoveTopicRequest {
    pub anchor_message_id: u64,
    pub new_topic: String,
    #[serde(default)]
    pub new_stream_id: Option<u64>,
    #[serde(default)]
    pub send_notification_to_old_thread: Option<bool>,
    #[serde(default)]
    pub send_notification_to_new_thread: Option<bool>,
}

/// Request to resolve or unresolve a topic by renaming it with Zulip's
/// canonical resolved-topic prefix.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ResolveTopicRequest {
    pub anchor_message_id: u64,
    pub topic_name: String,
    pub resolved: bool,
    #[serde(default)]
    pub send_notification_to_old_thread: Option<bool>,
    #[serde(default)]
    pub send_notification_to_new_thread: Option<bool>,
}

/// Anonymous group-setting value used by Zulip permission settings.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AnonymousGroupSetting {
    #[serde(default)]
    pub direct_subgroups: Vec<u64>,
    #[serde(default)]
    pub direct_members: Vec<u64>,
}

/// Group-setting value returned by Zulip for organization permissions.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum GroupSettingValue {
    UserGroupId(u64),
    AnonymousGroup(AnonymousGroupSetting),
}

/// Configuration metadata for a Zulip group permission setting.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct GroupPermissionSetting {
    #[serde(default)]
    pub require_system_group: bool,
    #[serde(default)]
    pub allow_internet_group: bool,
    #[serde(default)]
    pub allow_nobody_group: bool,
    #[serde(default)]
    pub allow_everyone_group: bool,
    #[serde(default)]
    pub default_group_name: String,
    #[serde(default)]
    pub default_for_system_groups: Option<String>,
    #[serde(default)]
    pub allowed_system_groups: Vec<String>,
}

/// Server-advertised permission-setting support for realm, stream, and group scopes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ServerSupportedPermissionSettings {
    #[serde(default)]
    pub realm: HashMap<String, GroupPermissionSetting>,
    #[serde(default)]
    pub stream: HashMap<String, GroupPermissionSetting>,
    #[serde(default)]
    pub group: HashMap<String, GroupPermissionSetting>,
}

/// Organization-level topic policy.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RealmTopicsPolicy {
    #[default]
    AllowEmptyTopic,
    DisableEmptyTopic,
}

/// Organization email-domain restriction entry.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RealmDomain {
    pub domain: String,
    pub allow_subdomains: bool,
}

/// Snapshot of organization settings needed by the admin/settings UI.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RealmSettingsSnapshot {
    #[serde(default)]
    pub realm_name: String,
    #[serde(default)]
    pub realm_description: String,
    #[serde(default)]
    pub realm_icon_url: String,
    #[serde(default)]
    pub realm_icon_source: String,
    #[serde(default)]
    pub realm_logo_url: String,
    #[serde(default)]
    pub realm_logo_source: String,
    #[serde(default)]
    pub realm_night_logo_url: String,
    #[serde(default)]
    pub realm_night_logo_source: String,
    #[serde(default)]
    pub max_icon_file_size_mib: u32,
    #[serde(default)]
    pub max_logo_file_size_mib: u32,
    #[serde(default)]
    pub zulip_plan_is_not_limited: bool,
    #[serde(default)]
    pub realm_invite_required: bool,
    #[serde(default)]
    pub realm_emails_restricted_to_domains: bool,
    #[serde(default)]
    pub realm_waiting_period_threshold: u32,
    #[serde(default)]
    pub realm_allow_message_editing: bool,
    #[serde(default)]
    pub realm_message_content_edit_limit_seconds: Option<u32>,
    #[serde(default)]
    pub realm_message_content_delete_limit_seconds: Option<u32>,
    #[serde(default)]
    pub realm_topics_policy: RealmTopicsPolicy,
    #[serde(default)]
    pub realm_create_multiuse_invite_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_invite_users_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_create_web_public_channel_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_create_public_channel_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_create_private_channel_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_add_subscribers_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_mention_many_users_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_manage_all_groups: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_create_groups: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_direct_message_permission_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_direct_message_initiator_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_move_messages_between_channels_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_move_messages_between_topics_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_resolve_topics_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_delete_any_message_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_delete_own_message_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_set_delete_message_policy_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_set_topics_policy_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_access_all_users_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_manage_billing_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_summarize_topics_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_create_write_only_bots_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_create_bots_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub realm_can_add_custom_emoji_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub server_supported_permission_settings: ServerSupportedPermissionSettings,
    #[serde(default)]
    pub realm_domains: Vec<RealmDomain>,
}

/// Topics response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicsResponse {
    pub topics: Vec<Topic>,
}

/// Event from the event queue (internal only — not exposed via specta)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Events response from GET /api/v1/events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventsResponse {
    pub events: Vec<Event>,
}

/// Send message result
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SendResult {
    pub id: u64,
}

/// Upload file result
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UploadResult {
    pub url: String,
    #[serde(default)]
    pub uri: Option<String>,
}

/// Saved server configuration
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SavedServer {
    pub id: String,
    pub url: String,
    pub email: String,
    pub api_key: String,
    pub realm_name: String,
    pub realm_icon: String,
}

/// Saved server plus current connection state.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SavedServerStatus {
    pub id: String,
    pub url: String,
    pub email: String,
    pub realm_name: String,
    pub realm_icon: String,
    pub connected: bool,
    pub org_id: Option<String>,
}

/// Desktop-shell settings that the frontend can treat as a stable native contract.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DesktopSettings {
    pub start_at_login: bool,
    pub start_minimized: bool,
    pub show_tray: bool,
    pub quit_on_close: bool,
    pub auto_update: bool,
    pub beta_updates: bool,
    pub spellcheck: bool,
    pub custom_css: String,
    pub download_location: String,
    pub use_system_proxy: bool,
    pub manual_proxy: bool,
    pub pac_url: String,
    pub proxy_rules: String,
    pub bypass_rules: String,
    #[serde(default)]
    pub trusted_certificates: Vec<String>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            start_at_login: false,
            start_minimized: false,
            show_tray: true,
            quit_on_close: false,
            auto_update: true,
            beta_updates: false,
            spellcheck: true,
            custom_css: String::new(),
            download_location: String::new(),
            use_system_proxy: true,
            manual_proxy: false,
            pac_url: String::new(),
            proxy_rules: String::new(),
            bypass_rules: String::new(),
            trusted_certificates: Vec::new(),
        }
    }
}

/// Native/backend feature support advertised to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DesktopCapabilities {
    pub multi_org: bool,
    pub saved_server_status: bool,
    pub uploads: bool,
    pub typing_notifications: bool,
    pub presence_updates: bool,
    pub realm_presence: bool,
    pub invites: bool,
    pub user_groups: bool,
    pub linkifiers: bool,
    pub custom_emoji: bool,
    pub bots: bool,
    pub bot_api_key: bool,
    pub spellcheck_settings: bool,
    pub tray: bool,
    pub badge_count: bool,
    pub start_at_login: bool,
    pub updater: bool,
    pub proxy_settings: bool,
    pub custom_certificates: bool,
    pub inline_notification_reply: bool,
    pub directory_picker: bool,
}

/// GET /api/v1/users response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsersResponse {
    pub members: Vec<User>,
}

/// GET /api/v1/realm/presence response.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RealmPresenceResponse {
    pub server_timestamp: f64,
    pub presences: HashMap<String, serde_json::Value>,
}

/// Invitation returned by GET /api/v1/invites.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Invite {
    pub id: u64,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub expiry_date: Option<u64>,
    #[serde(default)]
    pub invited: Option<u64>,
    #[serde(default)]
    pub invited_as: Option<u32>,
    #[serde(default)]
    pub invited_by_user_id: Option<u64>,
    #[serde(default)]
    pub notify_referrer_on_join: Option<bool>,
    #[serde(default)]
    pub is_multiuse: Option<bool>,
    #[serde(default)]
    pub link_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvitesResponse {
    pub invites: Vec<Invite>,
}

/// Minimal typed response for POST /api/v1/invites.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SendInvitesResponse {
    #[serde(default)]
    pub invited_emails: Vec<String>,
    #[serde(default)]
    pub already_invited: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub skipped: HashMap<String, Vec<String>>,
}

/// User group returned by GET /api/v1/user_groups.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UserGroup {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub creator_id: Option<u64>,
    #[serde(default)]
    pub date_created: Option<u64>,
    #[serde(default)]
    pub members: Vec<u64>,
    #[serde(default)]
    pub direct_subgroup_ids: Vec<u64>,
    #[serde(default)]
    pub is_system_group: bool,
    #[serde(default)]
    pub deactivated: bool,
    #[serde(default)]
    pub can_add_members_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub can_join_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub can_leave_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub can_manage_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub can_mention_group: Option<GroupSettingValue>,
    #[serde(default)]
    pub can_remove_members_group: Option<GroupSettingValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserGroupsResponse {
    pub user_groups: Vec<UserGroup>,
}

/// Response from POST /api/v1/user_groups/create.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreateUserGroupResponse {
    pub group_id: u64,
}

/// Linkifier entry returned by GET /api/v1/realm/linkifiers.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Linkifier {
    pub id: u64,
    pub pattern: String,
    pub url_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkifiersResponse {
    pub linkifiers: Vec<Linkifier>,
}

/// Response from POST /api/v1/realm/filters.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinkifierCreateResponse {
    pub id: u64,
}

/// Realm custom emoji entry.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RealmEmoji {
    pub id: String,
    pub name: String,
    pub source_url: String,
    #[serde(default)]
    pub deactivated: bool,
    #[serde(default)]
    pub author_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealmEmojiResponse {
    pub emoji: HashMap<String, RealmEmoji>,
}

/// Bot info returned by GET /api/v1/bots.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Bot {
    pub username: String,
    pub full_name: String,
    pub api_key: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub default_sending_stream: Option<String>,
    #[serde(default)]
    pub default_events_register_stream: Option<String>,
    #[serde(default)]
    pub default_all_public_streams: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotsResponse {
    pub bots: Vec<Bot>,
}

/// Response from POST /api/v1/bots.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CreateBotResponse {
    pub user_id: u64,
    pub api_key: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub default_sending_stream: Option<String>,
    #[serde(default)]
    pub default_events_register_stream: Option<String>,
    #[serde(default)]
    pub default_all_public_streams: Option<bool>,
}

/// Response from GET /api/v1/bots/{bot_id}/api_key.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct BotApiKeyResponse {
    pub api_key: String,
}

/// Message type for sending
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum MessageType {
    #[serde(rename = "stream")]
    Stream,
    #[serde(rename = "direct")]
    Direct,
}

/// Target for sending a message
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum MessageTarget {
    Stream(String),
    UserIds(Vec<u64>),
}

/// Flag operations
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum FlagOp {
    #[serde(rename = "add")]
    Add,
    #[serde(rename = "remove")]
    Remove,
}

/// Message flags
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum MessageFlag {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "starred")]
    Starred,
    #[serde(rename = "collapsed")]
    Collapsed,
}

/// Typing operation
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum TypingOp {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "stop")]
    Stop,
}

/// Presence status
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum PresenceStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "idle")]
    Idle,
}

/// Anchor for message queries
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum Anchor {
    Newest,
    Oldest,
    FirstUnread,
    MessageId(u64),
}

impl std::fmt::Display for Anchor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Anchor::Newest => write!(f, "newest"),
            Anchor::Oldest => write!(f, "oldest"),
            Anchor::FirstUnread => write!(f, "first_unread"),
            Anchor::MessageId(id) => write!(f, "{}", id),
        }
    }
}
