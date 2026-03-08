export const ALL_MESSAGES_NARROW = "all-messages";
export const STARRED_NARROW = "starred";
export function hasStarredFlag(message) {
    return (message.flags || []).includes("starred");
}
export function mergeMessagesById(existing, incoming) {
    if (incoming.length === 0) {
        return existing;
    }
    const merged = new Map();
    for (const message of existing) {
        merged.set(message.id, message);
    }
    for (const message of incoming) {
        merged.set(message.id, message);
    }
    return Array.from(merged.values()).sort((a, b) => a.id - b.id);
}
export function primaryNarrowForMessage(message) {
    if (message.stream_id) {
        return `stream:${message.stream_id}/topic:${message.subject}`;
    }
    if (Array.isArray(message.display_recipient)) {
        const recipientIds = message.display_recipient
            .map((user) => user.id)
            .sort((left, right) => left - right)
            .join(",");
        return recipientIds ? `dm:${recipientIds}` : null;
    }
    return null;
}
export function cacheKeysForMessage(message) {
    const keys = new Set();
    const primary = primaryNarrowForMessage(message);
    if (primary) {
        keys.add(primary);
    }
    keys.add(ALL_MESSAGES_NARROW);
    if (hasStarredFlag(message)) {
        keys.add(STARRED_NARROW);
    }
    return Array.from(keys);
}
