import { createContext, useContext, type JSX, type Accessor, type Setter } from "solid-js"
import { createSignal } from "solid-js"
import {
  type ParsedNarrow,
  isSpecialNarrow,
  narrowToFilters,
  parseNarrow,
} from "./navigation-utils"

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

export interface NavigationContext {
  activeNarrow: Accessor<Narrow>
  setActiveNarrow: Setter<Narrow>
  messageAnchorId: Accessor<number | null>
  navigateToMessage(narrow: string, messageId: number): void
  clearMessageAnchor(messageId?: number): void
  /** Parse a narrow string into Zulip API narrow filters */
  narrowToFilters(narrow: string): { operator: string; operand: string | number[] }[]
  /** Get display info from a narrow string */
  parseNarrow(narrow: string): ParsedNarrow | null
  /** Check if a narrow is a special view type */
  isSpecialNarrow(narrow: string): boolean
}

const NavContext = createContext<NavigationContext>()

export function NavigationProvider(props: { children: JSX.Element }) {
  const [activeNarrow, rawSetActiveNarrow] = createSignal<Narrow>(null)
  const [messageAnchorId, setMessageAnchorId] = createSignal<number | null>(null)

  const setActiveNarrow: Setter<Narrow> = (value) => {
    setMessageAnchorId(null)
    return rawSetActiveNarrow(value as any)
  }

  const navigateToMessage = (narrow: string, messageId: number) => {
    setMessageAnchorId(messageId)
    rawSetActiveNarrow(narrow)
  }

  const clearMessageAnchor = (messageId?: number) => {
    if (messageId !== undefined && messageAnchorId() !== messageId) {
      return
    }

    setMessageAnchorId(null)
  }

  const nav: NavigationContext = {
    activeNarrow,
    setActiveNarrow,
    messageAnchorId,
    navigateToMessage,
    clearMessageAnchor,

    narrowToFilters,
    parseNarrow,
    isSpecialNarrow,
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
