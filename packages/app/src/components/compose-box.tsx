import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { commands, type SavedSnippet } from "@foundry/desktop/bindings"
import { useNavigation } from "../context/navigation"
import { useOrg } from "../context/org"
import { useZulipSync } from "../context/zulip-sync"
import { useSettings } from "../context/settings"
import { usePlatform } from "../context/platform"
import { TopicPicker } from "./topic-picker"
import { FormatToolbar } from "./format-toolbar"
import { EmojiPicker } from "./emoji-picker"
import { MentionAutocomplete } from "./mention-autocomplete"
import {
  CALL_PROVIDER,
  buildBlockInsert,
  buildCallMessage,
  buildGlobalTimeMessage,
  buildInlineInsert,
  buildPollMessage,
  buildTodoMessage,
  chooseGifProvider,
  createCurrentHourDate,
  formatDateTimeLocalValue,
  getGifDisabledReason,
  getSavedSnippetDisabledReason,
  getVideoCallDisabledReason,
  getVideoCallProviderName,
  getVoiceCallDisabledReason,
  searchGifs,
  type GifSearchResult,
  type TodoTaskDraft,
} from "./compose-actions"
import {
  appendUploadMarkdown,
  buildUploadTooLargeMessage,
  bytesFromMebibytes,
  captureTextareaSelection,
  restoreTextareaSelection,
} from "./upload-utils"

