"use strict";

const assert = require("node:assert/strict");

const {JSDOM} = require("jsdom");

const {set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://zulip.zulipdev.com/",
});

const teamchat_ui = zrequire("teamchat_ui");
const teamchat_shell = zrequire("teamchat_shell");

function set_location(href) {
    window.history.replaceState({}, "", `http://zulip.zulipdev.com${href}`);
}

function test(label, f) {
    run_test(label, (helpers) => {
        set_global("window", dom.window);
        set_global("document", dom.window.document);
        set_global("location", dom.window.location);
        set_global("history", dom.window.history);
        set_global("localStorage", dom.window.localStorage);
        window.localStorage.clear();
        set_location("/");
        window.document.body.innerHTML = "";
        window.document.body.className = "";
        window.document.documentElement.className = "";
        window.document.documentElement.removeAttribute("data-theme");
        window.document.documentElement.removeAttribute("data-surface");
        f(helpers);
    });
}

function prepare_shell_dom() {
    window.document.body.innerHTML = `
        <div id="feedback_container"></div>
        <div id="navbar-fixed-container">
            <div id="navbar_alerts_wrapper"></div>
            <div id="header-container"></div>
            <div class="column-middle-inner" id="header-middle-inner"></div>
        </div>
        <div class="app">
            <div class="app-main">
                <div class="column-left" id="left-sidebar-container"></div>
                <div class="column-middle">
                    <div class="column-middle-inner">
                        <div id="recent_view"></div>
                        <div id="inbox-view"></div>
                        <div id="message_feed_container"></div>
                        <div id="compose">
                            <div id="compose-container"></div>
                        </div>
                    </div>
                </div>
                <div class="column-right" id="right-sidebar-container"></div>
            </div>
        </div>
    `;
}

test("is_teamchat_ui_enabled honors query precedence and localStorage fallback", () => {
    set_location("/?teamchat=true");
    assert.equal(teamchat_ui.is_teamchat_ui_enabled(), true);

    set_location("/?teamchat=no");
    window.localStorage.setItem("teamchat_ui.enabled", "1");
    assert.equal(teamchat_ui.is_teamchat_ui_enabled(), false);

    set_location("/");
    window.localStorage.setItem("teamchat_ui.enabled", "1");
    assert.equal(teamchat_ui.is_teamchat_ui_enabled(), true);

    set_location("/?teamchat=not-a-bool");
    assert.equal(teamchat_ui.is_teamchat_ui_enabled(), true);

    window.localStorage.clear();
    set_location("/?teamchat=not-a-bool");
    assert.equal(teamchat_ui.is_teamchat_ui_enabled(), false);
});

test("initialize mounts shell root, applies classes, and is idempotent", () => {
    prepare_shell_dom();
    window.localStorage.setItem("teamchat_ui.enabled", "1");

    const first = teamchat_ui.initialize();
    assert.equal(first, true);
    const root = document.querySelector("#teamchat-root");
    assert.ok(root !== null);
    const app = document.querySelector(".app");
    assert.equal(root.contains(app), true);
    assert.equal(window.document.body.classList.contains("teamchat-shell"), true);
    assert.equal(window.document.documentElement.classList.contains("teamchat-shell"), true);
    assert.equal(window.document.documentElement.hasAttribute("data-theme"), false);
    assert.equal(window.document.documentElement.getAttribute("data-surface"), "browser");
    assert.equal(window.document.body.classList.contains("fluid_layout_width"), true);
    assert.equal(root.classList.contains("teamchat-shell-root"), true);

    const second = teamchat_ui.initialize();
    assert.equal(second, true);
    assert.equal(document.querySelector("#teamchat-root"), root);
});

test("initialize is a no-op when shell DOM is missing", () => {
    window.document.body.innerHTML = `
        <div id="feedback_container"></div>
        <div id="navbar-fixed-container"></div>
        <div class="app"></div>
    `;
    window.localStorage.setItem("teamchat_ui.enabled", "1");
    const result = teamchat_ui.initialize();
    assert.equal(result, false);
    assert.equal(document.querySelector("#teamchat-root"), null);
});

