import type {Filter} from "../../filter.ts";
import * as narrow_state from "../../narrow_state.ts";
import * as narrow_title from "../../narrow_title.ts";
import * as people from "../../people.ts";
import * as stream_data from "../../stream_data.ts";

export type TeamchatConversationKind = "home" | "inbox" | "stream" | "topic" | "dm" | "search" | "other";

export type TeamchatConversationModel = {
    kind: TeamchatConversationKind;
    title: string;
    stream_id: number | undefined;
    stream_name: string | undefined;
    topic: string | undefined;
    dm_user_ids: number[];
    dm_recipients: string | undefined;
    canonical_terms: ReturnType<typeof narrow_state.search_terms>;
};

function get_kind(filter: Filter | undefined): TeamchatConversationKind {
    if (filter === undefined || filter.is_in_home()) {
        return "home";
    }

    const terms = filter.terms();
    if (terms.some((term) => term.operator === "is" && term.operand === "inbox")) {
        return "inbox";
    }

    if (terms.some((term) => term.operator === "dm")) {
        return "dm";
    }

    const has_channel = terms.some((term) => term.operator === "channel");
    const has_topic = terms.some((term) => term.operator === "topic");
    if (has_channel && has_topic) {
        return "topic";
    }
    if (has_channel) {
        return "stream";
    }

    if (filter.has_operator("search")) {
        return "search";
    }

    return "other";
}

export function get_conversation_model(filter: Filter | undefined = narrow_state.filter()): TeamchatConversationModel {
    const stream_id = narrow_state.stream_id(filter);
    const dm_user_ids = narrow_state.pm_ids(filter) ?? [];
    const dm_user_ids_string = dm_user_ids.join(",");

    return {
        kind: get_kind(filter),
        title: narrow_title.compute_narrow_title(filter),
        stream_id,
        stream_name: stream_id === undefined ? undefined : stream_data.get_stream_name_from_id(stream_id),
        topic: narrow_state.topic(filter),
        dm_user_ids,
        dm_recipients:
            dm_user_ids.length === 0
                ? undefined
                : people.format_recipients(dm_user_ids_string, "long"),
        canonical_terms: narrow_state.search_terms(filter),
    };
}
