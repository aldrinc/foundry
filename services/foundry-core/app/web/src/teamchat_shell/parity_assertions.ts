import {TEAMCHAT_REGION_IDS} from "./registry.ts";
import {is_shell_layout_ready} from "./layout.ts";
import {is_shell_active} from "./state.ts";

export type TeamchatParityResult = {
    ok: boolean;
    failures: string[];
};

const REQUIRED_BRIDGE_FUNCTION_PATHS = [
    ["models", "get_conversation_model"],
    ["models", "get_message_feed_model"],
    ["models", "get_sidebar_model"],
    ["models", "get_composer_model"],
    ["actions", "navigation", "navigate_to_stream"],
    ["actions", "navigation", "navigate_to_topic"],
    ["actions", "messages", "select_message"],
    ["actions", "messages", "toggle_emoji_reaction"],
    ["actions", "composer", "open_stream_composer"],
    ["actions", "composer", "submit_composer_message"],
    ["actions", "sidebar", "open_stream"],
    ["actions", "overlays", "open_settings"],
    ["events", "subscribe"],
    ["events", "get_event_domain"],
] as const;

type UnknownRecord = Record<string, unknown>;

function get_root(): HTMLElement | null {
    return document.querySelector<HTMLElement>("#teamchat-root");
}

function get_window_bridge(): UnknownRecord | undefined {
    const maybe_bridge = window.zulip_teamchat_bridge;
    if (
        maybe_bridge === undefined ||
        (typeof window.Element === "function" && maybe_bridge instanceof window.Element)
    ) {
        return undefined;
    }
    return maybe_bridge as UnknownRecord;
}

function path_is_function(obj: UnknownRecord | undefined, path: readonly string[]): boolean {
    if (obj === undefined) {
        return false;
    }

    let current: unknown = obj;
    for (const key of path) {
        if (typeof current !== "object" || current === null || !(key in current)) {
            return false;
        }
        current = (current as UnknownRecord)[key];
    }
    return typeof current === "function";
}

export function run_parity_assertions(): TeamchatParityResult {
    const failures: string[] = [];
    const root = get_root();

    if (root === null) {
        failures.push("missing #teamchat-root");
    }

    if (!is_shell_active()) {
        failures.push("teamchat shell state is inactive");
    }

    if (!is_shell_layout_ready()) {
        failures.push("teamchat shell layout is not ready");
    }

    for (const region_id of Object.values(TEAMCHAT_REGION_IDS)) {
        if (document.getElementById(region_id) === null) {
            failures.push(`missing region #${region_id}`);
        }
    }

    const bridge = get_window_bridge();
    if (bridge === undefined) {
        failures.push("window.zulip_teamchat_bridge is missing");
    }

    for (const path of REQUIRED_BRIDGE_FUNCTION_PATHS) {
        if (!path_is_function(bridge, path)) {
            failures.push(`missing bridge function: ${path.join(".")}`);
        }
    }

    const result = {
        ok: failures.length === 0,
        failures,
    };

    if (root !== null) {
        root.dataset["teamchatParity"] = result.ok ? "ok" : "failed";
    }

    return result;
}
