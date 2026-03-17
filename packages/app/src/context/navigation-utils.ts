import type { NarrowFilter } from "@foundry/desktop/bindings"
import type { Subscription } from "./zulip-sync"

export const SPECIAL_NARROWS = ["starred", "all-messages", "recent-topics"] as const
export type SpecialNarrow = typeof SPECIAL_NARROWS[number]

export interface ParsedNarrow {
  type: "stream" | "topic" | "dm" | "starred" | "all-messages" | "recent-topics" | "search"
  streamId?: number
  topic?: string
  userIds?: number[]
  query?: string
}

export function narrowToFilters(narrow: string): { operator: string; operand: string | number[] }[] {
  const filters: { operator: string; operand: string | number[] }[] = []

  if (narrow.startsWith("stream:")) {
    const rest = narrow.slice(7)
    const topicSep = rest.indexOf("/topic:")
    if (topicSep >= 0) {
      filters.push({ operator: "stream", operand: rest.slice(0, topicSep) })
      filters.push({ operator: "topic", operand: rest.slice(topicSep + 7) })
    } else {
      filters.push({ operator: "stream", operand: rest })
    }
  } else if (narrow.startsWith("dm:")) {
    const ids = narrow.slice(3).split(",").map(Number)
    filters.push({ operator: "dm", operand: ids })
  } else if (narrow === "starred") {
    filters.push({ operator: "is", operand: "starred" })
  } else if (narrow === "all-messages") {
    // Empty filters = all messages
  } else if (narrow.startsWith("search:")) {
    const query = narrow.slice(7)
    filters.push({ operator: "search", operand: query })
  }

  return filters
}

export function narrowToApiFilters(
  narrow: string,
  subscriptions: Pick<Subscription, "stream_id" | "name">[] = [],
): NarrowFilter[] {
  return (narrowToFilters(narrow) as NarrowFilter[]).map((filter) => {
    if (filter.operator !== "stream" || typeof filter.operand !== "string") {
      return filter
    }

    const streamId = Number.parseInt(filter.operand, 10)
    if (!Number.isFinite(streamId)) {
      return filter
    }

    const subscription = subscriptions.find((entry) => entry.stream_id === streamId)
    if (!subscription) {
      return filter
    }

    return {
      ...filter,
      operand: subscription.name,
    }
  })
}

export function parseNarrow(narrow: string): ParsedNarrow | null {
  if (narrow.startsWith("stream:")) {
    const rest = narrow.slice(7)
    const topicSep = rest.indexOf("/topic:")
    if (topicSep >= 0) {
      return {
        type: "topic",
        streamId: parseInt(rest.slice(0, topicSep), 10),
        topic: rest.slice(topicSep + 7),
      }
    }
    return { type: "stream", streamId: parseInt(rest, 10) }
  } else if (narrow.startsWith("dm:")) {
    const ids = narrow.slice(3).split(",").map(Number)
    return { type: "dm", userIds: ids }
  } else if (narrow === "starred") {
    return { type: "starred" }
  } else if (narrow === "all-messages") {
    return { type: "all-messages" }
  } else if (narrow === "recent-topics") {
    return { type: "recent-topics" }
  } else if (narrow.startsWith("search:")) {
    return { type: "search", query: narrow.slice(7) }
  }
  return null
}

export function isSpecialNarrow(narrow: string): boolean {
  return SPECIAL_NARROWS.includes(narrow as SpecialNarrow) || narrow.startsWith("search:")
}
