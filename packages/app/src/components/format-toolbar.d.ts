import type { JSX } from "solid-js";
/**
 * FormatToolbar — a row of markdown formatting buttons for the compose box.
 * Each button wraps the current selection or inserts formatting syntax.
 */
export declare function FormatToolbar(props: {
    textareaRef: HTMLTextAreaElement;
    onInsert: (newText: string, cursorOffset?: number) => void;
}): JSX.Element;
//# sourceMappingURL=format-toolbar.d.ts.map