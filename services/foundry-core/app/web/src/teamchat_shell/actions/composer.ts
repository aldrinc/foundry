import $ from "jquery";

import * as compose from "../../compose.ts";
import * as compose_actions from "../../compose_actions.ts";

export function open_stream_composer(stream_id?: number, topic = "", trigger = "teamchat_composer"): void {
    compose_actions.start({
        message_type: "stream",
        stream_id,
        topic,
        trigger,
    });
}

export function open_direct_message_composer(
    recipient_user_ids: number[],
    trigger = "teamchat_composer_dm",
): void {
    compose_actions.start({
        message_type: "private",
        private_message_recipient_ids: recipient_user_ids,
        trigger,
    });
}

export function cancel_composer(): void {
    compose_actions.cancel();
}

export function focus_compose_textarea(): void {
    $("textarea#compose-textarea").trigger("focus");
}

export function submit_composer_message(): void {
    compose.send_message();
}
