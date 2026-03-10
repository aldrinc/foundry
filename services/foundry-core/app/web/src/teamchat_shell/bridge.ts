import * as teamchat_composer_actions from "./actions/composer.ts";
import * as teamchat_message_actions from "./actions/messages.ts";
import * as teamchat_navigation_actions from "./actions/navigation.ts";
import * as teamchat_overlay_actions from "./actions/overlays.ts";
import * as teamchat_sidebar_actions from "./actions/sidebar.ts";
import * as teamchat_composer_adapter from "./adapters/composer.ts";
import * as teamchat_conversation_adapter from "./adapters/conversation.ts";
import * as teamchat_events_adapter from "./adapters/events.ts";
import * as teamchat_foundry_adapter from "./adapters/foundry.ts";
import * as teamchat_message_adapter from "./adapters/messages.ts";
import * as teamchat_sidebar_adapter from "./adapters/sidebar.ts";
import * as teamchat_events from "./events.ts";
import {is_shell_layout_ready} from "./layout.ts";
import * as parity_assertions from "./parity_assertions.ts";
import {is_shell_active} from "./state.ts";

export type TeamchatBridge = {
    version: 1;
    is_shell_active: () => boolean;
    is_shell_layout_ready: () => boolean;
    models: {
        get_conversation_model: typeof teamchat_conversation_adapter.get_conversation_model;
        get_message_feed_model: typeof teamchat_message_adapter.get_message_feed_model;
        get_sidebar_model: typeof teamchat_sidebar_adapter.get_sidebar_model;
        get_composer_model: typeof teamchat_composer_adapter.get_composer_model;
        get_foundry_state: typeof teamchat_foundry_adapter.get_foundry_state;
    };
    actions: {
        navigation: typeof teamchat_navigation_actions;
        messages: typeof teamchat_message_actions;
        composer: typeof teamchat_composer_actions;
        sidebar: typeof teamchat_sidebar_actions;
        overlays: typeof teamchat_overlay_actions;
        foundry: {
            launch_create_task_modal_for_topic: typeof teamchat_foundry_adapter.launch_create_task_modal_for_topic;
            open_task_from_topic_list: typeof teamchat_foundry_adapter.open_task_from_topic_list;
        };
    };
    events: {
        subscribe: typeof teamchat_events.subscribe_to_server_events;
        get_event_domain: typeof teamchat_events_adapter.get_event_domain;
        should_refresh_message_feed: typeof teamchat_events_adapter.should_refresh_message_feed;
        should_refresh_sidebar: typeof teamchat_events_adapter.should_refresh_sidebar;
        should_refresh_conversation_header: typeof teamchat_events_adapter.should_refresh_conversation_header;
    };
    parity: {
        run_assertions: typeof parity_assertions.run_parity_assertions;
    };
};

declare global {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Window {
        zulip_teamchat_bridge?: TeamchatBridge | Element;
        teamchat_bridge?: TeamchatBridge | Element;
    }
}

function create_bridge(): TeamchatBridge {
    return {
        version: 1,
        is_shell_active,
        is_shell_layout_ready,
        models: {
            get_conversation_model: teamchat_conversation_adapter.get_conversation_model,
            get_message_feed_model: teamchat_message_adapter.get_message_feed_model,
            get_sidebar_model: teamchat_sidebar_adapter.get_sidebar_model,
            get_composer_model: teamchat_composer_adapter.get_composer_model,
            get_foundry_state: teamchat_foundry_adapter.get_foundry_state,
        },
        actions: {
            navigation: teamchat_navigation_actions,
            messages: teamchat_message_actions,
            composer: teamchat_composer_actions,
            sidebar: teamchat_sidebar_actions,
            overlays: teamchat_overlay_actions,
            foundry: {
                launch_create_task_modal_for_topic:
                    teamchat_foundry_adapter.launch_create_task_modal_for_topic,
                open_task_from_topic_list: teamchat_foundry_adapter.open_task_from_topic_list,
            },
        },
        events: {
            subscribe: teamchat_events.subscribe_to_server_events,
            get_event_domain: teamchat_events_adapter.get_event_domain,
            should_refresh_message_feed: teamchat_events_adapter.should_refresh_message_feed,
            should_refresh_sidebar: teamchat_events_adapter.should_refresh_sidebar,
            should_refresh_conversation_header:
                teamchat_events_adapter.should_refresh_conversation_header,
        },
        parity: {
            run_assertions: parity_assertions.run_parity_assertions,
        },
    };
}

function set_window_bridge(bridge: TeamchatBridge | undefined): void {
    if (bridge === undefined) {
        delete window.zulip_teamchat_bridge;
        delete window.teamchat_bridge;
        return;
    }

    window.zulip_teamchat_bridge = bridge;
    window.teamchat_bridge = bridge;
}

function is_teamchat_bridge(value: unknown): value is TeamchatBridge {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return (
        Reflect.get(value, "version") === 1 &&
        typeof Reflect.get(value, "is_shell_active") === "function"
    );
}

export function install_bridge(): TeamchatBridge {
    const existing_bridge = window.zulip_teamchat_bridge;
    if (is_teamchat_bridge(existing_bridge)) {
        return existing_bridge;
    }

    const bridge = create_bridge();
    set_window_bridge(bridge);
    return bridge;
}

export function teardown_bridge(): void {
    teamchat_events.clear_server_event_listeners();
    set_window_bridge(undefined);
}
