import $ from "jquery";

import * as meridian_tasks_ui from "../../meridian_tasks_ui.ts";

export type TeamchatMeridianState = {
    task_view_open: boolean;
    selected_task_id: string | undefined;
};

function read_selected_task_id_from_dom(): string | undefined {
    const from_data_attribute = $("#meridian-task-main-view [data-meridian-task-id]").attr(
        "data-meridian-task-id",
    );
    if (typeof from_data_attribute === "string" && from_data_attribute.trim() !== "") {
        return from_data_attribute.trim();
    }

    const from_header = $("#meridian-task-main-view .meridian-task-id").text().trim();
    return from_header.length > 0 ? from_header : undefined;
}

export function get_meridian_state(): TeamchatMeridianState {
    return {
        task_view_open: document.body.classList.contains("meridian-task-main-view-open"),
        selected_task_id: read_selected_task_id_from_dom(),
    };
}

export function launch_create_task_modal_for_topic(stream_id: number, topic: string): void {
    meridian_tasks_ui.launch_create_task_modal_for_topic(stream_id, topic);
}

export function open_task_from_topic_list(task_id: string): boolean {
    const normalized_task_id = task_id.trim();
    if (normalized_task_id === "") {
        return false;
    }

    const $matching_task_link = $(
        `.meridian-topic-task-link[data-meridian-task-id="${normalized_task_id}"]`,
    );
    if ($matching_task_link.length === 0) {
        return false;
    }

    $matching_task_link.trigger("click");
    return true;
}
