const MESSAGE_EVENT_TYPES = new Set(["message", "update_message", "delete_message", "reaction"]);
const SIDEBAR_EVENT_TYPES = new Set(["stream", "subscription", "realm_user", "user_topic"]);
const PRESENCE_EVENT_TYPES = new Set(["presence", "user_status"]);
const TYPING_EVENT_TYPES = new Set(["typing", "typing_edit_message"]);
const UNREAD_EVENT_TYPES = new Set(["update_message_flags"]);
const SETTINGS_EVENT_TYPES = new Set(["user_settings", "realm"]);

export type TeamchatEventDomain =
    | "messages"
    | "sidebar"
    | "presence"
    | "typing"
    | "unread"
    | "settings"
    | "unknown";

export function get_event_type(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) {
        return undefined;
    }

    if (!("type" in event)) {
        return undefined;
    }

    const maybe_type = event.type;
    return typeof maybe_type === "string" ? maybe_type : undefined;
}

export function get_event_domain(event: unknown): TeamchatEventDomain {
    const event_type = get_event_type(event);
    if (event_type === undefined) {
        return "unknown";
    }

    if (MESSAGE_EVENT_TYPES.has(event_type)) {
        return "messages";
    }
    if (SIDEBAR_EVENT_TYPES.has(event_type)) {
        return "sidebar";
    }
    if (PRESENCE_EVENT_TYPES.has(event_type)) {
        return "presence";
    }
    if (TYPING_EVENT_TYPES.has(event_type)) {
        return "typing";
    }
    if (UNREAD_EVENT_TYPES.has(event_type)) {
        return "unread";
    }
    if (SETTINGS_EVENT_TYPES.has(event_type)) {
        return "settings";
    }
    return "unknown";
}

export function should_refresh_message_feed(event: unknown): boolean {
    const domain = get_event_domain(event);
    return domain === "messages" || domain === "typing" || domain === "unread";
}

export function should_refresh_sidebar(event: unknown): boolean {
    const domain = get_event_domain(event);
    return domain === "sidebar" || domain === "messages" || domain === "unread";
}

export function should_refresh_conversation_header(event: unknown): boolean {
    const domain = get_event_domain(event);
    return domain === "messages" || domain === "settings" || domain === "unread";
}
