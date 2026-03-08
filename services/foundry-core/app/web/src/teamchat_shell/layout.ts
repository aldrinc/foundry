import * as teamchat_ui from "../teamchat_ui.ts";

import * as registry from "./registry.ts";

const TEAMCHAT_MIDDLE_HEIGHT_CSS_VAR = "--teamchat-middle-available-height";
const TEAMCHAT_NAVBAR_OFFSET_CSS_VAR = "--navbar-fixed-height";
const TEAMCHAT_HEADER_PADDING_CSS_VAR = "--header-padding-bottom";
const MIN_MIDDLE_HEIGHT_PX = 320;
const MIDDLE_HEIGHT_BOTTOM_GUTTER_PX = 8;
const NO_FIXED_NAVBAR_OFFSET = "0px";

let layout_sizing_initialized = false;
let raf_request_id: number | undefined;
let timeout_request_id: number | undefined;

function get_shell_root(): HTMLElement | null {
    return document.querySelector<HTMLElement>("#teamchat-root");
}

function get_middle_column_inner(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
        "#teamchat-root .app-main .column-middle .column-middle-inner",
    );
}

function compute_middle_height_px(): number | undefined {
    const middle_column_inner = get_middle_column_inner();
    if (middle_column_inner === null) {
        return undefined;
    }

    const top = middle_column_inner.getBoundingClientRect().top;
    const viewport_height = window.innerHeight;
    const computed_height = Math.floor(viewport_height - top - MIDDLE_HEIGHT_BOTTOM_GUTTER_PX);
    return Math.max(computed_height, MIN_MIDDLE_HEIGHT_PX);
}

export function refresh_shell_layout_sizing(): void {
    const root = get_shell_root();
    if (root === null) {
        return;
    }

    // TeamChat shell keeps nav/header in normal flow, so legacy fixed-offset
    // spacing must be disabled while TeamChat layout is active.
    root.style.setProperty(TEAMCHAT_NAVBAR_OFFSET_CSS_VAR, NO_FIXED_NAVBAR_OFFSET);
    root.style.setProperty(TEAMCHAT_HEADER_PADDING_CSS_VAR, NO_FIXED_NAVBAR_OFFSET);

    const middle_height_px = compute_middle_height_px();
    if (middle_height_px === undefined) {
        return;
    }

    root.style.setProperty(TEAMCHAT_MIDDLE_HEIGHT_CSS_VAR, `${middle_height_px}px`);
}

function on_viewport_change(): void {
    if (raf_request_id !== undefined) {
        cancelAnimationFrame(raf_request_id);
    }
    raf_request_id = requestAnimationFrame(() => {
        refresh_shell_layout_sizing();
        raf_request_id = undefined;
    });
}

function initialize_layout_sizing(): void {
    if (layout_sizing_initialized) {
        refresh_shell_layout_sizing();
        return;
    }

    layout_sizing_initialized = true;
    window.addEventListener("resize", on_viewport_change, {passive: true});
    window.addEventListener("orientationchange", on_viewport_change);
    window.addEventListener("scroll", on_viewport_change, {passive: true});

    refresh_shell_layout_sizing();
    timeout_request_id = window.setTimeout(() => {
        refresh_shell_layout_sizing();
        timeout_request_id = undefined;
    }, 0);
}

function teardown_layout_sizing(): void {
    if (!layout_sizing_initialized) {
        return;
    }

    layout_sizing_initialized = false;
    window.removeEventListener("resize", on_viewport_change);
    window.removeEventListener("orientationchange", on_viewport_change);
    window.removeEventListener("scroll", on_viewport_change);

    if (raf_request_id !== undefined) {
        cancelAnimationFrame(raf_request_id);
        raf_request_id = undefined;
    }
    if (timeout_request_id !== undefined) {
        clearTimeout(timeout_request_id);
        timeout_request_id = undefined;
    }

    const root = get_shell_root();
    root?.style.removeProperty(TEAMCHAT_MIDDLE_HEIGHT_CSS_VAR);
    root?.style.removeProperty(TEAMCHAT_NAVBAR_OFFSET_CSS_VAR);
    root?.style.removeProperty(TEAMCHAT_HEADER_PADDING_CSS_VAR);
}

export function is_shell_layout_ready(): boolean {
    return teamchat_ui.isTeamchatShellReady();
}

export function initialize_shell_layout(): boolean {
    if (!teamchat_ui.mount_shell_root()) {
        return false;
    }
    const regions_ready = registry.initialize_regions();
    if (!regions_ready) {
        teardown_layout_sizing();
        return false;
    }

    initialize_layout_sizing();
    return true;
}

export function teardown_shell_layout(): void {
    teardown_layout_sizing();
    registry.teardown_regions();
}
