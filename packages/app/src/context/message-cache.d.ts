export interface CacheableMessage {
    id: number;
    type: string;
    subject: string;
    stream_id: number | null;
    display_recipient: string | {
        id: number;
    }[];
    flags?: string[];
}
export declare const ALL_MESSAGES_NARROW = "all-messages";
export declare const STARRED_NARROW = "starred";
export declare function hasStarredFlag(message: CacheableMessage): boolean;
export declare function mergeMessagesById<T extends CacheableMessage>(existing: T[], incoming: T[]): T[];
export declare function primaryNarrowForMessage(message: CacheableMessage): string | null;
export declare function cacheKeysForMessage(message: CacheableMessage): string[];
//# sourceMappingURL=message-cache.d.ts.map