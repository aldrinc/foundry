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
  const { capabilities } = useSettings()
  const platform = usePlatform()

  const [text, setText] = createSignal("")
  const [showFormatBar, setShowFormatBar] = createSignal(false)
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [uploadError, setUploadError] = createSignal("")
  const [dragOver, setDragOver] = createSignal(false)

  let textareaRef!: HTMLTextAreaElement

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  createEffect(() => {
    const _ = text()
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + "px"
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
        class="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-input)] overflow-hidden transition-shadow"
        classList={{
          "ring-2 ring-[var(--interactive-primary)]": dragOver(),
          "focus-within:border-[var(--interactive-primary)]": true,
        }}
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

          {/* Right side — hint + send button */}
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-tertiary)]">Enter to send</span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={handleSend}
              disabled={supervisor.store.sendingMessage || !text().trim()}
              title="Send (Enter)"
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
