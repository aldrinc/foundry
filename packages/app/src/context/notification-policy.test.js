import { describe, expect, test } from "bun:test";
import { buildNotificationBody, buildNotificationTitle, isMessageSentByCurrentUser, shouldNotifyMessage, } from "./notification-policy";
const DEFAULT_PREFERENCES = {
    desktopNotifs: true,
    dmNotifs: true,
    mentionNotifs: true,
    channelNotifs: false,
    followedTopics: true,
    wildcardMentions: "default",
};
function createMessage(overrides = {}) {
    return {
        id: 1001,
        sender_id: 22,
        sender_full_name: "Alicia",
        sender_email: "alicia@example.com",
        type: "stream",
        content: "<p>Hello there</p>",
        subject: "deploys",
        timestamp: 1_700_000_000,
        stream_id: 5,
        flags: [],
        reactions: [],
        avatar_url: null,
        display_recipient: "Denmark",
        ...overrides,
    };
}
describe("shouldNotifyMessage", () => {
    test("never notifies for self-sent messages", () => {
        const message = createMessage();
        expect(shouldNotifyMessage(message, DEFAULT_PREFERENCES, {
            currentUserId: 22,
            currentUserEmail: "desdemona@example.com",
        })).toBe(false);
    });
    test("never notifies for already-read messages", () => {
        const message = createMessage({ flags: ["read"] });
        expect(shouldNotifyMessage(message, DEFAULT_PREFERENCES, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
        })).toBe(false);
    });
    test("respects the direct-message toggle", () => {
        const message = createMessage({
            type: "private",
            display_recipient: [
                { id: 22, email: "alicia@example.com", full_name: "Alicia" },
                { id: 99, email: "desdemona@example.com", full_name: "Desdemona" },
            ],
        });
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, dmNotifs: true }, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
        })).toBe(true);
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, dmNotifs: false }, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
        })).toBe(false);
    });
    test("respects mention preferences for direct mentions", () => {
        const message = createMessage({ flags: ["mentioned"] });
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, mentionNotifs: true }, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
        })).toBe(true);
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, mentionNotifs: false }, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
        })).toBe(false);
    });
    test("does not gate ordinary channel notifications on personal desktop notification settings", () => {
        const message = createMessage();
        const context = { currentUserId: 99, currentUserEmail: "desdemona@example.com" };
        expect(shouldNotifyMessage(message, {
            ...DEFAULT_PREFERENCES,
            desktopNotifs: false,
            channelNotifs: true,
        }, context)).toBe(true);
    });
    test("supports wildcard mention overrides", () => {
        const message = createMessage({ flags: ["stream_wildcard_mentioned"] });
        const context = { currentUserId: 99, currentUserEmail: "desdemona@example.com" };
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, mentionNotifs: false }, context)).toBe(false);
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, mentionNotifs: false, wildcardMentions: "notify" }, context)).toBe(true);
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, mentionNotifs: true, wildcardMentions: "silent" }, context)).toBe(false);
    });
    test("uses channel notifications for ordinary stream traffic", () => {
        const message = createMessage();
        const context = { currentUserId: 99, currentUserEmail: "desdemona@example.com" };
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, channelNotifs: false }, context)).toBe(false);
        expect(shouldNotifyMessage(message, { ...DEFAULT_PREFERENCES, channelNotifs: true }, context)).toBe(true);
    });
    test("allows followed topics to override channel notifications", () => {
        const message = createMessage();
        expect(shouldNotifyMessage(message, DEFAULT_PREFERENCES, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
            isFollowedTopic: true,
        })).toBe(true);
    });
    test("respects explicit per-channel desktop notification overrides", () => {
        const message = createMessage();
        const context = { currentUserId: 99, currentUserEmail: "desdemona@example.com" };
        expect(shouldNotifyMessage(message, {
            ...DEFAULT_PREFERENCES,
            channelNotifs: false,
        }, {
            ...context,
            channelDesktopNotifications: true,
        })).toBe(true);
        expect(shouldNotifyMessage(message, {
            ...DEFAULT_PREFERENCES,
            channelNotifs: true,
        }, {
            ...context,
            channelDesktopNotifications: false,
        })).toBe(false);
    });
    test("suppresses ordinary channel notifications for muted topics", () => {
        const message = createMessage();
        expect(shouldNotifyMessage(message, {
            ...DEFAULT_PREFERENCES,
            channelNotifs: true,
        }, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
            isTopicMuted: true,
        })).toBe(false);
    });
    test("still allows direct mentions in muted topics", () => {
        const message = createMessage({ flags: ["mentioned"] });
        expect(shouldNotifyMessage(message, DEFAULT_PREFERENCES, {
            currentUserId: 99,
            currentUserEmail: "desdemona@example.com",
            isTopicMuted: true,
        })).toBe(true);
    });
});
describe("notification formatting", () => {
    test("matches current user by email when user id is unavailable", () => {
        const message = createMessage();
        expect(isMessageSentByCurrentUser(message, {
            currentUserId: null,
            currentUserEmail: "ALICIA@example.com",
        })).toBe(true);
    });
    test("builds stream notification titles with channel context", () => {
        expect(buildNotificationTitle(createMessage(), "Denmark")).toBe("Alicia (#Denmark > deploys)");
    });
    test("builds compact DM titles", () => {
        const message = createMessage({
            type: "private",
            display_recipient: [
                { id: 22, email: "alicia@example.com", full_name: "Alicia" },
                { id: 99, email: "desdemona@example.com", full_name: "Desdemona" },
            ],
        });
        expect(buildNotificationTitle(message)).toBe("Alicia (to you)");
    });
    test("strips HTML in notification bodies", () => {
        expect(buildNotificationBody("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
    });
    test("falls back to attached-file text for media-only messages", () => {
        expect(buildNotificationBody('<p><img src="/user_uploads/1/file.png"></p>')).toBe("(attached file)");
    });
});
