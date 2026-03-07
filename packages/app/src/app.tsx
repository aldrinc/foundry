import type {
  LoginResult,
  Message,
  Subscription,
  User,
} from "@zulip/desktop/bindings";
import { commands } from "@zulip/desktop/bindings";
import { createEffect, createSignal, type JSX, onMount, Show } from "solid-js";
import { ComposeBox } from "./components/compose-box";
import { GearMenu } from "./components/gear-menu";
import { HelpMenu } from "./components/help-menu";
import { KeyboardShortcutsModal } from "./components/keyboard-shortcuts-modal";
import { MessageList } from "./components/message-list";
import { RightSidebar } from "./components/right-sidebar";
import { StreamSidebar } from "./components/stream-sidebar";
import { SupervisorPanel } from "./components/supervisor";
import { NavigationProvider, useNavigation } from "./context/navigation";
import { OrgProvider } from "./context/org";
import { SettingsProvider, useSettings } from "./context/settings";
import { SupervisorProvider } from "./context/supervisor";
import { useZulipSync, ZulipSyncProvider } from "./context/zulip-sync";
import { AllMessagesView } from "./views/all-messages";
import { InboxView } from "./views/inbox";
import { LoginView } from "./views/login";
import { RecentTopicsView } from "./views/recent-topics";
import { SettingsView } from "./views/settings";
import { StarredView } from "./views/starred";

// ── Demo mode helpers (browser preview without Tauri backend) ──

const IS_DEMO =
  typeof window !== "undefined" && window.location.search.includes("demo");

function createDemoLoginResult(): LoginResult {
  return {
    org_id: "demo-org-001",
    realm_name: "Foundry Demo",
    realm_icon: "",
    queue_id: "demo-queue",
    user_id: 100,
    subscriptions: [
      { stream_id: 1, name: "general", color: "#76ce90", pin_to_top: true },
      { stream_id: 2, name: "engineering", color: "#fae589" },
      { stream_id: 3, name: "design", color: "#a6c5e2" },
      { stream_id: 4, name: "product", color: "#e4a5a5" },
      { stream_id: 5, name: "random", color: "#c2b0e2" },
      { stream_id: 6, name: "ops", color: "#e0ab76", is_muted: true },
    ],
    users: [
      {
        user_id: 100,
        email: "alice@foundry.dev",
        full_name: "Alice Chen",
        role: 200,
        is_active: true,
      },
      {
        user_id: 101,
        email: "bob@foundry.dev",
        full_name: "Bob Martinez",
        role: 400,
        is_active: true,
      },
      {
        user_id: 102,
        email: "carol@foundry.dev",
        full_name: "Carol Park",
        role: 400,
        is_active: true,
      },
      {
        user_id: 103,
        email: "dave@foundry.dev",
        full_name: "Dave Wilson",
        role: 400,
        is_active: true,
      },
    ],
  };
}

