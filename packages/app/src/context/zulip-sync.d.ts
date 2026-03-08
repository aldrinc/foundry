import { type JSX } from "solid-js";
export interface Subscription {
    stream_id: number;
    name: string;
    description?: string;
    color?: string;
    invite_only?: boolean;
    is_muted?: boolean;
    pin_to_top?: boolean;
}
export interface User {
    user_id: number;
    email: string;
    full_name: string;
    is_active?: boolean;
    is_bot?: boolean;
    is_admin?: boolean;
    avatar_url?: string | null;
    timezone?: string;
    role: number | null;
}
export interface Message {
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
    display_recipient: string | DisplayRecipientUser[];
}
export interface DisplayRecipientUser {
    id: number;
    email: string;
    full_name: string;
}
export interface Reaction {
    emoji_name: string;
    emoji_code: string;
    reaction_type: string;
    user_id: number;
}
export interface Topic {
    name: string;
    max_id: number;
}
export interface UnreadItem {
    stream_id: number;
    stream_name: string;
    stream_color: string;
    topic: string;
    count: number;
    last_message_id: number;
}
export interface ZulipStore {
    connected: boolean;
    orgId: string | null;
    queueId: string | null;
    currentUserId: number | null;
    currentUserEmail: string | null;
    subscriptions: Subscription[];
    users: User[];
    messages: Record<string, Message[]>;
    messageLoadState: Record<string, "idle" | "loading" | "loaded-all">;
    messageHydrated: Record<string, boolean>;
    unreadCounts: Record<number, number>;
    typingUsers: Record<string, number[]>;
    drafts: Record<string, string>;
    unreadItems: UnreadItem[];
}
export interface ZulipSync {
    store: ZulipStore;
    setConnected(orgId: string, queueId: string, subscriptions: Subscription[], users: User[], loginEmail?: string, userId?: number | null): void;
    setDisconnected(): void;
    addMessages(narrow: string, messages: Message[]): void;
    setMessageLoadState(narrow: string, state: "idle" | "loading" | "loaded-all"): void;
    isNarrowHydrated(narrow: string): boolean;
    markNarrowHydrated(narrow: string, hydrated: boolean): void;
    ensureMessages(narrow: string, filters: {
        operator: string;
        operand: string | number[];
    }[], options?: {
        force?: boolean;
        limit?: number;
        markRead?: boolean;
    }): Promise<{
        status: "ok" | "error";
        fromCache: boolean;
        error?: string;
    }>;
    updateUnreadCount(streamId: number, count: number): void;
    setTypingUsers(narrow: string, userIds: number[]): void;
    saveDraft(narrow: string, text: string): void;
    clearDraft(narrow: string): void;
    handleMessageEvent(data: any): void;
    handleTypingEvent(data: any): void;
    handleReactionEvent(data: any): void;
    handleSubscriptionEvent(data: any): void;
    handleUpdateMessageEvent(data: any): void;
    handleDeleteMessageEvent(data: any): void;
    handleFlagEvent(data: any): void;
    handleResync(data: any): void;
}
export declare function ZulipSyncProvider(props: {
    orgId: string;
    children: JSX.Element;
}): JSX.Element;
export declare function useZulipSync(): ZulipSync;
//# sourceMappingURL=zulip-sync.d.ts.map