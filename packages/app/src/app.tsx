import { type JSX, createSignal, createEffect, Show, onMount, onCleanup } from "solid-js"
import { ZulipSyncProvider, useZulipSync, registerActiveNarrowGetter } from "./context/zulip-sync"
import { OrgProvider, useOrg } from "./context/org"
import { NavigationProvider, useNavigation } from "./context/navigation"
import { AgentsProvider } from "./context/agents"
import { SupervisorProvider } from "./context/supervisor"
import { SettingsProvider, useSettings } from "./context/settings"
import { PresenceProvider } from "./context/presence"
import { getUnreadTotalCount } from "./context/unread-state"
import { LoginView } from "./views/login"
import { InboxView } from "./views/inbox"
import { SettingsView } from "./views/settings"
import { RecentTopicsView } from "./views/recent-topics"
import { StarredView } from "./views/starred"
import { AllMessagesView } from "./views/all-messages"
import { StreamSidebar } from "./components/stream-sidebar"
import { MessageList } from "./components/message-list"
import { ComposeBox } from "./components/compose-box"
import { SupervisorPanel } from "./components/supervisor"
import { RightSidebar } from "./components/right-sidebar"
import { KeyboardShortcutsModal } from "./components/keyboard-shortcuts-modal"
import { GearMenu } from "./components/gear-menu"
import { HelpMenu } from "./components/help-menu"
import { LeftBar } from "./components/left-bar"
import {
  clearManualLogout,
  markManualLogout,
  shouldSkipAutoLogin,
} from "./manual-logout"
import { commands } from "@zulip/desktop/bindings"
import type { LoginResult, Subscription, User, Message, SavedServerStatus } from "@zulip/desktop/bindings"

// ── Demo mode helpers (browser preview without Tauri backend) ──

const IS_DEMO = typeof window !== "undefined" && window.location.search.includes("demo")

function createDemoLoginResult(): LoginResult {
  return {
    org_id: "demo-org-001",
    realm_name: "Foundry Demo",
    realm_icon: "",
    realm_url: "https://demo.foundry.invalid",
    queue_id: "demo-queue",
    user_id: 100,
    user_topics: [],
    unread_msgs: {
      count: 3,
      pms: [],
      streams: [
        { stream_id: 1, topic: "welcome", unread_message_ids: [1003, 1004, 1005] },
      ],
      huddles: [],
      mentions: [],
      old_unreads_missing: false,
    },
    recent_private_conversations: [
      { user_ids: [101], max_message_id: 2002 },
      { user_ids: [102, 103], max_message_id: 2004 },
    ],
    subscriptions: [
      { stream_id: 1, name: "general", color: "#76ce90", pin_to_top: true },
      { stream_id: 2, name: "engineering", color: "#fae589" },
      { stream_id: 3, name: "design", color: "#a6c5e2" },
      { stream_id: 4, name: "product", color: "#e4a5a5" },
      { stream_id: 5, name: "random", color: "#c2b0e2" },
      { stream_id: 6, name: "ops", color: "#e0ab76", is_muted: true },
    ],
    users: [
      { user_id: 100, email: "alice@foundry.dev", full_name: "Alice Chen", role: 200, is_active: true },
      { user_id: 101, email: "bob@foundry.dev", full_name: "Bob Martinez", role: 400, is_active: true },
      { user_id: 102, email: "carol@foundry.dev", full_name: "Carol Park", role: 400, is_active: true },
      { user_id: 103, email: "dave@foundry.dev", full_name: "Dave Wilson", role: 400, is_active: true },
    ],
  }
}

