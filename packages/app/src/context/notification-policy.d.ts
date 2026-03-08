import type { Message } from "./zulip-sync";
export interface NotificationPreferences {
    desktopNotifs: boolean;
    dmNotifs: boolean;
    mentionNotifs: boolean;
    channelNotifs: boolean;
    followedTopics: boolean;
    wildcardMentions: string;
}
export interface NotificationContext {
    currentUserId: number | null;
    currentUserEmail: string | null;
    isFollowedTopic?: boolean;
}
export declare function isMessageSentByCurrentUser(message: Message, context: Pick<NotificationContext, "currentUserId" | "currentUserEmail">): boolean;
export declare function isWildcardMention(message: Message): boolean;
export declare function isDirectMention(message: Message): boolean;
export declare function shouldNotifyMessage(message: Message, preferences: NotificationPreferences, context: NotificationContext): boolean;
export declare function buildNotificationTitle(message: Message, streamName?: string): string;
export declare function buildNotificationBody(html: string): string;
//# sourceMappingURL=notification-policy.d.ts.map