function createDemoMessages(): Record<string, Message[]> {
  const now = Math.floor(Date.now() / 1000);
  return {
    "stream:1/topic:welcome": [
      {
        id: 1001,
        sender_id: 100,
        sender_full_name: "Alice Chen",
        sender_email: "alice@foundry.dev",
        type: "stream",
        content:
          "<p>Welcome to <strong>Foundry</strong>! This is the new team workspace.</p>",
        subject: "welcome",
        timestamp: now - 3600,
        stream_id: 1,
        flags: ["read"],
        reactions: [
          {
            emoji_name: "wave",
            emoji_code: "1f44b",
            reaction_type: "unicode_emoji",
            user_id: 101,
          },
          {
            emoji_name: "rocket",
            emoji_code: "1f680",
            reaction_type: "unicode_emoji",
            user_id: 102,
          },
        ],
        avatar_url: null,
        display_recipient: "general",
      },
      {
        id: 1002,
        sender_id: 101,
        sender_full_name: "Bob Martinez",
        sender_email: "bob@foundry.dev",
        type: "stream",
        content: "<p>Excited to be here! The new UI looks great.</p>",
        subject: "welcome",
        timestamp: now - 3500,
        stream_id: 1,
        flags: ["read"],
        reactions: [
          {
            emoji_name: "+1",
            emoji_code: "1f44d",
            reaction_type: "unicode_emoji",
            user_id: 100,
          },
        ],
        avatar_url: null,
        display_recipient: "general",
      },
      {
        id: 1003,
        sender_id: 102,
        sender_full_name: "Carol Park",
        sender_email: "carol@foundry.dev",
        type: "stream",
        content:
          "<p>Love the dark sidebar. Can we add custom emoji support next?</p>",
        subject: "welcome",
        timestamp: now - 3000,
        stream_id: 1,
        flags: [],
        reactions: [],
        avatar_url: null,
        display_recipient: "general",
      },
      {
        id: 1004,
        sender_id: 100,
        sender_full_name: "Alice Chen",
        sender_email: "alice@foundry.dev",
        type: "stream",
        content:
          "<p>Absolutely, custom emoji is on the roadmap. Check out the <code>#product</code> channel for more details.</p>",
        subject: "welcome",
        timestamp: now - 2800,
        stream_id: 1,
        flags: [],
        reactions: [],
        avatar_url: null,
        display_recipient: "general",
      },
      {
        id: 1005,
        sender_id: 103,
        sender_full_name: "Dave Wilson",
        sender_email: "dave@foundry.dev",
        type: "stream",
        content:
          "<p>Just pushed the new supervisor integration. You can now use the <strong>AI</strong> button in topic views to invoke the Meridian orchestrator.</p>",
        subject: "welcome",
        timestamp: now - 1200,
        stream_id: 1,
        flags: [],
        reactions: [
          {
            emoji_name: "tada",
            emoji_code: "1f389",
            reaction_type: "unicode_emoji",
            user_id: 100,
          },
          {
            emoji_name: "tada",
            emoji_code: "1f389",
            reaction_type: "unicode_emoji",
            user_id: 101,
          },
        ],
        avatar_url: null,
        display_recipient: "general",
      },
    ],
  };
}

/**
 * Root App component.
 */
export function App(props: {
  onCommandReady?: (trigger: (id: string) => void) => void;
  children?: JSX.Element;
}) {
  const [loginResult, setLoginResult] = createSignal<LoginResult | null>(null);
  const [loginEmail, setLoginEmail] = createSignal<string>("");
  const [autoLoginLoading, setAutoLoginLoading] = createSignal(true);

  // Try auto-login from saved servers (or use demo mode)
  onMount(async () => {
    if (IS_DEMO) {
      setLoginResult(createDemoLoginResult());
      setLoginEmail("alice@foundry.dev");
      setAutoLoginLoading(false);
      return;
    }

    try {
      const result = await commands.getServers();
      if (result.status === "ok" && result.data.length > 0) {
        const server = result.data[0];
        setLoginEmail(server.email);
        const loginRes = await commands.login(
          server.url,
          server.email,
          server.api_key,
        );
        if (loginRes.status === "ok") {
          setLoginResult(loginRes.data);
        }
      }
    } catch {
      // Auto-login failed, show login form
    } finally {
      setAutoLoginLoading(false);
    }
  });

  const handleLogin = (result: LoginResult, email?: string) => {
    setLoginResult(result);
    if (email) setLoginEmail(email);
  };

  return (
    <div class="h-screen w-screen flex flex-col" data-component="app-shell">
      <Show when={!autoLoginLoading()} fallback={<LoadingSplash />}>
        <Show
          when={loginResult()}
          fallback={
            <LoginView
              onLogin={(result) => {
                // Extract email from users list or saved servers
                // The LoginView will pass the email via the second arg
                handleLogin(result);
              }}
              onLoginWithEmail={(result, email) => handleLogin(result, email)}
            />
          }
        >
          {(result) => (
            <OrgProvider
              org={{
                orgId: result().org_id,
                realmName: result().realm_name,
                realmIcon: result().realm_icon,
              }}
            >
              <SettingsProvider orgId={result().org_id}>
                <ZulipSyncProvider orgId={result().org_id}>
                  <NavigationProvider>
                    <SupervisorProvider orgId={result().org_id}>
                      <AppShell
                        loginResult={result()}
                        loginEmail={loginEmail()}
                      />
                    </SupervisorProvider>
                  </NavigationProvider>
                </ZulipSyncProvider>
              </SettingsProvider>
            </OrgProvider>
          )}
        </Show>
      </Show>
    </div>
  );
}

function LoadingSplash() {
  return (
    <div class="h-full flex items-center justify-center bg-[var(--background-base)]">
      <div class="text-center">
        <div class="text-sm text-[var(--text-tertiary)]">Loading...</div>
      </div>
    </div>
  );
}

/**
 * Main app shell with sidebar + content area.
 * Shown after successful login.
 */
