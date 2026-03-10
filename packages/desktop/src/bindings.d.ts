/** user-defined commands **/
export declare const commands: {
    /**
     * GET /api/v1/server_settings (unauthenticated)
     * Discovers server capabilities and authentication methods
     */
    getServerSettings(url: string): Promise<Result<ServerSettings, string>>;
    /**
     * Authenticate with a Zulip server and start the event queue
     */
    login(url: string, email: string, apiKey: string): Promise<Result<LoginResult, string>>;
    /**
     * Exchange a password for an API key using Zulip's fetch_api_key endpoint
     */
    fetchApiKey(url: string, username: string, password: string): Promise<Result<FetchApiKeyResult, string>>;
    /**
     * Open an app-owned sign-in window for Zulip external authentication flows.
     */
    openExternalAuthWindow(url: string): Promise<Result<null, string>>;
    /**
     * Disconnect from a Zulip server
     */
    logout(orgId: string): Promise<Result<null, string>>;
    /**
     * Fetch messages with narrow filters
     */
    getMessages(orgId: string, narrow: NarrowFilter[], anchor: string, numBefore: number, numAfter: number): Promise<Result<MessageResponse, string>>;
    /**
     * Send a message
     */
    sendMessage(orgId: string, msgType: string, to: string, content: string, topic: string | null): Promise<Result<SendResult, string>>;
    /**
     * Edit a message
     */
    editMessage(orgId: string, messageId: number, content: string | null, topic: string | null): Promise<Result<null, string>>;
    /**
     * Delete a message
     */
    deleteMessage(orgId: string, messageId: number): Promise<Result<null, string>>;
    /**
     * Add an emoji reaction
     */
    addReaction(orgId: string, messageId: number, emojiName: string, emojiCode: string): Promise<Result<null, string>>;
    /**
     * Remove an emoji reaction
     */
    removeReaction(orgId: string, messageId: number, emojiName: string, emojiCode: string): Promise<Result<null, string>>;
    /**
     * Update own presence status
     */
    updatePresence(orgId: string, status: string): Promise<Result<null, string>>;
    /**
     * Send typing notification
     * `to` is a JSON string — either a JSON array of user IDs for DMs
     * or a single stream ID string for stream typing
     */
    sendTyping(orgId: string, op: string, typingType: string, to: string, topic: string | null): Promise<Result<null, string>>;
    /**
     * Save bytes to a temporary file and return its path (for paste/drag-drop uploads)
     */
    saveTempFile(fileName: string, data: number[]): Promise<Result<string, string>>;
    /**
     * Upload a file
     */
    uploadFile(orgId: string, filePath: string): Promise<Result<UploadResult, string>>;
    /**
     * Fetch an authenticated media URL and convert it to a data URL for the webview.
     */
    fetchAuthenticatedMediaDataUrl(orgId: string, mediaUrl: string): Promise<Result<string, string>>;
    /**
     * Update message flags (read, starred, etc.)
     */
    updateMessageFlags(orgId: string, messages: number[], op: string, flag: string): Promise<Result<null, string>>;
    /**
     * Mark all messages in a stream as read
     */
    markStreamAsRead(orgId: string, streamId: number): Promise<Result<null, string>>;
    /**
     * Mark all messages in a topic as read
     */
    markTopicAsRead(orgId: string, streamId: number, topicName: string): Promise<Result<null, string>>;
    /**
     * Get topics within a stream
     */
    getStreamTopics(orgId: string, streamId: number): Promise<Result<Topic[], string>>;
    /**
     * Subscribe to streams
     */
    subscribeStream(orgId: string, streamNames: string[]): Promise<Result<null, string>>;
    /**
     * Unsubscribe from streams
     */
    unsubscribeStream(orgId: string, streamNames: string[]): Promise<Result<null, string>>;
    /**
     * Update one or more subscription properties for channels the user is subscribed to.
     */
    updateSubscriptionProperties(orgId: string, subscriptionData: SubscriptionPropertyChange[]): Promise<Result<null, string>>;
    /**
     * Update the current user's topic visibility policy within a channel.
     */
    updateTopicVisibilityPolicy(orgId: string, streamId: number, topic: string, visibilityPolicy: UserTopicVisibilityPolicy): Promise<Result<null, string>>;
    /**
     * Move or rename all messages in a topic.
     */
    moveTopic(orgId: string, request: MoveTopicRequest): Promise<Result<null, string>>;
    /**
     * Resolve or unresolve all messages in a topic.
     */
    setTopicResolved(orgId: string, request: ResolveTopicRequest): Promise<Result<null, string>>;
    /**
     * Update Zulip user settings (syncs to server)
     * `settings_json` is a JSON string with Zulip API key names, e.g. `{"enter_sends": true}`
     */
    updateZulipSettings(orgId: string, settingsJson: string): Promise<Result<null, string>>;
    /**
     * Fetch current Zulip user settings from server
     */
    getZulipSettings(orgId: string): Promise<Result<string, string>>;
    /**
     * Fetch the current set of users from the Zulip server.
     */
    getUsers(orgId: string): Promise<Result<User[], string>>;
    /**
     * Reactivate a deactivated user.
     */
    reactivateUser(orgId: string, userId: number): Promise<Result<null, string>>;
    /**
     * Fetch presence data for the current organization.
     */
    getRealmPresence(orgId: string): Promise<Result<RealmPresenceResponse, string>>;
    /**
     * Fetch a typed snapshot of organization settings and configured email domains.
     */
    getRealmSettings(orgId: string): Promise<Result<RealmSettingsSnapshot, string>>;
    /**
     * Update organization-level settings using Zulip API key names.
     * `settings_json` is a JSON string such as `{"name":"Acme","invite_required":true}`.
     */
    updateRealmSettings(orgId: string, settingsJson: string): Promise<Result<null, string>>;
    /**
     * Add a new organization email domain restriction.
     */
    createRealmDomain(orgId: string, domain: string, allowSubdomains: boolean): Promise<Result<null, string>>;
    /**
     * Update the subdomain policy for an organization email domain.
     */
    updateRealmDomain(orgId: string, domain: string, allowSubdomains: boolean): Promise<Result<null, string>>;
    /**
     * Remove an organization email domain restriction.
     */
    deleteRealmDomain(orgId: string, domain: string): Promise<Result<null, string>>;
    /**
     * Fetch all manageable invitations.
     */
    getInvites(orgId: string): Promise<Result<Invite[], string>>;
    /**
     * Send email invitations.
     */
    sendInvites(orgId: string, inviteeEmails: string, inviteExpiresInMinutes: number | null, inviteAs: number | null, streamIds: number[]): Promise<Result<SendInvitesResponse, string>>;
    /**
     * Revoke an email invitation.
     */
    revokeInvite(orgId: string, inviteId: number): Promise<Result<null, string>>;
    /**
     * Resend an email invitation.
     */
    resendInvite(orgId: string, inviteId: number): Promise<Result<null, string>>;
    /**
     * Fetch user groups for the current organization.
     */
    getUserGroups(orgId: string, includeDeactivatedGroups: boolean): Promise<Result<UserGroup[], string>>;
    /**
     * Create a user group.
     */
    createUserGroup(orgId: string, name: string, description: string, members: number[]): Promise<Result<CreateUserGroupResponse, string>>;
    /**
     * Update the metadata for a user group.
     */
    updateUserGroup(orgId: string, userGroupId: number, name: string | null, description: string | null): Promise<Result<null, string>>;
    /**
     * Deactivate a user group.
     */
    deactivateUserGroup(orgId: string, userGroupId: number): Promise<Result<null, string>>;
    /**
     * Fetch all realm linkifiers.
     */
    getLinkifiers(orgId: string): Promise<Result<Linkifier[], string>>;
    /**
     * Change linkifier evaluation order.
     */
    reorderLinkifiers(orgId: string, orderedLinkifierIds: number[]): Promise<Result<null, string>>;
    /**
     * Create a linkifier.
     */
    createLinkifier(orgId: string, pattern: string, urlTemplate: string): Promise<Result<LinkifierCreateResponse, string>>;
    /**
     * Update a linkifier.
     */
    updateLinkifier(orgId: string, filterId: number, pattern: string, urlTemplate: string): Promise<Result<null, string>>;
    /**
     * Delete a linkifier.
     */
    deleteLinkifier(orgId: string, filterId: number): Promise<Result<null, string>>;
    /**
     * Fetch custom emoji for the organization.
     */
    getRealmEmoji(orgId: string): Promise<Result<RealmEmoji[], string>>;
    /**
     * Upload a custom emoji asset.
     */
    uploadCustomEmoji(orgId: string, emojiName: string, filePath: string): Promise<Result<null, string>>;
    /**
     * Deactivate a custom emoji.
     */
    deleteCustomEmoji(orgId: string, emojiName: string): Promise<Result<null, string>>;
    /**
     * Upload an organization icon asset.
     */
    uploadRealmIcon(orgId: string, filePath: string): Promise<Result<null, string>>;
    /**
     * Reset the organization icon to the default source.
     */
    deleteRealmIcon(orgId: string): Promise<Result<null, string>>;
    /**
     * Upload a light or dark organization logo asset.
     */
    uploadRealmLogo(orgId: string, filePath: string, night: boolean): Promise<Result<null, string>>;
    /**
     * Reset the light or dark organization logo to the default source.
     */
    deleteRealmLogo(orgId: string, night: boolean): Promise<Result<null, string>>;
    /**
     * Fetch bots the current user can administer.
     */
    getBots(orgId: string): Promise<Result<Bot[], string>>;
    /**
     * Create a bot or integration user.
     */
    createBot(orgId: string, fullName: string, shortName: string, botType: number, serviceName: string | null, payloadUrl: string | null): Promise<Result<CreateBotResponse, string>>;
    /**
     * Fetch the API key for a bot.
     */
    getBotApiKey(orgId: string, botId: number): Promise<Result<BotApiKeyResponse, string>>;
    /**
     * Get all saved servers
     */
    getServers(): Promise<Result<SavedServer[], string>>;
    /**
     * Get saved servers along with whether they are currently connected in this app session.
     */
    getSavedServerStatuses(): Promise<Result<SavedServerStatus[], string>>;
    /**
     * Add a server to the saved list
     */
    addServer(server: SavedServer): Promise<Result<null, string>>;
    /**
     * Remove a server from the saved list
     */
    removeServer(serverId: string): Promise<Result<null, string>>;
    /**
     * Return the native desktop settings contract as a typed object.
     */
    getDesktopSettings(): Promise<Result<DesktopSettings, string>>;
    /**
     * Persist the native desktop settings contract.
     */
    setDesktopSettings(settings: DesktopSettings): Promise<Result<DesktopSettings, string>>;
    /**
     * Report native/backend feature support for frontend planning and gating.
     */
    getDesktopCapabilities(): Promise<DesktopCapabilities>;
    /**
     * Update the platform unread badge count on the main window.
     */
    setUnreadBadgeCount(count: number | null): Promise<Result<null, string>>;
    /**
     * Play the bundled desktop notification sound from the native layer.
     */
    playNotificationSound(): Promise<Result<null, string>>;
    /**
     * Get app config value as JSON string (caller parses)
     */
    getConfig(key: string): Promise<Result<string | null, string>>;
    /**
     * Set app config value from JSON string (caller serializes)
     */
    setConfig(key: string, value: string): Promise<Result<null, string>>;
    /**
     * Poll supervisor session state and events
     */
    getSupervisorSession(orgId: string, topicScopeId: string, afterId: number, limit: number): Promise<Result<SupervisorSessionResponse, string>>;
    /**
     * Send a message to the supervisor
     */
    postSupervisorMessage(orgId: string, topicScopeId: string, message: string, clientMsgId: string, streamId: number | null, streamName: string | null, topic: string | null): Promise<Result<SupervisorMessageResponse, string>>;
    /**
     * Get task list for the supervisor dashboard
     */
    getSupervisorSidebar(orgId: string, topicScopeId: string): Promise<Result<SupervisorSidebarResponse, string>>;
    /**
     * Control a task (pause/resume/cancel)
     */
    controlSupervisorTask(orgId: string, topicScopeId: string, taskId: string, action: string): Promise<Result<null, string>>;
    /**
     * Reply to a task clarification question
     */
    replyToTaskClarification(orgId: string, topicScopeId: string, taskId: string, message: string): Promise<Result<null, string>>;
    /**
     * Get available AI providers and their auth status
     */
    getFoundryProviders(orgId: string): Promise<Result<FoundryProvidersResponse, string>>;
    /**
     * Connect a Foundry provider using an API key credential
     */
    connectFoundryProvider(orgId: string, provider: string, apiKey: string, label: string | null): Promise<Result<FoundryProviderCredentialResponse, string>>;
    /**
     * Disconnect a Foundry provider credential
     */
    disconnectFoundryProvider(orgId: string, provider: string): Promise<Result<FoundryProviderCredentialResponse, string>>;
    /**
     * Start a Foundry provider OAuth flow
     */
    startFoundryProviderOauth(orgId: string, provider: string, redirectUri: string | null): Promise<Result<FoundryProviderOauthStartResponse, string>>;
    /**
     * Get events for a specific task
     */
    getTaskEvents(orgId: string, topicScopeId: string, taskId: string, afterId: number, limit: number): Promise<Result<TaskEventsResponse, string>>;
    /**
     * Start the supervisor SSE event stream for a topic.
     * This connects to the Zulip server's SSE proxy endpoint and emits
     * Tauri events as new supervisor events arrive in real time.
     */
    startSupervisorStream(orgId: string, topicScopeId: string, afterId: number): Promise<Result<null, string>>;
    /**
     * Stop the supervisor SSE event stream for an org.
     */
    stopSupervisorStream(orgId: string): Promise<Result<null, string>>;
};
/** user-defined events **/
/** user-defined constants **/
/** user-defined types **/
/**
 * Anonymous group-setting value used by Zulip permission settings.
 */
