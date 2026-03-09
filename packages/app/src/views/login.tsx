import { createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { usePlatform } from "../context/platform"
import { commands } from "@zulip/desktop/bindings"
import type {
  ExternalAuthenticationMethod,
  LoginResult,
  ServerSettings,
} from "@zulip/desktop/bindings"
import {
  completePendingSso,
  consumePendingDeepLinks,
  openExternalAuth,
  parseSsoCallbackUrl,
  resolveServerUrl,
  subscribeToDeepLinks,
  supportsPasswordAuth,
  usernameLabel,
  usernamePlaceholder,
} from "../zulip-auth"

type AuthMode = "api-key" | "password"

/**
 * Login view — server URL input + authentication form.
 */
export function LoginView(props: {
  onLogin: (result: LoginResult) => void
  onLoginWithEmail?: (result: LoginResult, email: string) => void
}) {
  const platform = usePlatform()

  const [serverUrl, setServerUrl] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [step, setStep] = createSignal<"server" | "auth">("server")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [serverName, setServerName] = createSignal("")
  const [serverSettings, setServerSettings] = createSignal<ServerSettings | null>(null)
  const [authMode, setAuthMode] = createSignal<AuthMode>("api-key")
  const [pendingSsoProvider, setPendingSsoProvider] = createSignal<string | null>(null)

  const externalAuthMethods = () => serverSettings()?.external_authentication_methods ?? []
  const canUsePasswordAuth = () => {
    const settings = serverSettings()
    return settings ? supportsPasswordAuth(settings) : false
  }
  const currentUsernameLabel = () =>
    usernameLabel(serverSettings() ?? { require_email_format_usernames: true })
  const currentUsernamePlaceholder = () =>
    usernamePlaceholder(serverSettings() ?? { require_email_format_usernames: true })
  const usernameInputType = () =>
    serverSettings()?.require_email_format_usernames === false ? "text" : "email"

  const handleConnect = async () => {
    const url = serverUrl().trim()
    if (!url) {
      setError("Please enter a server URL")
      return
    }

    setLoading(true)
    setError("")

    try {
      const result = await commands.getServerSettings(url)
      if (result.status === "error") {
        setError(result.error)
        return
      }

      const resolvedUrl = resolveServerUrl(url, result.data)
      setServerUrl(resolvedUrl)
      setServerSettings(result.data)
      setServerName(result.data.realm_name || resolvedUrl)
      setAuthMode(supportsPasswordAuth(result.data) ? "password" : "api-key")
      setStep("auth")
    } catch (e: any) {
      setError(e?.toString() || "Failed to connect to server")
    } finally {
      setLoading(false)
    }
  }

  const completeLogin = async (resolvedUrl: string, userEmail: string, nextApiKey: string) => {
    const result = await commands.login(resolvedUrl, userEmail, nextApiKey)
    if (result.status === "error") {
      throw new Error(result.error)
    }

    await commands.addServer({
      id: result.data.org_id,
      url: resolvedUrl,
      email: userEmail,
      api_key: nextApiKey,
      realm_name: result.data.realm_name,
      realm_icon: result.data.realm_icon,
    })

    if (props.onLoginWithEmail) {
      props.onLoginWithEmail(result.data, userEmail)
    } else {
      props.onLogin(result.data)
    }
  }

  const handleLogin = async () => {
    const resolvedUrl = resolveServerUrl(serverUrl(), serverSettings())
    const username = email().trim()

    if (!username) {
      setError("Please enter your email")
      return
    }

    if (authMode() === "api-key" && !apiKey().trim()) {
      setError("Please enter your API key")
      return
    }

    if (authMode() === "password" && !password()) {
      setError("Please enter your password")
      return
    }

    setLoading(true)
    setError("")

    try {
      if (authMode() === "password") {
        const credentials = await commands.fetchApiKey(resolvedUrl, username, password())
        if (credentials.status === "error") {
          setError(credentials.error)
          return
        }

        setEmail(credentials.data.email)
        await completeLogin(resolvedUrl, credentials.data.email, credentials.data.api_key)
        return
      }

      await completeLogin(resolvedUrl, username, apiKey().trim())
    } catch (e: any) {
      setError(e?.message || e?.toString() || "Login failed")
    } finally {
      setLoading(false)
    }
  }

  const handleExternalAuth = async (method: ExternalAuthenticationMethod) => {
    const resolvedUrl = resolveServerUrl(serverUrl(), serverSettings())

    setError("")
    setPendingSsoProvider(method.name)

    try {
      await openExternalAuth(platform, window.localStorage, resolvedUrl, method)
    } catch (e: any) {
      setPendingSsoProvider(null)
      setError(e?.message || e?.toString() || "SSO login failed")
    }
  }

  const handleDeepLinks = async (urls: string[]) => {
    const callback = urls
      .map(parseSsoCallbackUrl)
      .find((payload): payload is NonNullable<ReturnType<typeof parseSsoCallbackUrl>> => payload !== null)

    if (!callback) return

    setLoading(true)
    setError("")

    try {
      const credentials = completePendingSso(window.localStorage, callback)
      setServerUrl(credentials.serverUrl)
      setEmail(credentials.email)
      await completeLogin(credentials.serverUrl, credentials.email, credentials.apiKey)
    } catch (e: any) {
      setError(e?.message || e?.toString() || "SSO login failed")
    } finally {
      setLoading(false)
      setPendingSsoProvider(null)
    }
  }

  const handleCreateOrg = () => {
    platform.openLink("https://zulip.com/new/")
  }

  onMount(() => {
    void handleDeepLinks(consumePendingDeepLinks())

    const unsubscribe = subscribeToDeepLinks((urls) => {
      void handleDeepLinks(urls)
    })

    onCleanup(unsubscribe)
  })

  const resetToServerStep = () => {
    setStep("server")
    setError("")
    setPendingSsoProvider(null)
    setServerSettings(null)
  }

  return (
    <div
      class="h-full flex items-center justify-center bg-[var(--background-base)]"
      data-component="login-view"
    >
      <div
        data-tauri-drag-region
        class="fixed top-0 left-0 right-0"
        style={{ height: "52px" }}
      />

      <div class="w-full max-w-md mx-auto p-8">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-[var(--text-primary)]">Foundry</h1>
          <p class="text-sm text-[var(--text-secondary)] mt-1">
            Connect to your Foundry organization
          </p>
        </div>

        <Show
          when={step() === "auth"}
          fallback={
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Organization URL
                </label>
                <input
                  data-component="server-url-input"
                  class="setting-input-value w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
                  type="url"
                  placeholder="https://your-org.foundry.dev"
                  value={serverUrl()}
                  onInput={(e) => setServerUrl(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  autofocus
                />
              </div>

              <Show when={error()}>
                <p class="text-sm text-[var(--status-error)]">{error()}</p>
              </Show>

              <button
                data-component="connect-button"
                id="connect"
                class="w-full py-2 px-4 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] text-sm font-medium hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleConnect}
                disabled={loading()}
              >
                {loading() ? "Connecting..." : "Connect"}
              </button>

              <div class="text-center">
                <a
                  data-component="create-org-link"
                  id="open-create-org-link"
                  class="text-sm text-[var(--interactive-primary)] hover:underline cursor-pointer"
                  onClick={handleCreateOrg}
                >
                  Create a new organization
                </a>
              </div>
            </div>
          }
        >
          <div class="space-y-4" data-component="auth-form">
            <div class="text-center mb-4">
              <p class="text-sm text-[var(--text-secondary)]">
                Connecting to <strong>{serverName()}</strong>
              </p>
            </div>

            <Show when={externalAuthMethods().length > 0}>
              <div class="space-y-4">
                <div class="space-y-2">
                  <For each={externalAuthMethods()}>
                    {(method) => (
                      <button
                        class="w-full py-2 px-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)] text-[var(--text-primary)] text-sm font-medium hover:bg-[var(--background-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void handleExternalAuth(method)}
                        disabled={loading()}
                      >
                        {pendingSsoProvider() === method.name
                          ? `Waiting for ${method.display_name} in your browser...`
                          : `Continue with ${method.display_name}`}
                      </button>
                    )}
                  </For>
                </div>

                <div class="flex items-center gap-3">
                  <div class="h-px flex-1 bg-[var(--border-default)]" />
                  <span class="text-xs uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Or use credentials
                  </span>
                  <div class="h-px flex-1 bg-[var(--border-default)]" />
                </div>
              </div>
            </Show>

            <div class="grid grid-cols-2 gap-2">
              <button
                class={`py-2 px-3 rounded-[var(--radius-md)] border text-sm transition-colors ${
                  authMode() === "password"
                    ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)]"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-surface)]"
                }`}
                onClick={() => setAuthMode("password")}
                disabled={!canUsePasswordAuth()}
              >
                Password
              </button>
              <button
                class={`py-2 px-3 rounded-[var(--radius-md)] border text-sm transition-colors ${
                  authMode() === "api-key"
                    ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)]"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-surface)]"
                }`}
                onClick={() => setAuthMode("api-key")}
              >
                API Key
              </button>
            </div>

            <div>
              <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                {currentUsernameLabel()}
              </label>
              <input
                class="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
                type={usernameInputType()}
                id="id_username"
                placeholder={currentUsernamePlaceholder()}
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                autofocus
              />
            </div>

            <Show
              when={authMode() === "password"}
              fallback={
                <div>
                  <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                    API Key
                  </label>
                  <input
                    class="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
                    type="password"
                    placeholder="Your Zulip API key"
                    value={apiKey()}
                    onInput={(e) => setApiKey(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                  <p class="text-xs text-[var(--text-tertiary)] mt-1">
                    Find your API key in Settings &rarr; Your Account &rarr; API Key
                  </p>
                </div>
              }
            >
              <div>
                <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Password
                </label>
                <input
                  class="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
                  type="password"
                  placeholder="Your Zulip password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
            </Show>

            <Show when={error()}>
              <p class="text-sm text-[var(--status-error)]">{error()}</p>
            </Show>

            <button
              class="w-full py-2 px-4 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] text-sm font-medium hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleLogin}
              disabled={loading() || (authMode() === "password" && !canUsePasswordAuth())}
            >
              {loading() ? "Signing in..." : "Sign In"}
            </button>

            <button
              class="w-full py-2 px-4 rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)] text-sm hover:bg-[var(--background-surface)] transition-colors"
              onClick={resetToServerStep}
            >
              Back
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}
