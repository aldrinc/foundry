import * as compose_state from "../../compose_state.ts";
import * as compose_ui from "../../compose_ui.ts";
import * as drafts from "../../drafts.ts";
import * as scheduled_messages from "../../scheduled_messages.ts";

export type TeamchatComposerModel = {
    is_composing: boolean;
    is_expanded: boolean;
    is_full_size: boolean;
    message_type: "stream" | "private" | undefined;
    stream_id: number | undefined;
    topic: string;
    private_message_recipient_ids: number[];
    message_content: string;
    has_message_content: boolean;
    compose_draft_id: string | undefined;
    draft_count: number;
    scheduled_message_count: number;
    selected_send_later_timestamp: number | undefined;
};

export function get_composer_model(): TeamchatComposerModel {
    const message_content = compose_state.message_content() ?? "";
    return {
        is_composing: compose_state.composing(),
        is_expanded: compose_ui.is_expanded(),
        is_full_size: compose_ui.is_full_size(),
        message_type: compose_state.get_message_type(),
        stream_id: compose_state.stream_id(),
        topic: compose_state.topic() ?? "",
        private_message_recipient_ids: compose_state.private_message_recipient_ids(),
        message_content,
        has_message_content: compose_state.has_message_content(),
        compose_draft_id: drafts.compose_draft_id,
        draft_count: drafts.draft_model.getDraftCount(),
        scheduled_message_count: scheduled_messages.get_count(),
        selected_send_later_timestamp: scheduled_messages.get_selected_send_later_timestamp(),
    };
}