export type AnonymousGroupSetting = {
    direct_subgroups?: number[];
    direct_members?: number[];
};
export type AuthMethods = {
    password?: boolean;
    email?: boolean;
    google?: boolean;
    github?: boolean;
    ldap?: boolean;
    dev?: boolean;
    remoteuser?: boolean;
    gitlab?: boolean;
    azuread?: boolean;
    apple?: boolean;
    saml?: boolean;
    "openid connect"?: boolean;
};
/**
 * Bot info returned by GET /api/v1/bots.
 */
export type Bot = {
    username: string;
    full_name: string;
    api_key: string;
    avatar_url?: string | null;
    default_sending_stream?: string | null;
    default_events_register_stream?: string | null;
    default_all_public_streams?: boolean | null;
};
/**
 * Response from GET /api/v1/bots/{bot_id}/api_key.
 */
export type BotApiKeyResponse = {
    api_key: string;
};
/**
 * Response from POST /api/v1/bots.
 */
export type CreateBotResponse = {
    user_id: number;
    api_key: string;
    avatar_url?: string | null;
    default_sending_stream?: string | null;
    default_events_register_stream?: string | null;
    default_all_public_streams?: boolean | null;
};
/**
 * Response from POST /api/v1/user_groups/create.
 */
export type CreateUserGroupResponse = {
    group_id: number;
};
/**
 * Native/backend feature support advertised to the frontend.
 */
