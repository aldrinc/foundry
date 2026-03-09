import * as sidebar_ui from "../../sidebar_ui.ts";
import * as navigation_actions from "./navigation.ts";

function click_left_sidebar_toggle_button(): boolean {
    const toggle_button = document.querySelector<HTMLElement>(".left-sidebar-toggle-button");
    if (toggle_button === null) {
        return false;
    }

    toggle_button.click();
    return true;
}

function click_right_sidebar_toggle_button(): boolean {
    const toggle_button = document.querySelector<HTMLElement>("#userlist-toggle-button");
    if (toggle_button === null) {
        return false;
    }

    toggle_button.click();
    return true;
}

export function show_left_sidebar(): boolean {
    sidebar_ui.show_left_sidebar();
    return true;
}

export function hide_left_sidebar(): boolean {
    if (sidebar_ui.left_sidebar_expanded_as_overlay) {
        sidebar_ui.hide_streamlist_sidebar();
        return true;
    }

    if (!document.body.classList.contains("hide-left-sidebar")) {
        return click_left_sidebar_toggle_button();
    }

    return true;
}

export function toggle_left_sidebar(): boolean {
    if (sidebar_ui.left_sidebar_expanded_as_overlay) {
        sidebar_ui.hide_streamlist_sidebar();
        return true;
    }

    if (document.body.classList.contains("hide-left-sidebar")) {
        sidebar_ui.show_left_sidebar();
        return true;
    }

    return click_left_sidebar_toggle_button();
}

export function toggle_right_sidebar(): boolean {
    if (sidebar_ui.right_sidebar_expanded_as_overlay) {
        sidebar_ui.hide_userlist_sidebar();
        return true;
    }

    return click_right_sidebar_toggle_button();
}

export function open_stream(stream_id: number): void {
    navigation_actions.navigate_to_stream(stream_id);
}

export function open_topic(stream_id: number, topic: string): void {
    navigation_actions.navigate_to_topic(stream_id, topic);
}

export function open_direct_message_user_ids_string(user_ids_string: string): boolean {
    return navigation_actions.navigate_to_direct_message_user_ids_string(user_ids_string);
}

export function open_inbox_view(): void {
    navigation_actions.navigate_to_inbox_view();
}
