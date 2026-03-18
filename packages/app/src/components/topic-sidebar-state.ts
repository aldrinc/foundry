import type { Topic } from "@foundry/desktop/bindings"
import type { UnreadItem } from "../context/unread-state"
import { normalizeTopicName } from "../topic-identity"

export const RESOLVED_TOPIC_PREFIX = "✔ "

export interface TopicSidebarEntry {
  name: string
  label: string
  maxId: number
  lastMessageId: number
  unreadCount: number
  resolved: boolean
}

export interface TopicSidebarSections {
  active: TopicSidebarEntry[]
  completed: TopicSidebarEntry[]
}

export function isResolvedTopicName(topicName: string): boolean {
  return topicName.startsWith(RESOLVED_TOPIC_PREFIX)
}

export function stripResolvedTopicPrefix(topicName: string): string {
  if (!isResolvedTopicName(topicName)) {
    return topicName
  }

  return topicName
    .slice(RESOLVED_TOPIC_PREFIX.length)
    .replace(/^[ ✔]+/, "")
}

export function resolveTopicName(topicName: string): string {
  return isResolvedTopicName(topicName) ? topicName : `${RESOLVED_TOPIC_PREFIX}${topicName}`
}

export function unresolveTopicName(topicName: string): string {
  return isResolvedTopicName(topicName) ? stripResolvedTopicPrefix(topicName) : topicName
}

function compareTopicEntries(left: TopicSidebarEntry, right: TopicSidebarEntry): number {
  if (left.lastMessageId !== right.lastMessageId) {
    return right.lastMessageId - left.lastMessageId
  }

  return left.label.localeCompare(right.label)
}

export function buildTopicSidebarSections(
  streamId: number,
  topics: Topic[],
  unreadItems: UnreadItem[],
): TopicSidebarSections {
  const unreadByTopic = new Map<string, { count: number; lastMessageId: number; topicName: string }>()

  for (const item of unreadItems) {
    if (item.kind !== "stream" || item.stream_id !== streamId) {
      continue
    }

    const key = normalizeTopicName(item.topic)
    const existing = unreadByTopic.get(key)

    unreadByTopic.set(key, {
      count: (existing?.count || 0) + item.count,
      lastMessageId: Math.max(existing?.lastMessageId || 0, item.last_message_id),
      topicName: item.last_message_id >= (existing?.lastMessageId || 0) ? item.topic : (existing?.topicName || item.topic),
    })
  }

  const entries = new Map<string, TopicSidebarEntry>()

  for (const topic of topics) {
    const key = normalizeTopicName(topic.name)
    const unread = unreadByTopic.get(key)
    entries.set(key, {
      name: topic.name,
      label: stripResolvedTopicPrefix(topic.name),
      maxId: topic.max_id,
      lastMessageId: Math.max(topic.max_id, unread?.lastMessageId || 0),
      unreadCount: unread?.count || 0,
      resolved: isResolvedTopicName(topic.name),
    })
  }

  for (const [key, unread] of unreadByTopic.entries()) {
    if (entries.has(key)) {
      continue
    }

    entries.set(key, {
      name: unread.topicName,
      label: stripResolvedTopicPrefix(unread.topicName),
      maxId: unread.lastMessageId,
      lastMessageId: unread.lastMessageId,
      unreadCount: unread.count,
      resolved: isResolvedTopicName(unread.topicName),
    })
  }

  const allEntries = Array.from(entries.values()).sort(compareTopicEntries)

  return {
    active: allEntries.filter((entry) => !entry.resolved),
    completed: allEntries.filter((entry) => entry.resolved),
  }
}
