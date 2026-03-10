import type { Topic } from "@zulip/desktop/bindings"
import type { UnreadItem } from "../context/unread-state"

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
  const unreadByTopic = new Map<string, { count: number; lastMessageId: number }>()

  for (const item of unreadItems) {
    if (item.kind !== "stream" || item.stream_id !== streamId) {
      continue
    }

    unreadByTopic.set(item.topic, {
      count: item.count,
      lastMessageId: item.last_message_id,
    })
  }

  const entries = new Map<string, TopicSidebarEntry>()

  for (const topic of topics) {
    const unread = unreadByTopic.get(topic.name)
    entries.set(topic.name, {
      name: topic.name,
      label: stripResolvedTopicPrefix(topic.name),
      maxId: topic.max_id,
      lastMessageId: Math.max(topic.max_id, unread?.lastMessageId || 0),
      unreadCount: unread?.count || 0,
      resolved: isResolvedTopicName(topic.name),
    })
  }

  for (const [topicName, unread] of unreadByTopic.entries()) {
    if (entries.has(topicName)) {
      continue
    }

    entries.set(topicName, {
      name: topicName,
      label: stripResolvedTopicPrefix(topicName),
      maxId: unread.lastMessageId,
      lastMessageId: unread.lastMessageId,
      unreadCount: unread.count,
      resolved: isResolvedTopicName(topicName),
    })
  }

  const allEntries = Array.from(entries.values()).sort(compareTopicEntries)

  return {
    active: allEntries.filter((entry) => !entry.resolved),
    completed: allEntries.filter((entry) => entry.resolved),
  }
}
