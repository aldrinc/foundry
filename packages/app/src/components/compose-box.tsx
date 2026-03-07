import { Show, createEffect, createSignal } from "solid-js"
import { commands } from "@zulip/desktop/bindings"
import { useNavigation } from "../context/navigation"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"

export function ComposeBox(props: { narrow: string }) {
  const sync = useZulipSync()
  const org = useOrg()
  const nav = useNavigation()

  const [content, setContent] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal("")

  let textareaRef!: HTMLTextAreaElement

  createEffect(() => {
    const draft = sync.store.drafts[props.narrow]
    setContent(draft || "")
    setError("")
  })

  createEffect(() => {
    const _ = content()
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 180)}px`
  })

  const messageTarget = () => {
    const parsed = nav.parseNarrow(props.narrow)
    if (!parsed) return null

    if (parsed.type === "topic" || parsed.type === "stream") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)
      return {
        msgType: "stream",
        to: stream?.name || String(parsed.streamId),
        topic: parsed.topic || "(no topic)",
      }
    }

    if (parsed.type === "dm") {
      return {
        msgType: "direct",
        to: JSON.stringify(parsed.userIds),
        topic: null,
      }
    }

    return null
  }

  const placeholder = () => {
    const parsed = nav.parseNarrow(props.narrow)
    if (!parsed) return "Type a message..."

    if (parsed.type === "topic") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)
      return `Message #${stream?.name || parsed.streamId} > ${parsed.topic}`
    }

    if (parsed.type === "stream") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === parsed.streamId)
      return `Message #${stream?.name || parsed.streamId}`
    }

    return "Type a message..."
  }

  const handleInput = (value: string) => {
    setContent(value)
    setError("")
    if (value.trim()) {
      sync.saveDraft(props.narrow, value)
    } else {
      sync.clearDraft(props.narrow)
    }
  }

  const handleSend = async () => {
    const text = content().trim()
    if (!text || sending()) return

    const target = messageTarget()
    if (!target) {
      setError("Cannot determine message destination")
      return
    }

    setSending(true)
    setError("")

    try {
      const result = await commands.sendMessage(
        org.orgId,
        target.msgType,
        target.to,
        text,
        target.topic,
      )

      if (result.status === "error") {
        setError(result.error || "Failed to send message")
        return
      }

      setContent("")
      sync.clearDraft(props.narrow)
    } catch (e: any) {
      setError(e?.toString() || "Failed to send message")
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div
      class="border-t border-[var(--border-default)] bg-[var(--background-surface)] px-4 py-3"
      data-component="compose-box"
    >
      <div class="flex gap-2 items-end">
        <textarea
          ref={textareaRef!}
          class="flex-1 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:border-[var(--interactive-primary)] transition-colors"
          style={{ "min-height": "38px", "max-height": "180px" }}
          placeholder={placeholder()}
          value={content()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={sending()}
          rows={1}
        />

        <button
          class="shrink-0 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] text-sm font-medium hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => void handleSend()}
          disabled={sending() || !content().trim()}
          title="Send (Cmd/Ctrl+Enter)"
        >
          {sending() ? "..." : "Send"}
        </button>
      </div>

      <p class="mt-1 text-[10px] text-[var(--text-tertiary)]">
        Send with Cmd/Ctrl+Enter
      </p>

      <Show when={error()}>
        <p class="text-xs text-[var(--status-error)] mt-1">{error()}</p>
      </Show>
    </div>
  )
}