export type DesktopCapabilities = {
    multi_org: boolean;
    saved_server_status: boolean;
    uploads: boolean;
    typing_notifications: boolean;
    presence_updates: boolean;
    realm_presence: boolean;
    invites: boolean;
    user_groups: boolean;
    linkifiers: boolean;
    custom_emoji: boolean;
    bots: boolean;
    bot_api_key: boolean;
    spellcheck_settings: boolean;
    tray: boolean;
    badge_count: boolean;
    start_at_login: boolean;
    updater: boolean;
    proxy_settings: boolean;
    custom_certificates: boolean;
    inline_notification_reply: boolean;
    directory_picker: boolean;
};
/**
 * Desktop-shell settings that the frontend can treat as a stable native contract.
 */
export type DesktopSettings = {
    start_at_login: boolean;
    start_minimized: boolean;
    show_tray: boolean;
    quit_on_close: boolean;
    auto_update: boolean;
    beta_updates: boolean;
    spellcheck: boolean;
    custom_css: string;
    download_location: string;
    use_system_proxy: boolean;
    manual_proxy: boolean;
    pac_url: string;
    proxy_rules: string;
    bypass_rules: string;
    trusted_certificates?: string[];
};
/**
 * Display recipient — either a stream name (string) or list of users (DMs)
 */
