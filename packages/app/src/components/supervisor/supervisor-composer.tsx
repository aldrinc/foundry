import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { commands } from "@zulip/desktop/bindings"
import { useSupervisor } from "../../context/supervisor"
import { useOrg } from "../../context/org"
import { useSettings } from "../../context/settings"
import { usePlatform } from "../../context/platform"
import { FormatToolbar } from "../format-toolbar"
import { EmojiPicker } from "../emoji-picker"

export function SupervisorComposer() {
  const supervisor = useSupervisor()
  const org = useOrg()
  const { store: settings, setSetting, capabilities } = useSettings()
  const platform = usePlatform()

  const [text, setText] = createSignal("")
  const [showFormatBar, setShowFormatBar] = createSignal(false)
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [uploadError, setUploadError] = createSignal("")
  const [dragOver, setDragOver] = createSignal(false)
  const [showOptionsMenu, setShowOptionsMenu] = createSignal(false)

  let textareaRef!: HTMLTextAreaElement

  const modKey = () => platform.os === "macos" ? "⌘" : "Ctrl"

  const caps = () => capabilities()
  const canUpload = () => caps()?.uploads !== false

  const handleSend = async () => {
    const msg = text().trim()
    if (!msg || supervisor.store.sendingMessage) return
    setText("")
    if (textareaRef) {
      textareaRef.style.height = "auto"
    }
    await supervisor.sendMessage(msg)
    textareaRef?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (settings.enterSends) {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        handleSend()
      }
    } else {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSend()
      }
    }
  }

  // Auto-resize textarea
  createEffect(() => {
    const _ = text()
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + "px"
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
        const current = text()
        setText(current ? `${current}\n${markdown}` : markdown)
      } else {
        setUploadError(result.error || "Upload failed")
      }
    } catch {
      setUploadError("Upload failed")
    }
    setUploading(false)
  }

  // ── Drag-and-drop (counter pattern to avoid child-element flicker) ──

  let dragCounter = 0

  const handleDragEnter = (e: DragEvent) => {
    if (!canUpload()) return
    e.preventDefault()
    dragCounter++
    setDragOver(true)
  }

  const handleDragOver = (e: DragEvent) => {
    if (!canUpload()) return
    e.preventDefault()
  }

  const handleDragLeave = (e: DragEvent) => {
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

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
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
    setUploading(true)
    setUploadError("")
    try {
      const buffer = await file.arrayBuffer()
      const bytes = Array.from(new Uint8Array(buffer))
      const fileName = file.name || "pasted-file"
      const tempResult = await commands.saveTempFile(fileName, bytes)
      if (tempResult.status === "error") {
        setUploadError(tempResult.error || "Failed to save temp file")
        setUploading(false)
        return
      }
      await uploadSingleFile(tempResult.data)
    } catch {
      setUploadError("Upload failed")
      setUploading(false)
    }
  }

  // ── Format toolbar insert handler ──
  const handleFormatInsert = (newText: string, _cursorOffset?: number) => {
    setText(newText)
  }

  // ── Emoji insert handler ──
  const handleEmojiSelect = (emojiName: string, _emojiCode: string) => {
    const current = text()
    const insertion = `:${emojiName}: `
    if (textareaRef) {
      const start = textareaRef.selectionStart
      const end = textareaRef.selectionEnd
      const newText = current.slice(0, start) + insertion + current.slice(end)
      setText(newText)
      requestAnimationFrame(() => {
        const pos = start + insertion.length
        textareaRef.focus()
        textareaRef.setSelectionRange(pos, pos)
      })
    } else {
      setText(current + insertion)
    }
    setShowEmojiPicker(false)
  }

  return (
    <div
      class="bg-[var(--background-surface)] px-3 py-2"
      data-component="supervisor-composer"
    >
      {/* Errors above the container */}
      <Show when={uploadError()}>
        <p class="text-xs text-[var(--status-error)] mb-1">{uploadError()}</p>
      </Show>

      {/* Unified compose container */}
      <div
        class="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-input)] transition-shadow"
        classList={{
          "ring-2 ring-[var(--interactive-primary)]": dragOver(),
          "focus-within:border-[var(--interactive-primary)]": true,
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Textarea — borderless, transparent */}
        <textarea
          ref={textareaRef!}
          class="w-full px-3 py-2 bg-transparent text-[var(--text-primary)] text-sm resize-none focus:outline-none"
          style={{ "min-height": "36px", "max-height": "120px" }}
          placeholder="Message supervisor..."
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={supervisor.store.sendingMessage}
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
              onClick={handleSend}
              disabled={supervisor.store.sendingMessage || !text().trim()}
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
