import { describe, expect, test } from "bun:test";
import { buildServerSettingsPatch, mergeServerSettings } from "./settings-sync";

describe("mergeServerSettings", () => {
  test("maps unique Zulip keys back into the local settings model", () => {
    const merged = mergeServerSettings(
      {
        theme: "system",
        fontSize: "normal",
        homeView: "inbox",
        animateImages: "always",
        language: "en",
        startAtLogin: false,
        startMinimized: false,
        showTray: true,
        quitOnClose: false,
        autoUpdate: true,
        betaUpdates: false,
        spellcheck: true,
        customCSS: "",
        downloadLocation: "",
        useSystemProxy: true,
        manualProxy: false,
        pacUrl: "",
        proxyRules: "",
        bypassRules: "",
        enterSends: true,
        timeFormat24h: false,
        sendTyping: true,
        sendReadReceipts: true,
        showAvailability: true,
        emailVisibility: "admins",
        desktopNotifs: true,
        notifSound: true,
        muteAllSounds: false,
        dmNotifs: true,
        mentionNotifs: true,
        channelNotifs: false,
        followedTopics: true,
        wildcardMentions: "default",
      },
      {
        enable_desktop_notifications: false,
        enable_sounds: false,
        enable_stream_desktop_notifications: true,
        enable_followed_topic_desktop_notifications: false,
        enter_sends: false,
      },
    );

    expect(merged.desktopNotifs).toBe(false);
    expect(merged.notifSound).toBe(false);
    expect(merged.muteAllSounds).toBe(true);
    expect(merged.channelNotifs).toBe(true);
    expect(merged.followedTopics).toBe(false);
    expect(merged.enterSends).toBe(false);
    expect(merged.mentionNotifs).toBe(true);
    expect(merged.dmNotifs).toBe(true);
  });
});

describe("buildServerSettingsPatch", () => {
  test("only syncs keys that have real Zulip server counterparts", () => {
    expect(buildServerSettingsPatch("desktopNotifs", false)).toEqual({
      enable_desktop_notifications: false,
    });
    expect(buildServerSettingsPatch("notifSound", false)).toEqual({
      enable_sounds: false,
    });
    expect(buildServerSettingsPatch("dmNotifs", false)).toBeNull();
    expect(buildServerSettingsPatch("mentionNotifs", false)).toBeNull();
    expect(buildServerSettingsPatch("wildcardMentions", "notify")).toBeNull();
  });
});