function createDemoMessages(): Record<string, Message[]> {
  const now = Math.floor(Date.now() / 1000)
  return {
    "stream:1/topic:welcome": [
      { id: 1001, sender_id: 100, sender_full_name: "Alice Chen", sender_email: "alice@foundry.dev", type: "stream", content: "<p>Welcome to <strong>Foundry</strong>! This is the new team workspace.</p>", subject: "welcome", timestamp: now - 3600, stream_id: 1, flags: ["read"], reactions: [{ emoji_name: "wave", emoji_code: "1f44b", reaction_type: "unicode_emoji", user_id: 101 }, { emoji_name: "rocket", emoji_code: "1f680", reaction_type: "unicode_emoji", user_id: 102 }], avatar_url: null, display_recipient: "general" },
      { id: 1002, sender_id: 101, sender_full_name: "Bob Martinez", sender_email: "bob@foundry.dev", type: "stream", content: "<p>Excited to be here! The new UI looks great.</p>", subject: "welcome", timestamp: now - 3500, stream_id: 1, flags: ["read"], reactions: [{ emoji_name: "+1", emoji_code: "1f44d", reaction_type: "unicode_emoji", user_id: 100 }], avatar_url: null, display_recipient: "general" },
      { id: 1003, sender_id: 102, sender_full_name: "Carol Park", sender_email: "carol@foundry.dev", type: "stream", content: "<p>Love the dark sidebar. Can we add custom emoji support next?</p>", subject: "welcome", timestamp: now - 3000, stream_id: 1, flags: [], reactions: [], avatar_url: null, display_recipient: "general" },
      { id: 1004, sender_id: 100, sender_full_name: "Alice Chen", sender_email: "alice@foundry.dev", type: "stream", content: "<p>Absolutely, custom emoji is on the roadmap. Check out the <code>#product</code> channel for more details.</p>", subject: "welcome", timestamp: now - 2800, stream_id: 1, flags: [], reactions: [], avatar_url: null, display_recipient: "general" },
      { id: 1005, sender_id: 103, sender_full_name: "Dave Wilson", sender_email: "dave@foundry.dev", type: "stream", content: "<p>Just pushed the new supervisor integration. You can now use the <strong>AI</strong> button in topic views to invoke the Foundry Supervisor.</p>", subject: "welcome", timestamp: now - 1200, stream_id: 1, flags: [], reactions: [{ emoji_name: "tada", emoji_code: "1f389", reaction_type: "unicode_emoji", user_id: 100 }, { emoji_name: "tada", emoji_code: "1f389", reaction_type: "unicode_emoji", user_id: 101 }], avatar_url: null, display_recipient: "general" },
    ],
  }
}

/**
 * Root App component.
 */
export function App(props: {
  onCommandReady?: (trigger: (id: string) => void) => void
  children?: JSX.Element
}) {
  const [loginResult, setLoginResult] = createSignal<LoginResult | null>(null)
  const [loginEmail, setLoginEmail] = createSignal<string>("")
  const [autoLoginLoading, setAutoLoginLoading] = createSignal(true)

  // Try auto-login from saved servers (or use demo mode)
  onMount(async () => {
    if (IS_DEMO) {
      setLoginResult(createDemoLoginResult())
      setLoginEmail("alice@foundry.dev")
      setAutoLoginLoading(false)
      return
    }

    try {
      if (shouldSkipAutoLogin(window.localStorage)) {
        return
      }

      const result = await commands.getServers()
      if (result.status === "ok" && result.data.length > 0) {
        const server = result.data[0]
        setLoginEmail(server.email)
        const loginRes = await commands.login(server.url, server.email, server.api_key)
        if (loginRes.status === "ok") {
          setLoginResult(loginRes.data)
        }
      }
    } catch {
      // Auto-login failed, show login form
    } finally {
      setAutoLoginLoading(false)
    }
  })

  const handleLogin = (result: LoginResult, email?: string) => {
    clearManualLogout(window.localStorage)
    setLoginResult(result)
    if (email) setLoginEmail(email)
  }

  const handleManualLogout = () => {
    markManualLogout(window.localStorage)
    commands.setUnreadBadgeCount(null).catch(() => {})
    window.location.reload()
  }

  const handleSwitchOrg = async (server: SavedServerStatus) => {
    // Logout current org
    const current = loginResult()
    if (current) {
      try { await commands.logout(current.org_id) } catch { /* non-critical */ }
    }
    // Login to new org
    try {
      const servers = await commands.getServers()
      if (servers.status === "ok") {
        const saved = servers.data.find(s => s.id === server.id)
        if (saved) {
          const res = await commands.login(saved.url, saved.email, saved.api_key)
          if (res.status === "ok") {
            clearManualLogout(window.localStorage)
            setLoginEmail(saved.email)
            setLoginResult(res.data)
            return
          }
        }
      }
    } catch { /* fallback to reload */ }
    window.location.reload()
  }

  return (
    <div class="h-screen w-screen flex flex-col" data-component="app-shell">
      <Show when={!autoLoginLoading()} fallback={<LoadingSplash />}>
        <Show
          keyed
          when={loginResult()}
          fallback={<LoginView onLogin={(result) => {
            // Extract email from users list or saved servers
            // The LoginView will pass the email via the second arg
            handleLogin(result)
          }} onLoginWithEmail={(result, email) => handleLogin(result, email)} />}
        >
          {(result) => (
            <OrgProvider org={{
              orgId: result.org_id,
              realmName: result.realm_name,
              realmIcon: result.realm_icon,
              realmUrl: result.realm_url,
            }}>
              <SettingsProvider orgId={result.org_id}>
                <PresenceProvider orgId={result.org_id}>
                  <AgentsProvider orgId={result.org_id}>
                    <ZulipSyncProvider orgId={result.org_id}>
                      <NavigationProvider>
                        <SupervisorProvider orgId={result.org_id}>
                          <AppShell
                            loginResult={result}
                            loginEmail={loginEmail()}
                            onLogout={handleManualLogout}
                            onSwitchOrg={handleSwitchOrg}
                          />
                        </SupervisorProvider>
                      </NavigationProvider>
                    </ZulipSyncProvider>
                  </AgentsProvider>
                </PresenceProvider>
              </SettingsProvider>
            </OrgProvider>
          )}
        </Show>
      </Show>
    </div>
  )
}