export type DisplayRecipient = string | DisplayRecipientUser[];
/**
 * User in a DM display_recipient
 */
export type DisplayRecipientUser = {
    id: number;
    email: string;
    full_name: string;
};
export type ExternalAuthenticationMethod = {
    name: string;
    display_name: string;
    display_icon: string | null;
    login_url: string;
    signup_url: string;
};
/**
 * Result of POST /api/v1/fetch_api_key
 */
export type FetchApiKeyResult = {
    api_key: string;
    email: string;
    user_id?: number | null;
};
/**
 * Provider authentication entry
 */
export type FoundryProviderAuth = {
    provider: string;
    display_name?: string;
    auth_modes?: string[];
    oauth_configured?: boolean;
    connected?: boolean;
    default_model?: string | null;
    credential?: FoundryProviderCredential | null;
    credential_status?: string | null;
};
/**
 * A connected provider credential preview returned by the provider auth API
 */
export type FoundryProviderCredential = {
    auth_mode?: string | null;
    label?: string | null;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};
/**
 * Response from POST /json/foundry/providers/connect or /disconnect
 */
export type FoundryProviderCredentialResponse = {
    provider: string;
    credential?: FoundryProviderCredential | null;
};
/**
 * Response from POST /json/foundry/providers/oauth/start
 */
