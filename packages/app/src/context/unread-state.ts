import { normalizeTopicName } from "../topic-identity"

export interface UnreadMessagesSnapshot {
  pms?: Array<{
    other_user_id?: number | null
    sender_id?: number | null
    unread_message_ids?: number[]
  }>
  streams?: Array<{
    stream_id: number
    topic: string
    unread_message_ids?: number[]
  }>
  huddles?: Array<{
    user_ids_string: string
    unread_message_ids?: number[]
  }>
}

export interface UnreadStreamItem {
  kind: "stream"
  stream_id: number
  stream_name: string
  stream_color: string
  topic: string
  count: number
  last_message_id: number
  message_ids: number[]
}

export interface UnreadDirectMessageItem {
  kind: "dm"
  narrow: string
  user_ids: number[]
  participant_names: string[]
  label: string
  count: number
  last_message_id: number
  message_ids: number[]
}

export type UnreadItem = UnreadStreamItem | UnreadDirectMessageItem

export interface SubscriptionLookup {
  stream_id: number
  name: string
  color?: string
}

export interface UserLookup {
  user_id: number
  full_name: string
}

export interface UnreadStreamIndexEntry {
  kind: "stream"
  streamId: number
  topic: string
}

export interface UnreadDirectMessageIndexEntry {
  kind: "dm"
  userIds: number[]
}

export type UnreadIndexEntry = UnreadStreamIndexEntry | UnreadDirectMessageIndexEntry

export interface UnreadUiState {
  unreadCounts: Record<number, number>
  unreadItems: UnreadItem[]
}

export interface CachedMessageLike {
  id: number
  flags?: string[]
}

function topicKey(streamId: number, topic: string): string {
  return `${streamId}:${normalizeTopicName(topic)}`
}

function dmKey(userIds: number[]): string {
  return `dm:${userIds.join(",")}`
}

function normalizeUserIds(userIds: number[]): number[] {
  return Array.from(
    new Set(userIds.filter((userId): userId is number => Number.isFinite(userId))),
  ).sort((left, right) => left - right)
}

function sameUserIds(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((userId, index) => userId === right[index])
}

function normalizeMessageIds(messageIds: number[]): number[] {
  return Array.from(
    new Set(messageIds.filter((messageId): messageId is number => Number.isFinite(messageId))),
  )
}

export function buildUnreadIndex(
  unreadMessages?: UnreadMessagesSnapshot | null,
  currentUserId?: number | null,
): Map<number, UnreadIndexEntry> {
  const index = new Map<number, UnreadIndexEntry>()

  for (const stream of unreadMessages?.streams || []) {
    for (const messageId of stream.unread_message_ids || []) {
      index.set(messageId, {
        kind: "stream",
        streamId: stream.stream_id,
        topic: stream.topic || "",
      })
    }
  }

  for (const directMessage of unreadMessages?.pms || []) {
    const otherUserId = directMessage.other_user_id ?? directMessage.sender_id
    const userIds = normalizeUserIds([
      ...(typeof currentUserId === "number" ? [currentUserId] : []),
      ...(typeof otherUserId === "number" ? [otherUserId] : []),
    ])

    if (userIds.length === 0) continue

    for (const messageId of directMessage.unread_message_ids || []) {
      index.set(messageId, {
        kind: "dm",
        userIds,
      })
    }
  }

  for (const huddle of unreadMessages?.huddles || []) {
    const parsedUserIds = huddle.user_ids_string
      .split(",")
      .map((userId) => Number(userId))
      .filter((userId): userId is number => Number.isFinite(userId))
    const userIds = normalizeUserIds([
      ...parsedUserIds,
      ...(typeof currentUserId === "number" ? [currentUserId] : []),
    ])

    if (userIds.length === 0) continue

    for (const messageId of huddle.unread_message_ids || []) {
      index.set(messageId, {
        kind: "dm",
        userIds,
      })
    }
  }

  return index
}

export function addUnreadStreamMessage(
  index: Map<number, UnreadIndexEntry>,
  messageId: number,
  streamId: number,
  topic: string,
): boolean {
  const existing = index.get(messageId)
  if (
    existing?.kind === "stream"
    && existing.streamId === streamId
    && normalizeTopicName(existing.topic) === normalizeTopicName(topic)
  ) {
    return false
  }

  index.set(messageId, { kind: "stream", streamId, topic })
  return true
}

export function addUnreadDirectMessage(
  index: Map<number, UnreadIndexEntry>,
  messageId: number,
  userIds: number[],
): boolean {
  const normalizedUserIds = normalizeUserIds(userIds)
  if (normalizedUserIds.length === 0) return false

  const existing = index.get(messageId)
  if (existing?.kind === "dm" && sameUserIds(existing.userIds, normalizedUserIds)) {
    return false
  }

  index.set(messageId, {
    kind: "dm",
    userIds: normalizedUserIds,
  })
  return true
}

export function removeUnreadMessages(
  index: Map<number, UnreadIndexEntry>,
  messageIds: number[],
): boolean {
  let changed = false

  for (const messageId of messageIds) {
    changed = index.delete(messageId) || changed
  }

  return changed
}

