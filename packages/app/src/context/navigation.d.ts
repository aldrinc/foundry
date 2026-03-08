import { type JSX, type Accessor, type Setter } from "solid-js";
/** Narrow string format:
 * - null: Inbox view
 * - "stream:{stream_id}": All messages in a stream
 * - "stream:{stream_id}/topic:{topic_name}": Specific topic
 * - "dm:{user_id1},{user_id2},...": Direct messages
 * - "starred": Starred messages view
 * - "all-messages": All messages view
 * - "recent-topics": Recent topics view
 * - "search:{query}": Search results
 */
export type Narrow = string | null;
/** Special view narrows (not Zulip API narrows) */
export declare const SPECIAL_NARROWS: readonly ["starred", "all-messages", "recent-topics"];
export type SpecialNarrow = typeof SPECIAL_NARROWS[number];
export interface NavigationContext {
    activeNarrow: Accessor<Narrow>;
    setActiveNarrow: Setter<Narrow>;
    /** Parse a narrow string into Zulip API narrow filters */
    narrowToFilters(narrow: string): {
        operator: string;
        operand: string | number[];
    }[];
    /** Get display info from a narrow string */
    parseNarrow(narrow: string): {
        type: "stream" | "topic" | "dm" | "starred" | "all-messages" | "recent-topics" | "search";
        streamId?: number;
        topic?: string;
        userIds?: number[];
        query?: string;
    } | null;
    /** Check if a narrow is a special view type */
    isSpecialNarrow(narrow: string): boolean;
}
export declare function NavigationProvider(props: {
    children: JSX.Element;
}): JSX.Element;
export declare function useNavigation(): NavigationContext;
//# sourceMappingURL=navigation.d.ts.map