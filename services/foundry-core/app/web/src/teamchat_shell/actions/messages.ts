import * as compose_reply from "../../compose_reply.ts";
import * as message_actions_popover from "../../message_actions_popover.ts";
import * as message_delete from "../../message_delete.ts";
import * as message_edit from "../../message_edit.ts";
import * as message_lists from "../../message_lists.ts";
import * as message_store from "../../message_store.ts";
import * as reactions from "../../reactions.ts";

function get_message_row(message_id: number): JQuery | undefined {
    const current_message_list = message_lists.current;
    if (current_message_list === undefined) {
        return undefined;
    }
    const $row = current_message_list.get_row(message_id);
    if ($row.length === 0) {
        return undefined;
    }
    return $row;
}

export function select_message(message_id: number): boolean {
    const current_message_list = message_lists.current;
    if (current_message_list === undefined) {
        return false;
    }

    current_message_list.select_id(message_id, {then_scroll: true});
    return true;
}

export function toggle_message_actions_menu(message_id: number): boolean {
    const message = message_store.get(message_id);
    if (message === undefined) {
        return false;
    }
    return message_actions_popover.toggle_message_actions_menu(message);
}

export function start_edit_message(message_id: number): boolean {
    const $row = get_message_row(message_id);
    if ($row === undefined) {
        return false;
    }

    message_edit.start($row);
    return true;
}

export function delete_message(message_id: number): boolean {
    const message = message_store.get(message_id);
    if (message === undefined) {
        return false;
    }

    if (!message_delete.get_deletability(message)) {
        return false;
    }

    message_delete.delete_message(message_id);
    return true;
}

export function toggle_emoji_reaction(message_id: number, emoji_name: string): boolean {
    const message = message_store.get(message_id);
    if (message === undefined) {
        return false;
    }

    reactions.toggle_emoji_reaction(message, emoji_name);
    return true;
}

export function quote_message(message_id: number): boolean {
    const message = message_store.get(message_id);
    if (message === undefined) {
        return false;
    }

    compose_reply.quote_message({
        message_id,
        trigger: "teamchat_quote_message",
    });
    return true;
}