export type FoundryProviderOauthStartResponse = {
    provider: string;
    authorize_url?: string | null;
    state?: string | null;
    expires_at?: string | null;
    redirect_uri?: string | null;
};
/**
 * Response from GET /json/foundry/providers/auth
 */
export type FoundryProvidersResponse = {
    providers?: FoundryProviderAuth[];
};
/**
 * Configuration metadata for a Zulip group permission setting.
 */
export type GroupPermissionSetting = {
    require_system_group?: boolean;
    allow_internet_group?: boolean;
    allow_nobody_group?: boolean;
    allow_everyone_group?: boolean;
    default_group_name?: string;
    default_for_system_groups?: string | null;
    allowed_system_groups?: string[];
};
/**
 * Group-setting value returned by Zulip for organization permissions.
 */
export type GroupSettingValue = number | AnonymousGroupSetting;
/**
 * Invitation returned by GET /api/v1/invites.
 */
export type Invite = {
    id: number;
    email?: string | null;
    expiry_date?: number | null;
    invited?: number | null;
    invited_as?: number | null;
    invited_by_user_id?: number | null;
    notify_referrer_on_join?: boolean | null;
    is_multiuse?: boolean | null;
    link_url?: string | null;
};
export type JsonValue = null | boolean | number | string | JsonValue[] | Partial<{
    [key in string]: JsonValue;
}>;
/**
 * Linkifier entry returned by GET /api/v1/realm/linkifiers.
 */
export type Linkifier = {
    id: number;
    pattern: string;
    url_template: string;
};
/**
 * Response from POST /api/v1/realm/filters.
 */
export type LinkifierCreateResponse = {
    id: number;
};
/**
 * Result of login flow
 */
export type LoginResult = {
    org_id: string;
    realm_name: string;
    realm_icon: string;
    realm_url: string;
    queue_id: string;
    /**
     * The logged-in user's ID (from Zulip register response)
     */
    user_id: number | null;
    subscriptions: Subscription[];
    users: User[];
    user_topics: UserTopic[];
    unread_msgs: UnreadMessages;
    recent_private_conversations: RecentPrivateConversation[];
};
/**
 * A Zulip message
 */
export type Message = {
    id: number;
    sender_id: number;
    sender_full_name: string;
    sender_email: string;
    type: string;
    content: string;
    subject: string;
    timestamp: number;
    stream_id: number | null;
    flags?: string[];
    reactions?: Reaction[];
    avatar_url: string | null;
    display_recipient: DisplayRecipient;
};
/**
 * GET /api/v1/messages response
 */
