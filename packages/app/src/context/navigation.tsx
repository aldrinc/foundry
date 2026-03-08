import { createContext, useContext, type JSX, type Accessor, type Setter } from "solid-js"
import { createSignal } from "solid-js"

/** Narrow string format:
 * - null: Inbox view
 * - "stream:{stream_id}": All messages in a stream
 * - "stream:{stream_id}/topic:{topic_name}": Specific topic
 * - "dm:{user_id1},{user_id2},...": Direct messages
 * - "starred": Starred messages view
 * - "all-messages": All messages view
 * - "recent-topics": Recent topics view
 * - "search:{query}": Search results
 */
export type Narrow = string | null

/** Special view narrows (not Zulip API narrows) */
export const SPECIAL_NARROWS = ["starred", "all-messages", "recent-topics"] as const
export type SpecialNarrow = typeof SPECIAL_NARROWS[number]

export interface NavigationContext {
  activeNarrow: Accessor<Narrow>
  setActiveNarrow: Setter<Narrow>
  /** Parse a narrow string into Zulip API narrow filters */
  narrowToFilters(narrow: string): { operator: string; operand: string | number[] }[]
  /** Get display info from a narrow string */
  parseNarrow(narrow: string): {
    type: "stream" | "topic" | "dm" | "starred" | "all-messages" | "recent-topics" | "search"
    streamId?: number
    topic?: string
    userIds?: number[]
    query?: string
  } | null
  /** Check if a narrow is a special view type */
  isSpecialNarrow(narrow: string): boolean
}

const NavContext = createContext<NavigationContext>()

export function NavigationProvider(props: { children: JSX.Element }) {
  const [activeNarrow, setActiveNarrow] = createSignal<Narrow>(null)

  const nav: NavigationContext = {
    activeNarrow,
    setActiveNarrow,

    narrowToFilters(narrow: string) {
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
    },

    parseNarrow(narrow: string) {
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
    },

    isSpecialNarrow(narrow: string) {
      return SPECIAL_NARROWS.includes(narrow as SpecialNarrow) || narrow.startsWith("search:")
    },
  }

  return (
    <NavContext.Provider value={nav}>
      {props.children}
    </NavContext.Provider>
  )
}

export function useNavigation(): NavigationContext {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider")
  return ctx
}