function AppShell(props: { loginResult: LoginResult; loginEmail: string }) {
  const sync = useZulipSync();
  const nav = useNavigation();
  const { store: settingsStore } = useSettings();
  const [showSettings, setShowSettings] = createSignal(false);
  const [showRightSidebar, setShowRightSidebar] = createSignal(false);
  const [showShortcuts, setShowShortcuts] = createSignal(false);

  // Seed the store with initial data from login
  onMount(() => {
    sync.setConnected(
      props.loginResult.org_id,
      props.loginResult.queue_id,
      props.loginResult.subscriptions,
      props.loginResult.users,
      props.loginEmail,
      props.loginResult.user_id,
    );

    // In demo mode, seed mock messages and navigate to a topic
    if (IS_DEMO) {
      const demoMessages = createDemoMessages();
      for (const [narrow, msgs] of Object.entries(demoMessages)) {
        sync.addMessages(narrow, msgs);
        sync.markNarrowHydrated(narrow, true);
        sync.setMessageLoadState(narrow, "loaded-all");
      }
      // Navigate to the welcome topic
      nav.setActiveNarrow("stream:1/topic:welcome");
    }
  });

  // ── Settings-driven behavior effects ──

  // Theme: apply data-theme attribute to root element
  createEffect(() => {
    const theme = settingsStore.theme;
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      // "system" — remove attribute, let CSS handle via prefers-color-scheme
      root.removeAttribute("data-theme");
    }
  });

  // Font size: set CSS variable on root
  createEffect(() => {
    const size = settingsStore.fontSize;
    const root = document.documentElement;
    const sizeMap: Record<string, string> = {
      small: "13px",
      normal: "14px",
      large: "16px",
    };
    root.style.setProperty("--font-size-base", sizeMap[size] || "14px");
  });

  // Custom CSS: inject/update a <style> element
  createEffect(() => {
    const css = settingsStore.customCSS;
    let styleEl = document.getElementById(
      "foundry-custom-css",
    ) as HTMLStyleElement | null;
    if (css) {
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "foundry-custom-css";
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
    } else if (styleEl) {
      styleEl.remove();
    }
  });

  // Render the main content based on the active narrow
  const renderMainContent = (nav: ReturnType<typeof useNavigation>) => {
    const narrow = nav.activeNarrow();

    // Inbox (null narrow)
    if (narrow === null) {
      return <InboxView />;
    }

    // Special views with dedicated components
    const parsed = nav.parseNarrow(narrow);

    if (parsed?.type === "recent-topics") {
      return <RecentTopicsView />;
    }

    if (parsed?.type === "starred") {
      return <StarredView />;
    }

    if (parsed?.type === "all-messages") {
      return <AllMessagesView />;
    }

    // Stream, topic, DM narrows — show messages + compose
    return (
      <>
        <MessageList
          narrow={narrow}
          onToggleUserPanel={() => setShowRightSidebar((s) => !s)}
        />
        <ComposeBox narrow={narrow} />
      </>
    );
  };

  return (
    <div class="flex flex-col h-full" data-component="app-layout">
      {/* macOS title bar drag region — provides space for traffic light buttons */}
      <div
        data-tauri-drag-region
        class="flex items-center justify-end"
        style={{
          height: "52px",
          "flex-shrink": "0",
          background: "var(--surface-sidebar)",
          "padding-right": "12px",
        }}
      >
        {/* Help & Settings icons — positioned above the message header */}
        <div
          class="flex items-center gap-1"
          style={{ "-webkit-app-region": "no-drag" }}
        >
          <HelpMenu onShowShortcuts={() => setShowShortcuts(true)} />
          <GearMenu onOpenSettings={() => setShowSettings(true)} />
        </div>
      </div>

      {/* Main row: sidebar + content */}
      <div class="flex flex-1 min-h-0">
        {/* Stream sidebar */}
        <StreamSidebar
          onOpenSettings={() => setShowSettings(true)}
          onLogout={() => window.location.reload()}
        />

        {/* Main content */}
        <main
          class="flex-1 flex flex-col min-w-0"
          data-component="main-content"
        >
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

      {/* Settings modal overlay */}
      <Show when={showSettings()}>
        <SettingsView
          onClose={() => setShowSettings(false)}
          onLogout={() => {
            setShowSettings(false);
            // Force re-render by going back to login
            window.location.reload();
          }}
        />
      </Show>

      {/* Keyboard shortcuts modal */}
      <Show when={showShortcuts()}>
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      </Show>
    </div>
  );
}
