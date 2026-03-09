import { createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { useOrg } from "../context/org"
import { usePlatform } from "../context/platform"
import { commands } from "@zulip/desktop/bindings"
import type {
  ExternalAuthenticationMethod,
  SavedServerStatus,
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

export function SettingsServers() {
  const org = useOrg()
  const platform = usePlatform()
  const [servers, setServers] = createSignal<SavedServerStatus[]>([])
  const [showAdd, setShowAdd] = createSignal(false)
  const [addStep, setAddStep] = createSignal<"url" | "credentials">("url")
  const [authMode, setAuthMode] = createSignal<AuthMode>("api-key")
  const [newUrl, setNewUrl] = createSignal("")
  const [newEmail, setNewEmail] = createSignal("")
  const [newApiKey, setNewApiKey] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [serverInfo, setServerInfo] = createSignal<ServerSettings | null>(null)
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [pendingSsoProvider, setPendingSsoProvider] = createSignal<string | null>(null)
  const externalAuthMethods = () => serverInfo()?.external_authentication_methods ?? []
  const canUsePasswordAuth = () => {
    const info = serverInfo()
    return info ? supportsPasswordAuth(info) : false
  }
  const currentUsernameLabel = () =>
    usernameLabel(serverInfo() ?? { require_email_format_usernames: true })
  const currentUsernamePlaceholder = () =>
    usernamePlaceholder(serverInfo() ?? { require_email_format_usernames: true })

  const loadServers = async () => {
    try {
      const result = await commands.getSavedServerStatuses()
      if (result.status === "ok") {
        setServers(result.data)
      }
    } catch {
      // Failed to load servers
    }
  }

  onMount(() => {
    void loadServers()
    void handleDeepLinks(consumePendingDeepLinks())

    const unsubscribe = subscribeToDeepLinks((urls) => {
      void handleDeepLinks(urls)
    })

    onCleanup(unsubscribe)
  })

  const resetAddForm = () => {
    setShowAdd(false)
    setAddStep("url")
    setAuthMode("api-key")
    setNewUrl("")
    setNewEmail("")
    setNewApiKey("")
    setNewPassword("")
    setServerInfo(null)
    setPendingSsoProvider(null)
    setError("")
  }

  const handleCheckServer = async () => {
    const url = newUrl().trim()
    if (!url) return
    setLoading(true)
    setError("")
    try {
      const result = await commands.getServerSettings(url)
      if (result.status === "ok") {
        const resolvedUrl = resolveServerUrl(url, result.data)
        setNewUrl(resolvedUrl)
        setServerInfo(result.data)
        setAuthMode(supportsPasswordAuth(result.data) ? "password" : "api-key")
        setAddStep("credentials")
      } else {
        setError(result.error)
      }
    } catch {
      setError("Failed to connect to server")
    }
    setLoading(false)
  }

  const completeServerLogin = async (url: string, email: string, apiKey: string) => {
    const loginResult = await commands.login(url, email, apiKey)
    if (loginResult.status === "error") {
      throw new Error(loginResult.error)
    }

    await commands.addServer({
      id: loginResult.data.org_id,
      url,
      email,
      api_key: apiKey,
      realm_name: loginResult.data.realm_name,
      realm_icon: loginResult.data.realm_icon,
    })

    resetAddForm()
    await loadServers()
  }

  const handleConnect = async () => {
    const url = resolveServerUrl(newUrl(), serverInfo())
    const username = newEmail().trim()
    if (!url || !username) return

    if (authMode() === "api-key" && !newApiKey().trim()) return
    if (authMode() === "password" && !newPassword()) return

    setLoading(true)
    setError("")
    try {
      if (authMode() === "password") {
        const apiKeyResult = await commands.fetchApiKey(url, username, newPassword())
        if (apiKeyResult.status === "error") {
          setError(apiKeyResult.error)
          return
        }

        setNewEmail(apiKeyResult.data.email)
        await completeServerLogin(url, apiKeyResult.data.email, apiKeyResult.data.api_key)
        return
      }

      await completeServerLogin(url, username, newApiKey().trim())
    } catch (e: any) {
      setError(e?.message || e?.toString() || "Failed to connect")
    } finally {
      setLoading(false)
    }
  }

  const handleExternalAuth = async (method: ExternalAuthenticationMethod) => {
    const url = resolveServerUrl(newUrl(), serverInfo())

    setError("")
    setPendingSsoProvider(method.name)

    try {
      await openExternalAuth(platform, window.localStorage, url, method)
    } catch (e: any) {
      setPendingSsoProvider(null)
      setError(e?.message || e?.toString() || "SSO sign-in failed")
    }
  }

  const handleDeepLinks = async (urls: string[]) => {
    const callback = urls
      .map(parseSsoCallbackUrl)
      .find((payload): payload is NonNullable<ReturnType<typeof parseSsoCallbackUrl>> => payload !== null)

    if (!callback || !showAdd()) return

    setLoading(true)
    setError("")
    try {
      const credentials = completePendingSso(window.localStorage, callback)
      setNewUrl(credentials.serverUrl)
      setNewEmail(credentials.email)
      await completeServerLogin(credentials.serverUrl, credentials.email, credentials.apiKey)
    } catch (e: any) {
      setError(e?.message || e?.toString() || "SSO sign-in failed")
    } finally {
      setLoading(false)
      setPendingSsoProvider(null)
    }
  }

  const handleDisconnect = async (server: SavedServerStatus) => {
    if (!server.org_id) return
    try {
      await commands.logout(server.org_id)
      await loadServers()
    } catch {
      // Non-critical
    }
  }

  const handleRemove = async (server: SavedServerStatus) => {
    if (!confirm(`Remove ${server.realm_name || server.url}? This cannot be undone.`)) return
    try {
      if (server.org_id) {
        await commands.logout(server.org_id)
      }
      await commands.removeServer(server.id)
      await loadServers()
    } catch {
      // Non-critical
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Connected Servers</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => showAdd() ? resetAddForm() : setShowAdd(true)}
        >
          {showAdd() ? "Cancel" : "Add server"}
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        Manage your connected Zulip organizations. You can connect to multiple servers and switch between them.
      </p>

      <Show when={showAdd()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <Show when={addStep() === "url"}>
            <div>
              <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Server URL</label>
              <input
                type="text"
                class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono"
                placeholder="https://chat.example.com"
                value={newUrl()}
                onInput={(e) => setNewUrl(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCheckServer()}
              />
            </div>
            <button
              class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
              disabled={!newUrl().trim() || loading()}
              onClick={handleCheckServer}
            >
              {loading() ? "Checking..." : "Connect"}
            </button>
          </Show>

          <Show when={addStep() === "credentials"}>
            <Show when={serverInfo()}>
              <div class="text-xs font-medium text-[var(--text-primary)]">
                {serverInfo()!.realm_name || newUrl()}
              </div>
              <div class="text-[10px] text-[var(--text-tertiary)] font-mono">{newUrl()}</div>
            </Show>

            <Show when={externalAuthMethods().length > 0}>
              <div class="space-y-4">
                <div class="space-y-2">
                  <For each={externalAuthMethods()}>
                    {(method) => (
                      <button
                        class="w-full py-2 px-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] text-xs text-[var(--text-primary)] hover:bg-[var(--background-surface)] transition-colors disabled:opacity-50"
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

                <div class="flex items-center gap-2">
                  <div class="h-px flex-1 bg-[var(--border-default)]" />
                  <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Or use credentials
                  </span>
                  <div class="h-px flex-1 bg-[var(--border-default)]" />
                </div>
              </div>
            </Show>

            <div class="grid grid-cols-2 gap-2">
              <button
                class={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border transition-colors ${
                  authMode() === "password"
                    ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)] text-white"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-base)]"
                }`}
                onClick={() => setAuthMode("password")}
                disabled={!canUsePasswordAuth()}
              >
                Password
              </button>
              <button
                class={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border transition-colors ${
                  authMode() === "api-key"
                    ? "border-[var(--interactive-primary)] bg-[var(--interactive-primary)] text-white"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-base)]"
                }`}
                onClick={() => setAuthMode("api-key")}
              >
                API Key
              </button>
            </div>

            <div>
              <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">
                {currentUsernameLabel()}
              </label>
              <input
                type={serverInfo()?.require_email_format_usernames === false ? "text" : "email"}
                class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                placeholder={currentUsernamePlaceholder()}
                value={newEmail()}
                onInput={(e) => setNewEmail(e.currentTarget.value)}
              />
            </div>

            <Show
              when={authMode() === "password"}
              fallback={
                <div>
                  <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">API Key</label>
                  <input
                    type="password"
                    class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono"
                    placeholder="Your API key"
                    value={newApiKey()}
                    onInput={(e) => setNewApiKey(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  />
                </div>
              }
            >
              <div>
                <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Password</label>
                <input
                  type="password"
                  class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                  placeholder="Your Zulip password"
                  value={newPassword()}
                  onInput={(e) => setNewPassword(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                />
              </div>
            </Show>

            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
                disabled={
                  loading()
                    || !newEmail().trim()
                    || (authMode() === "api-key" && !newApiKey().trim())
                    || (authMode() === "password"
                      && (!newPassword() || !canUsePasswordAuth()))
                }
                onClick={handleConnect}
              >
                {loading() ? "Connecting..." : "Sign in"}
              </button>
              <button
                class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-base)]"
                onClick={() => { setAddStep("url"); setError("") }}
              >
                Back
              </button>
            </div>
          </Show>

          <Show when={error()}>
            <div class="text-[11px] text-[var(--status-error)]">{error()}</div>
          </Show>
        </div>
      </Show>

      <Show
        when={servers().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No connected servers</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Add a server to get started
            </div>
          </div>
        }
      >
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={servers()}>
            {(server) => (
              <div class="flex items-center justify-between px-3 py-3 border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center gap-2 min-w-0">
                  <Show
                    when={server.realm_icon}
                    fallback={
                      <div class="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] flex items-center justify-center text-xs font-medium text-white shrink-0">
                        {(server.realm_name || server.url).charAt(0).toUpperCase()}
                      </div>
                    }
                  >
                    <img
                      src={server.realm_icon}
                      alt=""
                      class="w-8 h-8 rounded-[var(--radius-sm)] shrink-0"
                    />
                  </Show>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-[var(--text-primary)] truncate">
                      {server.realm_name || server.url}
                    </div>
                    <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">{server.email}</div>
                    <div class="text-[10px] text-[var(--text-quaternary)] font-mono mt-0.5 truncate">{server.url}</div>
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <Show when={server.id !== org.orgId}>
                    <Show
                      when={server.connected}
                      fallback={
                        <span class="text-[10px] px-2 py-0.5 rounded-full bg-[var(--background-base)] text-[var(--text-quaternary)] border border-[var(--border-default)]">
                          Saved
                        </span>
                      }
                    >
                      <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                        Connected
                      </span>
                    </Show>
                  </Show>

                  <Show when={server.connected && server.id !== org.orgId}>
                    <button
                      class="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-base)]"
                      onClick={() => void handleDisconnect(server)}
                    >
                      Disconnect
                    </button>
                  </Show>
                  <button
                    class="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--status-error)] hover:bg-[var(--background-base)]"
                    onClick={() => void handleRemove(server)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
