import type { Message } from "../context/zulip-sync";
export declare function MessageActions(props: {
    message: Message;
    currentUserId?: number;
    onStartEdit?: () => void;
    onQuote?: (text: string) => void;
}): import("solid-js").JSX.Element;
//# sourceMappingURL=message-actions.d.ts.map