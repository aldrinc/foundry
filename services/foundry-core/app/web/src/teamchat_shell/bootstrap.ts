import * as blueslip from "../blueslip.ts";
import * as teamchat_ui from "../teamchat_ui.ts";

import * as bridge from "./bridge.ts";
import * as layout from "./layout.ts";
import * as parity_assertions from "./parity_assertions.ts";
import {clear_shell_active, set_shell_active} from "./state.ts";

export function initialize_shell(): boolean {
    const initialized = teamchat_ui.initialize();
    if (!initialized) {
        layout.teardown_shell_layout();
        set_shell_active(false);
        return false;
    }

    const layout_ready = layout.initialize_shell_layout();
    if (!layout_ready) {
        teamchat_ui.deactivate();
        layout.teardown_shell_layout();
        set_shell_active(false);
        return false;
    }

    set_shell_active(true);
    bridge.install_bridge();

    const parity_result = parity_assertions.run_parity_assertions();
    if (!parity_result.ok) {
        blueslip.error("TeamChat parity assertions failed", {
            failures: parity_result.failures,
        });
    }
    return true;
}

export function teardown_shell(): void {
    bridge.teardown_bridge();
    clear_shell_active();
    layout.teardown_shell_layout();
    teamchat_ui.deactivate();
}
