import { createSignal, Show, onCleanup, createEffect } from "solid-js"
import { Portal } from "solid-js/web"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"
import { commands } from "@zulip/desktop/bindings"
import type { Message } from "../context/zulip-sync"
import { DEFAULT_MESSAGE_QUICK_REACTIONS } from "./emoji-quick-reactions"
import { EmojiPicker } from "./emoji-picker"

export function MessageActions(props: {
  message: Message
  currentUserId?: number
  onStartEdit?: () => void
  onQuote?: (text: string) => void
}) {
  const org = useOrg()
  const sync = useZulipSync()
  const [showEmoji, setShowEmoji] = createSignal(false)
  const [pickerPos, setPickerPos] = createSignal({ top: 0, left: 0 })
  const [confirming, setConfirming] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  let triggerRef!: HTMLDivElement

  const PICKER_WIDTH = 280
  const PICKER_HEIGHT = 310 // search + tabs + grid approx height

  const openPicker = () => {
    const rect = triggerRef.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top

    const top = spaceBelow >= PICKER_HEIGHT
      ? rect.bottom + 4
      : spaceAbove >= PICKER_HEIGHT
        ? rect.top - PICKER_HEIGHT - 4
        : Math.max(8, window.innerHeight - PICKER_HEIGHT - 8) // fallback: pin to bottom

    // Right-align to the trigger, but don't go off-screen left
    const left = Math.max(8, rect.right - PICKER_WIDTH)

    setPickerPos({ top, left })
    setShowEmoji(true)
  }

  const closePicker = () => setShowEmoji(false)

  // Close picker when the message list scrolls
  createEffect(() => {
    if (!showEmoji()) return
    const scrollParent = triggerRef?.closest(".overflow-y-auto, [style*='overflow']") as HTMLElement | null
    if (!scrollParent) return
    const onScroll = () => closePicker()
    scrollParent.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => scrollParent.removeEventListener("scroll", onScroll))
  })

  const isOwnMessage = () => props.currentUserId && props.message.sender_id === props.currentUserId
  const isStarred = () => (props.message.flags || []).includes("starred")
  const isRead = () => (props.message.flags || []).includes("read")

  const handleToggleRead = async () => {
    try {
      const op = isRead() ? "remove" : "add"
      await commands.updateMessageFlags(org.orgId, [props.message.id], op, "read")
    } catch (e) {
      console.error("Failed to toggle read:", e)
    }
  }

  const handleDelete = async () => {
    if (!confirming()) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
      return
    }
    await commands.deleteMessage(org.orgId, props.message.id)
    setConfirming(false)
  }

  const handleReaction = async (emojiName: string, emojiCode: string) => {
    setShowEmoji(false)
    const hasReaction =
      props.currentUserId !== undefined &&
      (props.message.reactions || []).some(
        reaction => reaction.emoji_code === emojiCode && reaction.user_id === props.currentUserId,
      )

    try {
      if (hasReaction) {
        await commands.removeReaction(org.orgId, props.message.id, emojiName, emojiCode)
      } else {
        await commands.addReaction(org.orgId, props.message.id, emojiName, emojiCode)
      }
    } catch (error) {
      console.error("Failed to update reaction:", error)
    }
  }

  const handleToggleStar = async () => {
    try {
      const op = isStarred() ? "remove" : "add"
      await commands.updateMessageFlags(org.orgId, [props.message.id], op, "starred")
    } catch (e) {
      console.error("Failed to toggle star:", e)
    }
  }

  const handleQuote = () => {
    // Extract text from HTML content
    const tmp = document.createElement("div")
    tmp.innerHTML = props.message.content
    const text = tmp.textContent || ""

    const quoteText = `@_**${props.message.sender_full_name}** said:\n\`\`\`quote\n${text}\n\`\`\`\n`
    props.onQuote?.(quoteText)
  }

  const handleCopyLink = async () => {
    // Build message permalink
    const streamId = props.message.stream_id
    const topic = props.message.subject
    const msgId = props.message.id

    let link = `#narrow`
    if (streamId) {
      const stream = sync.store.subscriptions.find(s => s.stream_id === streamId)
      link += `/stream/${stream?.name || streamId}`
      if (topic) link += `/topic/${topic}`
    }
    link += `/near/${msgId}`

    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback if clipboard API fails
      console.error("Failed to copy link")
    }
  }

  return (
    <div class="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-sm px-1 py-0.5"
      data-component="message-actions"
    >
      {/* React button */}
      <div ref={triggerRef!}>
        <ActionButton
          title="Add reaction"
          onClick={() => showEmoji() ? closePicker() : openPicker()}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2" />
            <circle cx="5.5" cy="6" r="0.7" fill="currentColor" />
            <circle cx="8.5" cy="6" r="0.7" fill="currentColor" />
            <path d="M5 8.5c.5.8 1.2 1 2 1s1.5-.2 2-1" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
          </svg>
        </ActionButton>
      </div>
      <Show when={showEmoji()}>
        <Portal>
          <div class="fixed inset-0 z-[9999]" onClick={closePicker} />
          <div
            class="fixed z-[10000]"
            style={{ top: `${pickerPos().top}px`, left: `${pickerPos().left}px` }}
          >
            <EmojiPicker
              onSelect={handleReaction}
              onClose={closePicker}
              quickReactions={DEFAULT_MESSAGE_QUICK_REACTIONS}
            />
          </div>
        </Portal>
      </Show>

      {/* Star toggle */}
      <ActionButton
        title={isStarred() ? "Unstar message" : "Star message"}
        onClick={handleToggleStar}
        active={isStarred()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill={isStarred() ? "currentColor" : "none"}>
          <path d="M7 1.5l1.5 3 3.3.5-2.4 2.3.6 3.2L7 8.9 3.9 10.5l.6-3.2-2.4-2.3 3.4-.5L7 1.5z"
            stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"
          />
        </svg>
      </ActionButton>

      {/* Mark read/unread */}
      <ActionButton
        title={isRead() ? "Mark as unread" : "Mark as read"}
        onClick={handleToggleRead}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <Show when={isRead()} fallback={
            <path d="M1 7l4 4 8-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          }>
            <circle cx="7" cy="7" r="3" fill="currentColor" />
          </Show>
        </svg>
      </ActionButton>

      {/* Quote */}
      <Show when={props.onQuote}>
        <ActionButton title="Quote message" onClick={handleQuote}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3v8M6 5h5M6 7h4M6 9h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </ActionButton>
      </Show>

      {/* Copy link */}
      <ActionButton title={copied() ? "Copied!" : "Copy link"} onClick={handleCopyLink}>
        <Show when={!copied()} fallback={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7l3 3 5-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        }>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M6 8a2.5 2.5 0 003.5-3.5L8 3a2 2 0 00-3 3L6 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            <path d="M8 6a2.5 2.5 0 00-3.5 3.5L6 11a2 2 0 003-3L8 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </Show>
      </ActionButton>

      {/* Edit (own messages only) */}
      <Show when={isOwnMessage()}>
        <ActionButton title="Edit" onClick={() => props.onStartEdit?.()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2M3 9l-0.5 2.5L5 11l6.5-6.5-2-2L3 9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
          </svg>
        </ActionButton>
      </Show>

      {/* Delete (own messages only) */}
      <Show when={isOwnMessage()}>
        <ActionButton
          title={confirming() ? "Click again to confirm" : "Delete"}
          onClick={handleDelete}
          danger={confirming()}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3.5 4h7l-.5 7.5H4L3.5 4zM2.5 4h9M5.5 2h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </ActionButton>
      </Show>
    </div>
  )
}

function ActionButton(props: {
  title: string
  onClick: () => void
  children: any
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); props.onClick() }}
      class={`p-1 rounded-[var(--radius-sm)] transition-colors ${
        props.danger
          ? "text-[var(--status-error)] hover:bg-[var(--status-error)]/10"
          : props.active
            ? "text-amber-400 hover:bg-amber-400/10"
            : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
      }`}
      title={props.title}
    >
      {props.children}
    </button>
  )
}