test("initialize and deactivate restore shell container", () => {
    prepare_shell_dom();
    window.localStorage.setItem("teamchat_ui.enabled", "1");
    const original_parent = document.querySelector(".app").parentElement;
    assert.ok(original_parent);
    const app = document.querySelector(".app");
    const before_parent = app.parentElement;
    assert.equal(before_parent, original_parent);

    const first = teamchat_ui.initialize();
    assert.equal(first, true);
    const root = document.querySelector("#teamchat-root");
    assert.ok(root);
    assert.equal(root.contains(app), true);

    teamchat_ui.deactivate();
    assert.equal(document.querySelector("#teamchat-root"), null);
    assert.equal(app.parentElement, original_parent);
    assert.equal(app.parentElement, before_parent);
    assert.equal(window.document.body.classList.contains("teamchat-shell"), false);
    assert.equal(window.document.documentElement.classList.contains("teamchat-shell"), false);
    assert.equal(window.document.body.classList.contains("fluid_layout_width"), false);
    assert.equal(window.document.documentElement.hasAttribute("data-theme"), false);
    assert.equal(window.document.documentElement.hasAttribute("data-surface"), false);
});

test("initialize and deactivate preserve pre-existing theme/surface and fluid layout state", () => {
    prepare_shell_dom();
    window.localStorage.setItem("teamchat_ui.enabled", "1");

    window.document.documentElement.setAttribute("data-theme", "dark");
    window.document.documentElement.setAttribute("data-surface", "native");
    window.document.body.classList.add("fluid_layout_width");

    assert.equal(teamchat_ui.initialize(), true);
    assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(window.document.documentElement.getAttribute("data-surface"), "browser");
    assert.equal(window.document.body.classList.contains("fluid_layout_width"), true);

    teamchat_ui.deactivate();
    assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(window.document.documentElement.getAttribute("data-surface"), "native");
    assert.equal(window.document.body.classList.contains("fluid_layout_width"), true);
});

test("mount_shell_root is idempotent and explicit unmount path", () => {
    prepare_shell_dom();
    const app = document.querySelector(".app");
    const original_parent = app.parentElement;

    assert.equal(teamchat_ui.mount_shell_root(), true);
    const root = document.querySelector("#teamchat-root");
    assert.ok(root);
    assert.equal(root.contains(app), true);

    assert.equal(teamchat_ui.mount_shell_root(), true);
    assert.equal(document.querySelector("#teamchat-root"), root);

    teamchat_ui.unmount_shell_root();
    assert.equal(document.querySelector("#teamchat-root"), null);
    assert.equal(app.parentElement, original_parent);
    assert.equal(app.parentElement.className, original_parent.className);
});

test("initialize remains inactive by default", () => {
    const should_render = teamchat_ui.is_teamchat_ui_enabled();
    assert.equal(should_render, false);
    assert.equal(teamchat_ui.initialize(), false);
    assert.equal(window.document.body.classList.contains("teamchat-shell"), false);
});

test("isTeamchatShellReady is based on legacy app structure", () => {
    prepare_shell_dom();
    assert.equal(teamchat_ui.isTeamchatShellReady(), true);

    window.document.body.innerHTML = '<div class="app"></div>';
    assert.equal(teamchat_ui.isTeamchatShellReady(), false);
});

test("teamchat_shell initialize_shell and teardown_shell follow same lifecycle", () => {
    prepare_shell_dom();
    window.localStorage.setItem("teamchat_ui.enabled", "1");

    assert.equal(teamchat_shell.initialize_shell(), true);
    assert.equal(teamchat_ui.isTeamchatShellReady(), true);
    assert.equal(document.querySelector("#teamchat-root") !== null, true);
    assert.equal(document.body.classList.contains("teamchat-shell"), true);
    assert.equal(document.querySelector("#teamchat-topbar-region") !== null, true);
    assert.equal(document.querySelector("#teamchat-left-rail-region") !== null, true);
    assert.equal(document.querySelector("#teamchat-center-header-region") !== null, true);
    assert.equal(document.querySelector("#teamchat-center-feed-region") !== null, true);
    assert.equal(document.querySelector("#teamchat-composer-region") !== null, true);
    assert.equal(document.querySelector("#teamchat-right-panel-region") !== null, true);
    assert.equal(window.zulip_teamchat_bridge !== undefined, true);
    assert.equal(window.teamchat_bridge !== undefined, true);

    teamchat_shell.teardown_shell();
    assert.equal(document.querySelector("#teamchat-root"), null);
    assert.equal(document.body.classList.contains("teamchat-shell"), false);
    assert.equal(document.querySelector("#teamchat-topbar-region"), null);
    assert.equal(document.querySelector("#teamchat-left-rail-region"), null);
    assert.equal(document.querySelector("#teamchat-center-header-region"), null);
    assert.equal(document.querySelector("#teamchat-center-feed-region"), null);
    assert.equal(document.querySelector("#teamchat-composer-region"), null);
    assert.equal(document.querySelector("#teamchat-right-panel-region"), null);
    assert.equal(window.zulip_teamchat_bridge, undefined);
    assert.equal(window.teamchat_bridge, undefined);
});
