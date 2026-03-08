import type { JSX } from "solid-js"

interface FormatAction {
  id: string
  label: string
  icon: JSX.Element
  shortcut?: string
  wrap: { before: string; after: string }
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    id: "bold",
    label: "Bold",
    shortcut: "Cmd+B",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 2h4a2.5 2.5 0 010 5H3V2zM3 7h4.5a2.5 2.5 0 010 5H3V7z" stroke="currentColor" stroke-width="1.5" /></svg>,
    wrap: { before: "**", after: "**" },
  },
  {
    id: "italic",
    label: "Italic",
    shortcut: "Cmd+I",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M5 2h4M3 10h4M7 2L5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>,
    wrap: { before: "*", after: "*" },
  },
  {
    id: "code",
    label: "Code",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3L1 6l3 3M8 3l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>,
    wrap: { before: "`", after: "`" },
  },
  {
    id: "codeblock",
    label: "Code Block",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" /><path d="M4 4L2 6l2 2M8 4l2 2-2 2" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" /></svg>,
    wrap: { before: "```\n", after: "\n```" },
  },
  {
    id: "quote",
    label: "Quote",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 2v8M6 4h4M6 6h3M6 8h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>,
    wrap: { before: "> ", after: "" },
  },
  {
    id: "link",
    label: "Link",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M5 7a3 3 0 004-4L7.5 1.5a2.1 2.1 0 00-3 3L5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /><path d="M7 5a3 3 0 00-4 4l1.5 1.5a2.1 2.1 0 003-3L7 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>,
    wrap: { before: "[", after: "](url)" },
  },
  {
    id: "list",
    label: "Bullet List",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="2" cy="3" r="1" fill="currentColor" /><circle cx="2" cy="6" r="1" fill="currentColor" /><circle cx="2" cy="9" r="1" fill="currentColor" /><path d="M5 3h5M5 6h5M5 9h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>,
    wrap: { before: "- ", after: "" },
  },
  {
    id: "numbered-list",
    label: "Numbered List",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><text x="1" y="4" font-size="4" fill="currentColor" font-family="system-ui">1.</text><text x="1" y="7" font-size="4" fill="currentColor" font-family="system-ui">2.</text><text x="1" y="10" font-size="4" fill="currentColor" font-family="system-ui">3.</text><path d="M5 3h5M5 6h5M5 9h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>,
    wrap: { before: "1. ", after: "" },
  },
  {
    id: "strikethrough",
    label: "Strikethrough",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /><path d="M8 3H5.5a1.5 1.5 0 000 3M4 9h2.5a1.5 1.5 0 000-3" stroke="currentColor" stroke-width="1.2" /></svg>,
    wrap: { before: "~~", after: "~~" },
  },
  {
    id: "heading",
    label: "Heading",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2v8M10 2v8M2 6h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>,
    wrap: { before: "# ", after: "" },
  },
  {
    id: "spoiler",
    label: "Spoiler",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" /><circle cx="6" cy="6" r="2" fill="currentColor" /></svg>,
    wrap: { before: "```spoiler \n", after: "\n```" },
  },
  {
    id: "math-inline",
    label: "Math (inline)",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><text x="1" y="9" font-size="9" fill="currentColor" font-family="serif" font-style="italic">x²</text></svg>,
    wrap: { before: "$$", after: "$$" },
  },
  {
    id: "math-block",
    label: "Math (block)",
    icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" /><text x="3" y="8" font-size="7" fill="currentColor" font-family="serif" font-style="italic">∑</text></svg>,
    wrap: { before: "```math\n", after: "\n```" },
  },
]

/**
 * FormatToolbar — a row of markdown formatting buttons for the compose box.
 * Each button wraps the current selection or inserts formatting syntax.
 */
export function FormatToolbar(props: {
  textareaRef: HTMLTextAreaElement
  onInsert: (newText: string, cursorOffset?: number) => void
}) {
  const applyFormat = (action: FormatAction) => {
    const textarea = props.textareaRef
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const selected = text.slice(start, end)

    const { before, after } = action.wrap
    const newText =
      text.slice(0, start) +
      before +
      (selected || action.label.toLowerCase()) +
      after +
      text.slice(end)

    // Calculate new cursor position
    const cursorPos = selected
      ? start + before.length + selected.length + after.length
      : start + before.length + action.label.toLowerCase().length

    props.onInsert(newText, cursorPos)

    // Refocus and set selection
    requestAnimationFrame(() => {
      textarea.focus()
      if (!selected) {
        // Select the placeholder text for easy replacement
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + action.label.toLowerCase().length
        )
      } else {
        textarea.setSelectionRange(cursorPos, cursorPos)
      }
    })
  }

  return (
    <div class="flex items-center gap-0.5" data-component="format-toolbar">
      {FORMAT_ACTIONS.map(action => (
        <button
          class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
          onClick={(e) => {
            e.preventDefault()
            applyFormat(action)
          }}
          title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
        >
          {action.icon}
        </button>
      ))}
    </div>
  )
}
