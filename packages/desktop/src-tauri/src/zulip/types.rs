use serde::{Deserialize, Serialize};

/// Server settings returned by GET /api/v1/server_settings (unauthenticated)
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ServerSettings {
    pub zulip_version: String,
    pub zulip_feature_level: u32,
    pub push_notifications_enabled: bool,
    pub realm_name: String,
    pub realm_icon: String,
    pub realm_description: String,
    #[serde(default)]
    pub authentication_methods: AuthMethods,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct AuthMethods {
    #[serde(default)]
    pub password: bool,
    #[serde(default)]
    pub google: bool,
    #[serde(default)]
    pub github: bool,
    #[serde(default)]
    pub ldap: bool,
    #[serde(default)]
    pub dev: bool,
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
    pub max_message_length: Option<u32>,
}

/// Result of login flow
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LoginResult {
    pub org_id: String,
    pub realm_name: String,
    pub realm_icon: String,
    pub queue_id: String,
    /// The logged-in user's ID (from Zulip register response)
    pub user_id: Option<u64>,
    pub subscriptions: Vec<Subscription>,
    pub users: Vec<User>,
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
