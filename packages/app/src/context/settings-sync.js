const ZULIP_SYNC_MAP = {
    enterSends: { key: "enter_sends" },
    timeFormat24h: { key: "twenty_four_hour_time" },
    sendTyping: { key: "send_typing_notifications" },
    sendReadReceipts: { key: "send_read_receipts" },
    showAvailability: { key: "presence_enabled" },
    emailVisibility: { key: "email_address_visibility" },
    desktopNotifs: { key: "enable_desktop_notifications" },
    notifSound: { key: "enable_sounds" },
    channelNotifs: { key: "enable_stream_desktop_notifications" },
    followedTopics: { key: "enable_followed_topic_desktop_notifications" },
};
export const ZULIP_SYNCED_KEYS = new Set(Object.keys(ZULIP_SYNC_MAP));
export function mergeServerSettings(current, serverData) {
    const next = { ...current };
    for (const [frontendKey, descriptor] of Object.entries(ZULIP_SYNC_MAP)) {
        const serverValue = serverData[descriptor.key];
        if (serverValue !== undefined) {
            next[frontendKey] = (descriptor.fromServer ? descriptor.fromServer(serverValue) : serverValue);
        }
    }
    if (serverData.enable_sounds !== undefined) {
        next.muteAllSounds = !Boolean(serverData.enable_sounds);
    }
    return next;
}
export function buildServerSettingsPatch(key, value) {
    const descriptor = ZULIP_SYNC_MAP[key];
    if (!descriptor)
        return null;
    return {
        [descriptor.key]: descriptor.toServer ? descriptor.toServer(value) : value,
    };
}
