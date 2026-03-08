import type { Message } from "../context/zulip-sync";
/** Convert an emoji hex code to its Unicode character(s) */
export declare function emojiCodeToChar(code: string): string;
export declare function MessageItem(props: {
    message: Message;
    showSender: boolean;
    serverUrl?: string;
    onQuote?: (text: string) => void;
}): import("solid-js").JSX.Element;
//# sourceMappingURL=message-item.d.ts.map