export type MessageResponse = {
    messages: Message[];
    found_newest: boolean;
    found_oldest: boolean;
    found_anchor: boolean;
};
/**
 * Request to move or rename all messages in a topic.
 *
 * `anchor_message_id` can be any message in the topic; callers typically use
 * the topic's `max_id` from `GET /users/me/{stream_id}/topics`.
 */
export type MoveTopicRequest = {
    anchor_message_id: number;
    new_topic: string;
    new_stream_id?: number | null;
    send_notification_to_old_thread?: boolean | null;
    send_notification_to_new_thread?: boolean | null;
};
/**
 * Narrow filter for message queries
 */
export type NarrowFilter = {
    operator: string;
    operand: NarrowOperand;
};
/**
 * Narrow operand — either a text string or a list of user IDs
 */
export type NarrowOperand = string | number[];
/**
 * Emoji reaction
 */
export type Reaction = {
    emoji_name: string;
    emoji_code: string;
    reaction_type: string;
    user_id: number;
};
/**
 * Organization email-domain restriction entry.
 */
export type RealmDomain = {
    domain: string;
    allow_subdomains: boolean;
};
/**
 * Realm custom emoji entry.
 */
export type RealmEmoji = {
    id: string;
    name: string;
    source_url: string;
    deactivated?: boolean;
    author_id?: number | null;
};
/**
 * GET /api/v1/realm/presence response.
 */
export type RealmPresenceResponse = {
    server_timestamp: number;
    presences: Partial<{
        [key in string]: JsonValue;
    }>;
};
/**
 * Snapshot of organization settings needed by the admin/settings UI.
 */
export type RealmSettingsSnapshot = {
    realm_name?: string;
    realm_description?: string;
    realm_icon_url?: string;
    realm_icon_source?: string;
    realm_logo_url?: string;
    realm_logo_source?: string;
    realm_night_logo_url?: string;
    realm_night_logo_source?: string;
    max_icon_file_size_mib?: number;
    max_logo_file_size_mib?: number;
    zulip_plan_is_not_limited?: boolean;
    realm_invite_required?: boolean;
    realm_emails_restricted_to_domains?: boolean;
    realm_waiting_period_threshold?: number;
    realm_allow_message_editing?: boolean;
    realm_message_content_edit_limit_seconds?: number | null;
    realm_message_content_delete_limit_seconds?: number | null;
    realm_topics_policy?: RealmTopicsPolicy;
    realm_create_multiuse_invite_group?: GroupSettingValue | null;
    realm_can_invite_users_group?: GroupSettingValue | null;
    realm_can_create_web_public_channel_group?: GroupSettingValue | null;
    realm_can_create_public_channel_group?: GroupSettingValue | null;
    realm_can_create_private_channel_group?: GroupSettingValue | null;
    realm_can_add_subscribers_group?: GroupSettingValue | null;
    realm_can_mention_many_users_group?: GroupSettingValue | null;
    realm_can_manage_all_groups?: GroupSettingValue | null;
    realm_can_create_groups?: GroupSettingValue | null;
    realm_direct_message_permission_group?: GroupSettingValue | null;
    realm_direct_message_initiator_group?: GroupSettingValue | null;
    realm_can_move_messages_between_channels_group?: GroupSettingValue | null;
    realm_can_move_messages_between_topics_group?: GroupSettingValue | null;
    realm_can_resolve_topics_group?: GroupSettingValue | null;
    realm_can_delete_any_message_group?: GroupSettingValue | null;
    realm_can_delete_own_message_group?: GroupSettingValue | null;
    realm_can_set_delete_message_policy_group?: GroupSettingValue | null;
    realm_can_set_topics_policy_group?: GroupSettingValue | null;
    realm_can_access_all_users_group?: GroupSettingValue | null;
    realm_can_manage_billing_group?: GroupSettingValue | null;
    realm_can_summarize_topics_group?: GroupSettingValue | null;
    realm_can_create_write_only_bots_group?: GroupSettingValue | null;
    realm_can_create_bots_group?: GroupSettingValue | null;
    realm_can_add_custom_emoji_group?: GroupSettingValue | null;
    server_supported_permission_settings?: ServerSupportedPermissionSettings;
    realm_domains?: RealmDomain[];
};
/**
 * Organization-level topic policy.
 */
