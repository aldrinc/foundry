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
    merged.set(topic.name, topic)
  }

  for (const topic of incoming) {
    const current = merged.get(topic.name)
    if (!current) {
      merged.set(topic.name, topic)
      continue
    }

    merged.set(topic.name, {
      ...current,
      ...topic,
      max_id: Math.max(current.max_id, topic.max_id),
    })
  }

  return Array.from(merged.values()).sort(compareTopics)
}

export function upsertTopicByName<T extends CacheableTopic>(existing: T[], incoming: T): T[] {
  return mergeTopicsByName(existing, [incoming])
}
