import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { commands } from "@zulip/desktop/bindings"
import { useNavigation } from "../context/navigation"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"
import { useSettings } from "../context/settings"
import { usePlatform } from "../context/platform"
import { TopicPicker } from "./topic-picker"
import { FormatToolbar } from "./format-toolbar"
import { EmojiPicker } from "./emoji-picker"

export function ComposeBox(props: { narrow: string }) {
  const sync = useZulipSync()
  const org = useOrg()
  const nav = useNavigation()
  const { store: settings, capabilities } = useSettings()
  const platform = usePlatform()

  const [content, setContent] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [uploading, setUploading] = createSignal(false)
  const [uploadError, setUploadError] = createSignal("")
  const [topic, setTopic] = createSignal("")
  const [dragOver, setDragOver] = createSignal(false)
  const [showFormatBar, setShowFormatBar] = createSignal(false)
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false)

  let textareaRef!: HTMLTextAreaElement
  let typingTimer: ReturnType<typeof setTimeout> | undefined
  let lastTypingSent = 0

  const caps = () => capabilities()
  const canUpload = () => caps()?.uploads !== false
  const canType = () => caps()?.typing_notifications !== false && settings.sendTyping

  // Load draft
  createEffect(() => {
    const draft = sync.store.drafts[props.narrow]
    setContent(draft || "")
    setError("")
    setUploadError("")
  })

  // Auto-resize textarea
  createEffect(() => {
    const _ = content()
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 180)}px`
  })

  // Cleanup typing on unmount or narrow change
  onCleanup(() => {
    if (typingTimer) clearTimeout(typingTimer)
    sendTypingStop()
  })

  // Close emoji picker on outside click
  const handleDocClick = () => setShowEmojiPicker(false)
  createEffect(() => {
    if (showEmojiPicker()) {
      document.addEventListener("click", handleDocClick)
    } else {
      document.removeEventListener("click", handleDocClick)
    }
  })
  onCleanup(() => document.removeEventListener("click", handleDocClick))

  const parsed = () => nav.parseNarrow(props.narrow)

  const messageTarget = () => {
    const p = parsed()
    if (!p) return null

    if (p.type === "topic") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === p.streamId)
      return {
        msgType: "stream",
        to: stream?.name || String(p.streamId),
        topic: p.topic || "(no topic)",
      }
    }

    if (p.type === "stream") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === p.streamId)
      const t = topic().trim() || "(no topic)"
      return {
        msgType: "stream",
        to: stream?.name || String(p.streamId),
        topic: t,
      }
    }

    if (p.type === "dm") {
      return {
        msgType: "direct",
        to: JSON.stringify(p.userIds),
        topic: null,
      }
    }

    return null
  }

  const placeholder = () => {
    const p = parsed()
    if (!p) return "Type a message..."

    if (p.type === "topic") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === p.streamId)
      return `Message #${stream?.name || p.streamId} > ${p.topic}`
    }

    if (p.type === "stream") {
      const stream = sync.store.subscriptions.find(s => s.stream_id === p.streamId)
      return `Message #${stream?.name || p.streamId}`
    }

    return "Type a message..."
  }

  // ── Typing indicators ──

  const typingTo = (): string | null => {
    const p = parsed()
    if (!p) return null
    if (p.type === "dm") return JSON.stringify(p.userIds)
    if (p.type === "topic" || p.type === "stream") return String(p.streamId)
    return null
  }

  const typingType = (): string | null => {
    const p = parsed()
    if (!p) return null
    if (p.type === "dm") return "direct"
    if (p.type === "topic" || p.type === "stream") return "stream"
    return null
  }

  const typingTopic = (): string | null => {
    const p = parsed()
    if (!p) return null
    if (p.type === "topic") return p.topic || null
    if (p.type === "stream") return topic() || null
    return null
  }

  const sendTypingStart = () => {
    if (!canType()) return
    const to = typingTo()
    const type = typingType()
    if (!to || !type) return

    const now = Date.now()
    if (now - lastTypingSent < 10000) return // Throttle to 10s
    lastTypingSent = now

    commands.sendTyping(org.orgId, "start", type, to, typingTopic()).catch(() => {})

    // Auto-stop after 5s idle
    if (typingTimer) clearTimeout(typingTimer)
    typingTimer = setTimeout(sendTypingStop, 5000)
  }

  const sendTypingStop = () => {
    if (!canType()) return
    const to = typingTo()
    const type = typingType()
    if (!to || !type) return

    if (typingTimer) clearTimeout(typingTimer)
    lastTypingSent = 0
    commands.sendTyping(org.orgId, "stop", type, to, typingTopic()).catch(() => {})
  }

  // ── File upload ──

  const handleFileUpload = async () => {
    if (!canUpload() || !platform.openFilePickerDialog) return
    setUploadError("")
    try {
      const result = await platform.openFilePickerDialog({ title: "Upload file" })
      if (!result) return
      const paths = Array.isArray(result) ? result : [result]
      for (const path of paths) {
        await uploadSingleFile(path)
      }
    } catch {
      setUploadError("Failed to open file picker")
    }
  }

  const uploadSingleFile = async (filePath: string) => {
    setUploading(true)
    setUploadError("")
    try {
      const result = await commands.uploadFile(org.orgId, filePath)
      if (result.status === "ok") {
        const fileName = filePath.split("/").pop() || "file"
        const markdown = `[${fileName}](${result.data.url})`
        const current = content()
        setContent(current ? `${current}\n${markdown}` : markdown)
        sync.saveDraft(props.narrow, content())
      } else {
        setUploadError(result.error || "Upload failed")
      }
    } catch {
      setUploadError("Upload failed")
    }
    setUploading(false)
  }

  const handleDragOver = (e: DragEvent) => {
    if (!canUpload()) return
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!canUpload()) return

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      const path = (file as any).path || file.name
      if (path) {
        await uploadSingleFile(path)
      }
    }
  }

  // ── Input handling ──

  const handleInput = (value: string) => {
    setContent(value)
    setError("")
    if (value.trim()) {
      sync.saveDraft(props.narrow, value)
      sendTypingStart()
    } else {
      sync.clearDraft(props.narrow)
      sendTypingStop()
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

    sendTypingStop()
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
    if (settings.enterSends) {
      // Plain Enter sends, Shift+Enter for newline
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        void handleSend()
      }
    } else {
      // Cmd/Ctrl+Enter sends
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSend()
      }
    }
  }

  // ── Format toolbar insert handler ──
  const handleFormatInsert = (newText: string, _cursorOffset?: number) => {
    setContent(newText)
    sync.saveDraft(props.narrow, newText)
  }

  // ── Emoji insert handler ──
  const handleEmojiSelect = (emojiName: string, _emojiCode: string) => {
    const current = content()
    const insertion = `:${emojiName}: `
    if (textareaRef) {
      const start = textareaRef.selectionStart
      const end = textareaRef.selectionEnd
      const newText = current.slice(0, start) + insertion + current.slice(end)
      setContent(newText)
      sync.saveDraft(props.narrow, newText)
      requestAnimationFrame(() => {
        const pos = start + insertion.length
        textareaRef.focus()
        textareaRef.setSelectionRange(pos, pos)
      })
    } else {
      setContent(current + insertion)
      sync.saveDraft(props.narrow, current + insertion)
    }
    setShowEmojiPicker(false)
  }

  // ── Typing indicator display ──
  const typingDisplay = () => {
    const users = sync.store.typingUsers[props.narrow]
    if (!users || users.length === 0) return null
    const names = users
      .map(uid => sync.store.users.find(u => u.user_id === uid)?.full_name)
      .filter(Boolean)
    if (names.length === 0) return null
    if (names.length === 1) return `${names[0]} is typing...`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
    return `${names[0]} and ${names.length - 1} others are typing...`
  }

  return (
    <div class="px-4 py-3" data-component="compose-box">
      {/* Typing indicator + errors — ABOVE the container */}
      <Show when={typingDisplay()}>
        <div class="text-[11px] text-[var(--text-tertiary)] mb-1 italic">
          {typingDisplay()}
        </div>
      </Show>
      <Show when={error()}>
        <p class="text-xs text-[var(--status-error)] mb-1">{error()}</p>
      </Show>
      <Show when={uploadError()}>
        <p class="text-xs text-[var(--status-error)] mb-1">{uploadError()}</p>
      </Show>

      {/* Unified compose container */}
      <div
        class="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-input)] overflow-hidden transition-shadow"
        classList={{
          "ring-2 ring-[var(--interactive-primary)]": dragOver(),
          "focus-within:border-[var(--interactive-primary)]": true,
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Topic picker for stream-root narrows */}
        <Show when={parsed()?.type === "stream" && parsed()?.streamId}>
          <div class="px-3 pt-2">
            <TopicPicker
              streamId={parsed()!.streamId!}
              value={topic()}
              onChange={setTopic}
            />
          </div>
        </Show>

        {/* Textarea — borderless, transparent */}
        <textarea
          ref={textareaRef!}
          class="w-full px-3 py-2.5 bg-transparent text-[var(--text-primary)] text-sm resize-none focus:outline-none"
          style={{ "min-height": "42px", "max-height": "180px" }}
          placeholder={placeholder()}
          value={content()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={sending()}
          rows={1}
        />

        {/* Format toolbar — toggled */}
        <Show when={showFormatBar()}>
          <div class="border-t border-[var(--border-default)] px-2 py-1">
            <FormatToolbar
              textareaRef={textareaRef}
              onInsert={handleFormatInsert}
            />
          </div>
        </Show>

        {/* Action bar */}
        <div class="flex items-center justify-between px-2 py-1.5 border-t border-[var(--border-default)]">
          {/* Left side actions */}
          <div class="flex items-center gap-0.5">
            {/* Attach button */}
            <Show when={canUpload()}>
              <button
                class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors disabled:opacity-50"
                onClick={handleFileUpload}
                disabled={uploading()}
                title="Attach file"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </button>
            </Show>

            {/* Format toggle (Aa) */}
            <button
              class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
              classList={{ "text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10": showFormatBar() }}
              onClick={() => setShowFormatBar(v => !v)}
              title="Formatting"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <text x="1" y="12" font-size="11" fill="currentColor" font-family="system-ui, sans-serif" font-weight="600">Aa</text>
              </svg>
            </button>

            {/* Emoji button */}
            <div class="relative">
              <button
                class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowEmojiPicker(v => !v)
                }}
                title="Emoji"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2" />
                  <circle cx="6" cy="7" r="0.8" fill="currentColor" />
                  <circle cx="10" cy="7" r="0.8" fill="currentColor" />
                  <path d="M5.5 10a3 3 0 005 0" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                </svg>
              </button>
              <Show when={showEmojiPicker()}>
                <div
                  class="absolute bottom-full left-0 mb-2 z-50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                </div>
              </Show>
            </div>

            {/* Upload spinner */}
            <Show when={uploading()}>
              <span class="text-[10px] text-[var(--text-tertiary)] ml-1">Uploading...</span>
            </Show>
          </div>

          {/* Right side — send hint + send button */}
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-tertiary)] hidden sm:inline">
              {settings.enterSends ? "Enter to send" : "Cmd/Ctrl+Enter"}
            </span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => void handleSend()}
              disabled={sending() || !content().trim()}
              title={settings.enterSends ? "Send (Enter)" : "Send (Cmd/Ctrl+Enter)"}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 11V3M7 3l-3.5 3.5M7 3l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
