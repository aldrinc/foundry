import * as narrow_state from "../../narrow_state.ts";
import * as pm_list_data from "../../pm_list_data.ts";
import * as stream_data from "../../stream_data.ts";
import * as topic_list from "../../topic_list.ts";
import * as topic_list_data from "../../topic_list_data.ts";
import * as unread from "../../unread.ts";

export type TeamchatSidebarStreamRow = {
    stream_id: number;
    name: string;
    color: string;
    unread_count: number;
    unread_mention_count: number;
    is_muted: boolean;
    is_archived: boolean;
};

export type TeamchatSidebarTopicRow = {
    stream_id: number;
    topic_name: string;
    topic_display_name: string;
    unread_count: number;
    has_unread_mention: boolean;
    is_active: boolean;
    is_muted: boolean;
    is_followed: boolean;
    url: string;
};

export type TeamchatSidebarDirectMessageRow = {
    user_ids_string: string;
    recipients: string;
    unread_count: number;
    has_unread_mention: boolean;
    is_active: boolean;
    is_group: boolean;
    is_bot: boolean;
    is_current_user: boolean;
    url: string;
};

export type TeamchatSidebarTopicsModel = {
    stream_id: number | undefined;
    topics: TeamchatSidebarTopicRow[];
    more_topics_unread_count: number;
};

export type TeamchatSidebarModel = {
    streams: TeamchatSidebarStreamRow[];
    direct_messages: TeamchatSidebarDirectMessageRow[];
    active_topics: TeamchatSidebarTopicsModel;
};

export function get_stream_rows(): TeamchatSidebarStreamRow[] {
    return stream_data
        .subscribed_subs()
        .filter((sub) => !sub.is_archived)
        .toSorted((left, right) =>
            left.name.localeCompare(right.name, undefined, {sensitivity: "base"}),
        )
        .map((sub) => {
            const unread_counts = unread.unread_count_info_for_stream(sub.stream_id);
            return {
                stream_id: sub.stream_id,
                name: sub.name,
                color: sub.color,
                unread_count: unread_counts.unmuted_count,
                unread_mention_count: unread.get_topics_with_unread_mentions(sub.stream_id).size,
                is_muted: sub.is_muted,
                is_archived: sub.is_archived,
            };
        });
}

function get_active_stream_id(): number | undefined {
    return topic_list.active_stream_id() ?? narrow_state.stream_id();
}

export function get_active_topic_rows(): TeamchatSidebarTopicsModel {
    const stream_id = get_active_stream_id();
    if (stream_id === undefined) {
        return {
            stream_id: undefined,
            topics: [],
            more_topics_unread_count: 0,
        };
    }

    const stream = stream_data.get_sub_by_id(stream_id);
    if (stream === undefined || !stream.subscribed || stream.is_archived) {
        return {
            stream_id: undefined,
            topics: [],
            more_topics_unread_count: 0,
        };
    }

    const list_info = topic_list_data.get_list_info(
        stream_id,
        false,
        (topic_names: string[]) => topic_names,
    );

    return {
        stream_id,
        topics: list_info.items.map((topic) => ({
            stream_id: topic.stream_id,
            topic_name: topic.topic_name,
            topic_display_name: topic.topic_display_name,
            unread_count: topic.unread,
            has_unread_mention: topic.contains_unread_mention,
            is_active: topic.is_active_topic,
            is_muted: topic.is_muted,
            is_followed: topic.is_followed,
            url: topic.url,
        })),
        more_topics_unread_count: list_info.more_topics_unreads,
    };
}

export function get_direct_message_rows(): TeamchatSidebarDirectMessageRow[] {
    return pm_list_data.get_conversations().map((conversation) => ({
        user_ids_string: conversation.user_ids_string,
        recipients: conversation.recipients,
        unread_count: conversation.unread,
        has_unread_mention: conversation.has_unread_mention,
        is_active: conversation.is_active,
        is_group: conversation.is_group,
        is_bot: conversation.is_bot,
        is_current_user: conversation.is_current_user,
        url: conversation.url,
    }));
}

export function get_sidebar_model(): TeamchatSidebarModel {
    return {
        streams: get_stream_rows(),
        direct_messages: get_direct_message_rows(),
        active_topics: get_active_topic_rows(),
    };
}
