import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { commands } from "@zulip/desktop/bindings"
import { useNavigation } from "../context/navigation"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"
import { useSettings } from "../context/settings"
import { usePlatform } from "../context/platform"
import { TopicPicker } from "./topic-picker"
import { FormatToolbar } from "./format-toolbar"
import { EmojiPicker } from "./emoji-picker"
import { MentionAutocomplete } from "./mention-autocomplete"

export function ComposeBox(props: { narrow: string }) {
  const sync = useZulipSync()
  const org = useOrg()
  const nav = useNavigation()
  const { store: settings, setSetting, capabilities } = useSettings()
  const platform = usePlatform()

  const [content, setContent] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal("")
  const [uploading, setUploading] = createSignal(false)
  const [uploadLabel, setUploadLabel] = createSignal("")
  const [uploadError, setUploadError] = createSignal("")
  const [topic, setTopic] = createSignal("")
  const [dragOver, setDragOver] = createSignal(false)
  const [showFormatBar, setShowFormatBar] = createSignal(false)
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false)
  const [showOptionsMenu, setShowOptionsMenu] = createSignal(false)
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionType, setMentionType] = createSignal<"user" | "stream">("user")
  let mentionTriggerIndex = -1

  let textareaRef!: HTMLTextAreaElement
  let composeRef!: HTMLDivElement
  let typingTimer: ReturnType<typeof setTimeout> | undefined
  let lastTypingSent = 0
  let nativeDropRegistered = false

  const modKey = () => platform.os === "macos" ? "⌘" : "Ctrl"

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

  // Close popover menus on outside click
  const handleDocClick = () => {
    setShowEmojiPicker(false)
    setShowOptionsMenu(false)
  }
  createEffect(() => {
    if (showEmojiPicker() || showOptionsMenu()) {
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
    const fileName = filePath.split("/").pop() || "file"
    setUploading(true)
    setUploadLabel(fileName)
    setUploadError("")
    try {
      const result = await commands.uploadFile(org.orgId, filePath)
      if (result.status === "ok") {
        const markdown = `[${fileName}](${result.data.url})`
        const current = content()
        setContent(current ? `${current}\n${markdown}` : markdown)
        sync.saveDraft(props.narrow, content())
      } else {
        setUploadError(result.error || "Upload failed")
      }
    } catch {
      setUploadError("Upload failed")
    } finally {
      setUploading(false)
      setUploadLabel("")
    }
  }

  const uploadFilePaths = async (paths: string[]) => {
    for (const path of paths) {
      await uploadSingleFile(path)
    }
  }

  const extractDroppedFiles = (dataTransfer?: DataTransfer | null): File[] => {
    const directFiles = Array.from(dataTransfer?.files || [])
    if (directFiles.length > 0) {
      return directFiles
    }

    return Array.from(dataTransfer?.items || [])
      .map((item) => item.kind === "file" ? item.getAsFile() : null)
      .filter((file): file is File => file !== null)
  }

  const isInsideCompose = (x: number, y: number): boolean => {
    if (!composeRef) return false
    const bounds = composeRef.getBoundingClientRect()
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
  }

  // ── Drag-and-drop (counter pattern to avoid child-element flicker) ──

  let dragCounter = 0

  const handleDragEnter = (e: DragEvent) => {
    if (!canUpload()) return
    if (nativeDropRegistered) return
    e.preventDefault()
    dragCounter++
    setDragOver(true)
  }

  const handleDragOver = (e: DragEvent) => {
    if (!canUpload()) return
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy"
    }
  }

  const handleDragLeave = (e: DragEvent) => {
    if (nativeDropRegistered) return
    e.preventDefault()
    dragCounter--
    if (dragCounter <= 0) {
      dragCounter = 0
      setDragOver(false)
    }
  }

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    dragCounter = 0
    setDragOver(false)
    if (!canUpload()) return
    if (nativeDropRegistered) return

    const files = extractDroppedFiles(e.dataTransfer)
    if (files.length === 0) return

    for (const file of files) {
      const path = (file as any).path
      if (path) {
        await uploadSingleFile(path)
      } else {
        await uploadBlobFile(file)
      }
    }
  }

  // ── Paste handler (Ctrl+V / Cmd+V with files) ──

  const handlePaste = async (e: ClipboardEvent) => {
    if (!canUpload()) return
    const items = e.clipboardData?.files
    if (!items || items.length === 0) return

    e.preventDefault()
    for (const file of Array.from(items)) {
      await uploadBlobFile(file)
    }
  }

  // Upload a File/Blob by saving to temp then uploading
  const uploadBlobFile = async (file: File) => {
    const fileName = file.name || "pasted-file"
    setUploading(true)
    setUploadLabel(fileName)
    setUploadError("")
    try {
      const buffer = await file.arrayBuffer()
      const bytes = Array.from(new Uint8Array(buffer))
      const tempResult = await commands.saveTempFile(fileName, bytes)
      if (tempResult.status === "error") {
        setUploadError(tempResult.error || "Failed to save temp file")
        setUploading(false)
        setUploadLabel("")
        return
      }
      await uploadSingleFile(tempResult.data)
    } catch {
      setUploadError("Upload failed")
      setUploading(false)
      setUploadLabel("")
    }
  }

  // ── Mention autocomplete ──

  const detectMentionTrigger = (value: string) => {
    if (!textareaRef) {
      setMentionQuery(null)
      return
    }

    const cursorPos = textareaRef.selectionStart
    const textBefore = value.slice(0, cursorPos)

    // Find @ or # preceded by whitespace/newline/start-of-string
    const atMatch = textBefore.match(/(?:^|[\s(])@([^\s]*)$/)
    const hashMatch = textBefore.match(/(?:^|[\s(])#([^\s]*)$/)

    if (atMatch) {
      setMentionType("user")
      setMentionQuery(atMatch[1])
      mentionTriggerIndex = cursorPos - atMatch[1].length - 1
    } else if (hashMatch) {
      setMentionType("stream")
      setMentionQuery(hashMatch[1])
      mentionTriggerIndex = cursorPos - hashMatch[1].length - 1
    } else {
      setMentionQuery(null)
      mentionTriggerIndex = -1
    }
  }

  const handleMentionSelect = (mentionText: string) => {
    if (mentionTriggerIndex < 0) return

    const current = content()
    const cursorPos = textareaRef?.selectionStart ?? current.length

    // Replace from the trigger character (@/#) through the current query
    const before = current.slice(0, mentionTriggerIndex)
    const after = current.slice(cursorPos)
    const newText = before + mentionText + after

    setContent(newText)
    sync.saveDraft(props.narrow, newText)
    setMentionQuery(null)
    mentionTriggerIndex = -1

    requestAnimationFrame(() => {
      const pos = before.length + mentionText.length
      textareaRef?.focus()
      textareaRef?.setSelectionRange(pos, pos)
    })
  }

  // ── Input handling ──

  const handleInput = (value: string) => {
    setContent(value)
    setError("")
    detectMentionTrigger(value)
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
    // If mention autocomplete is open, delegate keyboard events to it
    if (mentionQuery() !== null) {
      const handler = (window as any).__mentionAutocompleteKeyDown as ((e: KeyboardEvent) => void) | undefined
      if (handler && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Tab" || e.key === "Enter")) {
        handler(e)
        return
      }
      if (e.key === "Escape") {
        setMentionQuery(null)
        mentionTriggerIndex = -1
        e.preventDefault()
        return
      }
    }

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
    const currentUserId = sync.store.currentUserId
    const names = users
      .filter(uid => uid !== currentUserId)
      .map(uid => sync.store.users.find(u => u.user_id === uid)?.full_name)
      .filter(Boolean)
    if (names.length === 0) return null
    if (names.length === 1) return `${names[0]} is typing...`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
    return `${names[0]} and ${names.length - 1} others are typing...`
  }

  onMount(() => {
    if (!platform.onWindowDragDrop) {
      return
    }

    let dispose: (() => void) | undefined

    void platform.onWindowDragDrop(async (event) => {
      if (!canUpload()) return

      if (event.type === "leave") {
        setDragOver(false)
        return
      }

      if (!isInsideCompose(event.position.x, event.position.y)) {
        if (event.type !== "drop") {
          setDragOver(false)
        }
        return
      }

      if (event.type === "enter" || event.type === "over") {
        setDragOver(true)
        return
      }

      if (event.type === "drop" && event.paths.length > 0) {
        setDragOver(false)
        await uploadFilePaths(event.paths)
      }
    }).then((unlisten) => {
      nativeDropRegistered = true
      dispose = unlisten
    }).catch(() => {
      nativeDropRegistered = false
    })

    onCleanup(() => {
      nativeDropRegistered = false
      dispose?.()
    })
  })

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
        ref={composeRef!}
        class="relative rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-input)] transition-shadow"
        classList={{
          "ring-2 ring-[var(--interactive-primary)]": dragOver(),
          "focus-within:border-[var(--interactive-primary)]": true,
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Mention autocomplete */}
        <Show when={mentionQuery() !== null}>
          <MentionAutocomplete
            query={mentionQuery()!}
            type={mentionType()}
            onSelect={handleMentionSelect}
            onClose={() => { setMentionQuery(null); mentionTriggerIndex = -1 }}
          />
        </Show>

        {/* Topic picker for stream-root narrows */}
        <Show when={parsed()?.type === "stream" && parsed()?.streamId}>
          <div class="px-3 pt-2">
            <TopicPicker
              streamId={parsed()!.streamId!}
              value={topic()}
              onChange={setTopic}
              onSubmit={() => textareaRef?.focus()}
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
          onPaste={handlePaste}
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

        <Show when={uploading()}>
          <div
            class="flex items-center gap-2 px-3 py-2 border-t border-[var(--border-default)] bg-[var(--interactive-primary)]/5 text-[var(--interactive-primary)]"
            role="status"
            aria-live="polite"
          >
            <span class="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
            <span class="text-xs font-medium truncate">
              Uploading {uploadLabel()}...
            </span>
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
          </div>

          {/* Right side — send hint + options menu + send button */}
          <div class="flex items-center gap-1.5">
            {/* Keyboard shortcut hint with key badges */}
            <span class="hidden sm:flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)]">
              <Show when={!settings.enterSends}>
                <kbd class="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-tertiary)] shadow-[0_1px_0_rgba(0,0,0,0.05)]">{modKey()}</kbd>
              </Show>
              <kbd class="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-tertiary)] shadow-[0_1px_0_rgba(0,0,0,0.05)]">{"↵"}</kbd>
            </span>

            {/* Three-dot options menu */}
            <div class="relative">
              <button
                class="p-1 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowOptionsMenu(v => !v)
                }}
                title="Send options"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="3" cy="7" r="1.2" fill="currentColor" />
                  <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                  <circle cx="11" cy="7" r="1.2" fill="currentColor" />
                </svg>
              </button>
              <Show when={showOptionsMenu()}>
                <div
                  class="absolute bottom-full right-0 mb-2 z-50 w-[290px] bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg p-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Option: Enter to send */}
                  <button
                    class="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--background-elevated)] transition-colors text-left"
                    onClick={() => { setSetting("enterSends", true); setShowOptionsMenu(false) }}
                  >
                    <div class="mt-0.5 shrink-0">
                      <div
                        class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                        classList={{
                          "border-[var(--interactive-primary)]": settings.enterSends,
                          "border-[var(--text-tertiary)]": !settings.enterSends,
                        }}
                      >
                        <Show when={settings.enterSends}>
                          <div class="w-1.5 h-1.5 rounded-full bg-[var(--interactive-primary)]" />
                        </Show>
                      </div>
                    </div>
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <span class="text-xs text-[var(--text-primary)] flex items-center gap-1">
                        Press
                        <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-secondary)] shadow-[0_1px_0_rgba(0,0,0,0.07)]">Return</kbd>
                        to send
                      </span>
                      <span class="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
                        <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-secondary)] shadow-[0_1px_0_rgba(0,0,0,0.07)]">{modKey()}</kbd>
                        <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-secondary)] shadow-[0_1px_0_rgba(0,0,0,0.07)]">Return</kbd>
                        to add a new line
                      </span>
                    </div>
                  </button>

                  {/* Option: Cmd/Ctrl+Enter to send */}
                  <button
                    class="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--background-elevated)] transition-colors text-left"
                    onClick={() => { setSetting("enterSends", false); setShowOptionsMenu(false) }}
                  >
                    <div class="mt-0.5 shrink-0">
                      <div
                        class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                        classList={{
                          "border-[var(--interactive-primary)]": !settings.enterSends,
                          "border-[var(--text-tertiary)]": settings.enterSends,
                        }}
                      >
                        <Show when={!settings.enterSends}>
                          <div class="w-1.5 h-1.5 rounded-full bg-[var(--interactive-primary)]" />
                        </Show>
                      </div>
                    </div>
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <span class="text-xs text-[var(--text-primary)] flex items-center gap-1">
                        Press
                        <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-secondary)] shadow-[0_1px_0_rgba(0,0,0,0.07)]">{modKey()}</kbd>
                        <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-secondary)] shadow-[0_1px_0_rgba(0,0,0,0.07)]">Return</kbd>
                        to send
                      </span>
                      <span class="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
                        <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-medium bg-[var(--background-elevated)] border border-[var(--border-strong)] rounded text-[var(--text-secondary)] shadow-[0_1px_0_rgba(0,0,0,0.07)]">Return</kbd>
                        to add a new line
                      </span>
                    </div>
                  </button>
                </div>
              </Show>
            </div>

            <button
              class="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => void handleSend()}
              disabled={sending() || !content().trim()}
              title={settings.enterSends ? "Send (Enter)" : `Send (${modKey()}+Enter)`}
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
