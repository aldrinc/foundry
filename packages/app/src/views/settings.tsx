import { createEffect, createSignal, Show, For, type JSX } from "solid-js"
import { usePlatform } from "../context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsNotifications } from "./settings-notifications"
import { SettingsAccount } from "./settings-account"
import { SettingsProfile } from "./settings-profile"
import { SettingsMutedUsers } from "./settings-muted-users"
import { SettingsAlertWords } from "./settings-alert-words"
import { SettingsChannels } from "./settings-channels"
import { SettingsGroups } from "./settings-groups"
import { SettingsOrgProfile } from "./settings-org-profile"
import { SettingsOrgPermissions } from "./settings-org-permissions"
import { SettingsEmoji } from "./settings-emoji"
import { SettingsLinkifiers } from "./settings-linkifiers"
import { SettingsUsers } from "./settings-users"
import { SettingsAgents } from "./settings-agents"
import { SettingsBots } from "./settings-bots"
import { SettingsApp } from "./settings-app"
import { SettingsNetwork } from "./settings-network"
import { SettingsServers } from "./settings-servers"
import { SettingsUpdateControls } from "./settings-update-controls"
import type { SavedServerStatus } from "@foundry/desktop/bindings"

export type SettingsSection =
  | "general" | "notifications" | "profile" | "account" | "muted-users" | "alert-words"
  | "channels" | "groups"
  | "org-profile" | "org-permissions" | "emoji" | "linkifiers" | "users" | "agents" | "bots"
  | "app" | "network" | "servers"
  | "about"

export type SettingsRoute = {
  section: SettingsSection
  streamId?: number
  streamName?: string
}

export function normalizeSettingsRoute(route?: SettingsSection | SettingsRoute): SettingsRoute {
  if (!route) {
    return { section: "general" }
  }

  return typeof route === "string" ? { section: route } : route
}

interface NavCategory {
  label: string
  items: { id: SettingsSection; label: string; icon: () => JSX.Element }[]
}

