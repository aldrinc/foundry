import { createSignal, onMount, For, Show } from "solid-js"
import { useOrg } from "../context/org"
import { commands } from "@zulip/desktop/bindings"
import type { Bot } from "@zulip/desktop/bindings"

export function SettingsBots() {
  const org = useOrg()
  const [bots, setBots] = createSignal<Bot[]>([])
  const [showCreate, setShowCreate] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newShortName, setNewShortName] = createSignal("")
  const [newType, setNewType] = createSignal(1) // 1=generic, 2=incoming, 3=outgoing
  const [newPayloadUrl, setNewPayloadUrl] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null)

  const fetchBots = async () => {
    const result = await commands.getBots(org.orgId)
    if (result.status === "ok") {
      setBots(result.data)
    }
  }

  onMount(() => { void fetchBots() })

  const botTypeLabel = (bot: Bot) => {
    // Infer type from bot data
    if (bot.default_all_public_streams !== null && bot.default_all_public_streams !== undefined) return "Generic"
    return "Bot"
  }

  const handleCreate = async () => {
    if (!newName().trim() || !newShortName().trim()) return
    setCreating(true)
    setError("")

    const serviceName = newType() === 3 ? null : null
    const payloadUrl = newType() === 3 ? (newPayloadUrl().trim() || null) : null

    const result = await commands.createBot(
      org.orgId,
      newName().trim(),
      newShortName().trim(),
      newType(),
      serviceName,
      payloadUrl
    )
    setCreating(false)

    if (result.status === "error") {
      setError(result.error)
      return
    }

    setNewName("")
    setNewShortName("")
    setNewPayloadUrl("")
    setShowCreate(false)
    fetchBots()
  }

  const handleCopyApiKey = async (apiKey: string) => {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopiedKey(apiKey)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      // Clipboard API may not be available
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-[var(--text-primary)]">Bots</h3>
        <button
          class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
          onClick={() => setShowCreate(s => !s)}
        >
          {showCreate() ? "Cancel" : "Create bot"}
        </button>
      </div>

      <Show when={error()}>
        <div class="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 rounded-[var(--radius-sm)]">
          {error()}
        </div>
      </Show>

      {/* Create form */}
      <Show when={showCreate()}>
        <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)] space-y-3">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Bot name</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
              placeholder="e.g. CI Bot"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Short name (username)</label>
            <input
              type="text"
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
              placeholder="e.g. ci-bot"
              value={newShortName()}
              onInput={(e) => setNewShortName(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Type</label>
            <select
              class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
              value={newType()}
              onChange={(e) => setNewType(Number(e.currentTarget.value))}
            >
              <option value="1">Generic bot</option>
              <option value="2">Incoming webhook</option>
              <option value="3">Outgoing webhook</option>
            </select>
          </div>
          <Show when={newType() === 3}>
            <div>
              <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Payload URL</label>
              <input
                type="text"
                class="w-full text-xs bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                placeholder="https://example.com/webhook"
                value={newPayloadUrl()}
                onInput={(e) => setNewPayloadUrl(e.currentTarget.value)}
              />
            </div>
          </Show>
          <button
            class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleCreate}
            disabled={!newName().trim() || !newShortName().trim() || creating()}
          >
            {creating() ? "Creating..." : "Create bot"}
          </button>
        </div>
      </Show>

      {/* Bot list */}
      <Show
        when={bots().length > 0}
        fallback={
          <div class="text-center py-8">
            <div class="text-sm text-[var(--text-tertiary)]">No bots</div>
            <div class="text-xs text-[var(--text-quaternary)] mt-1">
              Create a bot to integrate with external services
            </div>
          </div>
        }
      >
        <div class="border border-[var(--border-default)] rounded-[var(--radius-md)] overflow-hidden">
          <For each={bots()}>
            {(bot) => (
              <div class="px-3 py-2.5 border-b border-[var(--border-default)] last:border-b-0">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <Show
                      when={bot.avatar_url}
                      fallback={
                        <div class="w-7 h-7 rounded-full bg-[var(--text-tertiary)] flex items-center justify-center text-[10px] font-medium text-white shrink-0">
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                            <rect x="3" y="2" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.2" />
                            <circle cx="5.5" cy="5" r="0.8" fill="currentColor" />
                            <circle cx="8.5" cy="5" r="0.8" fill="currentColor" />
                            <path d="M4 8v2M10 8v2M6 8v3h2V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                          </svg>
                        </div>
                      }
                    >
                      <img src={bot.avatar_url!} alt={bot.full_name} class="w-7 h-7 rounded-full shrink-0" />
                    </Show>
                    <div class="min-w-0">
                      <div class="text-xs font-medium text-[var(--text-primary)] truncate">{bot.full_name}</div>
                      <div class="text-[10px] text-[var(--text-tertiary)] truncate">{bot.username}</div>
                    </div>
                  </div>
                  <span class="text-[9px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded">
                    {botTypeLabel(bot)}
                  </span>
                </div>
                <Show when={bot.api_key}>
                  <div class="mt-2 flex items-center gap-2">
                    <code class="text-[10px] text-[var(--text-tertiary)] bg-[var(--background-base)] px-1.5 py-0.5 rounded font-mono truncate flex-1">
                      {bot.api_key}
                    </code>
                    <button
                      class="text-[10px] text-[var(--interactive-primary)] hover:underline shrink-0"
                      onClick={() => handleCopyApiKey(bot.api_key)}
                    >
                      {copiedKey() === bot.api_key ? "Copied!" : "Copy key"}
                    </button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
