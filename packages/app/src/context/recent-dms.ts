export interface RecentDirectMessageConversation {
  user_ids: number[]
  max_message_id: number
}

export interface RecentDirectMessageSnapshot {
  user_ids?: number[]
  max_message_id: number
}

export interface DirectMessageMessageShape {
  id: number
  stream_id: number | null
  display_recipient: string | { id: number }[]
}

function normalizeUserIds(userIds: number[]): number[] {
  return [...new Set(userIds.filter(id => Number.isFinite(id) && id > 0))].sort((left, right) => left - right)
}

export function normalizeRecentDirectMessage(
  conversation: RecentDirectMessageSnapshot,
  currentUserId: number | null,
): RecentDirectMessageConversation | null {
  const userIds = normalizeUserIds([
    ...(conversation.user_ids || []),
    ...(currentUserId ? [currentUserId] : []),
  ])

  if (userIds.length === 0) {
    return null
  }

  return {
    user_ids: userIds,
    max_message_id: conversation.max_message_id,
  }
}

export function hydrateRecentDirectMessages(
  conversations: RecentDirectMessageSnapshot[] | undefined,
  currentUserId: number | null,
): RecentDirectMessageConversation[] {
  const byConversation = new Map<string, RecentDirectMessageConversation>()

  for (const conversation of conversations || []) {
    const normalized = normalizeRecentDirectMessage(conversation, currentUserId)
    if (!normalized) continue

    const key = normalized.user_ids.join(",")
    const existing = byConversation.get(key)
    if (!existing || normalized.max_message_id > existing.max_message_id) {
      byConversation.set(key, normalized)
    }
  }

  return Array.from(byConversation.values()).sort(
    (left, right) => right.max_message_id - left.max_message_id,
  )
}

export function upsertRecentDirectMessageFromMessage(
  conversations: RecentDirectMessageConversation[],
  message: DirectMessageMessageShape,
  currentUserId: number | null,
): RecentDirectMessageConversation[] {
  if (message.stream_id !== null || !Array.isArray(message.display_recipient)) {
    return conversations
  }

  return hydrateRecentDirectMessages(
    [
      ...conversations,
      {
        user_ids: message.display_recipient.map(user => user.id),
        max_message_id: message.id,
      },
    ],
    currentUserId,
  )
}

export function narrowForRecentDirectMessage(conversation: RecentDirectMessageConversation): string {
  return `dm:${conversation.user_ids.join(",")}`
}
