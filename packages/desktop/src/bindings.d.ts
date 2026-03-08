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
     * Upload a file
     */
    uploadFile(orgId: string, filePath: string): Promise<Result<UploadResult, string>>;
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
     * Update Zulip user settings (syncs to server)
     * `settings_json` is a JSON string with Zulip API key names, e.g. `{"enter_sends": true}`
     */
    updateZulipSettings(orgId: string, settingsJson: string): Promise<Result<null, string>>;
    /**
     * Fetch current Zulip user settings from server
     */
    getZulipSettings(orgId: string): Promise<Result<string, string>>;
    /**
     * Get all saved servers
     */
    getServers(): Promise<Result<SavedServer[], string>>;
    /**
     * Add a server to the saved list
     */
    addServer(server: SavedServer): Promise<Result<null, string>>;
    /**
     * Remove a server from the saved list
     */
    removeServer(serverId: string): Promise<Result<null, string>>;
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
    getMeridianProviders(orgId: string): Promise<Result<MeridianProvidersResponse, string>>;
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
export type AuthMethods = {
    password?: boolean;
    google?: boolean;
    github?: boolean;
    ldap?: boolean;
    dev?: boolean;
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
export type JsonValue = null | boolean | number | string | JsonValue[] | Partial<{
    [key in string]: JsonValue;
}>;
/**
 * Result of login flow
 */
export type LoginResult = {
    org_id: string;
    realm_name: string;
    realm_icon: string;
    queue_id: string;
    /**
     * The logged-in user's ID (from Zulip register response)
     */
    user_id: number | null;
    subscriptions: Subscription[];
    users: User[];
};
/**
 * Provider authentication entry
 */
export type MeridianProviderAuth = {
    provider: string;
    display_name?: string;
    auth_modes?: string[];
    oauth_configured?: boolean;
    credential_status?: string | null;
};
/**
 * Response from GET /json/meridian/providers/auth
 */
export type MeridianProvidersResponse = {
    providers?: MeridianProviderAuth[];
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
    realm_name: string;
    realm_icon: string;
    realm_description: string;
    authentication_methods?: AuthMethods;
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
};
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
 * Response from POST /json/meridian/topics/{scope}/supervisor/message
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
 * Response from GET /json/meridian/topics/{scope}/supervisor/session
 */
export type SupervisorSessionResponse = {
    session?: SupervisorSession | null;
    events?: SupervisorEvent[];
};
/**
 * Response from GET /json/meridian/topics/{scope}/sidebar
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
 * Response from GET /json/meridian/topics/{scope}/tasks/{task_id}/events
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
export type Result<T, E> = {
    status: "ok";
    data: T;
} | {
    status: "error";
    error: E;
};
//# sourceMappingURL=bindings.d.ts.map