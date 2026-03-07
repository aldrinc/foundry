import type { AppSettings } from "./settings"

type ZulipSyncDescriptor = {
  key: string
  toServer?: (value: unknown) => unknown
  fromServer?: (value: unknown) => unknown
}

const ZULIP_SYNC_MAP: Partial<Record<keyof AppSettings, ZulipSyncDescriptor>> = {
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
}

export const ZULIP_SYNCED_KEYS = new Set<keyof AppSettings>(
  Object.keys(ZULIP_SYNC_MAP) as (keyof AppSettings)[]
)

export function mergeServerSettings(
  current: AppSettings,
  serverData: Record<string, unknown>,
): AppSettings {
  const next = { ...current }

  for (const [frontendKey, descriptor] of Object.entries(ZULIP_SYNC_MAP) as [keyof AppSettings, ZulipSyncDescriptor][]) {
    const serverValue = serverData[descriptor.key]
    if (serverValue !== undefined) {
      next[frontendKey] = (descriptor.fromServer ? descriptor.fromServer(serverValue) : serverValue) as never
    }
  }

  if (serverData.enable_sounds !== undefined) {
    next.muteAllSounds = !Boolean(serverData.enable_sounds)
  }

  return next
}

export function buildServerSettingsPatch<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Record<string, unknown> | null {
  const descriptor = ZULIP_SYNC_MAP[key]
  if (!descriptor) return null

  return {
    [descriptor.key]: descriptor.toServer ? descriptor.toServer(value) : value,
  }
}
