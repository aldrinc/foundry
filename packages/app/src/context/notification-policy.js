const ATTACHMENT_CONTENT = "(attached file)";
function hasFlag(message, flag) {
    return (message.flags || []).includes(flag);
}
export function isMessageSentByCurrentUser(message, context) {
    if (context.currentUserId && message.sender_id === context.currentUserId) {
        return true;
    }
    if (context.currentUserEmail && message.sender_email) {
        return message.sender_email.toLowerCase() === context.currentUserEmail.toLowerCase();
    }
    return false;
}
export function isWildcardMention(message) {
    return hasFlag(message, "stream_wildcard_mentioned") || hasFlag(message, "topic_wildcard_mentioned");
}
export function isDirectMention(message) {
    return hasFlag(message, "mentioned") || hasFlag(message, "has_alert_word");
}
export function shouldNotifyMessage(message, preferences, context) {
    if (!preferences.desktopNotifs)
        return false;
    if (hasFlag(message, "read"))
        return false;
    if (isMessageSentByCurrentUser(message, context))
        return false;
    if (message.type === "private") {
        return preferences.dmNotifs;
    }
    if (context.isFollowedTopic && preferences.followedTopics) {
        return true;
    }
    if (isWildcardMention(message)) {
        if (preferences.wildcardMentions === "notify")
            return true;
        if (preferences.wildcardMentions === "silent")
            return false;
        return preferences.mentionNotifs;
    }
    if (isDirectMention(message)) {
        return preferences.mentionNotifs;
    }
    return preferences.channelNotifs;
}
export function buildNotificationTitle(message, streamName) {
    if (message.type === "private") {
        const recipients = Array.isArray(message.display_recipient) ? message.display_recipient : [];
        if (recipients.length > 2) {
            return `${message.sender_full_name} (group DM)`;
        }
        return `${message.sender_full_name} (to you)`;
    }
    const streamLabel = streamName || "channel";
    return `${message.sender_full_name} (#${streamLabel} > ${message.subject})`;
}
export function buildNotificationBody(html) {
    const text = htmlToText(html);
    if (text)
        return text;
    if (/<(?:img|video|audio)\b/i.test(html) || /href="[^"]*\/user_uploads\//i.test(html)) {
        return ATTACHMENT_CONTENT;
    }
    return "";
}
function htmlToText(html) {
    if (typeof document !== "undefined") {
        const node = document.createElement("div");
        node.innerHTML = html;
        return normalizeWhitespace(node.textContent || "");
    }
    return normalizeWhitespace(html.replace(/<[^>]+>/g, " "));
}
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