type ComposeDialog =
  | "poll"
  | "todo"
  | "time"
  | "save-snippet"
  | "edit-snippet"

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
  const [showGifPicker, setShowGifPicker] = createSignal(false)
  const [showSavedSnippets, setShowSavedSnippets] = createSignal(false)
  const [activeDialog, setActiveDialog] = createSignal<ComposeDialog | null>(null)
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionType, setMentionType] = createSignal<"user" | "stream">("user")
  const [dialogError, setDialogError] = createSignal("")
  const [creatingCall, setCreatingCall] = createSignal<"video" | "voice" | null>(null)
  const [savedSnippets, setSavedSnippets] = createSignal<SavedSnippet[]>([])
  const [savedSnippetsLoading, setSavedSnippetsLoading] = createSignal(false)
  const [savedSnippetError, setSavedSnippetError] = createSignal("")
  const [savedSnippetQuery, setSavedSnippetQuery] = createSignal("")
  const [snippetTitle, setSnippetTitle] = createSignal("")
  const [snippetContent, setSnippetContent] = createSignal("")
  const [snippetMutationError, setSnippetMutationError] = createSignal("")
  const [snippetSaving, setSnippetSaving] = createSignal(false)
  const [editingSnippetId, setEditingSnippetId] = createSignal<number | null>(null)
  const [gifQuery, setGifQuery] = createSignal("")
  const [gifResults, setGifResults] = createSignal<GifSearchResult[]>([])
  const [gifLoading, setGifLoading] = createSignal(false)
  const [gifError, setGifError] = createSignal("")
  const [globalTimeValue, setGlobalTimeValue] = createSignal(formatDateTimeLocalValue(createCurrentHourDate()))
  const [pollQuestion, setPollQuestion] = createSignal("")
  const [pollOptions, setPollOptions] = createSignal<string[]>(["", "", ""])
  const [todoTitle, setTodoTitle] = createSignal("Task list")
  const [todoTasks, setTodoTasks] = createSignal<TodoTaskDraft[]>([
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
  ])
  let mentionTriggerIndex = -1

  let textareaRef!: HTMLTextAreaElement
  let composeRef!: HTMLDivElement
  let typingTimer: ReturnType<typeof setTimeout> | undefined
  let lastTypingSent = 0
  let nativeDropRegistered = false
  let latestGifRequest = 0

  const modKey = () => platform.os === "macos" ? "⌘" : "Ctrl"

  const caps = () => capabilities()
  const canUpload = () => caps()?.uploads !== false
  const canType = () => caps()?.typing_notifications !== false && settings.sendTyping
  const uploadLimitBytes = () => bytesFromMebibytes(org.maxFileUploadSizeMib)

  // Load draft
  createEffect(() => {
    const draft = sync.store.drafts[props.narrow]
    setContent(draft || "")
    setError("")
    setUploadError("")
  })

  createEffect(on(
    () => props.narrow,
    () => {
      const current = nav.parseNarrow(props.narrow)
      if (current?.type === "topic") {
        setTopic(current.topic || "")
        return
      }

      setTopic("")
    },
  ))

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
    setShowGifPicker(false)
    setShowSavedSnippets(false)
  }
  createEffect(() => {
    if (showEmojiPicker() || showOptionsMenu() || showGifPicker() || showSavedSnippets()) {
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

  const jitsiServerUrl = () => org.realmJitsiServerUrl || org.serverJitsiServerUrl

  const videoCallDisabledReason = createMemo(() =>
    getVideoCallDisabledReason(org.videoChatProvider, jitsiServerUrl())
  )

  const voiceCallDisabledReason = createMemo(() =>
    getVoiceCallDisabledReason(org.videoChatProvider, jitsiServerUrl())
  )

  const savedSnippetDisabledReason = createMemo(() =>
    getSavedSnippetDisabledReason(org.zulipFeatureLevel)
  )

  const gifSearchConfig = () => ({
    giphyApiKey: org.giphyApiKey,
    tenorApiKey: org.tenorApiKey,
    gifRatingPolicy: org.gifRatingPolicy,
    locale: navigator.language || "en",
  })

  const gifDisabledReason = createMemo(() =>
    getGifDisabledReason(gifSearchConfig())
  )

  const filteredSavedSnippets = createMemo(() => {
    const query = savedSnippetQuery().trim().toLowerCase()
    if (!query) {
      return savedSnippets()
    }

    return savedSnippets().filter((snippet) =>
      snippet.title.toLowerCase().includes(query)
      || snippet.content.toLowerCase().includes(query)
    )
  })

  const currentConversationLabel = () => {
    const current = parsed()
    if (!current) {
      return "Conversation"
    }

    if (current.type === "topic" || current.type === "stream") {
      const stream = sync.store.subscriptions.find((subscription) => subscription.stream_id === current.streamId)
      const streamLabel = `#${stream?.name || current.streamId}`
      const topicLabel = current.type === "topic"
        ? current.topic
        : topic().trim()
      return topicLabel ? `${streamLabel} > ${topicLabel}` : streamLabel
    }

    if (current.type === "dm") {
      const names = (current.userIds || [])
        .map((userId) => sync.store.users.find((user) => user.user_id === userId)?.full_name)
        .filter((value): value is string => Boolean(value))
      return names.length > 0 ? names.join(", ") : "Direct message"
    }

    return "Conversation"
  }

  const closeDialog = () => {
    setActiveDialog(null)
    setDialogError("")
    setSnippetMutationError("")
  }

  const persistDraft = (nextValue: string) => {
    setContent(nextValue)
    if (nextValue.trim()) {
      sync.saveDraft(props.narrow, nextValue)
      return
    }

    sync.clearDraft(props.narrow)
  }

  const applyInsertion = (
    nextValue: string,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    persistDraft(nextValue)
    requestAnimationFrame(() => {
      textareaRef?.focus()
      textareaRef?.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  const insertInlineContent = (insertion: string) => {
    const current = content()
    const selectionStart = textareaRef?.selectionStart ?? current.length
    const selectionEnd = textareaRef?.selectionEnd ?? current.length
    const next = buildInlineInsert(current, selectionStart, selectionEnd, insertion)
    applyInsertion(next.value, next.selectionStart, next.selectionEnd)
  }

  const insertBlockContent = (insertion: string) => {
    const current = content()
    const selectionStart = textareaRef?.selectionStart ?? current.length
    const selectionEnd = textareaRef?.selectionEnd ?? current.length
    const next = buildBlockInsert(current, selectionStart, selectionEnd, insertion)
    applyInsertion(next.value, next.selectionStart, next.selectionEnd)
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
    if (!(await validateUploadSize(filePath))) {
      return
    }
    setUploading(true)
    setUploadLabel(fileName)
    setUploadError("")
    try {
      const result = await commands.uploadFile(org.orgId, filePath)
      if (result.status === "ok") {
        const markdown = `[${fileName}](${result.data.url})`
        const current = content()
        const preservedSelection = captureTextareaSelection(textareaRef)
        const nextContent = appendUploadMarkdown(current, markdown)
        setContent(nextContent)
        sync.saveDraft(props.narrow, nextContent)
        requestAnimationFrame(() => restoreTextareaSelection(textareaRef, preservedSelection))
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
    if (!validateUploadSizeBytes(file.size)) {
      return
    }
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

  const validateUploadSizeBytes = (sizeBytes: number): boolean => {
    const limitBytes = uploadLimitBytes()
    if (!limitBytes || sizeBytes <= limitBytes) {
      return true
    }

    setUploadError(buildUploadTooLargeMessage(limitBytes))
    return false
  }

  const validateUploadSize = async (filePath: string): Promise<boolean> => {
    const limitBytes = uploadLimitBytes()
    if (!limitBytes) {
      return true
    }

    try {
      const result = await commands.getFileSizeBytes(filePath)
      if (result.status === "error") {
        return true
      }

      return validateUploadSizeBytes(result.data)
    } catch {
      return true
    }
  }

  const loadSavedSnippets = async () => {
    if (savedSnippetDisabledReason()) {
      return
    }

    setSavedSnippetsLoading(true)
    setSavedSnippetError("")
    try {
      const result = await commands.getSavedSnippets(org.orgId)
      if (result.status === "error") {
        setSavedSnippetError(result.error || "Failed to load saved snippets")
        return
      }

      const ordered = [...result.data].sort((left, right) => right.date_created - left.date_created)
      setSavedSnippets(ordered)
    } catch (error: any) {
      setSavedSnippetError(error?.message || error?.toString() || "Failed to load saved snippets")
    } finally {
      setSavedSnippetsLoading(false)
    }
  }

  const openSavedSnippetDialog = (mode: "save-snippet" | "edit-snippet", snippet?: SavedSnippet) => {
    setSnippetMutationError("")
    setDialogError("")
    setEditingSnippetId(snippet?.id ?? null)
    setSnippetTitle(snippet?.title ?? "")
    setSnippetContent(snippet?.content ?? content())
    setActiveDialog(mode)
    setShowSavedSnippets(false)
  }

  const submitSavedSnippet = async () => {
    const title = snippetTitle().trim()
    const body = snippetContent().trim()
    if (!title || !body) {
      setSnippetMutationError("Saved snippets need both a title and content.")
      return
    }

    setSnippetSaving(true)
    setSnippetMutationError("")
    try {
      if (editingSnippetId() != null) {
        const result = await commands.updateSavedSnippet(
          org.orgId,
          editingSnippetId()!,
          title,
          body,
        )
        if (result.status === "error") {
          setSnippetMutationError(result.error || "Failed to update saved snippet")
          return
        }
      } else {
        const result = await commands.createSavedSnippet(org.orgId, title, body)
        if (result.status === "error") {
          setSnippetMutationError(result.error || "Failed to create saved snippet")
          return
        }
      }

      closeDialog()
      await loadSavedSnippets()
    } catch (error: any) {
      setSnippetMutationError(error?.message || error?.toString() || "Failed to save snippet")
    } finally {
      setSnippetSaving(false)
    }
  }

  const handleDeleteSavedSnippet = async (snippet: SavedSnippet) => {
    if (!window.confirm(`Delete "${snippet.title}"?`)) {
      return
    }

    setSavedSnippetError("")
    try {
      const result = await commands.deleteSavedSnippet(org.orgId, snippet.id)
      if (result.status === "error") {
        setSavedSnippetError(result.error || "Failed to delete saved snippet")
        return
      }
      await loadSavedSnippets()
    } catch (error: any) {
      setSavedSnippetError(error?.message || error?.toString() || "Failed to delete saved snippet")
    }
  }

  const loadGifResults = async (query: string) => {
    if (gifDisabledReason()) {
      setGifResults([])
      return
    }

    const requestId = ++latestGifRequest
    setGifLoading(true)
    setGifError("")
    try {
      const results = await searchGifs(gifSearchConfig(), query)
      if (requestId !== latestGifRequest) {
        return
      }
      setGifResults(results)
    } catch (error: any) {
      if (requestId !== latestGifRequest) {
        return
      }
      setGifError(error?.message || error?.toString() || "Failed to load GIFs")
      setGifResults([])
    } finally {
      if (requestId === latestGifRequest) {
        setGifLoading(false)
      }
    }
  }

  createEffect(on(
    () => [showGifPicker(), gifQuery()] as const,
    ([open, query]) => {
      if (!open) {
        return
      }

      const timeout = setTimeout(() => {
        void loadGifResults(query)
      }, 250)

      onCleanup(() => clearTimeout(timeout))
    },
  ))

  const handleCreateCall = async (isAudioCall: boolean) => {
    const disabledReason = isAudioCall ? voiceCallDisabledReason() : videoCallDisabledReason()
    if (disabledReason) {
      setError(disabledReason)
      return
    }

    setCreatingCall(isAudioCall ? "voice" : "video")
    setError("")
    try {
      const result = await commands.createCallLink(org.orgId, {
        provider_id: org.videoChatProvider ?? CALL_PROVIDER.DISABLED,
        base_jitsi_url: jitsiServerUrl() || null,
        label: currentConversationLabel(),
        is_audio_call: isAudioCall,
      })

      if (result.status === "error") {
        const providerName = getVideoCallProviderName(org.videoChatProvider)
        const extraHint = providerName === "Zoom" && /zoom/i.test(result.error || "")
          ? " Finish the Zoom setup in your browser if prompted, then try again."
          : ""
        setError((result.error || "Failed to create call link") + extraHint)
        return
      }

      insertBlockContent(buildCallMessage(result.data.url, isAudioCall))
    } catch (error: any) {
      setError(error?.message || error?.toString() || "Failed to create call link")
    } finally {
      setCreatingCall(null)
    }
  }

  const openPollDialog = () => {
    setDialogError("")
    setPollQuestion("")
    setPollOptions(["", "", ""])
    setActiveDialog("poll")
  }

  const updatePollOption = (index: number, value: string) => {
    setPollOptions((current) => current.map((option, optionIndex) => optionIndex === index ? value : option))
  }

  const addPollOption = () => {
    setPollOptions((current) => [...current, ""])
  }

  const removePollOption = (index: number) => {
    setPollOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))
  }

  const submitPollDialog = () => {
    const question = pollQuestion().trim()
    const options = pollOptions().map((option) => option.trim()).filter(Boolean)
    if (!question) {
      setDialogError("Please enter a poll question.")
      return
    }
    if (options.length < 2) {
      setDialogError("Please add at least two poll options.")
      return
    }

    insertBlockContent(buildPollMessage(question, options))
    closeDialog()
  }

  const openTodoDialog = () => {
    setDialogError("")
    setTodoTitle("Task list")
    setTodoTasks([
      { name: "", description: "" },
      { name: "", description: "" },
      { name: "", description: "" },
    ])
    setActiveDialog("todo")
  }

  const updateTodoTask = (index: number, field: keyof TodoTaskDraft, value: string) => {
    setTodoTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, [field]: value } : task
      )
    )
  }

  const addTodoTask = () => {
    setTodoTasks((current) => [...current, { name: "", description: "" }])
  }

  const removeTodoTask = (index: number) => {
    setTodoTasks((current) => current.filter((_, taskIndex) => taskIndex !== index))
  }

  const submitTodoDialog = () => {
    const normalizedTasks = todoTasks()
      .map(({ name, description }) => ({ name: name.trim(), description: description.trim() }))
      .filter(({ name, description }) => name || description)

    if (normalizedTasks.some(({ name, description }) => !name && description)) {
      setDialogError("Please enter a task title before adding a description.")
      return
    }

    if (normalizedTasks.filter(({ name }) => name).length === 0) {
      setDialogError("Please add at least one task.")
      return
    }

    insertBlockContent(buildTodoMessage(todoTitle(), normalizedTasks))
    closeDialog()
  }

  const openTimeDialog = () => {
    setDialogError("")
    setGlobalTimeValue(formatDateTimeLocalValue(createCurrentHourDate()))
    setActiveDialog("time")
  }

  const submitTimeDialog = () => {
    if (!globalTimeValue()) {
      setDialogError("Please choose a date and time.")
      return
    }

    const selected = new Date(globalTimeValue())
    if (Number.isNaN(selected.valueOf())) {
      setDialogError("Please choose a valid date and time.")
      return
    }

    insertInlineContent(buildGlobalTimeMessage(selected.toISOString()))
    closeDialog()
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

    const currentNarrow = parsed()
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

      if (currentNarrow?.type === "stream" && currentNarrow.streamId && topic().trim()) {
        const streamId = currentNarrow.streamId
        const nextTopic = topic().trim()
        sync.upsertStreamTopic(streamId, nextTopic, result.data.id)
        sync.invalidateStreamTopics(streamId)
        sync.markNarrowHydrated(`stream:${streamId}`, false)
        setTopic("")
        nav.setActiveNarrow(`stream:${streamId}/topic:${nextTopic}`)
        void sync.ensureStreamTopics(streamId, { force: true })
      } else if (currentNarrow?.type === "topic" && currentNarrow.streamId) {
        sync.upsertStreamTopic(currentNarrow.streamId, currentNarrow.topic || "", result.data.id)
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
    persistDraft(newText)
  }

  // ── Emoji insert handler ──
  const handleEmojiSelect = (emojiName: string, _emojiCode: string) => {
    insertInlineContent(`:${emojiName}: `)
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
        <div class="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mb-1" aria-live="polite">
          <span class="inline-flex items-center gap-[3px]">
            <span class="w-[5px] h-[5px] rounded-full bg-[var(--text-tertiary)] animate-[typing-dot_1.4s_ease-in-out_infinite]" style={{ "animation-delay": "0ms" }} />
            <span class="w-[5px] h-[5px] rounded-full bg-[var(--text-tertiary)] animate-[typing-dot_1.4s_ease-in-out_infinite]" style={{ "animation-delay": "200ms" }} />
            <span class="w-[5px] h-[5px] rounded-full bg-[var(--text-tertiary)] animate-[typing-dot_1.4s_ease-in-out_infinite]" style={{ "animation-delay": "400ms" }} />
          </span>
          <span>{typingDisplay()}</span>
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
            allowSpecialMentions={parsed()?.type === "stream" || parsed()?.type === "topic"}
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
          class="w-full px-3 py-2.5 bg-transparent text-[var(--text-primary)] resize-none focus:outline-none"
          style={{ "font-size": "var(--font-size-base, 15px)", "min-height": "42px", "max-height": "180px" }}
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
          <div class="flex items-center gap-0.5 flex-wrap">
            <Show when={canUpload()}>
              <ComposeActionButton
                title={uploading() ? `Uploading ${uploadLabel()}...` : "Attach file"}
                onClick={handleFileUpload}
                disabled={uploading()}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </ComposeActionButton>
            </Show>

            <ComposeActionButton
              title={videoCallDisabledReason() || "Add video call"}
              onClick={() => void handleCreateCall(false)}
              disabled={Boolean(videoCallDisabledReason()) || creatingCall() !== null}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="4" width="7.5" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2" />
                <path d="M10.5 6.25l3-1.75v7l-3-1.75v-3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
            </ComposeActionButton>

            <ComposeActionButton
              title={voiceCallDisabledReason() || "Add voice call"}
              onClick={() => void handleCreateCall(true)}
              disabled={Boolean(voiceCallDisabledReason()) || creatingCall() !== null}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 8 9a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 8 3Z" stroke="currentColor" stroke-width="1.2" />
                <path d="M5 7.5a3 3 0 0 0 6 0M8 10.5v2M6 12.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
              </svg>
            </ComposeActionButton>

            <div class="relative">
              <ComposeActionButton
                title="Emoji"
                onClick={() => {
                  setShowGifPicker(false)
                  setShowSavedSnippets(false)
                  setShowOptionsMenu(false)
                  setShowEmojiPicker((value) => !value)
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2" />
                  <circle cx="6" cy="7" r="0.8" fill="currentColor" />
                  <circle cx="10" cy="7" r="0.8" fill="currentColor" />
                  <path d="M5.5 10a3 3 0 005 0" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                </svg>
              </ComposeActionButton>
              <Show when={showEmojiPicker()}>
                <div class="absolute bottom-full left-0 mb-2 z-50" onClick={(event) => event.stopPropagation()}>
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                </div>
              </Show>
            </div>

            <div class="relative">
              <ComposeActionButton
                title={gifDisabledReason() || "Add GIF"}
                onClick={() => {
                  setShowEmojiPicker(false)
                  setShowSavedSnippets(false)
                  setShowOptionsMenu(false)
                  setShowGifPicker((value) => !value)
                  if (!showGifPicker()) {
                    setGifQuery("")
                    setGifError("")
                  }
                }}
                disabled={Boolean(gifDisabledReason())}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2" />
                  <path d="M5 6h1.2v1.2H5V6Zm0 2.1h2.2v1.2H5V8.1Zm3.4-2.1h2.6v1.2h-1.4v2.1h-1.2V6Zm4.1 0h-1.2v3.3h1.2V6Z" fill="currentColor" />
                </svg>
              </ComposeActionButton>
              <Show when={showGifPicker()}>
                <div
                  class="absolute bottom-full left-0 mb-2 z-50 w-[360px] rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--background-surface)] p-3 shadow-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div class="flex items-center justify-between gap-3">
                    <input
                      class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                      placeholder={chooseGifProvider(gifSearchConfig()) === "tenor" ? "Search Tenor" : "Search Giphy"}
                      value={gifQuery()}
                      onInput={(event) => setGifQuery(event.currentTarget.value)}
                    />
                    <span class="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                      {chooseGifProvider(gifSearchConfig()) === "tenor" ? "Tenor" : "Giphy"}
                    </span>
                  </div>
                  <Show when={gifError()}>
                    <p class="mt-2 text-xs text-[var(--status-error)]">{gifError()}</p>
                  </Show>
                  <Show when={gifLoading()}>
                    <p class="mt-2 text-xs text-[var(--text-tertiary)]">Loading GIFs...</p>
                  </Show>
                  <div class="mt-3 grid max-h-[260px] grid-cols-2 gap-2 overflow-y-auto">
                    <For each={gifResults()}>
                      {(result) => (
                        <button
                          type="button"
                          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-elevated)]"
                          onClick={() => {
                            insertBlockContent(`[](${result.insertUrl})`)
                            setShowGifPicker(false)
                          }}
                          title="Insert GIF"
                        >
                          <img class="h-[120px] w-full object-cover" src={result.previewUrl} alt="GIF preview" />
                        </button>
                      )}
                    </For>
                  </div>
                  <Show when={!gifLoading() && gifResults().length === 0 && !gifError()}>
                    <p class="mt-3 text-xs text-[var(--text-tertiary)]">No GIFs matched that search.</p>
                  </Show>
                </div>
              </Show>
            </div>

            <div class="relative">
              <ComposeActionButton
                title={savedSnippetDisabledReason() || "Add saved snippet"}
                onClick={() => {
                  setShowEmojiPicker(false)
                  setShowGifPicker(false)
                  setShowOptionsMenu(false)
                  setShowSavedSnippets((value) => !value)
                  if (!showSavedSnippets() && savedSnippets().length === 0) {
                    void loadSavedSnippets()
                  }
                }}
                disabled={Boolean(savedSnippetDisabledReason())}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" />
                  <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
              </ComposeActionButton>
              <Show when={showSavedSnippets()}>
                <div
                  class="absolute bottom-full left-0 mb-2 z-50 w-[340px] rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--background-surface)] p-3 shadow-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div class="flex items-center gap-2">
                    <input
                      class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                      placeholder="Filter saved snippets"
                      value={savedSnippetQuery()}
                      onInput={(event) => setSavedSnippetQuery(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
                      onClick={() => openSavedSnippetDialog("save-snippet")}
                    >
                      New
                    </button>
                  </div>
                  <Show when={savedSnippetError()}>
                    <p class="mt-2 text-xs text-[var(--status-error)]">{savedSnippetError()}</p>
                  </Show>
                  <Show when={savedSnippetsLoading()}>
                    <p class="mt-2 text-xs text-[var(--text-tertiary)]">Loading saved snippets...</p>
                  </Show>
                  <div class="mt-3 flex max-h-[280px] flex-col gap-2 overflow-y-auto">
                    <For each={filteredSavedSnippets()}>
                      {(snippet) => (
                        <div class="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-elevated)] p-2">
                          <button
                            type="button"
                            class="w-full text-left"
                            onClick={() => {
                              insertBlockContent(snippet.content)
                              setShowSavedSnippets(false)
                            }}
                          >
                            <div class="text-sm font-medium text-[var(--text-primary)]">{snippet.title}</div>
                            <p class="mt-1 max-h-[2.8rem] overflow-hidden text-xs text-[var(--text-secondary)]">{snippet.content}</p>
                          </button>
                          <div class="mt-2 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              class="text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              onClick={(event) => {
                                event.stopPropagation()
                                openSavedSnippetDialog("edit-snippet", snippet)
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              class="text-[11px] font-medium text-[var(--status-error)]"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleDeleteSavedSnippet(snippet)
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={!savedSnippetsLoading() && filteredSavedSnippets().length === 0 && !savedSnippetError()}>
                    <p class="mt-3 text-xs text-[var(--text-tertiary)]">No saved snippets yet.</p>
                  </Show>
                </div>
              </Show>
            </div>

            <ComposeActionButton title="Add global time" onClick={openTimeDialog}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.2" />
                <path d="M8 5v3l2 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </ComposeActionButton>

            <ComposeActionButton title="Add poll" onClick={openPollDialog}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 12V8.5M8 12V5M12.5 12V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </ComposeActionButton>

            <ComposeActionButton title="Add to-do list" onClick={openTodoDialog}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 4.5h1.4l.8.9L6.6 4M7.5 4.8H13M3 8h1.4l.8.9L6.6 7.5M7.5 8.3H13M3 11.5h1.4l.8.9 1.4-1.4M7.5 11.8H13" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </ComposeActionButton>

            <ComposeActionButton
              title="Formatting"
              onClick={() => setShowFormatBar((value) => !value)}
              active={showFormatBar()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <text x="1" y="12" font-size="11" fill="currentColor" font-family="system-ui, sans-serif" font-weight="600">Aa</text>
              </svg>
            </ComposeActionButton>
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

      <Show when={activeDialog() === "time"}>
        <ComposeDialogFrame
          title="Add global time"
          onClose={closeDialog}
          footer={
            <>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] px-3 py-2 text-sm font-medium text-[var(--interactive-primary-text)]"
                onClick={submitTimeDialog}
              >
                Insert time
              </button>
            </>
          }
        >
          <div class="space-y-3">
            <p class="text-sm text-[var(--text-secondary)]">
              Insert a timezone-aware timestamp that Foundry will localize for each reader.
            </p>
            <input
              type="datetime-local"
              class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
              value={globalTimeValue()}
              onInput={(event) => setGlobalTimeValue(event.currentTarget.value)}
            />
            <Show when={dialogError()}>
              <p class="text-xs text-[var(--status-error)]">{dialogError()}</p>
            </Show>
          </div>
        </ComposeDialogFrame>
      </Show>

      <Show when={activeDialog() === "poll"}>
        <ComposeDialogFrame
          title="Create a poll"
          onClose={closeDialog}
          footer={
            <>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] px-3 py-2 text-sm font-medium text-[var(--interactive-primary-text)]"
                onClick={submitPollDialog}
              >
                Add poll
              </button>
            </>
          }
        >
          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Question
              </label>
              <input
                class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                placeholder="Your question"
                value={pollQuestion()}
                onInput={(event) => setPollQuestion(event.currentTarget.value)}
              />
            </div>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  Options
                </label>
                <button
                  type="button"
                  class="text-xs font-medium text-[var(--interactive-primary)]"
                  onClick={addPollOption}
                >
                  Add option
                </button>
              </div>
              <For each={pollOptions()}>
                {(option, index) => (
                  <div class="flex items-center gap-2">
                    <input
                      class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                      placeholder={`Option ${index() + 1}`}
                      value={option}
                      onInput={(event) => updatePollOption(index(), event.currentTarget.value)}
                    />
                    <Show when={pollOptions().length > 2}>
                      <button
                        type="button"
                        class="text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        onClick={() => removePollOption(index())}
                      >
                        Remove
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={dialogError()}>
              <p class="text-xs text-[var(--status-error)]">{dialogError()}</p>
            </Show>
          </div>
        </ComposeDialogFrame>
      </Show>

      <Show when={activeDialog() === "todo"}>
        <ComposeDialogFrame
          title="Create a collaborative to-do list"
          onClose={closeDialog}
          footer={
            <>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] px-3 py-2 text-sm font-medium text-[var(--interactive-primary-text)]"
                onClick={submitTodoDialog}
              >
                Create to-do list
              </button>
            </>
          }
        >
          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Title
              </label>
              <input
                class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                placeholder="Task list"
                value={todoTitle()}
                onInput={(event) => setTodoTitle(event.currentTarget.value)}
              />
            </div>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  Tasks
                </label>
                <button
                  type="button"
                  class="text-xs font-medium text-[var(--interactive-primary)]"
                  onClick={addTodoTask}
                >
                  Add task
                </button>
              </div>
              <For each={todoTasks()}>
                {(task, index) => (
                  <div class="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-elevated)] p-3">
                    <div class="flex items-center justify-between gap-2">
                      <input
                        class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                        placeholder={`Task ${index() + 1}`}
                        value={task.name}
                        onInput={(event) => updateTodoTask(index(), "name", event.currentTarget.value)}
                      />
                      <Show when={todoTasks().length > 2}>
                        <button
                          type="button"
                          class="text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                          onClick={() => removeTodoTask(index())}
                        >
                          Remove
                        </button>
                      </Show>
                    </div>
                    <input
                      class="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                      placeholder="Task description (optional)"
                      value={task.description}
                      onInput={(event) => updateTodoTask(index(), "description", event.currentTarget.value)}
                    />
                  </div>
                )}
              </For>
            </div>
            <Show when={dialogError()}>
              <p class="text-xs text-[var(--status-error)]">{dialogError()}</p>
            </Show>
          </div>
        </ComposeDialogFrame>
      </Show>

      <Show when={activeDialog() === "save-snippet" || activeDialog() === "edit-snippet"}>
        <ComposeDialogFrame
          title={activeDialog() === "edit-snippet" ? "Edit saved snippet" : "Create a new saved snippet"}
          onClose={closeDialog}
          footer={
            <>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--background-elevated)]"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] bg-[var(--interactive-primary)] px-3 py-2 text-sm font-medium text-[var(--interactive-primary-text)] disabled:opacity-50"
                onClick={() => void submitSavedSnippet()}
                disabled={snippetSaving()}
              >
                {activeDialog() === "edit-snippet" ? "Save" : "Create snippet"}
              </button>
            </>
          }
        >
          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Title
              </label>
              <input
                class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                placeholder="Snippet title"
                value={snippetTitle()}
                onInput={(event) => setSnippetTitle(event.currentTarget.value)}
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Content
              </label>
              <textarea
                class="min-h-[180px] w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]"
                value={snippetContent()}
                onInput={(event) => setSnippetContent(event.currentTarget.value)}
              />
            </div>
            <Show when={snippetMutationError()}>
              <p class="text-xs text-[var(--status-error)]">{snippetMutationError()}</p>
            </Show>
          </div>
        </ComposeDialogFrame>
      </Show>
    </div>
  )
}

function ComposeActionButton(props: {
  title: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      classList={{
        "text-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10": props.active,
      }}
      onClick={(event) => {
        event.stopPropagation()
        props.onClick?.()
      }}
      disabled={props.disabled}
      title={props.title}
    >
      {props.children}
    </button>
  )
}

function ComposeDialogFrame(props: {
  title: string
  onClose: () => void
  children: JSX.Element
  footer: JSX.Element
}) {
  return (
    <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" onClick={props.onClose}>
      <div
        class="w-full max-w-lg rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--background-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h3 class="text-sm font-semibold text-[var(--text-primary)]">{props.title}</h3>
          <button
            type="button"
            class="rounded-[var(--radius-sm)] p-1 text-[var(--text-tertiary)] hover:bg-[var(--background-elevated)] hover:text-[var(--text-primary)]"
            onClick={props.onClose}
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="px-5 py-4">{props.children}</div>
        <div class="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-4">
          {props.footer}
        </div>
      </div>
    </div>
  )
}
