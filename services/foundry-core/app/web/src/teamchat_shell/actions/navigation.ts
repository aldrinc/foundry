import * as browser_history from "../../browser_history.ts";
import * as message_view from "../../message_view.ts";
import * as people from "../../people.ts";
import type {ShowMessageViewOpts} from "../../message_view.ts";
import type {NarrowTerm} from "../../state_data.ts";

type TeamchatNavigationOptions = Omit<ShowMessageViewOpts, "change_hash" | "trigger"> & {
    trigger?: string;
    change_hash?: boolean;
};

function normalize_hash(hash: string): string {
    if (hash.startsWith("#")) {
        return hash;
    }
    return `#${hash}`;
}

function normalize_show_opts(
    trigger: string,
    options: TeamchatNavigationOptions,
): ShowMessageViewOpts {
    return {
        ...options,
        trigger: options.trigger ?? trigger,
        change_hash: options.change_hash ?? true,
    };
}

function show_terms(
    terms: NarrowTerm[],
    trigger: string,
    options: TeamchatNavigationOptions = {},
): void {
    message_view.show(terms, normalize_show_opts(trigger, options));
}

export function navigate_to_hash(hash: string): void {
    browser_history.update(normalize_hash(hash));
}

export function navigate_to_home(options: TeamchatNavigationOptions = {}): void {
    show_terms([{operator: "in", operand: "home"}], "teamchat_navigation_home", options);
}

export function navigate_to_inbox_view(): void {
    navigate_to_hash("#inbox");
}

export function navigate_to_recent_view(): void {
    navigate_to_hash("#recent");
}

export function navigate_to_stream(
    stream_id: number,
    options: TeamchatNavigationOptions = {},
): void {
    show_terms(
        [{operator: "channel", operand: stream_id.toString()}],
        "teamchat_navigation_stream",
        options,
    );
}

export function navigate_to_topic(
    stream_id: number,
    topic: string,
    options: TeamchatNavigationOptions = {},
): void {
    show_terms(
        [
            {operator: "channel", operand: stream_id.toString()},
            {operator: "topic", operand: topic},
        ],
        "teamchat_navigation_topic",
        options,
    );
}

export function navigate_to_direct_message_ids(
    recipient_user_ids: number[],
    options: TeamchatNavigationOptions = {},
): void {
    show_terms(
        [{operator: "dm", operand: recipient_user_ids}],
        "teamchat_navigation_dm",
        options,
    );
}

export function navigate_to_direct_message_user_ids_string(
    user_ids_string: string,
    options: TeamchatNavigationOptions = {},
): boolean {
    const recipient_user_ids = people.user_ids_string_to_ids_array(user_ids_string);
    if (recipient_user_ids === undefined) {
        return false;
    }
    navigate_to_direct_message_ids(recipient_user_ids, options);
    return true;
}
