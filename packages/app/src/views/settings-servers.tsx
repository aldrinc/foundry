import { createSignal, For, Show, onMount } from "solid-js"
import { useOrg } from "../context/org"
import { commands } from "@zulip/desktop/bindings"

interface Server {
  url: string
  email: string
  realm_name?: string
}

export function SettingsServers() {
  const org = useOrg()
  const [servers, setServers] = createSignal<Server[]>([])
  const [showAdd, setShowAdd] = createSignal(false)
  const [newUrl, setNewUrl] = createSignal("")

  onMount(async () => {
    try {
      const result = await commands.getServers()
      if (result.status === "ok") {
        setServers(result.data.map(s => ({
          url: s.url,
          email: s.email,
          realm_name: undefined,
        })))
      }
    } catch {
      // Failed to load servers
    }
  })

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Connected Servers</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowAdd(s => !s)}
        >
          {showAdd() ? "Cancel" : "Add server"}
        </button>
      </div>

      <p class="text-xs text-[var(--text-tertiary)]">
        Manage your connected Zulip organizations. You can connect to multiple servers and switch between them.
      </p>

      {/* Add form */}
      <Show when={showAdd()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Server URL</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono"
              placeholder="https://chat.example.com"
              value={newUrl()}
              onInput={(e) => setNewUrl(e.currentTarget.value)}
            />
          </div>
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
            disabled={!newUrl().trim()}
          >
            Connect
          </button>
        </div>
      </Show>

      {/* Server list */}
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
                <div class="min-w-0">
                  <div class="text-xs font-medium text-[var(--text-primary)] truncate">
                    {server.realm_name || server.url}
                  </div>
                  <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">{server.email}</div>
                  <div class="text-[10px] text-[var(--text-quaternary)] font-mono mt-0.5 truncate">{server.url}</div>
                </div>
                <div class="flex items-center gap-2 shrink-0 ml-2">
                  <span class="w-2 h-2 rounded-full bg-green-500" title="Connected" />
                  <button class="text-[10px] text-[var(--status-error)] hover:underline">
                    Disconnect
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
