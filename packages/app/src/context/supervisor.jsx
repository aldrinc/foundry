import { createContext, createEffect, useContext, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@zulip/desktop/bindings";
import { unwrapSupervisorMessageWithDelegates, wrapSupervisorMessageWithDelegates, } from "./agent-runtime";
import { useAgents } from "./agents";
import { useNavigation } from "./navigation";
import { shouldKeepSupervisorOpenForNarrow } from "./supervisor-navigation";
const initialStore = {
    active: false,
    topicScopeId: null,
    streamId: null,
    streamName: "",
    topicName: "",
    session: null,
    status: "idle",
    events: [],
    afterId: 0,
    seenEventIds: new Set(),
    sendingMessage: false,
    pendingUserEchoes: new Map(),
    nextLocalEventId: -1,
    lastThinkingPreview: "",
    lastThinkingEventMs: 0,
    tasks: [],
    warning: "",
    warningTone: "info",
};
const SupervisorCtx = createContext();
// ── Provider ──
const THINKING_FRESHNESS_MS = 22_000;
const SUPERVISOR_POLL_INTERVAL_MS = 5_000;
const SUPERVISOR_CONNECTION_TIMEOUT_MS = 8_000;
const SUPERVISOR_FALLBACK_WARNING = "Live updates unavailable. Refreshing every 5 seconds.";
const IS_DEMO = typeof window !== "undefined" && window.location.search.includes("demo");
const HAS_TAURI_BRIDGE = typeof window !== "undefined" &&
    typeof window.__TAURI_INTERNALS__ !== "undefined";
const SUPERVISOR_PREVIEW_WARNING = "Supervisor runtime is unavailable in browser preview mode.";
import { sanitizeEventId } from "../tauri-event-utils";
export function SupervisorProvider(props) {
    const agents = useAgents();
    const nav = useNavigation();
    const [store, setStore] = createStore({ ...initialStore, seenEventIds: new Set(), pendingUserEchoes: new Map() });
    let unlisteners = [];
    let pollTimer;
    let connectionTimer;
    let sessionPollInFlight = false;
    let sidebarPollInFlight = false;
    let pollingFallbackActive = false;
    function setWarning(message, tone = "error") {
        setStore(produce(s => {
            s.warning = message;
            s.warningTone = tone;
        }));
    }
    function clearWarning() {
        setStore(produce(s => {
            s.warning = "";
            s.warningTone = "info";
        }));
    }
    function supervisorRuntimeAvailable() {
        return HAS_TAURI_BRIDGE && !IS_DEMO;
    }
    function applySupervisorEvent(state, evt) {
        if (state.seenEventIds.has(evt.id))
            return;
        state.seenEventIds.add(evt.id);
        const nextEvent = evt.role === "user"
            ? {
                ...evt,
                content_md: unwrapSupervisorMessageWithDelegates(evt.content_md || ""),
            }
            : evt;
        if (nextEvent.client_msg_id && state.pendingUserEchoes.has(nextEvent.client_msg_id)) {
            const localId = state.pendingUserEchoes.get(nextEvent.client_msg_id);
            state.events = state.events.filter(e => e.id !== localId);
            state.pendingUserEchoes.delete(nextEvent.client_msg_id);
        }
        state.events.push(nextEvent);
        if (nextEvent.id > state.afterId) {
            state.afterId = nextEvent.id;
        }
        if (nextEvent.kind === "thinking") {
            state.lastThinkingPreview = nextEvent.content_md || "";
            state.lastThinkingEventMs = Date.now();
        }
        else if (nextEvent.kind === "message" && nextEvent.role === "assistant") {
            state.lastThinkingPreview = "";
            state.lastThinkingEventMs = 0;
        }
    }
    function mergeSupervisorSnapshot(payload) {
        setStore(produce(s => {
            if (payload.session) {
                s.session = payload.session;
            }
            for (const evt of payload.events || []) {
                applySupervisorEvent(s, evt);
            }
            if (payload.tasks) {
                s.tasks = payload.tasks;
            }
        }));
    }
    function clearConnectionTimer() {
        if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = undefined;
        }
    }
    function stopPollingFallback() {
        pollingFallbackActive = false;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
        }
        clearConnectionTimer();
    }
    async function refreshSidebar(topicScopeId) {
        if (sidebarPollInFlight || store.topicScopeId !== topicScopeId || !store.active)
            return;
        sidebarPollInFlight = true;
        try {
            const result = await commands.getSupervisorSidebar(props.orgId, topicScopeId);
            if (result.status === "ok" && store.topicScopeId === topicScopeId) {
                mergeSupervisorSnapshot({ tasks: result.data.tasks });
            }
        }
        catch (error) {
            console.warn("[Supervisor] Sidebar refresh failed:", error);
        }
        finally {
            sidebarPollInFlight = false;
        }
    }
    async function pollSession(topicScopeId, useFallbackWarning) {
        if (sessionPollInFlight || store.topicScopeId !== topicScopeId || !store.active)
            return;
        sessionPollInFlight = true;
        try {
            const result = await commands.getSupervisorSession(props.orgId, topicScopeId, store.afterId, 200);
            if (store.topicScopeId !== topicScopeId)
                return;
            if (result.status === "ok") {
                mergeSupervisorSnapshot({
                    session: result.data.session,
                    events: result.data.events,
                    tasks: result.data.task_summary?.tasks,
                });
                setStore("status", "connected");
                if (useFallbackWarning) {
                    setStore(produce(s => {
                        if (!s.warning || s.warningTone === "info") {
                            s.warning = SUPERVISOR_FALLBACK_WARNING;
                            s.warningTone = "info";
                        }
                    }));
                }
                else {
                    clearWarning();
                }
            }
            else if (result.status === "error" && store.status === "connecting") {
                setStore("status", "disconnected");
                setWarning(`Failed to load supervisor: ${result.error}`, "error");
            }
        }
        catch (error) {
            if (store.topicScopeId === topicScopeId && store.status === "connecting") {
                setStore("status", "disconnected");
                setWarning(error?.message || error?.toString() || "Failed to load supervisor", "error");
            }
        }
        finally {
            sessionPollInFlight = false;
        }
    }
    function startPollingFallback(topicScopeId) {
        if (store.topicScopeId !== topicScopeId || !store.active)
            return;
        if (pollingFallbackActive)
            return;
        pollingFallbackActive = true;
        clearConnectionTimer();
        setStore(produce(s => {
            if (s.topicScopeId !== topicScopeId)
                return;
            if (s.session) {
                s.status = "connected";
            }
            else if (s.status === "connecting") {
                s.status = "disconnected";
            }
            s.warning = SUPERVISOR_FALLBACK_WARNING;
            s.warningTone = "info";
        }));
        void pollSession(topicScopeId, true);
        void refreshSidebar(topicScopeId);
        if (!pollTimer) {
            pollTimer = setInterval(() => {
                void pollSession(topicScopeId, true);
                void refreshSidebar(topicScopeId);
            }, SUPERVISOR_POLL_INTERVAL_MS);
        }
    }
    // ── Tauri event handlers ──
    function handleSupervisorEvent(payload) {
        if (!store.active)
            return;
        const evt = payload;
        setStore(produce(s => applySupervisorEvent(s, evt)));
    }
    function handleSessionState(payload) {
        if (!store.active)
            return;
        setStore(produce(s => {
            if (payload.session) {
                s.session = payload.session;
            }
            // Update task summary from periodic session_state events
            if (payload.task_summary?.tasks) {
                s.tasks = payload.task_summary.tasks;
            }
        }));
    }
    function handleConnected() {
        if (!store.active)
            return;
        stopPollingFallback();
        setStore(produce(s => {
            s.status = "connected";
            s.warning = "";
            s.warningTone = "info";
        }));
    }
    function handleDisconnected(payload) {
        if (!store.active)
            return;
        if (!store.topicScopeId)
            return;
        console.warn("[Supervisor] Live stream disconnected:", payload);
        startPollingFallback(store.topicScopeId);
    }
    async function setupEventListeners() {
        const eventId = sanitizeEventId(props.orgId);
        const fns = await Promise.all([
            listen(`supervisor:${eventId}:events`, (e) => handleSupervisorEvent(e.payload)),
            listen(`supervisor:${eventId}:session`, (e) => handleSessionState(e.payload)),
            listen(`supervisor:${eventId}:connected`, () => handleConnected()),
            listen(`supervisor:${eventId}:disconnected`, (e) => handleDisconnected(e.payload)),
        ]);
        unlisteners.push(...fns);
    }
    function cleanupEventListeners() {
        for (const fn of unlisteners)
            fn();
        unlisteners = [];
    }
    // ── Context methods ──
    const ctx = {
        get store() { return store; },
        openForTopic(streamId, streamName, topic) {
            const topicScopeId = `stream_id:${streamId}:topic:${topic}`;
            // Clean up any previous connection
            stopPollingFallback();
            cleanupEventListeners();
            if (supervisorRuntimeAvailable()) {
                void commands.stopSupervisorStream(props.orgId);
            }
            // Reset state for new topic
            setStore(produce(s => {
                s.active = true;
                s.topicScopeId = topicScopeId;
                s.streamId = streamId;
                s.streamName = streamName;
                s.topicName = topic;
                s.session = null;
                s.status = "connecting";
                s.events = [];
                s.afterId = 0;
                s.seenEventIds = new Set();
                s.sendingMessage = false;
                s.pendingUserEchoes = new Map();
                s.nextLocalEventId = -1;
                s.lastThinkingPreview = "";
                s.lastThinkingEventMs = 0;
                s.tasks = [];
                s.warning = "";
                s.warningTone = "info";
            }));
            if (!supervisorRuntimeAvailable()) {
                setStore(produce(s => {
                    s.status = "disconnected";
                    s.warning = SUPERVISOR_PREVIEW_WARNING;
                    s.warningTone = "info";
                }));
                return;
            }
            // Set up Tauri event listeners, then start the Rust SSE stream
            setupEventListeners()
                .then(() => {
                return commands.startSupervisorStream(props.orgId, topicScopeId, 0);
            })
                .then((result) => {
                if (result.status === "error") {
                    console.error("[Supervisor] Failed to start SSE stream:", result.error);
                    startPollingFallback(topicScopeId);
                }
            })
                .catch((err) => {
                console.error("[Supervisor] Failed to set up event listeners:", err);
                setStore(produce(s => {
                    s.status = "disconnected";
                    s.warning = `Connection setup failed: ${err?.message || err}`;
                    s.warningTone = "error";
                }));
            });
            // Initial one-shot GET to load existing session + event history
            void pollSession(topicScopeId, false);
            void refreshSidebar(topicScopeId);
            connectionTimer = setTimeout(() => {
                if (store.status === "connecting" && store.topicScopeId === topicScopeId) {
                    startPollingFallback(topicScopeId);
                }
            }, SUPERVISOR_CONNECTION_TIMEOUT_MS);
        },
        close() {
            stopPollingFallback();
            cleanupEventListeners();
            if (supervisorRuntimeAvailable()) {
                void commands.stopSupervisorStream(props.orgId);
            }
            setStore(produce(s => {
                s.active = false;
                s.status = "idle";
                s.topicScopeId = null;
                s.warning = "";
                s.warningTone = "info";
            }));
        },
        async sendMessage(text) {
            if (!store.topicScopeId || store.sendingMessage)
                return;
            if (!supervisorRuntimeAvailable()) {
                setWarning(SUPERVISOR_PREVIEW_WARNING, "info");
                return;
            }
            const clientMsgId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const localId = store.nextLocalEventId;
            const delegateContext = agents.buildSupervisorDelegateContext(store.streamId);
            const outboundMessage = wrapSupervisorMessageWithDelegates(text, delegateContext);
            // Local echo: immediately append as user message
            setStore(produce(s => {
                s.sendingMessage = true;
                s.nextLocalEventId--;
                const echo = {
                    id: localId,
                    topic_scope_id: s.topicScopeId,
                    session_id: s.session?.session_id || "",
                    ts: new Date().toISOString(),
                    kind: "message",
                    role: "user",
                    content_md: text,
                    client_msg_id: clientMsgId,
                };
                s.events.push(echo);
                s.pendingUserEchoes.set(clientMsgId, localId);
            }));
            try {
                const result = await commands.postSupervisorMessage(props.orgId, store.topicScopeId, outboundMessage, clientMsgId, store.streamId, store.streamName || null, store.topicName || null);
                if (result.status === "error") {
                    setWarning(result.error);
                    // Remove echo on failure
                    setStore(produce(s => {
                        s.events = s.events.filter(e => e.id !== localId);
                        s.pendingUserEchoes.delete(clientMsgId);
                    }));
                }
                else {
                    // Process any events in the response (for immediate feedback)
                    const data = result.data;
                    if (data.session) {
                        setStore("session", data.session);
                    }
                    if (data.events) {
                        mergeSupervisorSnapshot({ events: data.events });
                    }
                    setStore(produce(s => {
                        if (s.warningTone === "error") {
                            s.warning = "";
                            s.warningTone = "info";
                        }
                    }));
                }
            }
            catch (e) {
                setWarning(e?.toString() || "Failed to send message");
                setStore(produce(s => {
                    s.events = s.events.filter(e => e.id !== localId);
                    s.pendingUserEchoes.delete(clientMsgId);
                }));
            }
            finally {
                setStore("sendingMessage", false);
            }
        },
        async controlTask(taskId, action) {
            if (!store.topicScopeId)
                return;
            if (!supervisorRuntimeAvailable()) {
                setWarning(SUPERVISOR_PREVIEW_WARNING, "info");
                return;
            }
            try {
                const result = await commands.controlSupervisorTask(props.orgId, store.topicScopeId, taskId, action);
                if (result.status === "error") {
                    setWarning(result.error);
                }
            }
            catch (e) {
                setWarning(e?.toString() || "Failed to control task");
            }
        },
        async replyToClarification(taskId, message) {
            if (!store.topicScopeId)
                return;
            if (!supervisorRuntimeAvailable()) {
                setWarning(SUPERVISOR_PREVIEW_WARNING, "info");
                return;
            }
            try {
                const result = await commands.replyToTaskClarification(props.orgId, store.topicScopeId, taskId, message);
                if (result.status === "error") {
                    setWarning(result.error);
                }
            }
            catch (e) {
                setWarning(e?.toString() || "Failed to reply to task");
            }
        },
        isThinkingFresh() {
            if (!store.lastThinkingEventMs)
                return false;
            return Date.now() - store.lastThinkingEventMs < THINKING_FRESHNESS_MS;
        },
        livePreviewMode() {
            if (store.status === "disconnected")
                return "reconnecting";
            if (ctx.isThinkingFresh() && store.lastThinkingPreview)
                return "thinking";
            return null;
        },
    };
    createEffect(() => {
        const activeNarrow = nav.activeNarrow();
        if (!store.active)
            return;
        if (shouldKeepSupervisorOpenForNarrow(activeNarrow, store.streamId, store.topicName))
            return;
        ctx.close();
    });
    onCleanup(() => {
        stopPollingFallback();
        cleanupEventListeners();
        if (supervisorRuntimeAvailable()) {
            void commands.stopSupervisorStream(props.orgId);
        }
    });
    return (<SupervisorCtx.Provider value={ctx}>
      {props.children}
    </SupervisorCtx.Provider>);
}
export function useSupervisor() {
    const ctx = useContext(SupervisorCtx);
    if (!ctx)
        throw new Error("useSupervisor must be used within SupervisorProvider");
    return ctx;
}
