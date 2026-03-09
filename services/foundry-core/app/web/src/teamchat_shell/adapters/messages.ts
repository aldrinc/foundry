import * as message_lists from "../../message_lists.ts";
import type {Message} from "../../message_store.ts";
import * as narrow_state from "../../narrow_state.ts";

export type TeamchatFeedMessage = {
    id: number;
    sender_id: number;
    timestamp: number;
    type: Message["type"];
    stream_id: number | undefined;
    topic: string | undefined;
    unread: boolean;
    starred: boolean;
};

export type TeamchatMessageFeedModel = {
    is_message_feed_visible: boolean;
    selected_message_id: number | undefined;
    message_ids: number[];
    messages: TeamchatFeedMessage[];
};

function to_feed_message(message: Message): TeamchatFeedMessage {
    return {
        id: message.id,
        sender_id: message.sender_id,
        timestamp: message.timestamp,
        type: message.type,
        stream_id: message.type === "stream" ? message.stream_id : undefined,
        topic: message.type === "stream" ? message.topic : undefined,
        unread: message.unread,
        starred: message.starred,
    };
}

export function get_current_messages(limit = 200): TeamchatFeedMessage[] {
    const current_message_list = message_lists.current;
    if (current_message_list === undefined) {
        return [];
    }

    const all_messages = current_message_list.all_messages();
    const slice_start = Math.max(all_messages.length - Math.max(limit, 0), 0);
    return all_messages.slice(slice_start).map((message) => to_feed_message(message));
}

export function get_message_ids(): number[] {
    return get_current_messages(Number.POSITIVE_INFINITY).map((message) => message.id);
}

export function get_selected_message_id(): number | undefined {
    const current_message_list = message_lists.current;
    if (current_message_list === undefined) {
        return undefined;
    }

    const selected_id = current_message_list.selected_id();
    return selected_id >= 0 ? selected_id : undefined;
}

export function get_message_feed_model(limit = 200): TeamchatMessageFeedModel {
    const messages = get_current_messages(limit);
    return {
        is_message_feed_visible: narrow_state.is_message_feed_visible(),
        selected_message_id: get_selected_message_id(),
        message_ids: messages.map((message) => message.id),
        messages,
    };
}