export function updateUnreadStreamMessage(
  index: Map<number, UnreadIndexEntry>,
  messageId: number,
  updates: Partial<UnreadStreamIndexEntry>,
): boolean {
  const existing = index.get(messageId)
  if (!existing || existing.kind !== "stream") return false

  const next = {
    kind: "stream" as const,
    streamId: updates.streamId ?? existing.streamId,
    topic: updates.topic ?? existing.topic,
  }

  if (
    next.streamId === existing.streamId
    && normalizeTopicName(next.topic) === normalizeTopicName(existing.topic)
  ) {
    return false
  }

  index.set(messageId, next)
  return true
}

export function buildUnreadUiState(
  index: ReadonlyMap<number, UnreadIndexEntry>,
  subscriptions: SubscriptionLookup[],
  users: UserLookup[],
  currentUserId?: number | null,
): UnreadUiState {
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.stream_id, subscription]))
  const userById = new Map(users.map((user) => [user.user_id, user]))
  const unreadCounts: Record<number, number> = {}
  const grouped = new Map<string, UnreadItem>()

  for (const [messageId, entry] of index.entries()) {
    if (entry.kind === "stream") {
      unreadCounts[entry.streamId] = (unreadCounts[entry.streamId] || 0) + 1

      const key = topicKey(entry.streamId, entry.topic)
      const existing = grouped.get(key)
      if (existing?.kind === "stream") {
        existing.count += 1
        if (messageId >= existing.last_message_id) {
          existing.topic = entry.topic
          existing.last_message_id = messageId
        }
        existing.message_ids.push(messageId)
        continue
      }

      const subscription = subscriptionById.get(entry.streamId)
      grouped.set(key, {
        kind: "stream",
        stream_id: entry.streamId,
        stream_name: subscription?.name || `#${entry.streamId}`,
        stream_color: subscription?.color || "",
        topic: entry.topic,
        count: 1,
        last_message_id: messageId,
        message_ids: [messageId],
      })
      continue
    }

    const key = dmKey(entry.userIds)
    const existing = grouped.get(key)
    if (existing?.kind === "dm") {
      existing.count += 1
      existing.last_message_id = Math.max(existing.last_message_id, messageId)
      existing.message_ids.push(messageId)
      continue
    }

    const participantNames = entry.userIds
      .filter((userId) => userId !== currentUserId)
      .map((userId) => userById.get(userId)?.full_name || `User ${userId}`)
    const label = participantNames.length > 0
      ? participantNames.join(", ")
      : "Saved messages"

    grouped.set(key, {
      kind: "dm",
      narrow: key,
      user_ids: entry.userIds,
      participant_names: participantNames,
      label,
      count: 1,
      last_message_id: messageId,
      message_ids: [messageId],
    })
  }

  return {
    unreadCounts,
    unreadItems: Array.from(grouped.values()).sort((a, b) => b.last_message_id - a.last_message_id),
  }
}

export function getUnreadTotalCount(unreadItems: UnreadItem[]): number {
  return unreadItems.reduce((sum, item) => sum + item.count, 0)
}

export function applyLocalReadState(
  index: Map<number, UnreadIndexEntry>,
  cachedMessages: Record<string, CachedMessageLike[]>,
  messageIds: number[],
): boolean {
  const normalizedMessageIds = normalizeMessageIds(messageIds)
  if (normalizedMessageIds.length === 0) {
    return false
  }

  const idSet = new Set(normalizedMessageIds)

  for (const narrow of Object.keys(cachedMessages)) {
    for (const message of cachedMessages[narrow] || []) {
      if (!idSet.has(message.id)) {
        continue
      }

      const flags = message.flags || []
      if (!flags.includes("read")) {
        message.flags = [...flags, "read"]
      }
    }
  }

  return removeUnreadMessages(index, normalizedMessageIds)
}

export function getUnreadMessageIdsForStream(
  index: ReadonlyMap<number, UnreadIndexEntry>,
  streamId: number,
): number[] {
  const messageIds: number[] = []

  for (const [messageId, entry] of index.entries()) {
    if (entry.kind === "stream" && entry.streamId === streamId) {
      messageIds.push(messageId)
    }
  }

  return messageIds
}

export function getUnreadMessageIdsForTopic(
  index: ReadonlyMap<number, UnreadIndexEntry>,
  streamId: number,
  topic: string,
): number[] {
  const messageIds: number[] = []

  for (const [messageId, entry] of index.entries()) {
    if (
      entry.kind === "stream"
      && entry.streamId === streamId
      && normalizeTopicName(entry.topic) === normalizeTopicName(topic)
    ) {
      messageIds.push(messageId)
    }
  }

  return messageIds
}

export function shouldAddMessageToUnread(
  message: {
    sender_id: number
    flags?: string[]
    stream_id: number | null
    display_recipient: string | { id: number }[]
  },
  currentUserId: number | null,
  isViewingConversation: boolean,
): boolean {
  if ((message.flags || []).includes("read")) {
    return false
  }

  if (isViewingConversation) {
    return false
  }

  if (message.sender_id === currentUserId) {
    return false
  }

  return typeof message.stream_id === "number" || Array.isArray(message.display_recipient)
}
