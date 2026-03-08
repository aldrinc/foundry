const TEAMCHAT_TRUE_VALUES = new Set(["1", "true", "on", "yes", "y", "enable", "enabled"]);
const TEAMCHAT_FALSE_VALUES = new Set([
    "0",
    "false",
    "off",
    "no",
    "n",
    "legacy",
    "disable",
    "disabled",
]);
const TEAMCHAT_QUERY_FLAG = "teamchat";
const TEAMCHAT_LOCALSTORAGE_KEY = "teamchat_ui.enabled";
const TEAMCHAT_CSS_CLASS = "teamchat-shell";
const TEAMCHAT_FLUID_LAYOUT_CLASS = "fluid_layout_width";
const TEAMCHAT_ROOT_CLASS = "teamchat-shell-root";
const TEAMCHAT_ROOT_ID = "teamchat-root";
const TEAMCHAT_SURFACE_DATA_ATTR = "browser";

let previous_theme_attr: string | null = null;
let previous_surface_attr: string | null = null;
let had_fluid_layout_class = false;
let has_saved_runtime_state = false;

function parse_bool_value(raw: string | null): boolean | undefined {
    if (raw === null) {
        return undefined;
    }
    const normalized = raw.trim().toLowerCase();
    if (TEAMCHAT_TRUE_VALUES.has(normalized)) {
        return true;
    }
    if (TEAMCHAT_FALSE_VALUES.has(normalized)) {
        return false;
    }
    return undefined;
}

function read_query_param(): boolean | undefined {
    const params = new URLSearchParams(window.location.search);
    return parse_bool_value(params.get(TEAMCHAT_QUERY_FLAG));
}

function read_local_storage(): boolean | undefined {
    try {
        return parse_bool_value(window.localStorage.getItem(TEAMCHAT_LOCALSTORAGE_KEY));
    } catch {
        return undefined;
    }
}

export function is_teamchat_ui_enabled(): boolean {
    const query_flag = read_query_param();
    if (query_flag !== undefined) {
        return query_flag;
    }

    const local = read_local_storage();
    if (local !== undefined) {
        return local;
    }

    return false;
}

function set_query_override(query_enabled: boolean): void {
    const params = new URLSearchParams(window.location.search);
    params.set(TEAMCHAT_QUERY_FLAG, query_enabled ? "1" : "0");
    const serialized_query = params.toString();
    const next_url = `${window.location.pathname}${
        serialized_query.length > 0 ? `?${serialized_query}` : ""
    }${window.location.hash}`;
    window.history.replaceState({}, "", next_url);
}

function set_local_storage(enabled: boolean): void {
    try {
        window.localStorage.setItem(TEAMCHAT_LOCALSTORAGE_KEY, enabled ? "1" : "0");
    } catch {
        // Local storage can fail in private browsing or restrictive
        // browser environments; fail open and continue without persistence.
    }
}

function save_runtime_state(): void {
    if (has_saved_runtime_state) {
        return;
    }

    previous_theme_attr = document.documentElement.getAttribute("data-theme");
    previous_surface_attr = document.documentElement.getAttribute("data-surface");
    had_fluid_layout_class = document.body.classList.contains(TEAMCHAT_FLUID_LAYOUT_CLASS);
    has_saved_runtime_state = true;
}

export function isTeamchatShellReady(): boolean {
    // The shell is only mountable if the legacy app container exists.
    const app = document.querySelector(".app");
    const app_main = document.querySelector(".app-main");
    return app !== null && app_main !== null;
}

function get_shell_root(): HTMLElement | null {
    return document.querySelector(`#${TEAMCHAT_ROOT_ID}`);
}

function get_root_app(): HTMLElement | null {
    const shell_root = get_shell_root();
    if (shell_root === null) {
        return document.querySelector(".app");
    }
    const app = shell_root.querySelector<HTMLElement>(".app");
    if (app !== null && shell_root.contains(app)) {
        return app;
    }
    return null;
}

export function mount_shell_root(): boolean {
    if (get_shell_root() !== null) {
        return true;
    }

    const app = document.querySelector(".app");
    const app_parent = app?.parentElement;
    if (app === null || app_parent === null || app_parent === undefined) {
        return false;
    }

    const shell_root = document.createElement("div");
    shell_root.id = TEAMCHAT_ROOT_ID;
    shell_root.className = TEAMCHAT_ROOT_CLASS;

    app.before(shell_root);
    shell_root.append(app);
    return true;
}

export function unmount_shell_root(): void {
    const root = get_shell_root();
    const app = get_root_app();
    const root_parent = root?.parentElement;

    if (root === null || app === null || root_parent === null || root_parent === undefined) {
        return;
    }

    if (root.contains(app)) {
        root.before(app);
    }

    if (!root.hasChildNodes()) {
        root.remove();
        return;
    }

    // Any leftover nodes are intentionally kept in place for debug only.
    root.remove();
}

function apply_theme_attributes(): void {
    save_runtime_state();
    const root = document.documentElement;

    root.setAttribute("data-surface", TEAMCHAT_SURFACE_DATA_ATTR);
    document.body.classList.add(TEAMCHAT_FLUID_LAYOUT_CLASS);
}

function restore_runtime_attributes(): void {
    if (!has_saved_runtime_state) {
        return;
    }

    const root = document.documentElement;
    if (previous_theme_attr === null) {
        root.removeAttribute("data-theme");
    } else {
        root.setAttribute("data-theme", previous_theme_attr);
    }

    if (previous_surface_attr === null) {
        root.removeAttribute("data-surface");
    } else {
        root.setAttribute("data-surface", previous_surface_attr);
    }

    document.body.classList.toggle(TEAMCHAT_FLUID_LAYOUT_CLASS, had_fluid_layout_class);

    previous_theme_attr = null;
    previous_surface_attr = null;
    had_fluid_layout_class = false;
    has_saved_runtime_state = false;
}

function apply_root_class(): void {
    const root = get_shell_root();
    if (root !== null) {
        root.classList.add(TEAMCHAT_ROOT_CLASS);
    }
}

function apply_body_class(): void {
    document.body.classList.add(TEAMCHAT_CSS_CLASS);
    document.documentElement.classList.add(TEAMCHAT_CSS_CLASS);
}

export function remove_teamchat_flags(): void {
    document.body.classList.remove(TEAMCHAT_CSS_CLASS);
    document.documentElement.classList.remove(TEAMCHAT_CSS_CLASS);
    const root = get_shell_root();
    if (root !== null) {
        root.classList.remove(TEAMCHAT_ROOT_CLASS);
    }
    document.querySelector("#teamchat-shell-banner")?.remove();
}

export function deactivate(): void {
    remove_teamchat_flags();
    restore_runtime_attributes();
    unmount_shell_root();
}

export function initialize(): boolean {
    if (!is_teamchat_ui_enabled()) {
        deactivate();
        return false;
    }

    if (!isTeamchatShellReady()) {
        deactivate();
        return false;
    }

    mount_shell_root();
    apply_root_class();
    apply_body_class();
    apply_theme_attributes();
    // Clean up any stale TeamChat banner from previous builds.
    document.querySelector("#teamchat-shell-banner")?.remove();
    return true;
}

export function enable(): void {
    set_local_storage(true);
    set_query_override(true);
    window.location.reload();
}

export function disable(): void {
    set_local_storage(false);
    set_query_override(false);
    window.location.reload();
}
