export interface QuickReactionEntry {
  name: string
  code: string
  char: string
}

const QUICK_REACTION_ENTRIES = [
  { name: "grinning", code: "1f600", char: "😀" },
  { name: "smiley", code: "1f603", char: "😃" },
  { name: "smile", code: "1f604", char: "😄" },
  { name: "grin", code: "1f601", char: "😁" },
  { name: "laughing", code: "1f606", char: "😆" },
  { name: "sweat_smile", code: "1f605", char: "😅" },
  { name: "joy", code: "1f602", char: "😂" },
  { name: "rofl", code: "1f923", char: "🤣" },
  { name: "wink", code: "1f609", char: "😉" },
  { name: "blush", code: "1f60a", char: "😊" },
  { name: "innocent", code: "1f607", char: "😇" },
  { name: "heart_eyes", code: "1f60d", char: "😍" },
  { name: "wave", code: "1f44b", char: "👋" },
  { name: "+1", code: "1f44d", char: "👍" },
  { name: "-1", code: "1f44e", char: "👎" },
  { name: "ok_hand", code: "1f44c", char: "👌" },
  { name: "clap", code: "1f44f", char: "👏" },
  { name: "raised_hands", code: "1f64c", char: "🙌" },
  { name: "pray", code: "1f64f", char: "🙏" },
  { name: "tada", code: "1f389", char: "🎉" },
  { name: "rocket", code: "1f680", char: "🚀" },
  { name: "heart", code: "2764", char: "❤️" },
  { name: "check_mark", code: "2705", char: "✅" },
  { name: "x", code: "274c", char: "❌" },
] as const satisfies readonly QuickReactionEntry[]

const MESSAGE_QUICK_REACTION_NAMES = ["+1", "check_mark", "joy", "raised_hands"] as const

export function getQuickReactionEntriesByName(names: readonly string[]): QuickReactionEntry[] {
  return names.flatMap((name) => {
    const entry = QUICK_REACTION_ENTRIES.find((emoji) => emoji.name === name)
    return entry ? [entry] : []
  })
}

export const DEFAULT_MESSAGE_QUICK_REACTIONS = getQuickReactionEntriesByName(
  MESSAGE_QUICK_REACTION_NAMES,
)