const NAV: NavCategory[] = [
  {
    label: "Personal",
    items: [
      { id: "general", label: "General", icon: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg> },
      { id: "profile", label: "Profile", icon: () => <SvgIcon><circle cx="7" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2" /><path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "notifications", label: "Notifications", icon: () => <SvgIcon><path d="M3.5 6a3.5 3.5 0 017 0v3l1.5 1.5H2L3.5 9V6z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /><path d="M5.5 11a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.2" /></SvgIcon> },
      { id: "account", label: "Account & Privacy", icon: () => <SvgIcon><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.2" /><path d="M2 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "muted-users", label: "Muted Users", icon: () => <SvgIcon><circle cx="7" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.2" /><path d="M2 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /><path d="M3 3l8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "alert-words", label: "Alert Words", icon: () => <SvgIcon><path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.4 1.4M9.6 9.6L11 11M11 3l-1.4 1.4M4.4 9.6L3 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
    ],
  },
  {
    label: "Channels & Groups",
    items: [
      { id: "channels", label: "Channels", icon: () => <SvgIcon><path d="M4 1v12M10 1v12M1 4h12M1 10h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "groups", label: "User Groups", icon: () => <SvgIcon><circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.2" /><circle cx="10" cy="4" r="2" stroke="currentColor" stroke-width="1.2" /><path d="M1 12c0-2.2 1.8-4 4-4 1 0 1.9.4 2.5 1M7.5 12c0-2.2 1.8-4 4-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
    ],
  },
  {
    label: "Organization",
    items: [
      { id: "org-profile", label: "Profile", icon: () => <SvgIcon><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.2" /><path d="M5 8h4M7 5v6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "org-permissions", label: "Permissions", icon: () => <SvgIcon><rect x="3" y="1" width="8" height="12" rx="1" stroke="currentColor" stroke-width="1.2" /><path d="M5.5 5h3M5.5 7.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "emoji", label: "Custom Emoji", icon: () => <SvgIcon><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" /><circle cx="5" cy="5.5" r="0.8" fill="currentColor" /><circle cx="9" cy="5.5" r="0.8" fill="currentColor" /><path d="M4.5 8.5a2.5 2.5 0 005 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "linkifiers", label: "Linkifiers", icon: () => <SvgIcon><path d="M6 8l-1.5 1.5a2.1 2.1 0 003 3L9 11M8 6l1.5-1.5a2.1 2.1 0 013 3L11 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "users", label: "Users", icon: () => <SvgIcon><circle cx="7" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2" /><path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
      { id: "agents", label: "Agents", icon: () => <SvgIcon><path d="M2 11c0-1.7 1.3-3 3-3 1 0 1.9.5 2.4 1.2M8 11c0-1.7 1.3-3 3-3 1.7 0 3 1.3 3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /><circle cx="5" cy="4.5" r="2" stroke="currentColor" stroke-width="1.2" /><circle cx="11" cy="4.5" r="2" stroke="currentColor" stroke-width="1.2" /></SvgIcon> },
      { id: "bots", label: "Bots", icon: () => <SvgIcon><rect x="3" y="2" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.2" /><circle cx="5.5" cy="5" r="0.8" fill="currentColor" /><circle cx="8.5" cy="5" r="0.8" fill="currentColor" /><path d="M4 8v2M10 8v2M6 8v3h2V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></SvgIcon> },
    ],
  },
  {
    label: "Desktop",
    items: [
      { id: "app", label: "App Preferences", icon: () => <SvgIcon><rect x="1.5" y="2.5" width="11" height="9" rx="1" stroke="currentColor" stroke-width="1.2" /><path d="M1.5 5h11" stroke="currentColor" stroke-width="1.2" /><circle cx="3.5" cy="3.8" r="0.5" fill="currentColor" /><circle cx="5.5" cy="3.8" r="0.5" fill="currentColor" /></SvgIcon> },
      { id: "network", label: "Network", icon: () => <SvgIcon><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2" /><path d="M1.5 7h11M7 1.5c-2 2-2 9 0 11M7 1.5c2 2 2 9 0 11" stroke="currentColor" stroke-width="1.2" /></SvgIcon> },
      { id: "servers", label: "Servers", icon: () => <SvgIcon><rect x="2" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.2" /><rect x="2" y="8" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.2" /><circle cx="9" cy="4" r="0.8" fill="currentColor" /><circle cx="9" cy="10" r="0.8" fill="currentColor" /></SvgIcon> },
    ],
  },
  {
    label: "",
    items: [
      { id: "about", label: "About", icon: () => <SvgIcon><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2" /><path d="M7 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /><circle cx="7" cy="4" r="0.8" fill="currentColor" /></SvgIcon> },
    ],
  },
]

export function SettingsView(props: {
  initialRoute?: SettingsSection | SettingsRoute
  onClose: () => void
  onLogout: () => void | Promise<void>
  onSwitchOrg?: (server: SavedServerStatus) => void
}) {
  const [route, setRoute] = createSignal<SettingsRoute>(normalizeSettingsRoute(props.initialRoute))

  createEffect(() => {
    setRoute(normalizeSettingsRoute(props.initialRoute))
  })

  const activeSection = () => route().section
  const channelContextName = () => activeSection() === "channels" ? route().streamName : undefined

  const renderContent = () => {
    switch (activeSection()) {
      case "general": return <SettingsGeneral />
      case "profile": return <SettingsProfile />
      case "notifications": return <SettingsNotifications />
      case "account": return <SettingsAccount onLogout={props.onLogout} />
      case "muted-users": return <SettingsMutedUsers />
      case "alert-words": return <SettingsAlertWords />
      case "channels": return <SettingsChannels focusStreamId={route().streamId} focusStreamName={route().streamName} />
      case "groups": return <SettingsGroups />
      case "org-profile": return <SettingsOrgProfile />
      case "org-permissions": return <SettingsOrgPermissions />
      case "emoji": return <SettingsEmoji />
      case "linkifiers": return <SettingsLinkifiers />
      case "users": return <SettingsUsers />
      case "agents": return <SettingsAgents />
      case "bots": return <SettingsBots />
      case "app": return <SettingsApp />
      case "network": return <SettingsNetwork />
      case "servers": return <SettingsServers onSwitchOrg={props.onSwitchOrg} />
      case "about": return <SettingsAbout />
      default: return <SettingsGeneral />
    }
  }

  return (
    <div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={props.onClose}>
      <div
        class="w-[720px] max-h-[85vh] bg-[var(--background-surface)] rounded-[var(--radius-lg)] shadow-lg border border-[var(--border-default)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] shrink-0">
          <div>
            <h2 class="text-sm font-semibold text-[var(--text-primary)]">
              {activeSection() === "channels" && channelContextName() ? "Channel settings" : "Settings"}
            </h2>
            <Show when={channelContextName()}>
              <p class="text-[11px] text-[var(--text-tertiary)]">#{channelContextName()}</p>
            </Show>
          </div>
          <button
            onClick={props.onClose}
            class="p-1 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div class="flex flex-1 min-h-0">
          {/* Left sidebar nav */}
          <nav class="w-[200px] border-r border-[var(--border-default)] overflow-y-auto py-2 shrink-0">
            <For each={NAV}>
              {(category) => (
                <div class="mb-1">
                  <Show when={category.label}>
                    <div class="px-3 py-1.5 text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                      {category.label}
                    </div>
                  </Show>
                  <For each={category.items}>
                    {(item) => (
                      <button
                        class={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                          activeSection() === item.id
                            ? "bg-[var(--interactive-primary)]/10 text-[var(--interactive-primary)] font-medium"
                            : "text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] hover:text-[var(--text-primary)]"
                        }`}
                        onClick={() => setRoute({ section: item.id })}
                      >
                        <span class="w-[14px] h-[14px] flex items-center justify-center shrink-0">
                          {item.icon()}
                        </span>
                        <span class="truncate">{item.label}</span>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </nav>

          {/* Right content area */}
          <div class="flex-1 overflow-y-auto p-5">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  )
}

function SvgIcon(props: { children: JSX.Element }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      {props.children}
    </svg>
  )
}

function SettingsAbout() {
  const platform = usePlatform()

  return (
    <div class="space-y-4">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">About</h3>

      <div class="p-4 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] text-center space-y-2">
        <div class="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] flex items-center justify-center text-white text-lg font-bold mx-auto">
          F
        </div>
        <div class="text-lg font-bold text-[var(--text-primary)]">Foundry Desktop</div>
        <div class="text-xs text-[var(--text-secondary)]">
          A native desktop client for Foundry messaging
        </div>
        <div class="text-[10px] text-[var(--text-tertiary)]">
          Built with Tauri + SolidJS
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-[var(--text-secondary)]">Version</span>
          <span class="text-[var(--text-primary)] font-mono">{platform.version ?? "Unknown"}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-[var(--text-secondary)]">Tauri</span>
          <span class="text-[var(--text-primary)] font-mono">{platform.tauriVersion ?? "Unknown"}</span>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-[var(--text-secondary)]">Platform</span>
          <span class="text-[var(--text-primary)] font-mono">{navigator.platform}</span>
        </div>
      </div>

      <SettingsUpdateControls layout="stack" />
    </div>
  )
}
