export declare const SPECIAL_NARROWS: readonly ["starred", "all-messages", "recent-topics"];
export type SpecialNarrow = typeof SPECIAL_NARROWS[number];
export interface ParsedNarrow {
    type: "stream" | "topic" | "dm" | "starred" | "all-messages" | "recent-topics" | "search";
    streamId?: number;
    topic?: string;
    userIds?: number[];
    query?: string;
}
export declare function narrowToFilters(narrow: string): {
    operator: string;
    operand: string | number[];
}[];
export declare function parseNarrow(narrow: string): ParsedNarrow | null;
export declare function isSpecialNarrow(narrow: string): boolean;
//# sourceMappingURL=navigation-utils.d.ts.map