export type RealmTopicsPolicy = "allow_empty_topic" | "disable_empty_topic";
/**
 * Recent DM/group-DM metadata returned by Zulip register.
 */
export type RecentPrivateConversation = {
    user_ids?: number[];
    max_message_id: number;
};
/**
 * Request to resolve or unresolve a topic by renaming it with Zulip's
 * canonical resolved-topic prefix.
 */
export type ResolveTopicRequest = {
    anchor_message_id: number;
    topic_name: string;
    resolved: boolean;
    send_notification_to_old_thread?: boolean | null;
    send_notification_to_new_thread?: boolean | null;
};
/**
 * Saved server configuration
 */
export type SavedServer = {
    id: string;
    url: string;
    email: string;
    api_key: string;
    realm_name: string;
    realm_icon: string;
};
/**
 * Saved server plus current connection state.
 */
export type SavedServerStatus = {
    id: string;
    url: string;
    email: string;
    realm_name: string;
    realm_icon: string;
    connected: boolean;
    org_id: string | null;
};
/**
 * Minimal typed response for POST /api/v1/invites.
 */
export type SendInvitesResponse = {
    invited_emails?: string[];
    already_invited?: Partial<{
        [key in string]: string[];
    }>;
    skipped?: Partial<{
        [key in string]: string[];
    }>;
};
/**
 * Send message result
 */
export type SendResult = {
    id: number;
};
/**
 * Server settings returned by GET /api/v1/server_settings (unauthenticated)
 */
export type ServerSettings = {
    zulip_version: string;
    zulip_feature_level: number;
    push_notifications_enabled: boolean;
    realm_name?: string;
    realm_icon?: string;
    realm_description?: string;
    realm_url?: string;
    email_auth_enabled?: boolean;
    require_email_format_usernames?: boolean;
    authentication_methods?: AuthMethods;
    external_authentication_methods?: ExternalAuthenticationMethod[];
};
/**
 * Server-advertised permission-setting support for realm, stream, and group scopes.
 */
export type ServerSupportedPermissionSettings = {
    realm?: Partial<{
        [key in string]: GroupPermissionSetting;
    }>;
    stream?: Partial<{
        [key in string]: GroupPermissionSetting;
    }>;
    group?: Partial<{
        [key in string]: GroupPermissionSetting;
    }>;
};
/**
 * Stream/channel subscription
 */
export type Subscription = {
    stream_id: number;
    name: string;
    description?: string;
    color?: string;
    invite_only?: boolean;
    is_muted?: boolean;
    pin_to_top?: boolean;
    desktop_notifications?: boolean | null;
    audible_notifications?: boolean | null;
    push_notifications?: boolean | null;
    email_notifications?: boolean | null;
    wildcard_mentions_notify?: boolean | null;
    in_home_view?: boolean | null;
};
/**
 * Subscription property names accepted by Zulip's bulk subscription settings API.
 */
export type SubscriptionProperty = "in_home_view" | "is_muted" | "color" | "desktop_notifications" | "audible_notifications" | "push_notifications" | "email_notifications" | "pin_to_top" | "wildcard_mentions_notify";
/**
 * Single bulk subscription property update request.
 */
export type SubscriptionPropertyChange = {
    stream_id: number;
    property: SubscriptionProperty;
    value: SubscriptionPropertyValue;
};
/**
 * Property value union accepted by Zulip's subscription settings API.
 */
export type SubscriptionPropertyValue = boolean | string;
/**
 * A single event in the supervisor timeline
 */
export type SupervisorEvent = {
    id: number;
    topic_scope_id: string;
    session_id: string;
    ts: string;
    /**
     * Event kind: "message", "thinking", "tool_call", "tool_result",
     * "dispatch_result", "plan_draft", "assistant"
     */
    kind: string;
    /**
     * Role: "user", "assistant", "system"
     */
    role: string;
    author_id?: string | null;
    author_name?: string | null;
    content_md?: string;
    /**
     * Polymorphic payload - structure varies by event kind
     */
    payload?: JsonValue;
    client_msg_id?: string | null;
};
/**
 * Response from POST /json/foundry/topics/{scope}/supervisor/message
 */