function LoadingSplash() {
  return (
    <div class="h-full flex items-center justify-center bg-[var(--background-base)]">
      <div class="text-center">
        <div class="text-sm text-[var(--text-tertiary)]">Loading...</div>
      </div>
    </div>
  )
}

/**
 * Main app shell with sidebar + content area.
 * Shown after successful login.
 */
function AppShell(props: {
  loginResult: LoginResult
  loginEmail: string
  onLogout: () => void
  onSwitchOrg?: (server: SavedServerStatus) => void
}) {
  const sync = useZulipSync()
  const org = useOrg()
  const nav = useNavigation()
  const { store: settingsStore } = useSettings()
  const [showSettings, setShowSettings] = createSignal(false)
  const [showRightSidebar, setShowRightSidebar] = createSignal(false)
  const [showShortcuts, setShowShortcuts] = createSignal(false)

  const handleLogout = async () => {
    try {
      await commands.logout(props.loginResult.org_id)
    } catch {
      // Non-critical, still return to the login screen.
    }

    props.onLogout()
  }

  // Let the sync layer know which narrow the user is viewing,
  // so incoming messages in the active conversation are auto-marked as read.
  registerActiveNarrowGetter(() => nav.activeNarrow())

  // Seed the store with initial data from login
  onMount(() => {
    if (props.loginResult.realm_url) {
      org.setRealmUrl(props.loginResult.realm_url)
      ;(window as any).__FOUNDRY_REALM_URL = props.loginResult.realm_url
    }

    sync.setConnected(
      props.loginResult.org_id,
      props.loginResult.queue_id,
      props.loginResult.subscriptions,
      props.loginResult.users,
      props.loginEmail,
      props.loginResult.user_id,
      props.loginResult.user_topics,
      props.loginResult.unread_msgs,
      props.loginResult.recent_private_conversations,
    )

    void commands.getSavedServerStatuses().then((result) => {
      if (result.status !== "ok") return

      const currentServer = result.data.find((server) => server.org_id === props.loginResult.org_id)
        || result.data.find((server) =>
          server.connected
          && server.realm_name === props.loginResult.realm_name
          && server.email === props.loginEmail,
        )
        || result.data.find((server) =>
          server.connected
          && server.realm_name === props.loginResult.realm_name,
        )
      if (currentServer?.url) {
        org.setRealmUrl(currentServer.url)
        ;(window as any).__FOUNDRY_REALM_URL = currentServer.url
      }
    }).catch(() => {})

    // Apply homeView setting to set the initial navigation narrow
    if (!IS_DEMO) {
      const homeMap: Record<string, string | null> = {
        inbox: null,
        recent: "recent-topics",
        all: "all-messages",
      }
      const initialNarrow = homeMap[settingsStore.homeView]
      if (initialNarrow !== undefined) {
        nav.setActiveNarrow(initialNarrow)
      }
    }

    // In demo mode, seed mock messages and navigate to a topic
    if (IS_DEMO) {
      const demoMessages = createDemoMessages()
      for (const [narrow, msgs] of Object.entries(demoMessages)) {
        sync.addMessages(narrow, msgs)
        sync.markNarrowHydrated(narrow, true)
        sync.setMessageLoadState(narrow, "loaded-all")
      }
      // Navigate to the welcome topic
      nav.setActiveNarrow("stream:1/topic:welcome")
    }
  })

  // ── Unread badge count ──
  createEffect(() => {
    const total = getUnreadTotalCount(sync.store.unreadItems)
    commands.setUnreadBadgeCount(total > 0 ? total : null).catch(() => {})
  })

  // ── Settings-driven behavior effects ──

  // Theme: apply data-theme attribute to root element
  createEffect(() => {
    const theme = settingsStore.theme
    const root = document.documentElement
    if (theme === "light" || theme === "dark" || theme === "foundry") {
      root.setAttribute("data-theme", theme)
    } else {
      // "system" — remove attribute, let CSS handle via prefers-color-scheme
      root.removeAttribute("data-theme")
    }
  })

  // Whether the outer frame (top bar, left bar) has a dark background
  const outerFrameIsDark = () => {
    const theme = settingsStore.theme
    if (theme === "foundry" || theme === "dark") return true
    if (theme === "light") return false
    // "system" — check OS preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  }

  // Font size: set CSS variable on root
  createEffect(() => {
    const size = settingsStore.fontSize
    const root = document.documentElement
    const sizeMap: Record<string, string> = { small: "13px", normal: "14px", large: "16px" }
    root.style.setProperty("--font-size-base", sizeMap[size] || "14px")
  })

  // Custom CSS: inject/update a <style> element
  createEffect(() => {
    const css = settingsStore.customCSS
    let styleEl = document.getElementById("foundry-custom-css") as HTMLStyleElement | null
    if (css) {
      if (!styleEl) {
        styleEl = document.createElement("style")
        styleEl.id = "foundry-custom-css"
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = css
    } else if (styleEl) {
      styleEl.remove()
    }
  })

  // ── Global keyboard shortcuts ──
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in inputs/textareas
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return

      if (e.key === "Escape") {
        setShowSettings(false)
        setShowShortcuts(false)
        setShowRightSidebar(false)
        return
      }

      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        // Focus compose box
        const composeEl = document.querySelector<HTMLTextAreaElement>('[data-component="compose-box"] textarea')
        if (composeEl) {
          e.preventDefault()
          composeEl.focus()
        }
        return
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        // Focus search
        const searchEl = document.querySelector<HTMLInputElement>('[data-component="stream-search"] input')
        if (searchEl) {
          e.preventDefault()
          searchEl.focus()
        }
        return
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        setShowShortcuts(s => !s)
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown))
  })

  // Render the main content based on the active narrow
  const renderMainContent = (nav: ReturnType<typeof useNavigation>) => {
    const narrow = nav.activeNarrow()

    // Inbox (null narrow)
    if (narrow === null) {
      return <InboxView />
    }

    // Special views with dedicated components
    const parsed = nav.parseNarrow(narrow)

    if (parsed?.type === "recent-topics") {
      return <RecentTopicsView />
    }

    if (parsed?.type === "starred") {
      return <StarredView />
    }

    if (parsed?.type === "all-messages") {
      return <AllMessagesView />
    }

    // Stream, topic, DM narrows — show messages + compose
    return (
      <>
        <MessageList narrow={narrow} onToggleUserPanel={() => setShowRightSidebar(s => !s)} />
        <ComposeBox narrow={narrow} />
      </>
    )
  }

  return (
    <div class="flex h-full" data-component="app-layout" style={{ background: "var(--surface-outer-bg)" }}>
      {/* Left bar — full height, outside the inset container */}
      <LeftBar darkBackground={outerFrameIsDark()} />

      {/* Right column: top bar + inset content */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Top bar — blends with outer bg, OUTSIDE the inset container */}
        <div
          data-tauri-drag-region
          class="flex items-center justify-end"
          style={{ height: "36px", "flex-shrink": "0", background: "var(--surface-outer-bg)", "padding-right": "12px" }}
        >
          <div class="flex items-center gap-1" style={{ "-webkit-app-region": "no-drag" }}>
            <HelpMenu onShowShortcuts={() => setShowShortcuts(true)} darkBackground={outerFrameIsDark()} />
            <GearMenu onOpenSettings={() => setShowSettings(true)} darkBackground={outerFrameIsDark()} />
          </div>
        </div>

        {/* Inset container — rounded, with margin on right/bottom */}
        <div
          class="flex-1 flex min-h-0"
          style={{
            margin: "0 var(--layout-inset) var(--layout-inset) 0",
            "border-radius": "var(--radius-container)",
            overflow: "hidden",
            background: "var(--background-base)",
            border: "var(--inset-border)",
          }}
        >
          {/* Stream sidebar */}
          <StreamSidebar
            onOpenSettings={() => setShowSettings(true)}
            onLogout={handleLogout}
            onSwitchOrg={(server) => props.onSwitchOrg?.(server)}
          />

          {/* Main content */}
          <main class="flex-1 flex flex-col min-w-0" data-component="main-content">
            {renderMainContent(nav)}
          </main>

          {/* Right sidebar (user list) */}
          <RightSidebar
            show={showRightSidebar()}
            onClose={() => setShowRightSidebar(false)}
          />

          {/* Supervisor panel (conditionally rendered) */}
          <SupervisorPanel />
        </div>
      </div>

      {/* Settings modal overlay */}
      <Show when={showSettings()}>
        <SettingsView
          onClose={() => setShowSettings(false)}
          onLogout={async () => {
            setShowSettings(false)
            await handleLogout()
          }}
        />
      </Show>

      {/* Keyboard shortcuts modal */}
      <Show when={showShortcuts()}>
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      </Show>
    </div>
  )
}
