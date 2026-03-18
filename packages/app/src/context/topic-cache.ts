import { normalizeTopicName } from "../topic-identity"

export interface CacheableTopic {
  name: string
  max_id: number
}

function compareTopics(left: CacheableTopic, right: CacheableTopic): number {
  if (left.max_id !== right.max_id) {
    return right.max_id - left.max_id
  }

  return left.name.localeCompare(right.name)
}

export function mergeTopicsByName<T extends CacheableTopic>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) {
    return existing.slice().sort(compareTopics)
  }

  const merged = new Map<string, T>()

  for (const topic of existing) {
    merged.set(normalizeTopicName(topic.name), topic)
  }

  for (const topic of incoming) {
    const key = normalizeTopicName(topic.name)
    const current = merged.get(key)
    if (!current) {
      merged.set(key, topic)
      continue
    }

    const preferIncoming = topic.max_id >= current.max_id
    const preferred = preferIncoming ? topic : current
    const fallback = preferIncoming ? current : topic

    merged.set(key, {
      ...fallback,
      ...preferred,
      max_id: Math.max(current.max_id, topic.max_id),
    })
  }

  return Array.from(merged.values()).sort(compareTopics)
}

export function upsertTopicByName<T extends CacheableTopic>(existing: T[], incoming: T): T[] {
  return mergeTopicsByName(existing, [incoming])
}
