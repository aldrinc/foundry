import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { MeridianProviderAuth } from "@zulip/desktop/bindings"
import {
  createAgentFromTemplate,
  DELEGATE_TEMPLATES,
  type DelegateAgent,
  useAgents,
} from "../context/agents"
import {
  getProviderConnectionStatus,
  getProviderDefaultModel,
} from "../context/agent-runtime"
import { useZulipSync } from "../context/zulip-sync"
import { SettingToggle } from "./settings-general"

function blankAgent(): DelegateAgent {
  const now = new Date().toISOString()
  return {
    id: "",
    name: "",
    emoji: "",
    purpose: "",
    theme: "",
    soul: "",
    enabled: true,
    delegateEligible: true,
    scopeMode: "all_topics",
    streamIds: [],
    inheritRuntimePreset: true,
    inheritProviders: true,
    inheritMcp: true,
    inheritChannels: true,
    inheritSkills: true,
    providerOverride: null,
    preferredModel: "",
    createdAt: now,
    updatedAt: now,
  }
}

export function SettingsAgents() {
  const agents = useAgents()
  const sync = useZulipSync()
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [draft, setDraft] = createStore<DelegateAgent>(blankAgent())
  const [draftError, setDraftError] = createSignal("")

  const connectedProviders = createMemo(() =>
    (agents.store.providers || []).filter((provider) =>
      getProviderConnectionStatus(provider) === "connected" ||
      getProviderConnectionStatus(provider) === "configured",
    ),
  )

  const editingExisting = createMemo(() =>
    agents.store.delegates.find((delegate) => delegate.id === editingId()) || null,
  )

  const resetDraft = (next?: DelegateAgent) => {
    setDraft(reconcile(next || blankAgent()))
    setDraftError("")
  }

  const openCreate = () => {
    setEditingId("__new__")
    resetDraft(blankAgent())
  }

  const openEdit = (delegate: DelegateAgent) => {
    setEditingId(delegate.id)
    resetDraft({ ...delegate, streamIds: [...delegate.streamIds] })
  }

  const applyTemplate = (templateId: string) => {
    const template = DELEGATE_TEMPLATES.find((entry) => entry.id === templateId)
    if (!template) return
    setEditingId("__new__")
    resetDraft(createAgentFromTemplate(template, agents.store.delegates.map((delegate) => delegate.id)))
  }

  const closeEditor = () => {
    setEditingId(null)
    resetDraft(blankAgent())
  }

  const saveDraft = async () => {
    const result = await agents.upsertAgent({ ...draft, streamIds: [...draft.streamIds] })
    if (!result.ok) {
      setDraftError(result.error || "Failed to save agent.")
      return
    }
    closeEditor()
  }

  const toggleStream = (streamId: number) => {
    setDraft("streamIds", (streamIds) =>
      streamIds.includes(streamId)
        ? streamIds.filter((value) => value !== streamId)
        : [...streamIds, streamId],
    )
  }

  return (
    <div class="space-y-6">
      <div class="p-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-base)]">
        <div class="text-sm font-semibold text-[var(--text-primary)]">Supervisor-managed delegates</div>
        <div class="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
          Users still talk to one Supervisor in a topic. The agents configured here are the Moltis-backed delegates
          the Supervisor can use behind the scenes for research, review, specification, and other specialized work.
        </div>
      </div>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[var(--text-primary)]">Moltis Runtime</h3>
            <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Provider state comes from Meridian today. Delegate definitions are stored locally and injected into
              Supervisor requests until native Meridian agent sync endpoints land.
            </div>
          </div>
          <button
            class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] transition-colors"
            onClick={() => void agents.refreshProviders()}
            disabled={agents.store.providersLoading}
          >
            {agents.store.providersLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <Show
          when={agents.store.providers.length > 0}
          fallback={
            <div class="p-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)] text-xs text-[var(--text-tertiary)]">
              {agents.store.providerError || "No Moltis providers reported yet."}
            </div>
          }
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <For each={agents.store.providers}>
              {(provider) => <ProviderCard provider={provider} />}
            </For>
          </div>
        </Show>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[var(--text-primary)]">Delegate Agents</h3>
            <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Configure delegate identity, inheritance, provider overrides, and where the Supervisor may use each agent.
            </div>
          </div>
          <button
            class="px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
            onClick={openCreate}
          >
            New agent
          </button>
        </div>

        <div class="flex flex-wrap gap-2">
          <For each={DELEGATE_TEMPLATES}>
            {(template) => (
              <button
                class="px-2.5 py-1.5 text-[11px] rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
                onClick={() => applyTemplate(template.id)}
              >
                Use {template.name}
              </button>
            )}
          </For>
        </div>

        <Show when={editingId()}>
          <div class="p-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)] space-y-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-[var(--text-primary)]">
                  {editingExisting() ? `Edit ${editingExisting()!.name}` : "Create delegate"}
                </div>
                <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  Use inheritance for Moltis defaults, then override only what Foundry actually needs to control.
                </div>
              </div>
              <button
                class="px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] transition-colors"
                onClick={closeEditor}
              >
                Cancel
              </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Agent ID" hint="Slug used internally for this delegate.">
                <input
                  type="text"
                  value={draft.id}
                  disabled={!!editingExisting()}
                  onInput={(event) => setDraft("id", event.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] disabled:opacity-60"
                  placeholder="researcher"
                />
              </Field>

              <Field label="Name" hint="User-facing delegate label.">
                <input
                  type="text"
                  value={draft.name}
                  onInput={(event) => setDraft("name", event.currentTarget.value)}
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                  placeholder="Researcher"
                />
              </Field>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Emoji / icon" hint="Short visual marker in lists and roster chips.">
                <input
                  type="text"
                  value={draft.emoji}
                  onInput={(event) => setDraft("emoji", event.currentTarget.value.slice(0, 2))}
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                  placeholder="R"
                />
              </Field>

              <Field label="Theme" hint="High-level persona or working style.">
                <input
                  type="text"
                  value={draft.theme}
                  onInput={(event) => setDraft("theme", event.currentTarget.value)}
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                  placeholder="thorough and evidence-driven"
                />
              </Field>
            </div>

            <Field label="Purpose" hint="What this delegate is for when the Supervisor decides to use it.">
              <textarea
                rows="3"
                value={draft.purpose}
                onInput={(event) => setDraft("purpose", event.currentTarget.value)}
                class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                placeholder="Collect context, references, and comparative information before the Supervisor decides what to do next."
              />
            </Field>

            <Field label="Soul / system guidance" hint="Delegate-specific prompt override used when the Supervisor routes work here.">
              <textarea
                rows="4"
                value={draft.soul}
                onInput={(event) => setDraft("soul", event.currentTarget.value)}
                class="w-full text-xs font-mono bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)]"
                placeholder="You are a research delegate..."
              />
            </Field>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SettingToggle
                label="Enabled"
                description="Whether this delegate exists in Foundry at all."
                checked={draft.enabled}
                onChange={(value) => setDraft("enabled", value)}
              />
              <SettingToggle
                label="Supervisor may delegate"
                description="If off, the delegate stays configured but unavailable to the Supervisor."
                checked={draft.delegateEligible}
                onChange={(value) => setDraft("delegateEligible", value)}
              />
            </div>

            <div class="pt-1">
              <div class="text-xs font-medium text-[var(--text-primary)] mb-2">Moltis inheritance</div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingToggle
                  label="Inherit runtime preset"
                  description="Use Moltis default spawn/runtime settings unless Foundry overrides later."
                  checked={draft.inheritRuntimePreset}
                  onChange={(value) => setDraft("inheritRuntimePreset", value)}
                />
                <SettingToggle
                  label="Inherit providers"
                  description="Use Moltis provider and model defaults for this delegate."
                  checked={draft.inheritProviders}
                  onChange={(value) => setDraft("inheritProviders", value)}
                />
                <SettingToggle
                  label="Inherit MCP"
                  description="Use the default Moltis MCP server/tool envelope."
                  checked={draft.inheritMcp}
                  onChange={(value) => setDraft("inheritMcp", value)}
                />
                <SettingToggle
                  label="Inherit channels"
                  description="Keep connector configuration inherited until channel-agent support lands."
                  checked={draft.inheritChannels}
                  onChange={(value) => setDraft("inheritChannels", value)}
                />
                <SettingToggle
                  label="Inherit skills"
                  description="Use the current Moltis skill defaults instead of per-agent overrides."
                  checked={draft.inheritSkills}
                  onChange={(value) => setDraft("inheritSkills", value)}
                />
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Provider override" hint={draft.inheritProviders ? "Disabled while provider inheritance is on." : "Optional Moltis provider override for this delegate."}>
                <select
                  value={draft.providerOverride || ""}
                  disabled={draft.inheritProviders}
                  onChange={(event) => setDraft("providerOverride", event.currentTarget.value || null)}
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] disabled:opacity-60"
                >
                  <option value="">Use current runtime default</option>
                  <For each={connectedProviders()}>
                    {(provider) => (
                      <option value={provider.provider}>
                        {provider.display_name || provider.provider}
                      </option>
                    )}
                  </For>
                </select>
              </Field>

              <Field label="Preferred model" hint={draft.inheritProviders ? "Disabled while provider inheritance is on." : "Free-form model hint until model-list integration lands."}>
                <input
                  type="text"
                  value={draft.preferredModel}
                  disabled={draft.inheritProviders}
                  onInput={(event) => setDraft("preferredModel", event.currentTarget.value)}
                  class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] disabled:opacity-60"
                  placeholder="gpt-5.2"
                />
              </Field>
            </div>

            <div class="space-y-3">
              <div>
                <div class="text-xs font-medium text-[var(--text-primary)]">Topic availability</div>
                <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  Controls where this delegate appears in the Supervisor roster.
                </div>
              </div>

              <div class="flex gap-2">
                <button
                  class={`px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] border transition-colors ${
                    draft.scopeMode === "all_topics"
                      ? "border-[var(--interactive-primary)] text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)]"
                  }`}
                  onClick={() => setDraft("scopeMode", "all_topics")}
                >
                  All topics
                </button>
                <button
                  class={`px-2.5 py-1 text-[11px] rounded-[var(--radius-sm)] border transition-colors ${
                    draft.scopeMode === "selected_streams"
                      ? "border-[var(--interactive-primary)] text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)]"
                  }`}
                  onClick={() => setDraft("scopeMode", "selected_streams")}
                >
                  Selected streams
                </button>
              </div>

              <Show when={draft.scopeMode === "selected_streams"}>
                <div class="flex flex-wrap gap-2">
                  <For each={sync.store.subscriptions}>
                    {(stream) => (
                      <button
                        class={`px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border transition-colors ${
                          draft.streamIds.includes(stream.stream_id)
                            ? "border-[var(--interactive-primary)] text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10"
                            : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)]"
                        }`}
                        onClick={() => toggleStream(stream.stream_id)}
                      >
                        {stream.name}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <Show when={draftError()}>
              <div class="text-xs text-[var(--status-error)]">{draftError()}</div>
            </Show>

            <div class="flex items-center justify-between gap-3">
              <div class="text-[11px] text-[var(--text-tertiary)]">
                Delegate execution is not wired yet. This slice makes the catalog, inheritance, and Supervisor visibility real first.
              </div>
              <button
                class="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] text-white hover:opacity-90 transition-opacity"
                onClick={() => void saveDraft()}
              >
                Save agent
              </button>
            </div>
          </div>
        </Show>

        <Show
          when={agents.store.delegates.length > 0}
          fallback={
            <div class="text-center py-10 border border-dashed border-[var(--border-default)] rounded-[var(--radius-md)]">
              <div class="text-sm text-[var(--text-tertiary)]">No delegate agents yet</div>
              <div class="text-xs text-[var(--text-quaternary)] mt-1">
                Start with a template or create one from scratch.
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SupervisorCard />
            <For each={agents.store.delegates}>
              {(delegate) => (
                <DelegateCard
                  delegate={delegate}
                  provider={agents.store.providers.find((provider) => provider.provider === delegate.providerOverride) || null}
                  onEdit={() => openEdit(delegate)}
                  onDelete={() => void agents.deleteAgent(delegate.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  )
}

function ProviderCard(props: { provider: MeridianProviderAuth }) {
  const label = () => props.provider.display_name || props.provider.provider
  const defaultModel = () => getProviderDefaultModel(props.provider)
  const authLabel = () => {
    if ((props.provider.auth_modes || []).includes("oauth")) return "OAuth"
    if ((props.provider.auth_modes || []).includes("local")) return "Local"
    return "API key"
  }
  const statusLabel = () => getProviderConnectionStatus(props.provider)

  return (
    <div class="p-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)]">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-xs font-medium text-[var(--text-primary)]">{label()}</div>
          <div class="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            {props.provider.provider}
            <Show when={defaultModel()}>
              <span> · {defaultModel()}</span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <ProviderBadge label={authLabel()} tone="neutral" />
          <ProviderBadge
            label={statusLabel()}
            tone={statusLabel() === "connected" || statusLabel() === "configured" ? "success" : "warning"}
          />
        </div>
      </div>
    </div>
  )
}

function SupervisorCard() {
  return (
    <div class="p-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-base)]">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-full bg-[var(--interactive-primary)] text-white flex items-center justify-center text-xs font-semibold shrink-0">
              S
            </span>
            <div>
              <div class="text-sm font-semibold text-[var(--text-primary)]">Supervisor</div>
              <div class="text-[10px] text-[var(--text-tertiary)]">Built-in topic-facing control plane</div>
            </div>
          </div>
          <div class="text-xs text-[var(--text-secondary)] mt-3 leading-relaxed">
            The Supervisor remains the only default topic conversation. It uses the configured delegates below behind
            the scenes instead of requiring users to speak to multiple agents directly.
          </div>
        </div>
        <ProviderBadge label="Built-in" tone="neutral" />
      </div>
    </div>
  )
}

function DelegateCard(props: {
  delegate: DelegateAgent
  provider: MeridianProviderAuth | null
  onEdit: () => void
  onDelete: () => void
}) {
  const inheritance = () => {
    const items: string[] = []
    if (props.delegate.inheritRuntimePreset) items.push("Runtime")
    if (props.delegate.inheritProviders) items.push("Providers")
    if (props.delegate.inheritMcp) items.push("MCP")
    if (props.delegate.inheritChannels) items.push("Channels")
    if (props.delegate.inheritSkills) items.push("Skills")
    return items
  }

  const scopeLabel = () =>
    props.delegate.scopeMode === "all_topics"
      ? "All topics"
      : `${props.delegate.streamIds.length} stream${props.delegate.streamIds.length === 1 ? "" : "s"}`

  const providerLabel = () => {
    if (props.delegate.inheritProviders) return "Inherits Moltis providers"
    if (props.provider) return props.provider.display_name || props.provider.provider
    if (props.delegate.providerOverride) return props.delegate.providerOverride
    return "Custom provider override"
  }

  return (
    <div class="p-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)]">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-full bg-[var(--background-elevated)] text-[var(--text-primary)] flex items-center justify-center text-xs font-semibold shrink-0">
              {props.delegate.emoji || props.delegate.name.charAt(0).toUpperCase()}
            </span>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-[var(--text-primary)] truncate">{props.delegate.name}</div>
              <div class="text-[10px] text-[var(--text-tertiary)] truncate">{props.delegate.id}</div>
            </div>
          </div>
          <div class="text-xs text-[var(--text-secondary)] mt-3 leading-relaxed">
            {props.delegate.purpose || "No purpose defined yet."}
          </div>
          <Show when={props.delegate.theme}>
            <div class="text-[11px] text-[var(--text-tertiary)] mt-2">
              Theme: {props.delegate.theme}
            </div>
          </Show>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <ProviderBadge label={props.delegate.enabled ? "Enabled" : "Disabled"} tone={props.delegate.enabled ? "success" : "neutral"} />
          <ProviderBadge label={props.delegate.delegateEligible ? "Delegateable" : "Held back"} tone={props.delegate.delegateEligible ? "neutral" : "warning"} />
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5 mt-3">
        <ProviderBadge label={scopeLabel()} tone="neutral" />
        <ProviderBadge label={providerLabel()} tone="neutral" />
        <For each={inheritance().slice(0, 3)}>
          {(item) => <ProviderBadge label={`Inherit ${item}`} tone="neutral" />}
        </For>
      </div>

      <div class="flex items-center justify-between gap-3 mt-3">
        <div class="text-[11px] text-[var(--text-tertiary)] truncate">
          {props.delegate.preferredModel ? `Model hint: ${props.delegate.preferredModel}` : "Using runtime model inheritance"}
        </div>
        <div class="flex gap-2 shrink-0">
          <button
            class="px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--background-elevated)] transition-colors"
            onClick={props.onEdit}
          >
            Edit
          </button>
          <button
            class="px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border border-[var(--status-error)]/30 text-[var(--status-error)] hover:bg-[var(--status-error)]/10 transition-colors"
            onClick={props.onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function Field(props: { label: string; hint: string; children: any }) {
  return (
    <label class="block">
      <div class="text-xs font-medium text-[var(--text-primary)]">{props.label}</div>
      <div class="text-[11px] text-[var(--text-tertiary)] mt-0.5 mb-1.5">{props.hint}</div>
      {props.children}
    </label>
  )
}

function ProviderBadge(props: { label: string; tone: "neutral" | "success" | "warning" }) {
  const classes = () => {
    if (props.tone === "success") return "bg-[var(--status-success)]/10 text-[var(--status-success)]"
    if (props.tone === "warning") return "bg-[var(--status-warning)]/10 text-[var(--status-warning)]"
    return "bg-[var(--background-elevated)] text-[var(--text-secondary)]"
  }

  return (
    <span class={`px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] ${classes()}`}>
      {props.label}
    </span>
  )
}
