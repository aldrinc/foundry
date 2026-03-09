import * as about_zulip from "../../about_zulip.ts";
import * as navbar_help_menu from "../../navbar_help_menu.ts";
import * as overlays from "../../overlays.ts";
import * as personal_menu_popover from "../../personal_menu_popover.ts";
import * as settings from "../../settings.ts";

export function open_settings(section = ""): void {
    settings.launch(section);
}

export function open_profile_settings(): void {
    settings.launch("your-account");
}

export function open_help_menu(): void {
    navbar_help_menu.toggle();
}

export function open_personal_menu(): void {
    personal_menu_popover.toggle();
}

export function open_about_overlay(): void {
    about_zulip.launch();
}

export function close_active_overlay(): boolean {
    if (!overlays.any_active()) {
        return false;
    }
    overlays.close_active();
    return true;
}