export type SupervisorMessageResponse = {
    session?: SupervisorSession | null;
    events?: SupervisorEvent[];
};
/**
 * A supervisor session tied to a topic scope
 */
export type SupervisorSession = {
    session_id: string;
    topic_scope_id: string;
    status: string;
    updated_at?: string | null;
    metadata?: SupervisorSessionMetadata;
};
/**
 * Metadata about the supervisor session engine
 */
export type SupervisorSessionMetadata = {
    engine?: string | null;
    moltis_model?: string | null;
};
/**
 * Response from GET /json/foundry/topics/{scope}/supervisor/session
 */
export type SupervisorSessionResponse = {
    session?: SupervisorSession | null;
    events?: SupervisorEvent[];
};
/**
 * Response from GET /json/foundry/topics/{scope}/sidebar
 */
export type SupervisorSidebarResponse = {
    tasks?: SupervisorTask[];
};
/**
 * A task entry from the supervisor sidebar/dashboard
 */
export type SupervisorTask = {
    task_id: string;
    title?: string;
    assigned_role?: string;
    status?: string;
    activity?: string | null;
    last_updated?: string | null;
    preview_url?: string | null;
    branch_name?: string | null;
    turns_used?: number | null;
    tokens_used?: number | null;
    usd_estimate?: number | null;
    result_text?: string | null;
    error_text?: string | null;
    clarification_requested?: boolean;
    approved?: boolean;
    artifacts?: JsonValue[];
    blockers?: string[];
};
/**
 * Task event from the task event stream
 */
export type TaskEvent = {
    id: number;
    task_id: string;
    ts: string;
    level?: string;
    event_type?: string;
    message?: string;
    data?: JsonValue;
};
/**
 * Response from GET /json/foundry/topics/{scope}/tasks/{task_id}/events
 */
export type TaskEventsResponse = {
    task_id: string;
    events?: TaskEvent[];
};
/**
 * Topic within a stream
 */
export type Topic = {
    name: string;
    max_id: number;
};
export type UnreadDirectMessage = {
    other_user_id: number | null;
    sender_id: number | null;
    unread_message_ids?: number[];
};
export type UnreadGroupDirectMessage = {
    user_ids_string: string;
    unread_message_ids?: number[];
};
/**
 * Aggregated unread metadata returned by Zulip register.
 */
export type UnreadMessages = {
    count?: number;
    pms?: UnreadDirectMessage[];
    streams?: UnreadStream[];
    huddles?: UnreadGroupDirectMessage[];
    mentions?: number[];
    old_unreads_missing?: boolean;
};
export type UnreadStream = {
    topic: string;
    stream_id: number;
    unread_message_ids?: number[];
};
/**
 * Upload file result
 */
export type UploadResult = {
    url: string;
    uri?: string | null;
};
/**
 * User profile
 */
export type User = {
    user_id: number;
    email: string;
    full_name: string;
    is_active?: boolean;
    is_bot?: boolean;
    is_admin?: boolean;
    avatar_url?: string | null;
    timezone?: string;
    role: number | null;
};
/**
 * User group returned by GET /api/v1/user_groups.
 */
export type UserGroup = {
    id: number;
    name: string;
    description?: string;
    creator_id?: number | null;
    date_created?: number | null;
    members?: number[];
    direct_subgroup_ids?: number[];
    is_system_group?: boolean;
    deactivated?: boolean;
    can_add_members_group?: GroupSettingValue | null;
    can_join_group?: GroupSettingValue | null;
    can_leave_group?: GroupSettingValue | null;
    can_manage_group?: GroupSettingValue | null;
    can_mention_group?: GroupSettingValue | null;
    can_remove_members_group?: GroupSettingValue | null;
};
/**
 * Per-topic user visibility state returned by Zulip.
 */
export type UserTopic = {
    stream_id: number;
    topic_name: string;
    last_updated: number;
    visibility_policy: UserTopicVisibilityPolicy;
};
/**
 * Stream topic visibility policy in Zulip.
 */
export type UserTopicVisibilityPolicy = "Inherit" | "Muted" | "Unmuted" | "Followed";
export type Result<T, E> = {
    status: "ok";
    data: T;
} | {
    status: "error";
    error: E;
};
//# sourceMappingURL=bindings.d.ts.map