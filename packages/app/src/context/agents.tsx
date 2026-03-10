import { createContext, useContext, type JSX, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { commands } from "@foundry/desktop/bindings"
import type { FoundryProviderAuth } from "@foundry/desktop/bindings"
import {
  buildSupervisorDelegateContextFromDelegates,
  isProviderConnected,
  normalizeProvider,
} from "./agent-runtime"

const AGENTS_CONFIG_KEY = "foundry_agents_catalog_v1"
const IS_DEMO = typeof window !== "undefined" && window.location.search.includes("demo")
const HAS_TAURI_BRIDGE =
  typeof window !== "undefined" &&
  typeof (window as any).__TAURI_INTERNALS__ !== "undefined"

export type AgentScopeMode = "all_topics" | "selected_streams"

export interface DelegateAgent {
  id: string
  name: string
  emoji: string
  purpose: string
  theme: string
  soul: string
  enabled: boolean
  delegateEligible: boolean
  scopeMode: AgentScopeMode
  streamIds: number[]
  inheritRuntimePreset: boolean
  inheritProviders: boolean
  inheritMcp: boolean
  inheritChannels: boolean
  inheritSkills: boolean
  providerOverride: string | null
  preferredModel: string
  createdAt: string
  updatedAt: string
}

export interface DelegateTemplate {
  id: string
  name: string
  emoji: string
  purpose: string
  theme: string
  soul: string
}

export const DELEGATE_TEMPLATES: DelegateTemplate[] = [
  {
    id: "researcher",
    name: "Researcher",
    emoji: "R",
    purpose: "Collect context, references, and comparative information before the Supervisor decides what to do next.",
    theme: "thorough and evidence-driven",
    soul: "You are a research delegate. Gather facts, summarize the strongest evidence, and avoid making product or code changes yourself.",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    emoji: "V",
    purpose: "Review plans, outputs, and implementation risks before the Supervisor reports back to the topic.",
    theme: "skeptical and exact",
    soul: "You are a review delegate. Focus on correctness, edge cases, regressions, and missing evidence.",
  },
  {
    id: "product-spec",
    name: "Product Spec",
    emoji: "P",
    purpose: "Turn topic discussion into structured product requirements, open questions, and acceptance criteria.",
    theme: "clear and structured",
    soul: "You are a product-spec delegate. Convert messy discussion into crisp requirements, constraints, and acceptance checks.",
  },
]

const DEMO_PROVIDERS: FoundryProviderAuth[] = [
  {
    provider: "claude_code",
    display_name: "Claude Code",
    auth_modes: ["api_key", "oauth"],
    oauth_configured: true,
    connected: false,
    default_model: "claude-sonnet-4",
  },
  {
    provider: "codex",
    display_name: "Codex",
    auth_modes: ["api_key", "oauth"],
    oauth_configured: true,
    connected: false,
    default_model: "gpt-5.2-2025-12-11",
  },
  {
    provider: "opencode",
    display_name: "OpenCode",
    auth_modes: ["api_key"],
    connected: false,
    default_model: "fireworks/kimi-k2p5",
  },
]

export interface AgentsStore {
  delegates: DelegateAgent[]
  providers: FoundryProviderAuth[]
  loading: boolean
  providersLoading: boolean
  providerError: string
}

export interface AgentsContextValue {
  store: AgentsStore
  upsertAgent(agent: DelegateAgent): Promise<{ ok: boolean; error?: string }>
  deleteAgent(id: string): Promise<void>
  refreshProviders(): Promise<FoundryProviderAuth[]>
  connectProvider(provider: string, apiKey: string, label?: string | null): Promise<{ ok: boolean; error?: string }>
  disconnectProvider(provider: string): Promise<{ ok: boolean; error?: string }>
  startProviderOauth(provider: string, redirectUri?: string | null): Promise<{ ok: boolean; authorizeUrl?: string | null; error?: string }>
  waitForProviderConnection(provider: string, timeoutMs?: number, intervalMs?: number): Promise<{ ok: boolean; connected: boolean; error?: string }>
  availableDelegatesForStream(streamId: number | null): DelegateAgent[]
  buildSupervisorDelegateContext(streamId: number | null): string | null
}

const AgentsContext = createContext<AgentsContextValue>()

function createTemplateAgent(template: DelegateTemplate): DelegateAgent {
  const now = new Date().toISOString()
  return {
    id: template.id,
    name: template.name,
    emoji: template.emoji,
    purpose: template.purpose,
    theme: template.theme,
    soul: template.soul,
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

function sortDelegates(delegates: DelegateAgent[]) {
  return [...delegates].sort((a, b) => a.name.localeCompare(b.name))
}

function hydrateDelegates(raw: unknown): DelegateAgent[] {
  if (!Array.isArray(raw)) return []

  return sortDelegates(
    raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null
        const item = entry as Partial<DelegateAgent>
        if (!item.id || !item.name) return null
        const now = new Date().toISOString()
        return {
          id: item.id,
          name: item.name,
          emoji: item.emoji || "",
          purpose: item.purpose || "",
          theme: item.theme || "",
          soul: item.soul || "",
          enabled: item.enabled ?? true,
          delegateEligible: item.delegateEligible ?? true,
          scopeMode: item.scopeMode === "selected_streams" ? "selected_streams" : "all_topics",
          streamIds: Array.isArray(item.streamIds)
            ? item.streamIds.map(Number).filter((value) => Number.isFinite(value))
            : [],
          inheritRuntimePreset: item.inheritRuntimePreset ?? true,
          inheritProviders: item.inheritProviders ?? true,
          inheritMcp: item.inheritMcp ?? true,
          inheritChannels: item.inheritChannels ?? true,
          inheritSkills: item.inheritSkills ?? true,
          providerOverride: item.providerOverride || null,
          preferredModel: item.preferredModel || "",
          createdAt: item.createdAt || now,
          updatedAt: item.updatedAt || now,
        } satisfies DelegateAgent
      })
      .filter((delegate): delegate is DelegateAgent => !!delegate),
  )
}

function agentMatchesStream(agent: DelegateAgent, streamId: number | null) {
  if (!agent.enabled || !agent.delegateEligible) return false
  if (agent.scopeMode === "all_topics") return true
  if (!streamId) return false
  return agent.streamIds.includes(streamId)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function AgentsProvider(props: { orgId: string; children: JSX.Element }) {
  const [store, setStore] = createStore<AgentsStore>({
    delegates: [],
    providers: [],
    loading: true,
    providersLoading: false,
    providerError: "",
  })

  async function persistDelegates(nextDelegates: DelegateAgent[]) {
    if (!HAS_TAURI_BRIDGE && !IS_DEMO) return

    try {
      await commands.setConfig(AGENTS_CONFIG_KEY, JSON.stringify(nextDelegates))
    } catch {
      // Local persistence failure should not break the UI.
    }
  }

  const findProvider = (providerId: string, providers = store.providers) =>
    providers.find((provider) => provider.provider === providerId) || null

  function setDemoProvider(
    providerId: string,
    updater: (provider: FoundryProviderAuth) => FoundryProviderAuth,
  ) {
    setStore(
      "providers",
      store.providers.map((provider) =>
        provider.provider === providerId
          ? normalizeProvider(updater(provider))
          : provider,
      ),
    )
  }

  async function refreshProviders() {
    setStore("providersLoading", true)
    setStore("providerError", "")

    if (IS_DEMO || !HAS_TAURI_BRIDGE) {
      const nextProviders =
        store.providers.length > 0
          ? store.providers.map((provider) => normalizeProvider(provider))
          : DEMO_PROVIDERS.map((provider) => normalizeProvider(provider))
      setStore("providers", nextProviders)
      setStore("providersLoading", false)
      return nextProviders
    }

    try {
      const result = await commands.getFoundryProviders(props.orgId)
      if (result.status === "ok") {
        const nextProviders = (result.data.providers || []).map((provider) =>
          normalizeProvider(provider),
        )
        setStore("providers", nextProviders)
        return nextProviders
      } else {
        setStore("providerError", result.error || "Failed to load Moltis providers")
      }
    } catch (error: any) {
      setStore("providerError", error?.message || error?.toString() || "Failed to load Moltis providers")
    } finally {
      setStore("providersLoading", false)
    }

    return store.providers
  }

  onMount(async () => {
    if (!HAS_TAURI_BRIDGE && !IS_DEMO) {
      setStore("loading", false)
      return
    }

    try {
      const result = await commands.getConfig(AGENTS_CONFIG_KEY)
      if (result.status === "ok" && result.data) {
        const parsed = JSON.parse(result.data)
        setStore("delegates", hydrateDelegates(parsed))
      } else if (IS_DEMO) {
        setStore("delegates", DELEGATE_TEMPLATES.map(createTemplateAgent))
      }
    } catch {
      if (IS_DEMO) {
        setStore("delegates", DELEGATE_TEMPLATES.map(createTemplateAgent))
      }
    } finally {
      setStore("loading", false)
    }

    void refreshProviders()
  })

  const ctx: AgentsContextValue = {
    get store() {
      return store
    },

    async upsertAgent(agent) {
      const trimmedId = agent.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, "")
      const trimmedName = agent.name.trim()

      if (!trimmedId) {
        return { ok: false, error: "Agent ID is required." }
      }

      if (!trimmedName) {
        return { ok: false, error: "Agent name is required." }
      }

      const exists = store.delegates.some((delegate) => delegate.id === trimmedId && delegate.id !== agent.id)
      if (exists) {
        return { ok: false, error: `An agent with id "${trimmedId}" already exists.` }
      }

      const now = new Date().toISOString()
      const nextAgent: DelegateAgent = {
        ...agent,
        id: trimmedId,
        name: trimmedName,
        purpose: agent.purpose.trim(),
        theme: agent.theme.trim(),
        soul: agent.soul.trim(),
        streamIds: [...new Set(agent.streamIds.map(Number).filter((value) => Number.isFinite(value)))],
        providerOverride: agent.inheritProviders ? null : agent.providerOverride || null,
        preferredModel: agent.inheritProviders ? "" : agent.preferredModel.trim(),
        createdAt: agent.createdAt || now,
        updatedAt: now,
      }

      const nextDelegates = sortDelegates([
        ...store.delegates.filter((delegate) => delegate.id !== trimmedId),
        nextAgent,
      ])

      setStore("delegates", nextDelegates)
      await persistDelegates(nextDelegates)
      return { ok: true }
    },

    async deleteAgent(id) {
      const nextDelegates = store.delegates.filter((delegate) => delegate.id !== id)
      setStore("delegates", nextDelegates)
      await persistDelegates(nextDelegates)
    },

    refreshProviders,

    async connectProvider(provider, apiKey, label) {
      const trimmedProvider = provider.trim()
      const trimmedApiKey = apiKey.trim()

      if (!trimmedProvider) {
        return { ok: false, error: "Provider is required." }
      }

      if (!trimmedApiKey) {
        return { ok: false, error: "API key is required." }
      }

      if (IS_DEMO || !HAS_TAURI_BRIDGE) {
        const now = new Date().toISOString()
        setDemoProvider(trimmedProvider, (current) => ({
          ...current,
          connected: true,
          credential_status: "connected",
          credential: {
            auth_mode: "api_key",
            label: label?.trim() || "API key",
            status: "active",
            updated_at: now,
          },
        }))
        return { ok: true }
      }

      try {
        const result = await commands.connectFoundryProvider(
          props.orgId,
          trimmedProvider,
          trimmedApiKey,
          label?.trim() || null,
        )

        if (result.status !== "ok") {
          return { ok: false, error: result.error || "Failed to connect provider." }
        }

        await refreshProviders()
        return { ok: true }
      } catch (error: any) {
        return {
          ok: false,
          error: error?.message || error?.toString() || "Failed to connect provider.",
        }
      }
    },

    async disconnectProvider(provider) {
      const trimmedProvider = provider.trim()
      if (!trimmedProvider) {
        return { ok: false, error: "Provider is required." }
      }

      if (IS_DEMO || !HAS_TAURI_BRIDGE) {
        setDemoProvider(trimmedProvider, (current) => ({
          ...current,
          connected: false,
          credential_status: "not_connected",
          credential: null,
        }))
        return { ok: true }
      }

      try {
        const result = await commands.disconnectFoundryProvider(
          props.orgId,
          trimmedProvider,
        )

        if (result.status !== "ok") {
          return { ok: false, error: result.error || "Failed to disconnect provider." }
        }

        await refreshProviders()
        return { ok: true }
      } catch (error: any) {
        return {
          ok: false,
          error: error?.message || error?.toString() || "Failed to disconnect provider.",
        }
      }
    },

    async startProviderOauth(provider, redirectUri) {
      const trimmedProvider = provider.trim()
      if (!trimmedProvider) {
        return { ok: false, error: "Provider is required." }
      }

      if (IS_DEMO || !HAS_TAURI_BRIDGE) {
        const now = new Date().toISOString()
        setTimeout(() => {
          setDemoProvider(trimmedProvider, (current) => ({
            ...current,
            connected: true,
            credential_status: "connected",
            credential: {
              auth_mode: "oauth",
              label: "OAuth",
              status: "active",
              updated_at: now,
            },
          }))
        }, 1200)
        return { ok: true, authorizeUrl: null }
      }

      try {
        const result = await commands.startFoundryProviderOauth(
          props.orgId,
          trimmedProvider,
          redirectUri?.trim() || null,
        )

        if (result.status !== "ok") {
          return { ok: false, error: result.error || "Failed to start OAuth sign-in." }
        }

        if (!result.data.authorize_url) {
          return {
            ok: false,
            error: "OAuth start did not return an authorization URL.",
          }
        }

        return {
          ok: true,
          authorizeUrl: result.data.authorize_url || null,
        }
      } catch (error: any) {
        return {
          ok: false,
          error: error?.message || error?.toString() || "Failed to start OAuth sign-in.",
        }
      }
    },

    async waitForProviderConnection(provider, timeoutMs = 45_000, intervalMs = 1_500) {
      const trimmedProvider = provider.trim()
      if (!trimmedProvider) {
        return { ok: false, connected: false, error: "Provider is required." }
      }

      const deadline = Date.now() + timeoutMs

      while (Date.now() <= deadline) {
        const providers = await refreshProviders()
        const current = findProvider(trimmedProvider, providers)
        if (current && isProviderConnected(current)) {
          return { ok: true, connected: true }
        }

        if (Date.now() + intervalMs > deadline) {
          break
        }

        await sleep(intervalMs)
      }

      return {
        ok: false,
        connected: false,
        error: "Timed out waiting for the provider to finish connecting.",
      }
    },

    availableDelegatesForStream(streamId) {
      return sortDelegates(store.delegates.filter((delegate) => agentMatchesStream(delegate, streamId)))
    },

    buildSupervisorDelegateContext(streamId) {
      return buildSupervisorDelegateContextFromDelegates(
        store.delegates.filter((delegate) => agentMatchesStream(delegate, streamId)),
      )
    },
  }

  return (
    <AgentsContext.Provider value={ctx}>
      {props.children}
    </AgentsContext.Provider>
  )
}

export function useAgents() {
  const ctx = useContext(AgentsContext)
  if (!ctx) throw new Error("useAgents must be used within AgentsProvider")
  return ctx
}

export function createAgentFromTemplate(template: DelegateTemplate, existingIds: string[]) {
  const base = createTemplateAgent(template)
  if (!existingIds.includes(base.id)) return base

  let index = 2
  let nextId = `${base.id}-${index}`
  while (existingIds.includes(nextId)) {
    index += 1
    nextId = `${base.id}-${index}`
  }

  return {
    ...base,
    id: nextId,
    name: `${base.name} ${index}`,
  }
}
