/**
 * MentionAutocomplete — floating autocomplete panel for @mentions and #stream links.
 * Shows when the user types `@` or `#` in the compose box.
 */
export declare function MentionAutocomplete(props: {
    query: string;
    type: "user" | "stream";
    onSelect: (text: string) => void;
    onClose: () => void;
    position?: {
        top: number;
        left: number;
    };
}): import("solid-js").JSX.Element;
//# sourceMappingURL=mention-autocomplete.d.ts.map