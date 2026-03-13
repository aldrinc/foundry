export interface CacheableMessage {
  id: number
  type: string
  subject: string
  stream_id: number | null
  display_recipient: string | { id: number }[]
  flags?: string[]
}

export const ALL_MESSAGES_NARROW = "all-messages"
export const STARRED_NARROW = "starred"

export function hasStarredFlag(message: CacheableMessage): boolean {
  return (message.flags || []).includes("starred")
}

export function mergeMessagesById<T extends CacheableMessage>(
  existing: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) {
    return existing
  }

  const merged = new Map<number, T>()
  for (const message of existing) {
    merged.set(message.id, message)
  }
  for (const message of incoming) {
    merged.set(message.id, message)
  }

  return Array.from(merged.values()).sort((a, b) => a.id - b.id)
}

export function primaryNarrowForMessage(message: CacheableMessage): string | null {
  if (message.stream_id) {
    return `stream:${message.stream_id}/topic:${message.subject}`
  }

  if (Array.isArray(message.display_recipient)) {
    const recipientIds = message.display_recipient
      .map((user) => user.id)
      .sort((left, right) => left - right)
      .join(",")
    return recipientIds ? `dm:${recipientIds}` : null
  }

  return null
}

export function cacheKeysForMessage(message: CacheableMessage): string[] {
  const keys = new Set<string>()
  const primary = primaryNarrowForMessage(message)

  if (primary) {
    keys.add(primary)
  }

  if (message.stream_id) {
    keys.add(`stream:${message.stream_id}`)
  }

  keys.add(ALL_MESSAGES_NARROW)

  if (hasStarredFlag(message)) {
    keys.add(STARRED_NARROW)
  }

  return Array.from(keys)
}
