const REGION_CLASS = "teamchat-shell-region";

export const TEAMCHAT_REGION_IDS = {
    topbar: "teamchat-topbar-region",
    left_rail: "teamchat-left-rail-region",
    center_header: "teamchat-center-header-region",
    center_feed: "teamchat-center-feed-region",
    composer: "teamchat-composer-region",
    right_panel: "teamchat-right-panel-region",
} as const;

type TeamchatRegionName = keyof typeof TEAMCHAT_REGION_IDS;

function get_region(region_name: TeamchatRegionName): HTMLElement | null {
    return document.querySelector<HTMLElement>(`#${TEAMCHAT_REGION_IDS[region_name]}`);
}

function create_region(region_name: TeamchatRegionName): HTMLDivElement {
    const region = document.createElement("div");
    region.id = TEAMCHAT_REGION_IDS[region_name];
    region.className = REGION_CLASS;
    region.dataset["teamchatRegion"] = region_name;
    return region;
}

function ensure_wrapped_region(
    region_name: TeamchatRegionName,
    target: HTMLElement,
): HTMLDivElement {
    const existing_region = get_region(region_name);
    if (existing_region !== null) {
        if (!existing_region.contains(target)) {
            existing_region.append(target);
        }
        return existing_region as HTMLDivElement;
    }

    const region = create_region(region_name);
    target.before(region);
    region.append(target);
    return region;
}

function unwrap_region(region_name: TeamchatRegionName): void {
    const region = get_region(region_name);
    if (region === null) {
        return;
    }

    const parent = region.parentElement;
    if (parent === null) {
        return;
    }

    while (region.firstChild !== null) {
        parent.insertBefore(region.firstChild, region);
    }
    region.remove();
}

function get_main_middle_inner(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".app-main .column-middle .column-middle-inner");
}

function wrap_center_feed_region(): boolean {
    const middle_inner = get_main_middle_inner();
    if (middle_inner === null) {
        return false;
    }

    const ordered_feed_ids = ["recent_view", "inbox-view", "message_feed_container"] as const;
    const feed_candidates: HTMLElement[] = [];
    for (const feed_id of ordered_feed_ids) {
        const candidate = document.getElementById(feed_id);
        if (candidate !== null && middle_inner.contains(candidate)) {
            feed_candidates.push(candidate);
        }
    }

    if (feed_candidates.length === 0) {
        return false;
    }

    const existing_region = get_region("center_feed");
    if (existing_region !== null) {
        for (const candidate of feed_candidates) {
            if (!existing_region.contains(candidate)) {
                existing_region.append(candidate);
            }
        }
        return true;
    }

    const first_feed_child = feed_candidates[0];
    if (first_feed_child === undefined) {
        return false;
    }
    const region = create_region("center_feed");
    first_feed_child.before(region);

    for (const candidate of feed_candidates) {
        region.append(candidate);
    }

    return true;
}

export function initialize_regions(): boolean {
    const left_sidebar = document.querySelector<HTMLElement>("#left-sidebar-container");
    const right_sidebar = document.querySelector<HTMLElement>("#right-sidebar-container");
    const compose = document.querySelector<HTMLElement>("#compose");
    const navbar_fixed = document.querySelector<HTMLElement>("#navbar-fixed-container");
    const header_container = document.querySelector<HTMLElement>("#header-container");

    if (
        left_sidebar === null ||
        right_sidebar === null ||
        compose === null ||
        navbar_fixed === null ||
        header_container === null
    ) {
        return false;
    }

    ensure_wrapped_region("topbar", navbar_fixed);
    ensure_wrapped_region("center_header", header_container);
    ensure_wrapped_region("left_rail", left_sidebar);
    ensure_wrapped_region("right_panel", right_sidebar);
    ensure_wrapped_region("composer", compose);
    return wrap_center_feed_region();
}

export function teardown_regions(): void {
    unwrap_region("center_header");
    unwrap_region("topbar");
    unwrap_region("left_rail");
    unwrap_region("center_feed");
    unwrap_region("composer");
    unwrap_region("right_panel");
}
