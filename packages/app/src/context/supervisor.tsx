import { createContext, createEffect, useContext, type JSX, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { commands } from "@foundry/desktop/bindings"
import type {
  SupervisorSession,
  SupervisorEvent,
  SupervisorTask,
  SupervisorTaskSummary,
  RuntimeProjection,
  JsonValue,
} from "@foundry/desktop/bindings"
import {
  unwrapSupervisorMessageWithDelegates,
  wrapSupervisorMessageWithDelegates,
} from "./agent-runtime"
import { useAgents } from "./agents"
import { useNavigation } from "./navigation"
import {
  extractRuntimeProjection,
  type RuntimeProjectionCarrier,
} from "./supervisor-runtime"
import { shouldKeepSupervisorOpenForNarrow } from "./supervisor-navigation"

// ── Store shape ──

export interface SupervisorStore {
  active: boolean
  topicScopeId: string | null
  streamId: number | null
  streamName: string
  topicName: string

  session: SupervisorSession | null
  sessions: SupervisorSession[]
  selectedSessionId: string | null
  draftingNewSession: boolean
  status: "idle" | "connecting" | "connected" | "disconnected"

  events: SupervisorEvent[]
  afterId: number
  seenEventIds: Set<number>

  sendingMessage: boolean
  awaitingResponse: boolean              // true from send until first non-user event
  pendingUserEchoes: Map<string, number> // clientMsgId -> localId
  nextLocalEventId: number

  lastThinkingPreview: string
  lastThinkingEventMs: number
  streamingMessageId: number | null      // event ID currently being streamed into

  tasks: SupervisorTask[]

  // Runtime summary — authoritative state from orchestrator
  runtimePhase: string | null
  runtimePhaseReason: string | null
  approvalRequired: boolean
  clarificationRequired: boolean
  executionRequested: boolean
  executionReady: boolean
  executionBlockers: string[]
  completionFollowUpRequired: boolean
  completionMissingEvidence: string[]
  repoAttachment: JsonValue | null
  workerBackendReady: boolean
  observedArtifacts: JsonValue[]
  activePlanRevisionId: string | null
  taskCounts: { total: number; pending: number; running: number; completed: number; failed: number } | null

  warning: string
  warningTone: "info" | "error"
}

const initialStore: SupervisorStore = {
  active: false,
  topicScopeId: null,
  streamId: null,
  streamName: "",
  topicName: "",
  session: null,
  sessions: [],
  selectedSessionId: null,
  draftingNewSession: false,
  status: "idle",
  events: [],
  afterId: 0,
  seenEventIds: new Set(),
  sendingMessage: false,
  awaitingResponse: false,
  pendingUserEchoes: new Map(),
  nextLocalEventId: -1,
  lastThinkingPreview: "",
  lastThinkingEventMs: 0,
  streamingMessageId: null,
  tasks: [],
  runtimePhase: null,
  runtimePhaseReason: null,
  approvalRequired: false,
  clarificationRequired: false,
  executionRequested: false,
  executionReady: false,
  executionBlockers: [],
  completionFollowUpRequired: false,
  completionMissingEvidence: [],
  repoAttachment: null,
  workerBackendReady: false,
  observedArtifacts: [],
  activePlanRevisionId: null,
  taskCounts: null,
  warning: "",
  warningTone: "info",
}

// ── Context interface ──

export interface SupervisorContext {
  store: SupervisorStore
  openForTopic(streamId: number, streamName: string, topic: string): void
  close(): void
  selectSession(sessionId: string): void
  startNewSession(): void
  sendMessage(text: string): Promise<void>
  controlTask(taskId: string, action: string): Promise<void>
  replyToClarification(taskId: string, message: string): Promise<void>
  isThinkingFresh(): boolean
  livePreviewMode(): "thinking" | "reconnecting" | null
  isAwaitingFirstResponse(): boolean
  isStreaming(eventId: number): boolean
}

const SupervisorCtx = createContext<SupervisorContext>()

// ── Provider ──

const THINKING_FRESHNESS_MS = 22_000
const SUPERVISOR_POLL_INTERVAL_MS = 5_000
const SUPERVISOR_CONNECTION_TIMEOUT_MS = 8_000
const SUPERVISOR_FALLBACK_WARNING = "Live updates unavailable. Refreshing every 5 seconds."
const IS_DEMO = typeof window !== "undefined" && window.location.search.includes("demo")
const HAS_TAURI_BRIDGE =
  typeof window !== "undefined" &&
  typeof (window as any).__TAURI_INTERNALS__ !== "undefined"
const SUPERVISOR_PREVIEW_WARNING = "Supervisor runtime is unavailable in browser preview mode."

import { sanitizeEventId } from "../tauri-event-utils"

export function SupervisorProvider(props: { orgId: string; children: JSX.Element }) {
  const agents = useAgents()
  const nav = useNavigation()
  const [store, setStore] = createStore<SupervisorStore>({ ...initialStore, seenEventIds: new Set(), pendingUserEchoes: new Map() })
  let unlisteners: UnlistenFn[] = []
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let connectionTimer: ReturnType<typeof setTimeout> | undefined
  let sessionPollInFlight = false
  let sidebarPollInFlight = false
  let pollingFallbackActive = false

  function setWarning(message: string, tone: "info" | "error" = "error") {
    setStore(produce(s => {
      s.warning = message
      s.warningTone = tone
    }))
  }

  function clearWarning() {
    setStore(produce(s => {
      s.warning = ""
      s.warningTone = "info"
    }))
  }

  function supervisorRuntimeAvailable() {
    return HAS_TAURI_BRIDGE && !IS_DEMO
  }

  function requestedSessionId(state: SupervisorStore = store) {
    if (state.draftingNewSession) return null
    return state.selectedSessionId || state.session?.session_id || null
  }

  function replaceSessionView(sessionId: string | null, draft = false) {
    setStore(produce(s => {
      s.selectedSessionId = sessionId
      s.draftingNewSession = draft
      s.session = sessionId
        ? (s.sessions.find(item => item.session_id === sessionId) || null)
        : null
      s.events = []
      s.afterId = 0
      s.seenEventIds = new Set()
      s.pendingUserEchoes = new Map()
      s.nextLocalEventId = -1
      s.lastThinkingPreview = ""
      s.lastThinkingEventMs = 0
      s.awaitingResponse = false
      s.streamingMessageId = null
      s.tasks = []
      s.runtimePhase = null
      s.runtimePhaseReason = null
      s.approvalRequired = false
      s.clarificationRequired = false
      s.executionRequested = false
      s.executionReady = false
      s.executionBlockers = []
      s.completionFollowUpRequired = false
      s.completionMissingEvidence = []
      s.repoAttachment = null
      s.workerBackendReady = false
      s.observedArtifacts = []
      s.activePlanRevisionId = null
      s.taskCounts = null
      s.warning = ""
      s.warningTone = "info"
      s.status = draft ? "connected" : "connecting"
    }))
  }

  function applySupervisorEvent(state: SupervisorStore, evt: SupervisorEvent) {
    if (state.draftingNewSession) return
    if (state.selectedSessionId && evt.session_id && evt.session_id !== state.selectedSessionId) return
    if (state.seenEventIds.has(evt.id)) return
    state.seenEventIds.add(evt.id)

    // Always update cursor
    if (evt.id > state.afterId) {
      state.afterId = evt.id
    }

    const kind = evt.kind
    const payload = (evt.payload || {}) as Record<string, any>

    // ── DEAD HANDLERS ──
    // The backend never emits "plan_update", "task_update", or "content_delta".
    // Real task state flows through session_state SSE → mergeTaskSummary().
    // Real plan updates come as new plan_draft events.
    // These guards remain as defensive no-ops in case a future backend revision
    // starts emitting them — they silently swallow the event to avoid duplication.
    if (kind === "plan_update" || kind === "task_update" || kind === "content_delta") {
      return
    }

    // ── Standard events (push to timeline) ──

    const nextEvent =
      evt.role === "user"
        ? {
            ...evt,
            content_md: unwrapSupervisorMessageWithDelegates(evt.content_md || ""),
          }
        : evt

    if (nextEvent.client_msg_id && state.pendingUserEchoes.has(nextEvent.client_msg_id)) {
      const localId = state.pendingUserEchoes.get(nextEvent.client_msg_id)!
      state.events = state.events.filter(e => e.id !== localId)
      state.pendingUserEchoes.delete(nextEvent.client_msg_id)
    }

    // Clear awaiting response when first non-user event arrives
    if (nextEvent.role !== "user") {
      state.awaitingResponse = false
    }

    state.events.push(nextEvent)

    // REMOVED: plan/job_started indexing — backend never emits these event kinds.
    // Task state is authoritative from session_state SSE → store.tasks.

    // Existing thinking/message tracking
    if (kind === "thinking") {
      state.lastThinkingPreview = nextEvent.content_md || ""
      state.lastThinkingEventMs = Date.now()
    } else if (kind === "message" && nextEvent.role === "assistant") {
      state.lastThinkingPreview = ""
      state.lastThinkingEventMs = 0
      state.streamingMessageId = null
    }
  }

  function mergeRuntimeProjection(s: SupervisorStore, proj: RuntimeProjection) {
    s.runtimePhase = proj.phase ?? s.runtimePhase
    s.runtimePhaseReason = proj.phase_reason ?? s.runtimePhaseReason
    s.approvalRequired = proj.approval_required ?? s.approvalRequired
    s.clarificationRequired = proj.clarification_required ?? s.clarificationRequired
    s.executionRequested = proj.execution_requested ?? s.executionRequested
    s.executionReady = proj.execution_prerequisites_ready ?? s.executionReady
    s.executionBlockers = proj.execution_blockers ?? s.executionBlockers
    s.completionFollowUpRequired = proj.completion_follow_up_required ?? s.completionFollowUpRequired
    s.completionMissingEvidence = proj.completion_missing_evidence ?? s.completionMissingEvidence
    s.repoAttachment = proj.repo_attachment ?? s.repoAttachment
    s.workerBackendReady = proj.worker_backend_ready ?? s.workerBackendReady
    s.observedArtifacts = (proj.observed_artifacts as JsonValue[] | null) ?? s.observedArtifacts
    s.activePlanRevisionId = proj.active_plan_revision_id ?? s.activePlanRevisionId
  }

  function mergeTaskSummary(s: SupervisorStore, summary: SupervisorTaskSummary) {
    if (summary.tasks) s.tasks = summary.tasks
    if (summary.phase != null) s.runtimePhase = summary.phase
    if (summary.active_plan_revision_id != null) s.activePlanRevisionId = summary.active_plan_revision_id
    if (summary.completion_follow_up_required != null) s.completionFollowUpRequired = summary.completion_follow_up_required
    if (summary.completion_missing_evidence != null) s.completionMissingEvidence = summary.completion_missing_evidence

    const taskRuntimeProjection = extractRuntimeProjection({
      phase: summary.phase ?? null,
      runtime_state: summary.runtime_state ?? null,
    })
    if (taskRuntimeProjection) {
      mergeRuntimeProjection(s, taskRuntimeProjection)
    }

    // Parse counts into taskCounts
    if (summary.counts != null && typeof summary.counts === "object") {
      const c = summary.counts as Record<string, number>
      s.taskCounts = {
        total: summary.task_count ?? 0,
        pending: c.pending ?? 0,
        running: c.running ?? 0,
        completed: c.completed ?? 0,
        failed: c.failed ?? 0,
      }
    }
  }

  function mergeSupervisorSnapshot(payload: {
    session?: SupervisorSession | null
    sessions?: SupervisorSession[]
    events?: SupervisorEvent[]
    tasks?: SupervisorTask[]
    taskSummary?: SupervisorTaskSummary | null
    runtimeProjection?: RuntimeProjection | null
  }) {
    setStore(produce(s => {
      const sessionRuntimeProjection = payload.session
        ? extractRuntimeProjection(payload.session as RuntimeProjectionCarrier)
        : null

      if (payload.sessions) {
        s.sessions = payload.sessions
      }
      if (payload.session) {
        s.session = payload.session
        if (s.draftingNewSession || !s.selectedSessionId) {
          s.selectedSessionId = payload.session.session_id
          s.draftingNewSession = false
        }
      }

      for (const evt of payload.events || []) {
        applySupervisorEvent(s, evt)
      }

      // Merge runtime state from authoritative sources
      if (payload.taskSummary) {
        mergeTaskSummary(s, payload.taskSummary)
      } else if (payload.tasks) {
        s.tasks = payload.tasks
      }

      if (sessionRuntimeProjection) {
        mergeRuntimeProjection(s, sessionRuntimeProjection)
      }
      if (payload.runtimeProjection) {
        mergeRuntimeProjection(s, payload.runtimeProjection)
      }
    }))
  }

  function clearConnectionTimer() {
    if (connectionTimer) {
      clearTimeout(connectionTimer)
      connectionTimer = undefined
    }
  }

  function stopPollingFallback() {
    pollingFallbackActive = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
    clearConnectionTimer()
  }

  async function refreshSidebar(topicScopeId: string, sessionId: string | null) {
    if (sidebarPollInFlight || store.topicScopeId !== topicScopeId || !store.active || store.draftingNewSession) return
    sidebarPollInFlight = true

    try {
      const result = await commands.getSupervisorSidebar(props.orgId, topicScopeId, sessionId)
      if (result.status === "ok" && store.topicScopeId === topicScopeId && requestedSessionId() === sessionId) {
        mergeSupervisorSnapshot({ tasks: result.data.tasks })
      }
    } catch (error) {
      console.warn("[Supervisor] Sidebar refresh failed:", error)
    } finally {
      sidebarPollInFlight = false
    }
  }

  async function pollSession(topicScopeId: string, sessionId: string | null, useFallbackWarning: boolean) {
    if (sessionPollInFlight || store.topicScopeId !== topicScopeId || !store.active || store.draftingNewSession) return
    sessionPollInFlight = true

    try {
      const result = await commands.getSupervisorSession(props.orgId, topicScopeId, sessionId, store.afterId, 200)
      if (store.topicScopeId !== topicScopeId || requestedSessionId() !== sessionId) return

      if (result.status === "ok") {
        mergeSupervisorSnapshot({
          session: result.data.session,
          sessions: result.data.sessions,
          events: result.data.events,
          taskSummary: result.data.task_summary,
          runtimeProjection: result.data.runtime_projection,
        })
        setStore("status", "connected")
        if (useFallbackWarning) {
          setStore(produce(s => {
            if (!s.warning || s.warningTone === "info") {
              s.warning = SUPERVISOR_FALLBACK_WARNING
              s.warningTone = "info"
            }
          }))
        } else {
          clearWarning()
        }
      } else if (result.status === "error" && store.status === "connecting") {
        setStore("status", "disconnected")
        setWarning(`Failed to load supervisor: ${result.error}`, "error")
      }
    } catch (error: any) {
      if (store.topicScopeId === topicScopeId && store.status === "connecting") {
        setStore("status", "disconnected")
        setWarning(error?.message || error?.toString() || "Failed to load supervisor", "error")
      }
    } finally {
      sessionPollInFlight = false
    }
  }

  function startPollingFallback(topicScopeId: string, sessionId: string | null) {
    if (store.topicScopeId !== topicScopeId || !store.active) return
    if (pollingFallbackActive) return

    pollingFallbackActive = true
    clearConnectionTimer()

    setStore(produce(s => {
      if (s.topicScopeId !== topicScopeId) return
      if (s.session) {
        s.status = "connected"
      } else if (s.status === "connecting") {
        s.status = "disconnected"
      }
      s.warning = SUPERVISOR_FALLBACK_WARNING
      s.warningTone = "info"
    }))

    if (!store.draftingNewSession) {
      void pollSession(topicScopeId, sessionId, true)
      void refreshSidebar(topicScopeId, sessionId)
    }

    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (store.draftingNewSession) return
        const currentSessionId = requestedSessionId()
        void pollSession(topicScopeId, currentSessionId, true)
        void refreshSidebar(topicScopeId, currentSessionId)
      }, SUPERVISOR_POLL_INTERVAL_MS)
    }
  }

  // ── Tauri event handlers ──

  function handleSupervisorEvent(payload: any) {
    if (!store.active) return

    const evt = payload as SupervisorEvent
    setStore(produce(s => applySupervisorEvent(s, evt)))
  }

  function handleSessionState(payload: any) {
    if (!store.active) return

    setStore(produce(s => {
      const sessionTaskSummary = payload?.session?.task_summary as SupervisorTaskSummary | null | undefined
      const sessionRuntimeProjection = extractRuntimeProjection(
        payload?.session as RuntimeProjectionCarrier | null | undefined,
      )

      if (payload.sessions) {
        s.sessions = payload.sessions
      }
      if (payload.session) {
        s.session = payload.session
        if (s.draftingNewSession || !s.selectedSessionId) {
          s.selectedSessionId = payload.session.session_id
          s.draftingNewSession = false
        }
      }
      // Update task summary and runtime projection from periodic session_state events
      if (payload.task_summary) {
        mergeTaskSummary(s, payload.task_summary)
      } else if (sessionTaskSummary) {
        mergeTaskSummary(s, sessionTaskSummary)
      }
      if (payload.runtime_projection) {
        mergeRuntimeProjection(s, payload.runtime_projection)
      } else if (sessionRuntimeProjection) {
        mergeRuntimeProjection(s, sessionRuntimeProjection)
      }
    }))
  }

  function handleConnected() {
    if (!store.active) return
    stopPollingFallback()

    setStore(produce(s => {
      s.status = "connected"
      s.warning = ""
      s.warningTone = "info"
    }))
  }

  function handleDisconnected(payload: any) {
    if (!store.active) return
    if (!store.topicScopeId) return

    console.warn("[Supervisor] Live stream disconnected:", payload)
    startPollingFallback(store.topicScopeId, requestedSessionId())
  }

  async function setupEventListeners() {
    const eventId = sanitizeEventId(props.orgId)
    const fns = await Promise.all([
      listen<any>(`supervisor:${eventId}:events`, (e) => handleSupervisorEvent(e.payload)),
      listen<any>(`supervisor:${eventId}:session`, (e) => handleSessionState(e.payload)),
      listen<any>(`supervisor:${eventId}:connected`, () => handleConnected()),
      listen<any>(`supervisor:${eventId}:disconnected`, (e) => handleDisconnected(e.payload)),
    ])
    unlisteners.push(...fns)
  }

  function cleanupEventListeners() {
    for (const fn of unlisteners) fn()
    unlisteners = []
  }

  // ── Context methods ──

  const ctx: SupervisorContext = {
    get store() { return store },

    openForTopic(streamId, streamName, topic) {
      const topicScopeId = `stream_id:${streamId}:topic:${topic}`

      // Clean up any previous connection
      stopPollingFallback()
      cleanupEventListeners()
      if (supervisorRuntimeAvailable()) {
        void commands.stopSupervisorStream(props.orgId)
      }

      // Reset state for new topic
      setStore(produce(s => {
        s.active = true
        s.topicScopeId = topicScopeId
        s.streamId = streamId
        s.streamName = streamName
        s.topicName = topic
        s.session = null
        s.sessions = []
        s.selectedSessionId = null
        s.draftingNewSession = false
        s.status = "connecting"
        s.events = []
        s.afterId = 0
        s.seenEventIds = new Set()
        s.sendingMessage = false
        s.awaitingResponse = false
        s.pendingUserEchoes = new Map()
        s.nextLocalEventId = -1
        s.lastThinkingPreview = ""
        s.lastThinkingEventMs = 0
        s.streamingMessageId = null
        s.tasks = []
        s.runtimePhase = null
        s.runtimePhaseReason = null
        s.approvalRequired = false
        s.clarificationRequired = false
        s.executionRequested = false
        s.executionReady = false
        s.executionBlockers = []
        s.completionFollowUpRequired = false
        s.completionMissingEvidence = []
        s.repoAttachment = null
        s.workerBackendReady = false
        s.observedArtifacts = []
        s.activePlanRevisionId = null
        s.taskCounts = null
        s.warning = ""
        s.warningTone = "info"
      }))

      if (!supervisorRuntimeAvailable()) {
        setStore(produce(s => {
          s.status = "disconnected"
          s.warning = SUPERVISOR_PREVIEW_WARNING
          s.warningTone = "info"
        }))
        return
      }

      // Set up Tauri event listeners, then start the Rust SSE stream
      setupEventListeners()
        .then(() => {
          return commands.startSupervisorStream(props.orgId, topicScopeId, null, 0)
        })
        .then((result) => {
          if (result.status === "error") {
            console.error("[Supervisor] Failed to start SSE stream:", result.error)
            startPollingFallback(topicScopeId, null)
          }
        })
        .catch((err) => {
          console.error("[Supervisor] Failed to set up event listeners:", err)
          setStore(produce(s => {
            s.status = "disconnected"
            s.warning = `Connection setup failed: ${err?.message || err}`
            s.warningTone = "error"
          }))
        })

      // Initial one-shot GET to load existing session + event history
      void pollSession(topicScopeId, null, false)

      connectionTimer = setTimeout(() => {
        if (store.status === "connecting" && store.topicScopeId === topicScopeId) {
          startPollingFallback(topicScopeId, null)
        }
      }, SUPERVISOR_CONNECTION_TIMEOUT_MS)
    },

    close() {
      stopPollingFallback()
      cleanupEventListeners()
      if (supervisorRuntimeAvailable()) {
        void commands.stopSupervisorStream(props.orgId)
      }

      setStore(produce(s => {
        s.active = false
        s.status = "idle"
        s.topicScopeId = null
        s.session = null
        s.sessions = []
        s.selectedSessionId = null
        s.draftingNewSession = false
        s.warning = ""
        s.warningTone = "info"
      }))
    },

    selectSession(sessionId) {
      if (!store.topicScopeId || !supervisorRuntimeAvailable()) return
      const targetSessionId = sessionId.trim()
      if (!targetSessionId || targetSessionId === requestedSessionId()) return

      stopPollingFallback()
      replaceSessionView(targetSessionId, false)
      void commands.startSupervisorStream(props.orgId, store.topicScopeId, targetSessionId, 0)
        .then((result) => {
          if (result.status === "error") {
            console.error("[Supervisor] Failed to switch SSE stream:", result.error)
            startPollingFallback(store.topicScopeId!, targetSessionId)
          }
        })
      void pollSession(store.topicScopeId, targetSessionId, false)
      void refreshSidebar(store.topicScopeId, targetSessionId)
    },

    startNewSession() {
      if (!store.topicScopeId) return
      stopPollingFallback()
      if (supervisorRuntimeAvailable()) {
        void commands.stopSupervisorStream(props.orgId)
      }
      replaceSessionView(null, true)
    },

    async sendMessage(text: string) {
      if (!store.topicScopeId || store.sendingMessage) return
      if (!supervisorRuntimeAvailable()) {
        setWarning(SUPERVISOR_PREVIEW_WARNING, "info")
        return
      }

      const clientMsgId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const localId = store.nextLocalEventId
      const sessionId = requestedSessionId()
      const creatingSession = store.draftingNewSession || !sessionId
      const delegateContext = agents.buildSupervisorDelegateContext(store.streamId)
      const outboundMessage = wrapSupervisorMessageWithDelegates(text, delegateContext)

      // Local echo: immediately append as user message
      setStore(produce(s => {
        s.sendingMessage = true
        s.awaitingResponse = true
        s.nextLocalEventId--

        const echo: SupervisorEvent = {
          id: localId,
          topic_scope_id: s.topicScopeId!,
          session_id: sessionId || "",
          ts: new Date().toISOString(),
          kind: "message",
          role: "user",
          content_md: text,
          client_msg_id: clientMsgId,
        }
        s.events.push(echo)
        s.pendingUserEchoes.set(clientMsgId, localId)
      }))

      try {
        const result = await commands.postSupervisorMessage(
          props.orgId,
          {
            topicScopeId: store.topicScopeId!,
            message: outboundMessage,
            sessionId,
            sessionCreateMode: creatingSession ? "manual" : null,
            sessionTitle: creatingSession ? text : null,
            clientMsgId,
            streamId: store.streamId,
            streamName: store.streamName || null,
            topic: store.topicName || null,
          },
        )

        if (result.status === "error") {
          setWarning(result.error)
          // Remove echo on failure
          setStore(produce(s => {
            s.events = s.events.filter(e => e.id !== localId)
            s.pendingUserEchoes.delete(clientMsgId)
          }))
        } else {
          // Process any events in the response (for immediate feedback)
          const data = result.data
          mergeSupervisorSnapshot({
            session: data.session,
            sessions: data.sessions,
            events: data.events,
            taskSummary: data.task_summary,
            runtimeProjection: data.runtime_projection,
          })
          const nextSessionId = data.session?.session_id || sessionId
          if (nextSessionId && supervisorRuntimeAvailable()) {
            const streamResult = await commands.startSupervisorStream(
              props.orgId,
              store.topicScopeId!,
              nextSessionId,
              store.afterId,
            )
            if (streamResult.status === "error") {
              console.error("[Supervisor] Failed to refresh SSE stream:", streamResult.error)
              startPollingFallback(store.topicScopeId!, nextSessionId)
            }
          }
          setStore(produce(s => {
            if (s.warningTone === "error") {
              s.warning = ""
              s.warningTone = "info"
            }
          }))
        }
      } catch (e: any) {
        setWarning(e?.toString() || "Failed to send message")
        setStore(produce(s => {
          s.events = s.events.filter(e => e.id !== localId)
          s.pendingUserEchoes.delete(clientMsgId)
        }))
      } finally {
        setStore("sendingMessage", false)
      }
    },

    async controlTask(taskId, action) {
      if (!store.topicScopeId) return
      if (!supervisorRuntimeAvailable()) {
        setWarning(SUPERVISOR_PREVIEW_WARNING, "info")
        return
      }
      try {
        const result = await commands.controlSupervisorTask(
          props.orgId,
          store.topicScopeId,
          taskId,
          action,
        )
        if (result.status === "error") {
          setWarning(result.error)
        }
      } catch (e: any) {
        setWarning(e?.toString() || "Failed to control task")
      }
    },

    async replyToClarification(taskId, message) {
      if (!store.topicScopeId) return
      if (!supervisorRuntimeAvailable()) {
        setWarning(SUPERVISOR_PREVIEW_WARNING, "info")
        return
      }
      try {
        const result = await commands.replyToTaskClarification(
          props.orgId,
          store.topicScopeId,
          taskId,
          message,
        )
        if (result.status === "error") {
          setWarning(result.error)
        }
      } catch (e: any) {
        setWarning(e?.toString() || "Failed to reply to task")
      }
    },

    isThinkingFresh() {
      if (!store.lastThinkingEventMs) return false
      return Date.now() - store.lastThinkingEventMs < THINKING_FRESHNESS_MS
    },

    livePreviewMode() {
      if (store.status === "disconnected") return "reconnecting"
      if (ctx.isThinkingFresh() && store.lastThinkingPreview) return "thinking"
      return null
    },

    isAwaitingFirstResponse() {
      return store.awaitingResponse
    },

    isStreaming(eventId: number) {
      return store.streamingMessageId === eventId
    },
  }

  createEffect(() => {
    const activeNarrow = nav.activeNarrow()
    if (!store.active) return
    if (shouldKeepSupervisorOpenForNarrow(activeNarrow, store.streamId, store.topicName)) return
    ctx.close()
  })

  onCleanup(() => {
    stopPollingFallback()
    cleanupEventListeners()
    if (supervisorRuntimeAvailable()) {
      void commands.stopSupervisorStream(props.orgId)
    }
  })

  return (
    <SupervisorCtx.Provider value={ctx}>
      {props.children}
    </SupervisorCtx.Provider>
  )
}

export function useSupervisor(): SupervisorContext {
  const ctx = useContext(SupervisorCtx)
  if (!ctx) throw new Error("useSupervisor must be used within SupervisorProvider")
  return ctx
}
