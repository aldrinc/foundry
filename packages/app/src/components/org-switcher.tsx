import { createSignal, For, Show, onMount } from "solid-js"
import { commands } from "@foundry/desktop/bindings"
import type { SavedServerStatus } from "@foundry/desktop/bindings"

export function OrgSwitcher(props: {
  currentOrgId: string
  currentRealmName?: string
  currentRealmIcon?: string
  currentRealmUrl?: string
  onSwitch: (server: SavedServerStatus) => void
  onAddOrg: () => void
}) {
  const [servers, setServers] = createSignal<SavedServerStatus[]>([])
  const [open, setOpen] = createSignal(false)

  onMount(async () => {
    try {
      const result = await commands.getSavedServerStatuses()
      if (result.status === "ok") {
        setServers(result.data)
      }
    } catch {
      // Non-critical
    }
  })

  const currentServer = () => servers().find(s => s.org_id === props.currentOrgId)
  const otherServers = () => servers().filter(s => s.org_id !== props.currentOrgId)
  const currentRealmName = () => currentServer()?.realm_name || props.currentRealmName || "Organization"
  const currentRealmIcon = () => currentServer()?.realm_icon || props.currentRealmIcon || ""
  const currentRealmUrl = () => currentServer()?.url || props.currentRealmUrl || ""

  return (
    <div class="relative">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--background-surface)] transition-colors border-b border-[var(--border-default)]"
        data-component="org-switcher-trigger"
        onClick={() => setOpen(o => !o)}
      >
        <Show
          when={currentRealmIcon()}
          fallback={
            <div class="w-5 h-5 rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] flex items-center justify-center text-[9px] font-bold text-white shrink-0">
              {currentRealmName().charAt(0).toUpperCase()}
            </div>
          }
        >
          <img
            src={currentRealmIcon()}
            alt=""
            class="w-5 h-5 rounded-[var(--radius-sm)] shrink-0"
          />
        </Show>
        <div class="min-w-0 flex-1">
          <div class="text-xs font-medium text-[var(--text-primary)] truncate">
            {currentRealmName()}
          </div>
          <Show when={currentRealmUrl()}>
            <div
              class="text-[10px] text-[var(--text-tertiary)] font-mono truncate mt-0.5"
              title={currentRealmUrl()}
            >
              {currentRealmUrl()}
            </div>
          </Show>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="shrink-0 text-[var(--text-tertiary)]">
          <path d="M3 4l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <Show when={open()}>
        <div
          class="absolute top-full left-0 right-0 z-50 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-b-[var(--radius-md)] shadow-lg py-1"
        >
          <Show
            when={otherServers().length > 0}
            fallback={
              <div class="px-3 py-2 text-[10px] text-[var(--text-tertiary)]">
                No other saved organizations yet.
              </div>
            }
          >
            <For each={otherServers()}>
              {(server) => (
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--background-elevated)] transition-colors"
                  data-component="org-switcher-option"
                  onClick={() => {
                    setOpen(false)
                    props.onSwitch(server)
                  }}
                >
                  <Show
                    when={server.realm_icon}
                    fallback={
                      <div class="w-5 h-5 rounded-[var(--radius-sm)] bg-[var(--text-tertiary)] flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                        {(server.realm_name || server.url).charAt(0).toUpperCase()}
                      </div>
                    }
                  >
                    <img src={server.realm_icon} alt="" class="w-5 h-5 rounded-[var(--radius-sm)] shrink-0" />
                  </Show>
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-medium text-[var(--text-primary)] truncate">
                      {server.realm_name || server.url}
                    </div>
                    <div class="text-[10px] text-[var(--text-tertiary)] font-mono truncate mt-0.5" title={server.url}>
                      {server.url}
                    </div>
                    <div class="text-[10px] text-[var(--text-tertiary)] truncate">{server.email}</div>
                  </div>
                  <span
                    class={`w-2 h-2 rounded-full shrink-0 ${server.connected ? "bg-green-500" : "bg-[var(--text-quaternary)]"}`}
                  />
                </button>
              )}
            </For>
          </Show>

          <div class="border-t border-[var(--border-default)] mt-1 pt-1">
            <button
              class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-[var(--interactive-primary)] hover:bg-[var(--background-elevated)] transition-colors"
              data-component="org-switcher-add-org"
              onClick={() => {
                setOpen(false)
                props.onAddOrg()
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" class="shrink-0">
                <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
              Open server settings
            </button>
          </div>
        </div>

        {/* Click-away backdrop */}
        <div class="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      </Show>
    </div>
  )
}
