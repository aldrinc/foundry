import { createContext, useContext, type JSX, onMount, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { listen } from "@tauri-apps/api/event"
import { commands } from "@foundry/desktop/bindings"
import type { UserTopic, UserTopicVisibilityPolicy } from "@foundry/desktop/bindings"
import { sanitizeEventId } from "../tauri-event-utils"
import { usePlatform } from "./platform"
import { useSettings } from "./settings"
import {
  buildNotificationBody,
  buildNotificationTitle,
  shouldNotifyMessage,
} from "./notification-policy"
import {
  STARRED_NARROW,
  cacheKeysForMessage,
  hasStarredFlag,
  mergeMessagesById,
  primaryNarrowForMessage,
} from "./message-cache"
import {
  addUnreadDirectMessage,
  addUnreadStreamMessage,
  applyLocalReadState,
  buildUnreadIndex,
  buildUnreadUiState,
  getUnreadMessageIdsForStream,
  getUnreadMessageIdsForTopic,
  removeUnreadMessages,
  shouldAddMessageToUnread,
  updateUnreadStreamMessage,
  type UnreadItem,
  type UnreadMessagesSnapshot,
} from "./unread-state"
import {
  hydrateRecentDirectMessages,
  upsertRecentDirectMessageFromMessage,
  type RecentDirectMessageConversation,
  type RecentDirectMessageSnapshot,
} from "./recent-dms"
import { mergeTopicsByName, upsertTopicByName } from "./topic-cache"

export type { UnreadItem } from "./unread-state"

// Module-level getter for the active narrow — allows handleMessageEvent
// to check if the user is viewing the conversation a new message belongs to.
let _getActiveNarrow: (() => string | null) | null = null
const IS_DEMO = typeof window !== "undefined" && window.location.search.includes("demo")
const HAS_TAURI_BRIDGE =
  typeof window !== "undefined"
  && typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function"

export function registerActiveNarrowGetter(getter: () => string | null) {
  _getActiveNarrow = getter
}

// Types matching the specta-generated bindings
export interface Subscription {
  stream_id: number
  name: string
  description?: string
  color?: string
  invite_only?: boolean
  is_muted?: boolean
  pin_to_top?: boolean
  desktop_notifications?: boolean | null
  audible_notifications?: boolean | null
  push_notifications?: boolean | null
  email_notifications?: boolean | null
  wildcard_mentions_notify?: boolean | null
  in_home_view?: boolean | null
}

export interface User {
  user_id: number
  email: string
  full_name: string
  is_active?: boolean
  is_bot?: boolean
  is_admin?: boolean
  avatar_url?: string | null
  timezone?: string
  role: number | null
}

export interface Message {
  id: number
  sender_id: number
  sender_full_name: string
  sender_email: string
  type: string
  content: string
  subject: string
  timestamp: number
  stream_id: number | null
  flags?: string[]
  reactions?: Reaction[]
  avatar_url: string | null
  display_recipient: string | DisplayRecipientUser[]
}

export interface DisplayRecipientUser {
  id: number
  email: string
  full_name: string
}

export interface Reaction {
  emoji_name: string
  emoji_code: string
  reaction_type: string
  user_id: number
}

export interface Topic {
  name: string
  max_id: number
}

export interface ZulipStore {
  // Connection state
  connected: boolean
  orgId: string | null
  queueId: string | null

  // Current user
  currentUserId: number | null
  currentUserEmail: string | null

  // Core data
  subscriptions: Subscription[]
  users: User[]
  recentDirectMessages: RecentDirectMessageConversation[]

  // Messages keyed by narrow string (e.g., "stream:5/topic:foo")
  messages: Record<string, Message[]>
  messageLoadState: Record<string, "idle" | "loading" | "loaded-all">
  messageHydrated: Record<string, boolean>

  // UI state
  unreadCounts: Record<number, number>
  typingUsers: Record<string, number[]>
  drafts: Record<string, string>
  topicsByStream: Record<number, Topic[]>
  streamTopicsHydrated: Record<number, boolean>

  // Derived data computed from events
  unreadItems: UnreadItem[]

  // Topic visibility policies
  userTopics: UserTopic[]
}

const initialStore: ZulipStore = {
  connected: false,
  orgId: null,
  queueId: null,
  currentUserId: null,
  currentUserEmail: null,
  subscriptions: [],
  users: [],
  recentDirectMessages: [],
  messages: {},
  messageLoadState: {},
  messageHydrated: {},
  unreadCounts: {},
  typingUsers: {},
  drafts: {},
  topicsByStream: {},
  streamTopicsHydrated: {},
  unreadItems: [],
  userTopics: [],
}

export interface ZulipSync {
  store: ZulipStore

  // Actions
  setConnected(
    orgId: string,
    queueId: string,
    subscriptions: Subscription[],
    users: User[],
    loginEmail?: string,
    userId?: number | null,
    userTopics?: UserTopic[],
    unreadMessages?: UnreadMessagesSnapshot,
    recentDirectMessages?: RecentDirectMessageSnapshot[],
  ): void
  setDisconnected(): void
  addMessages(narrow: string, messages: Message[]): void
  replaceUsers(users: User[]): void
  setMessageLoadState(narrow: string, state: "idle" | "loading" | "loaded-all"): void
  isNarrowHydrated(narrow: string): boolean
  markNarrowHydrated(narrow: string, hydrated: boolean): void
  ensureStreamTopics(
    streamId: number,
    options?: {
      force?: boolean
    },
  ): Promise<{ status: "ok" | "error"; fromCache: boolean; error?: string }>
  isStreamTopicsHydrated(streamId: number): boolean
  markStreamTopicsHydrated(streamId: number, hydrated: boolean): void
  invalidateStreamTopics(streamId: number): void
  upsertStreamTopic(streamId: number, topicName: string, maxId: number): void
  ensureMessages(
    narrow: string,
    filters: { operator: string; operand: string | number[] }[],
    options?: {
      force?: boolean
      limit?: number
      markRead?: boolean
    },
  ): Promise<{ status: "ok" | "error"; fromCache: boolean; error?: string }>
  updateUnreadCount(streamId: number, count: number): void
  setTypingUsers(narrow: string, userIds: number[]): void
  saveDraft(narrow: string, text: string): void
  clearDraft(narrow: string): void
  markMessagesRead(messageIds: number[]): Promise<void>
  markStreamAsRead(streamId: number): Promise<void>
  markTopicAsRead(streamId: number, topic: string): Promise<void>

  // Event handlers
  handleMessageEvent(data: any): void
  handleTypingEvent(data: any): void
  handleReactionEvent(data: any): void
  handleSubscriptionEvent(data: any): void
  handleUpdateMessageEvent(data: any): void
  handleDeleteMessageEvent(data: any): void
  handleFlagEvent(data: any): void
  handleResync(data: any): void
  handleUserTopicEvent(data: any): void
  getTopicVisibility(streamId: number, topic: string): UserTopicVisibilityPolicy
}

const ZulipSyncContext = createContext<ZulipSync>()

export function ZulipSyncProvider(props: { orgId: string; children: JSX.Element }) {
  const [store, setStore] = createStore<ZulipStore>({ ...initialStore })
  const inFlightFetches = new Map<string, Promise<{ status: "ok" | "error"; fromCache: boolean; error?: string }>>()
  const inFlightTopicFetches = new Map<number, Promise<{ status: "ok" | "error"; fromCache: boolean; error?: string }>>()
  const unreadIndex = new Map<number, { kind: "stream"; streamId: number; topic: string } | { kind: "dm"; userIds: number[] }>()
  const platform = usePlatform()
  const { store: settings } = useSettings()

  const applyReadLocally = (messageIds: number[]) => {
    if (applyLocalReadState(unreadIndex, store.messages, messageIds)) {
      syncUnreadUi()
    }
  }

  const reconcileFetchedReadMessages = (messages: Message[]) => {
    const readIds = messages
      .filter((message) => (message.flags || []).includes("read"))
      .map((message) => message.id)

    applyReadLocally(readIds)
  }

  const syncUnreadUi = (
    subscriptions = store.subscriptions,
    users = store.users,
    currentUserId = store.currentUserId,
  ) => {
    const unreadState = buildUnreadUiState(unreadIndex, subscriptions, users, currentUserId)
    setStore(produce(s => {
      s.unreadCounts = unreadState.unreadCounts
      s.unreadItems = unreadState.unreadItems
    }))
  }

  const seedUnreadState = (
    unreadMessages?: UnreadMessagesSnapshot,
    subscriptions = store.subscriptions,
    users = store.users,
    currentUserId = store.currentUserId,
  ) => {
    unreadIndex.clear()
    const seeded = buildUnreadIndex(unreadMessages, currentUserId)
    for (const [messageId, entry] of seeded.entries()) {
      unreadIndex.set(messageId, entry)
    }
    syncUnreadUi(subscriptions, users, currentUserId)
  }

  const seedRecentDirectMessages = (
    recentDirectMessages?: RecentDirectMessageSnapshot[],
    currentUserId = store.currentUserId,
  ) => {
    setStore(
      "recentDirectMessages",
      hydrateRecentDirectMessages(recentDirectMessages, currentUserId),
    )
  }

  const getTopicVisibility = (streamId: number, topic: string): UserTopicVisibilityPolicy => {
    const userTopic = store.userTopics.find(
      entry => entry.stream_id === streamId && entry.topic_name === topic,
    )
    return (userTopic?.visibility_policy as UserTopicVisibilityPolicy) || "Inherit"
  }

  const maybeNotifyForMessage = (message: Message) => {
    const subscription = message.stream_id
      ? store.subscriptions.find(entry => entry.stream_id === message.stream_id)
      : undefined
    const topicVisibility = message.stream_id ? getTopicVisibility(message.stream_id, message.subject) : "Inherit"
    const isFollowedTopic = topicVisibility === "Followed"
    const isTopicMuted = topicVisibility === "Muted"
    const isTopicUnmuted = topicVisibility === "Unmuted" || isFollowedTopic
    const isChannelMuted = Boolean(subscription?.is_muted) && !isTopicUnmuted

    const shouldNotify = shouldNotifyMessage(message, {
      desktopNotifs: settings.desktopNotifs,
      dmNotifs: settings.dmNotifs,
      mentionNotifs: settings.mentionNotifs,
      channelNotifs: settings.channelNotifs,
      followedTopics: settings.followedTopics,
      wildcardMentions: settings.wildcardMentions,
    }, {
      currentUserId: store.currentUserId,
      currentUserEmail: store.currentUserEmail,
      isFollowedTopic,
      isTopicMuted,
      isChannelMuted,
      channelDesktopNotifications: subscription?.desktop_notifications ?? null,
      channelWildcardMentionsNotify: subscription?.wildcard_mentions_notify ?? null,
    })

    if (!shouldNotify) {
      return
    }

    const silent = settings.muteAllSounds || !(
      message.type === "private"
        ? settings.notifSound
        : (subscription?.audible_notifications ?? settings.notifSound)
    )

    void platform.notify(
      buildNotificationTitle(message, subscription?.name),
      buildNotificationBody(message.content),
      { silent },
    )
  }

  const sync: ZulipSync = {
    get store() { return store },

    setConnected(orgId, queueId, subscriptions, users, loginEmail, userId, userTopics, unreadMessages, recentDirectMessages) {
      // Resolve the current user ID:
      // 1. Use the user_id directly from the Zulip register API response (most reliable)
      // 2. Fall back to case-insensitive email matching
      let resolvedUserId: number | null = userId ?? null
      let resolvedEmail: string | null = loginEmail ?? null

      if (resolvedUserId) {
        const user = users.find(u => u.user_id === resolvedUserId)
        console.log(`[ZulipSync] Current user from API: ${user?.full_name ?? "unknown"} (ID: ${resolvedUserId})`)
        if (user) {
          resolvedEmail = user.email
        }
      } else if (loginEmail) {
        // Fallback: match by email (case-insensitive)
        const emailLower = loginEmail.toLowerCase()
        const currentUser = users.find(u => u.email.toLowerCase() === emailLower)
        if (currentUser) {
          resolvedUserId = currentUser.user_id
          console.log(`[ZulipSync] Resolved current user via email: ${currentUser.full_name} (ID: ${resolvedUserId})`)
        } else {
          console.warn(
            `[ZulipSync] Could not resolve currentUserId: login email "${loginEmail}" not found in users list (${users.length} users). ` +
            `Available emails: ${users.slice(0, 5).map(u => u.email).join(", ")}...`
          )
        }
      }

      setStore(produce(s => {
        s.connected = true
        s.orgId = orgId
        s.queueId = queueId
        s.subscriptions = subscriptions
        s.users = users
        s.currentUserId = resolvedUserId
        s.currentUserEmail = resolvedEmail
        s.userTopics = userTopics || []
        s.topicsByStream = {}
        s.streamTopicsHydrated = {}
      }))

      seedUnreadState(unreadMessages, subscriptions, users, resolvedUserId)
      seedRecentDirectMessages(recentDirectMessages, resolvedUserId)
    },

    setDisconnected() {
      unreadIndex.clear()
      setStore(produce(s => {
        s.connected = false
        s.queueId = null
        s.recentDirectMessages = []
        s.unreadCounts = {}
        s.unreadItems = []
        s.topicsByStream = {}
        s.streamTopicsHydrated = {}
      }))
    },

    addMessages(narrow, messages) {
      setStore(produce(s => {
        s.messages[narrow] = mergeMessagesById(s.messages[narrow] || [], messages)
      }))
    },

    replaceUsers(users) {
      setStore("users", users)
      syncUnreadUi(store.subscriptions, users, store.currentUserId)
    },

    setMessageLoadState(narrow, state) {
      setStore("messageLoadState", narrow, state)
    },

    isNarrowHydrated(narrow) {
      return !!store.messageHydrated[narrow]
    },

    markNarrowHydrated(narrow, hydrated) {
      setStore("messageHydrated", narrow, hydrated)
    },

    async ensureStreamTopics(streamId, options) {
      const force = options?.force ?? false

      if (!force && sync.isStreamTopicsHydrated(streamId)) {
        return { status: "ok" as const, fromCache: true }
      }

      const existingRequest = inFlightTopicFetches.get(streamId)
      if (existingRequest) {
        return existingRequest
      }

      const request = (async () => {
        try {
          const result = await commands.getStreamTopics(props.orgId, streamId)

          if (result.status === "error") {
            return { status: "error" as const, fromCache: false, error: result.error }
          }

          setStore(produce(s => {
            s.topicsByStream[streamId] = mergeTopicsByName(
              force ? ([] as Topic[]) : (s.topicsByStream[streamId] || []),
              result.data,
            )
          }))
          sync.markStreamTopicsHydrated(streamId, true)

          return { status: "ok" as const, fromCache: false }
        } catch (error: any) {
          return {
            status: "error" as const,
            fromCache: false,
            error: error?.toString() || "Failed to load topics",
          }
        } finally {
          inFlightTopicFetches.delete(streamId)
        }
      })()

      inFlightTopicFetches.set(streamId, request)
      return request
    },

    isStreamTopicsHydrated(streamId) {
      return !!store.streamTopicsHydrated[streamId]
    },

    markStreamTopicsHydrated(streamId, hydrated) {
      setStore("streamTopicsHydrated", streamId, hydrated)
    },

    invalidateStreamTopics(streamId) {
      setStore("streamTopicsHydrated", streamId, false)
    },

    upsertStreamTopic(streamId, topicName, maxId) {
      if (!topicName.trim()) {
        return
      }

      setStore(produce(s => {
        s.topicsByStream[streamId] = upsertTopicByName(s.topicsByStream[streamId] || [], {
          name: topicName,
          max_id: maxId,
        })
      }))
    },

    async ensureMessages(narrow, filters, options) {
      const force = options?.force ?? false
      const limit = options?.limit ?? 50
      const markRead = options?.markRead ?? false

      if (!force && sync.isNarrowHydrated(narrow)) {
        return { status: "ok" as const, fromCache: true }
      }

      const requestKey = `${narrow}::${limit}::${markRead ? "read" : "noread"}`
      const existingRequest = inFlightFetches.get(requestKey)
      if (existingRequest) {
        return existingRequest
      }

      sync.setMessageLoadState(narrow, "loading")

      const request = (async () => {
        try {
          const result = await commands.getMessages(
            props.orgId,
            filters,
            "newest",
            limit,
            0,
          )

          if (result.status === "error") {
            sync.setMessageLoadState(narrow, "idle")
            return { status: "error" as const, fromCache: false, error: result.error }
          }

          sync.addMessages(narrow, result.data.messages)
          reconcileFetchedReadMessages(result.data.messages)
          sync.markNarrowHydrated(narrow, true)
          sync.setMessageLoadState(narrow, result.data.found_oldest ? "loaded-all" : "idle")

          if (markRead) {
            const unreadIds = result.data.messages
              .filter(message => !(message.flags || []).includes("read"))
              .map(message => message.id)
            if (unreadIds.length > 0) {
              await sync.markMessagesRead(unreadIds)
            }
          }

          return { status: "ok" as const, fromCache: false }
        } catch (error: any) {
          sync.setMessageLoadState(narrow, "idle")
          return {
            status: "error" as const,
            fromCache: false,
            error: error?.toString() || "Failed to load messages",
          }
        } finally {
          inFlightFetches.delete(requestKey)
        }
      })()

      inFlightFetches.set(requestKey, request)
      return request
    },

    updateUnreadCount(streamId, count) {
      setStore("unreadCounts", streamId, count)
    },

    setTypingUsers(narrow, userIds) {
      setStore("typingUsers", narrow, userIds)
    },

    saveDraft(narrow, text) {
      setStore("drafts", narrow, text)
    },

    clearDraft(narrow) {
      setStore(produce(s => {
        delete s.drafts[narrow]
      }))
    },

    async markMessagesRead(messageIds) {
      if (messageIds.length === 0) {
        return
      }

      const result = await commands.updateMessageFlags(props.orgId, messageIds, "add", "read")
      if (result.status === "error") {
        throw new Error(result.error || "Failed to mark messages as read")
      }

      applyReadLocally(messageIds)
    },

    async markStreamAsRead(streamId) {
      const unreadMessageIds = getUnreadMessageIdsForStream(unreadIndex, streamId)
      const result = await commands.markStreamAsRead(props.orgId, streamId)
      if (result.status === "error") {
        throw new Error(result.error || "Failed to mark stream as read")
      }

      applyReadLocally(unreadMessageIds)
    },

    async markTopicAsRead(streamId, topic) {
      const unreadMessageIds = getUnreadMessageIdsForTopic(unreadIndex, streamId, topic)
      const result = await commands.markTopicAsRead(props.orgId, streamId, topic)
      if (result.status === "error") {
        throw new Error(result.error || "Failed to mark topic as read")
      }

      applyReadLocally(unreadMessageIds)
    },

    // Event: new message
    handleMessageEvent(data: any) {
      if (!data?.message) return
      const msg = data.message as Message

      if (typeof msg.stream_id === "number" && msg.subject) {
        sync.upsertStreamTopic(msg.stream_id, msg.subject, msg.id)
      }

      setStore(
        "recentDirectMessages",
        upsertRecentDirectMessageFromMessage(
          store.recentDirectMessages,
          msg,
          store.currentUserId,
        ),
      )

      for (const narrow of cacheKeysForMessage(msg)) {
        sync.addMessages(narrow, [msg])
      }

      // Check if the user is currently viewing this conversation
      const activeNarrow = _getActiveNarrow?.() ?? null
      const messageNarrow = primaryNarrowForMessage(msg)
      const isViewingConversation = activeNarrow != null && messageNarrow != null && (
        activeNarrow === messageNarrow
        || (activeNarrow.startsWith("stream:") && !activeNarrow.includes("/topic:") && messageNarrow.startsWith(`${activeNarrow}/topic:`))
      )
      const shouldTrackUnread = shouldAddMessageToUnread(
        msg,
        store.currentUserId,
        isViewingConversation,
      )

      // Read-path actions should update local state as soon as the server accepts them.
      if (!shouldTrackUnread) {
        if (!(msg.flags || []).includes("read")) {
          sync.markMessagesRead([msg.id]).catch(() => {})
        } else {
          applyReadLocally([msg.id])
        }
      } else if (msg.stream_id) {
        if (addUnreadStreamMessage(unreadIndex, msg.id, msg.stream_id, msg.subject)) {
          syncUnreadUi()
        }
      } else if (Array.isArray(msg.display_recipient)) {
        if (addUnreadDirectMessage(
          unreadIndex,
          msg.id,
          msg.display_recipient.map((recipient) => recipient.id),
        )) {
          syncUnreadUi()
        }
      }

      // Never notify for messages sent by the current user
      if (msg.sender_id !== store.currentUserId) {
        maybeNotifyForMessage(msg)
      }
    },

    // Event: typing indicator (DM + stream/topic)
    handleTypingEvent(data: any) {
      if (!data) return
      const op = data.op as string
      const senderId = data.sender?.user_id as number

      // Never show the current user's own typing indicator
      if (senderId === store.currentUserId) return

      // Build narrow key — two different payload shapes:
      // DM:     { sender, recipients: [{user_id}] }     → narrow = "dm:id1,id2"
      // Stream: { sender, stream_id, topic }             → narrow = "stream:<id>/topic:<topic>"
      let narrow = ""
      if (data.message_type === "stream" && data.stream_id && data.topic) {
        narrow = `stream:${data.stream_id}/topic:${data.topic}`
      } else if (data.recipients) {
        const ids = (data.recipients as { user_id: number }[])
          .map(u => u.user_id)
          .sort()
          .join(",")
        narrow = `dm:${ids}`
      }

      if (!narrow) return

      if (op === "start") {
        const current = store.typingUsers[narrow] || []
        if (!current.includes(senderId)) {
          sync.setTypingUsers(narrow, [...current, senderId])
        }
        // Auto-clear after 15 seconds (in case "stop" event is missed)
        setTimeout(() => {
          const current = store.typingUsers[narrow] || []
          if (current.includes(senderId)) {
            sync.setTypingUsers(narrow, current.filter(id => id !== senderId))
          }
        }, 15000)
      } else if (op === "stop") {
        const current = store.typingUsers[narrow] || []
        sync.setTypingUsers(narrow, current.filter(id => id !== senderId))
      }
    },

    // Event: reaction added/removed
    handleReactionEvent(data: any) {
      if (!data) return
      const messageId = data.message_id as number
      const op = data.op as string
      const reaction: Reaction = {
        emoji_name: data.emoji_name,
        emoji_code: data.emoji_code,
        reaction_type: data.reaction_type,
        user_id: data.user_id,
      }

      setStore(produce(s => {
        for (const narrow of Object.keys(s.messages)) {
          const msgs = s.messages[narrow]
          const idx = msgs.findIndex(m => m.id === messageId)
          if (idx >= 0) {
            if (op === "add") {
              const already = (msgs[idx].reactions || []).some(
                r => r.emoji_code === reaction.emoji_code && r.user_id === reaction.user_id
              )
              if (!already) {
                msgs[idx].reactions = [...(msgs[idx].reactions || []), reaction]
              }
            } else if (op === "remove") {
              msgs[idx].reactions = (msgs[idx].reactions || []).filter(
                r => !(r.emoji_code === reaction.emoji_code && r.user_id === reaction.user_id)
              )
            }
          }
        }
      }))
    },

    // Event: subscription added/removed
    handleSubscriptionEvent(data: any) {
      if (!data) return
      const op = data.op as string

      if (op === "add" && data.subscriptions) {
        setStore(produce(s => {
          for (const sub of data.subscriptions) {
            if (!s.subscriptions.find(ss => ss.stream_id === sub.stream_id)) {
              s.subscriptions.push(sub)
            }
          }
        }))
      } else if (op === "remove" && data.subscriptions) {
        setStore(produce(s => {
          const removeIds = new Set(data.subscriptions.map((ss: any) => ss.stream_id))
          s.subscriptions = s.subscriptions.filter(ss => !removeIds.has(ss.stream_id))
        }))
      } else if (op === "update" && data.stream_id) {
        setStore(produce(s => {
          const sub = s.subscriptions.find(ss => ss.stream_id === data.stream_id)
          if (sub) {
            Object.assign(sub, data)
          }
        }))
      }

      syncUnreadUi()
    },

    // Event: message edited
    handleUpdateMessageEvent(data: any) {
      if (!data?.message_id) return
      const messageId = data.message_id as number
      let unreadChanged = false
      let previousStreamId: number | null = null

      setStore(produce(s => {
        for (const narrow of Object.keys(s.messages)) {
          const msgs = s.messages[narrow]
          const idx = msgs.findIndex(m => m.id === messageId)
          if (idx >= 0) {
            previousStreamId = typeof msgs[idx].stream_id === "number" ? msgs[idx].stream_id : null
            if (data.content) msgs[idx].content = data.content
            if (data.subject) {
              msgs[idx].subject = data.subject
              unreadChanged = updateUnreadStreamMessage(unreadIndex, messageId, { topic: data.subject }) || unreadChanged
            }
            break
          }
        }
      }))

      if (typeof data.new_stream_id === "number") {
        unreadChanged = updateUnreadStreamMessage(unreadIndex, messageId, {
          streamId: data.new_stream_id,
        }) || unreadChanged
      }

      const topicMetadataChanged =
        typeof data.subject === "string"
        || typeof data.new_stream_id === "number"

      if (topicMetadataChanged && previousStreamId !== null) {
        sync.invalidateStreamTopics(previousStreamId)
      }

      if (topicMetadataChanged && typeof data.new_stream_id === "number" && data.new_stream_id !== previousStreamId) {
        sync.invalidateStreamTopics(data.new_stream_id)
      }

      const nextStreamId = typeof data.new_stream_id === "number" ? data.new_stream_id : previousStreamId
      if (nextStreamId !== null && typeof data.subject === "string" && data.subject) {
        sync.upsertStreamTopic(nextStreamId, data.subject, messageId)
      }

      if (unreadChanged) {
        syncUnreadUi()
      }
    },

    // Event: message deleted
    handleDeleteMessageEvent(data: any) {
      if (!data?.message_id && !data?.message_ids) return
      const deleteIds = data.message_ids
        ? (data.message_ids as number[])
        : [data.message_id as number]

      const deleteSet = new Set(deleteIds)
      const affectedStreamIds = new Set<number>()

      setStore(produce(s => {
        for (const narrow of Object.keys(s.messages)) {
          for (const message of s.messages[narrow]) {
            if (deleteSet.has(message.id) && typeof message.stream_id === "number") {
              affectedStreamIds.add(message.stream_id)
            }
          }
          s.messages[narrow] = s.messages[narrow].filter(m => !deleteSet.has(m.id))
        }
      }))

      if (removeUnreadMessages(unreadIndex, deleteIds)) {
        syncUnreadUi()
      }

      for (const streamId of affectedStreamIds) {
        sync.invalidateStreamTopics(streamId)
      }
    },

    // Event: message flags updated (read, starred)
    handleFlagEvent(data: any) {
      if (!data) return
      const op = data.operation || data.op
      const flag = data.flag as string
      const messageIds = Array.isArray(data.messages) ? data.messages as number[] : []

      if (!flag) return

      const idSet = new Set(messageIds)

      if (messageIds.length > 0) {
        setStore(produce(s => {
          for (const narrow of Object.keys(s.messages)) {
            for (const msg of s.messages[narrow]) {
              if (idSet.has(msg.id)) {
                const flags = msg.flags || []
                if (op === "add" && !flags.includes(flag)) {
                  msg.flags = [...flags, flag]
                } else if (op === "remove") {
                  msg.flags = flags.filter(f => f !== flag)
                }
              }
            }
          }

          if (flag === "starred") {
            if (op === "remove") {
              s.messages[STARRED_NARROW] = (s.messages[STARRED_NARROW] || []).filter(
                msg => !idSet.has(msg.id),
              )
            } else if (op === "add") {
              const starredMessages: Message[] = []
              for (const narrow of Object.keys(s.messages)) {
                if (narrow === STARRED_NARROW) continue
                for (const msg of s.messages[narrow]) {
                  if (idSet.has(msg.id) && hasStarredFlag(msg)) {
                    starredMessages.push(msg)
                  }
                }
              }
              s.messages[STARRED_NARROW] = mergeMessagesById(
                s.messages[STARRED_NARROW] || [],
                starredMessages,
              )
            }
          }
        }))
      }

      if (flag === "read") {
        let unreadChanged = false

        if (op === "add") {
          unreadChanged = removeUnreadMessages(unreadIndex, messageIds)
        } else if (op === "remove") {
          const details = data.message_details as Record<string, any> | undefined

          for (const messageId of messageIds) {
            const detail = details?.[String(messageId)] || details?.[messageId]
            if (detail?.type === "stream" && typeof detail.stream_id === "number") {
              unreadChanged = addUnreadStreamMessage(
                unreadIndex,
                messageId,
                detail.stream_id,
                detail.topic || "",
              ) || unreadChanged
              continue
            }

            if (detail?.type === "private" && Array.isArray(detail.user_ids)) {
              unreadChanged = addUnreadDirectMessage(
                unreadIndex,
                messageId,
                [
                  ...detail.user_ids,
                  ...(typeof store.currentUserId === "number" ? [store.currentUserId] : []),
                ],
              ) || unreadChanged
            }
          }
        }

        if (unreadChanged) {
          syncUnreadUi()
        }
      }
    },

    // Event: resync (queue was re-registered)
    handleResync(data: any) {
      if (!data) return
      const nextUsers = Array.isArray(data.users) && data.users.length > 0 ? data.users : store.users
      setStore(produce(s => {
        if (data.subscriptions) s.subscriptions = data.subscriptions
        s.users = nextUsers
        // Clear messages to force refetch
        s.messages = {}
        s.messageLoadState = {}
        s.messageHydrated = {}
        s.topicsByStream = {}
        s.streamTopicsHydrated = {}
      }))

      seedUnreadState(
        data.unread_msgs,
        data.subscriptions || store.subscriptions,
        nextUsers,
        store.currentUserId,
      )
      seedRecentDirectMessages(data.recent_private_conversations, store.currentUserId)
    },

    handleUserTopicEvent(data: any) {
      if (!data) return
      const { stream_id, topic_name, visibility_policy, last_updated } = data
      setStore(produce(s => {
        const idx = s.userTopics.findIndex(
          ut => ut.stream_id === stream_id && ut.topic_name === topic_name,
        )
        if (visibility_policy === "Inherit") {
          // Remove — "Inherit" means default (no override)
          if (idx >= 0) s.userTopics.splice(idx, 1)
        } else if (idx >= 0) {
          s.userTopics[idx] = { stream_id, topic_name, visibility_policy, last_updated }
        } else {
          s.userTopics.push({ stream_id, topic_name, visibility_policy, last_updated })
        }
      }))
    },

    getTopicVisibility(streamId: number, topic: string): UserTopicVisibilityPolicy {
      return getTopicVisibility(streamId, topic)
    },
  }

  // Set up Tauri event listeners
  onMount(async () => {
    if (IS_DEMO || !HAS_TAURI_BRIDGE) {
      return
    }

    const listeners: (() => void)[] = []

    const eventTypes = [
      "message",
      "typing",
      "reaction",
      "subscription",
      "update_message",
      "delete_message",
      "update_message_flags",
      "user_topic",
      "resync",
      "disconnected",
      "connection_error",
    ]

    // Sanitize org_id for Tauri event names — dots are not allowed
    const eventId = sanitizeEventId(props.orgId)

    // Listen for all Zulip events
    for (const eventType of eventTypes) {
      const eventName = `zulip:${eventId}:${eventType}`
      const unlisten = await listen<any>(eventName, (event) => {
        handleZulipEvent(eventType, event.payload)
      })
      listeners.push(unlisten)
    }

    onCleanup(() => {
      for (const unlisten of listeners) {
        unlisten()
      }
    })
  })

  function handleZulipEvent(eventType: string, data: any) {
    switch (eventType) {
      case "message":
        sync.handleMessageEvent(data)
        break
      case "typing":
        sync.handleTypingEvent(data)
        break
      case "reaction":
        sync.handleReactionEvent(data)
        break
      case "subscription":
        sync.handleSubscriptionEvent(data)
        break
      case "update_message":
        sync.handleUpdateMessageEvent(data)
        break
      case "delete_message":
        sync.handleDeleteMessageEvent(data)
        break
      case "update_message_flags":
        sync.handleFlagEvent(data)
        break
      case "user_topic":
        sync.handleUserTopicEvent(data)
        break
      case "resync":
        sync.handleResync(data)
        break
      case "disconnected":
        sync.setDisconnected()
        break
      case "connection_error":
        // Could show a UI notification here
        break
    }
  }

  return (
    <ZulipSyncContext.Provider value={sync}>
      {props.children}
    </ZulipSyncContext.Provider>
  )
}

export function useZulipSync(): ZulipSync {
  const ctx = useContext(ZulipSyncContext)
  if (!ctx) throw new Error("useZulipSync must be used within ZulipSyncProvider")
  return ctx
}
