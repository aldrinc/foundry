import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { useZulipSync, type UnreadItem } from "../../context/zulip-sync"
import { useNavigation } from "../../context/navigation"
import { useOrg } from "../../context/org"
import { usePlatform } from "../../context/platform"
import { commands } from "@foundry/desktop/bindings"
import type {
  InboxSecretaryCitation,
  InboxSecretaryItem,
  InboxSecretarySession,
} from "@foundry/desktop/bindings"
import { PrioritySection } from "./priority-section"
import { TraditionalInbox } from "./traditional-inbox"
import { normalizeInboxAssistantError } from "./inbox-assistant-error"
import { formatCitationTime } from "./utils"

const INITIAL_SECRETARY_PROMPT =
  "Review my current work, pull more context when needed, and update my priority inbox with concise likely-important items and unclear items."

export function InboxView() {
  const sync = useZulipSync()
  const nav = useNavigation()
  const org = useOrg()
  const platform = usePlatform()
  const [assistantSession, setAssistantSession] = createSignal<InboxSecretarySession | null>(null)
  const [assistantLoading, setAssistantLoading] = createSignal(false)
  const [assistantError, setAssistantError] = createSignal("")
  const [assistantInput, setAssistantInput] = createSignal("")
  const [feedbackPending, setFeedbackPending] = createSignal<Record<string, boolean>>({})
  const [bootstrappedOrgId, setBootstrappedOrgId] = createSignal("")
  let assistantRequestVersion = 0

  // --- Derived state ---

  const streamUnreadItems = createMemo(() =>
    sync.store.unreadItems.filter((item): item is Extract<UnreadItem, { kind: "stream" }> => item.kind === "stream")
  )

  const directUnreadItems = createMemo(() =>
    sync.store.unreadItems.filter((item): item is Extract<UnreadItem, { kind: "dm" }> => item.kind === "dm")
  )

  const groupedUnreads = createMemo(() => {
    const items = streamUnreadItems()
    const groups = new Map<number, {
      streamId: number
      streamName: string
      streamColor: string
      topics: Extract<UnreadItem, { kind: "stream" }>[]
      totalCount: number
    }>()

    for (const item of items) {
      let group = groups.get(item.stream_id)
      if (!group) {
        group = {
          streamId: item.stream_id,
          streamName: item.stream_name,
          streamColor: item.stream_color,
          topics: [],
          totalCount: 0,
        }
        groups.set(item.stream_id, group)
      }
      group.topics.push(item)
      group.totalCount += item.count
    }

    return Array.from(groups.values()).sort((a, b) => {
      const aMax = Math.max(...a.topics.map(t => t.last_message_id))
      const bMax = Math.max(...b.topics.map(t => t.last_message_id))
      return bMax - aMax
    })
  })

  const totalUnread = createMemo(() =>
    sync.store.unreadItems.reduce((sum, item) => sum + item.count, 0)
  )

  const likelyItems = createMemo(() => assistantSession()?.snapshot?.priorities || [])
  const unclearItems = createMemo(() => assistantSession()?.snapshot?.unclear || [])
  const assistantTurns = createMemo(() => assistantSession()?.turns || [])
  const latestRun = createMemo(() => assistantSession()?.last_run || null)
  const latestReviewTime = createMemo(() => {
    const value = assistantSession()?.snapshot?.generated_at || assistantSession()?.last_run?.created_at
    return value ? formatCitationTime(value) : ""
  })
  const configured = createMemo(() => assistantSession()?.configured !== false)

  // --- Async actions ---

  const loadAssistantSession = async (orgId: string) => {
    const requestVersion = ++assistantRequestVersion
    setAssistantError("")
    setAssistantLoading(true)

    try {
      const result = await commands.getInboxAssistantSession(orgId)
      if (requestVersion !== assistantRequestVersion) return
      if (result.status === "error") {
        setAssistantSession(null)
        setAssistantError(normalizeInboxAssistantError(result.error || "Failed to load inbox secretary"))
        return
      }
      setAssistantSession(result.data)
      if (
        result.data.configured !== false
        && result.data.turns.length === 0
        && bootstrappedOrgId() !== orgId
      ) {
        setBootstrappedOrgId(orgId)
        void sendAssistantMessage(INITIAL_SECRETARY_PROMPT)
      }
    } catch (error: any) {
      if (requestVersion !== assistantRequestVersion) return
      setAssistantSession(null)
      setAssistantError(normalizeInboxAssistantError(error?.toString() || "Failed to load inbox secretary"))
    } finally {
      if (requestVersion !== assistantRequestVersion) return
      setAssistantLoading(false)
    }
  }

  const sendAssistantMessage = async (message: string) => {
    const trimmed = message.trim()
    if (!trimmed) return

    const requestVersion = ++assistantRequestVersion
    setAssistantLoading(true)
    setAssistantError("")

    try {
      const result = await commands.sendInboxAssistantMessage(org.orgId, trimmed)
      if (requestVersion !== assistantRequestVersion) return
      if (result.status === "error") {
        setAssistantError(normalizeInboxAssistantError(result.error || "Failed to update inbox secretary"))
        return
      }
      setAssistantSession(result.data)
      setAssistantInput("")
      setBootstrappedOrgId(org.orgId)
    } catch (error: any) {
      if (requestVersion !== assistantRequestVersion) return
      setAssistantError(normalizeInboxAssistantError(error?.toString() || "Failed to update inbox secretary"))
    } finally {
      if (requestVersion !== assistantRequestVersion) return
      setAssistantLoading(false)
    }
  }

  const recordAssistantFeedback = async (item: InboxSecretaryItem, action: string) => {
    const itemKey = item.external_key || item.conversation_key
    if (!itemKey) return

    setFeedbackPending((current) => ({ ...current, [itemKey]: true }))
    setAssistantError("")
    try {
      const result = await commands.recordInboxAssistantFeedback(org.orgId, itemKey, item.conversation_key, action, null)
      if (result.status === "error") {
        setAssistantError(normalizeInboxAssistantError(result.error || "Failed to record secretary feedback"))
        return
      }
      setAssistantSession(result.data)
    } catch (error: any) {
      setAssistantError(normalizeInboxAssistantError(error?.toString() || "Failed to record secretary feedback"))
    } finally {
      setFeedbackPending((current) => {
        const next = { ...current }
        delete next[itemKey]
        return next
      })
    }
  }

  // --- Navigation handlers ---

  const openItemThread = (item: InboxSecretaryItem) => {
    if (item.narrow) {
      nav.setActiveNarrow(item.narrow)
      return
    }
    const sourceUrl = item.citations[0]?.source_url
    if (sourceUrl) {
      void platform.openLink(sourceUrl)
    }
  }

  const openCitation = (item: InboxSecretaryItem, citation: InboxSecretaryCitation) => {
    if (citation.source_url) {
      void platform.openLink(citation.source_url)
      return
    }
    openItemThread(item)
  }

  // --- Effects ---

  createEffect(() => {
    const orgId = org.orgId
    setBootstrappedOrgId("")
    setAssistantSession(null)
    setAssistantError("")
    void loadAssistantSession(orgId)
  })

  return (
    <div
      class="flex-1 min-h-0 flex flex-col"
      data-component="inbox-view"
    >
      {/* Header */}
      <header class="h-12 flex items-center justify-between px-4 border-b border-[var(--border-default)] bg-[var(--background-surface)] shrink-0">
        <h1 class="text-sm font-semibold text-[var(--text-primary)]">
          Inbox
        </h1>
        <Show when={totalUnread() > 0}>
          <span class="text-xs text-[var(--text-tertiary)]">
            {totalUnread()} unread
          </span>
        </Show>
      </header>

      {/* Content */}
      <div class="flex-1 min-h-0 overflow-y-auto">
        <PrioritySection
          likelyItems={likelyItems()}
          unclearItems={unclearItems()}
          assistantTurns={assistantTurns()}
          latestRun={latestRun()}
          latestReviewTime={latestReviewTime()}
          assistantLoading={assistantLoading()}
          assistantError={assistantError()}
          configured={configured()}
          feedbackPending={feedbackPending()}
          assistantInput={assistantInput()}
          onReview={() => void sendAssistantMessage(INITIAL_SECRETARY_PROMPT)}
          onSendMessage={(msg) => void sendAssistantMessage(msg)}
          onRecordFeedback={(item, action) => void recordAssistantFeedback(item, action)}
          onOpenItem={openItemThread}
          onOpenCitation={openCitation}
          onSetAssistantInput={setAssistantInput}
        />

        <TraditionalInbox
          groupedUnreads={groupedUnreads()}
          directUnreadItems={directUnreadItems()}
          onTopicClick={(streamId, topic) => nav.setActiveNarrow(`stream:${streamId}/topic:${topic}`)}
          onStreamClick={(streamId) => nav.setActiveNarrow(`stream:${streamId}`)}
          onMarkStreamRead={(streamId) => { sync.markStreamAsRead(streamId).catch(() => {}) }}
          onMarkTopicRead={(streamId, topic) => { sync.markTopicAsRead(streamId, topic).catch(() => {}) }}
          onDmClick={(narrow) => nav.setActiveNarrow(narrow)}
          onMarkDmRead={(messageIds) => { sync.markMessagesRead(messageIds).catch(() => {}) }}
        />
      </div>
    </div>
  )
}
