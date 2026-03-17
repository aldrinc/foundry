import { Show, For, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { Message, Reaction } from "../context/zulip-sync"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { usePlatform } from "../context/platform"
import { useNavigation } from "../context/navigation"
import { commands } from "@foundry/desktop/bindings"
import { MessageActions } from "./message-actions"
import { parseMessageDeepLinkUrl } from "../message-permalinks"
import { publishDeepLinks } from "../zulip-auth"
import {
  getUserUploadDownloadUrl,
  hydrateMessageImageCarousels,
  hydrateAuthenticatedMessageImages,
  isMessageImageLink,
  openMessageImageViewerFromLink,
  resolveMessageUrl,
  resolveRealmUrlFromSavedServers,
  sanitizeMessageHtml,
} from "./message-html"
import { hydrateCodeBlocks } from "./code-block-enhancer"
import { hydrateFileAttachmentCards } from "./file-attachment-card"
import { LinkPreviewCard, extractFirstUrl } from "./link-preview-card"
import { parseZulipConversationLink, type ParsedZulipConversationLink } from "./zulip-link-utils"
import type { ReplyTarget } from "./message-reply"

/** Convert an emoji hex code to its Unicode character(s) */
export function emojiCodeToChar(code: string): string {
  try {
    // Handle multi-codepoint emoji (e.g., "1f1fa-1f1f8" for flags)
    const codePoints = code.split("-").map(cp => parseInt(cp, 16))
    return String.fromCodePoint(...codePoints)
  } catch {
    return `:${code}:`
  }
}

export function MessageItem(props: {
  message: Message
  showSender: boolean
  serverUrl?: string
  onReply?: (target: ReplyTarget) => void
}) {
  const org = useOrg()
  const sync = useZulipSync()
  const platform = usePlatform()
  const nav = useNavigation()
  const [editing, setEditing] = createSignal(false)
  const [editContent, setEditContent] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [resolvedServerUrl, setResolvedServerUrl] = createSignal(props.serverUrl || org.realmUrl || (window as any).__FOUNDRY_REALM_URL || "")
  const [linkPreviewCollapsed, setLinkPreviewCollapsed] = createSignal(false)
  let refreshAuthenticatedImages = () => {}
  let contentEl!: HTMLDivElement

  const currentUserId = () => sync.store.currentUserId

  // Extract first URL from message for link preview (Mattermost shows first URL only)
  const firstUrl = () => extractFirstUrl(props.message.content)

  const serverUrl = () => resolvedServerUrl()

  const timestamp = () => {
    const date = new Date(props.message.timestamp * 1000)
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  }

  const avatarUrl = () => {
    const url = props.message.avatar_url
    if (!url) return null
    if (url.startsWith("/") && serverUrl()) {
      return resolveMessageUrl(url, serverUrl())
    }
    return url
  }

  const startEdit = () => {
    // Extract text from HTML content (rough - the server stores raw markdown)
    const tmp = document.createElement("div")
    tmp.innerHTML = props.message.content
    setEditContent(tmp.textContent || "")
    setEditing(true)
  }

  const saveEdit = async () => {
    const text = editContent().trim()
    if (!text) return
    setSaving(true)
    try {
      const result = await commands.editMessage(org.orgId, props.message.id, text, null)
      if (result.status === "ok") {
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditContent("")
  }

  const handleToggleReaction = async (emojiName: string, emojiCode: string) => {
    const userId = currentUserId()
    // Check if user already reacted
    const existing = (props.message.reactions || []).find(
      r => r.emoji_code === emojiCode && r.user_id === userId
    )
    try {
      if (existing) {
        await commands.removeReaction(org.orgId, props.message.id, emojiName, emojiCode)
      } else {
        await commands.addReaction(org.orgId, props.message.id, emojiName, emojiCode)
      }
    } catch (e) {
      console.error("Reaction failed:", e)
    }
  }

  const navigateToConversationLink = (link: ParsedZulipConversationLink) => {
    if (link.messageId !== undefined) {
      nav.navigateToMessage(link.narrow, link.messageId)
      return
    }

    nav.setActiveNarrow(link.narrow)
  }

  const handleContentClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const link = target.closest("a[href]") as HTMLAnchorElement | null
    if (!link) return

    const href = link.getAttribute("href")
    if (!href) return

    const messageDeepLink = parseMessageDeepLinkUrl(href)
    if (messageDeepLink) {
      event.preventDefault()
      event.stopPropagation()
      publishDeepLinks([href])
      return
    }

    if (isMessageImageLink(link, serverUrl())) {
      // If the image is inside a gallery, let the gallery handle it
      if (link.closest(".foundry-image-gallery")) return

      // Single inline images — don't open a standalone lightbox, just
      // suppress navigation. The file attachment card provides download.
      if (link.closest(".message_inline_image")) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      event.preventDefault()
      event.stopPropagation()
      openMessageImageViewerFromLink(contentEl, link, {
        openLink: (url) => platform.openLink(url),
        onViewerImageChange: () => refreshAuthenticatedImages(),
        serverUrl: serverUrl(),
      })
      return
    }

    const internalConversationLink = parseZulipConversationLink(href, {
      realmUrl: serverUrl(),
      subscriptions: sync.store.subscriptions,
    })
    if (internalConversationLink) {
      event.preventDefault()
      event.stopPropagation()
      navigateToConversationLink(internalConversationLink)
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const resolvedHref = resolveMessageUrl(href, serverUrl())
    const downloadHref = shouldOpenUserUploadAsDownload(link, serverUrl())
      ? getUserUploadDownloadUrl(href, serverUrl())
      : undefined

    platform.openLink(downloadHref || resolvedHref)
  }

  createEffect(() => {
    const nextServerUrl = props.serverUrl || org.realmUrl || (window as any).__FOUNDRY_REALM_URL || ""
    if (nextServerUrl && nextServerUrl !== resolvedServerUrl()) {
      setResolvedServerUrl(nextServerUrl)
    }
  })

  onMount(() => {
    if (resolvedServerUrl()) return

    void resolveRealmUrlFromSavedServers(org.orgId, org.realmName).then((url) => {
      if (url) {
        setResolvedServerUrl(url)
      }
    }).catch(() => {})
  })

  createEffect(() => {
    if (!contentEl) return
    contentEl.innerHTML = sanitizeMessageHtml(props.message.content, serverUrl())

    let cleanupImages = () => {}
    const rehydrateImages = () => {
      cleanupImages()
      cleanupImages = hydrateAuthenticatedMessageImages(contentEl, org.orgId, serverUrl())
    }
    refreshAuthenticatedImages = rehydrateImages
    const cleanupCarousel = hydrateMessageImageCarousels(contentEl, {
      openLink: (url) => platform.openLink(url),
      onViewerImageChange: rehydrateImages,
      serverUrl: serverUrl(),
    })
    const cleanupCodeBlocks = hydrateCodeBlocks(contentEl)
    const cleanupFileCards = hydrateFileAttachmentCards(contentEl, serverUrl())

    // Strip href from remaining inline image links (those not consumed by
    // gallery carousels) so Tauri's native navigation doesn't open them
    // in the system browser on click. Must run AFTER carousel and file card
    // hydration since both need the original hrefs.
    const inlineImageCleanups: (() => void)[] = []
    for (const link of contentEl.querySelectorAll<HTMLAnchorElement>(".message_inline_image a[href]")) {
      const href = link.getAttribute("href")!
      link.dataset.originalHref = href
      link.removeAttribute("href")
      link.style.cursor = "pointer"
      const onClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        // Temporarily restore href so the viewer can extract image source
        link.setAttribute("href", link.dataset.originalHref || "")
        openMessageImageViewerFromLink(contentEl, link, {
          openLink: (url) => platform.openLink(url),
          onViewerImageChange: () => refreshAuthenticatedImages(),
          serverUrl: serverUrl(),
        })
        // Strip it again after viewer is created
        link.removeAttribute("href")
      }
      link.addEventListener("click", onClick)
      inlineImageCleanups.push(() => link.removeEventListener("click", onClick))
    }

    rehydrateImages()
    onCleanup(() => {
      refreshAuthenticatedImages = () => {}
      cleanupImages()
      cleanupCarousel()
      cleanupCodeBlocks()
      cleanupFileCards()
      inlineImageCleanups.forEach((fn) => fn())
    })
  })

  return (
    <div
      class="group relative flex gap-3 px-5 py-1 hover:bg-[var(--background-surface)]/50"
      classList={{ "pt-5": props.showSender, "pt-1": !props.showSender }}
      data-component="message-item"
      data-message-id={props.message.id}
    >
      {/* Avatar column */}
      <div class="w-9 shrink-0">
        <Show
          when={props.showSender}
          fallback={
            <span class="block w-9 text-center text-xs leading-[1.25rem] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity select-none whitespace-nowrap overflow-hidden">
              {new Date(props.message.timestamp * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: false })}
            </span>
          }
        >
          <Show
            when={avatarUrl()}
            fallback={
              <div class="w-9 h-9 rounded-full bg-[var(--background-surface)] flex items-center justify-center text-sm font-medium text-[var(--text-secondary)]">
                {props.message.sender_full_name.charAt(0).toUpperCase()}
              </div>
            }
          >
            {(url) => (
              <img
                src={url()}
                alt=""
                class="w-9 h-9 rounded-full object-cover"
              />
            )}
          </Show>
        </Show>
      </div>

      {/* Content column */}
      <div class="flex-1 min-w-0">
        <Show when={props.showSender}>
          <div class="flex items-baseline gap-2 mb-0.5">
            <span class="text-[15px] font-bold text-[var(--text-primary)] leading-snug">
              {props.message.sender_full_name}
            </span>
            <span class="text-xs text-[var(--text-secondary)] ml-0.5">
              {timestamp()}
            </span>
          </div>
        </Show>

        {/* Edit mode or message content */}
        <Show
          when={!editing()}
          fallback={
            <div class="space-y-1">
              <textarea
                class="w-full px-2 py-1.5 text-sm border border-[var(--interactive-primary)] rounded-[var(--radius-md)] bg-[var(--surface-input)] text-[var(--text-primary)] resize-none focus:outline-none"
                value={editContent()}
                onInput={(e) => setEditContent(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    saveEdit()
                  }
                  if (e.key === "Escape") cancelEdit()
                }}
                rows={3}
                autofocus
              />
              <div class="flex gap-1">
                <button
                  onClick={saveEdit}
                  disabled={saving()}
                  class="text-xs px-2 py-1 rounded bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] disabled:opacity-50"
                >
                  {saving() ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={cancelEdit}
                  class="text-xs px-2 py-1 rounded bg-[var(--background-elevated)] text-[var(--text-secondary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          }
        >
          <div
            ref={contentEl!}
            class="text-[var(--text-primary)] message-content select-text"
            style={{ "font-size": "var(--font-size-base, 15px)" }}
            data-component="message-content"
            onClick={handleContentClick}
          />
        </Show>

        {/* Link preview card — first URL in message (Element/Mattermost convention) */}
        <Show when={!editing() && firstUrl() && !linkPreviewCollapsed()}>
          <LinkPreviewCard
            url={firstUrl()!}
            collapsed={linkPreviewCollapsed()}
            onCollapse={() => setLinkPreviewCollapsed(true)}
          />
        </Show>

        {/* Reactions — with username tooltips (Mattermost ReactionTooltip pattern) */}
        <Show when={props.message.reactions && props.message.reactions.length > 0}>
          <div class="flex flex-wrap gap-1 mt-1" role="group" aria-label="Message reactions">
            <For each={groupReactions(props.message.reactions || [])}>
              {(reaction) => {
                const isOwn = () => {
                  const uid = currentUserId()
                  return uid ? reaction.user_ids.includes(uid) : false
                }

                const reactionUserNames = () => {
                  return reaction.user_ids
                    .map(uid => sync.store.users.find(u => u.user_id === uid)?.full_name)
                    .filter(Boolean) as string[]
                }

                const tooltipText = () => {
                  const names = reactionUserNames()
                  const emojiLabel = reaction.emoji_name.replace(/_/g, " ")
                  if (names.length === 0) return `:${reaction.emoji_name}:`
                  if (names.length === 1) return `${names[0]} reacted with ${emojiLabel}`
                  if (names.length === 2) return `${names[0]} and ${names[1]} reacted with ${emojiLabel}`
                  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} reacted with ${emojiLabel}`
                }

                return (
                  <button
                    class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                      isOwn()
                        ? "bg-[var(--interactive-primary)]/10 border-[var(--interactive-primary)]/30 text-[var(--interactive-primary)]"
                        : "bg-[var(--background-surface)] border-[var(--border-default)] text-[var(--text-primary)]"
                    } hover:border-[var(--interactive-primary)]`}
                    title={tooltipText()}
                    aria-label={tooltipText()}
                    onClick={() => handleToggleReaction(reaction.emoji_name, reaction.emoji_code)}
                  >
                    <span aria-hidden="true">{emojiCodeToChar(reaction.emoji_code)}</span>
                    <span class="text-[var(--text-tertiary)]">{reaction.count}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* Hover action bar */}
      <MessageActions
        message={props.message}
        currentUserId={currentUserId() ?? undefined}
        onStartEdit={startEdit}
        onReply={props.onReply}
      />
    </div>
  )
}

function shouldOpenUserUploadAsDownload(link: HTMLAnchorElement, serverUrl?: string): boolean {
  if (
    link.classList.contains("foundry-image-gallery-open")
    || link.classList.contains("foundry-image-lightbox-link")
  ) {
    return false
  }
  if (isMessageImageLink(link, serverUrl)) return false
  return !link.querySelector("video, audio")
}

/** Group identical reactions and count them, tracking user IDs */
function groupReactions(reactions: Reaction[]) {
  const groups = new Map<string, { emoji_name: string; emoji_code: string; count: number; user_ids: number[] }>()
  for (const r of reactions) {
    const key = r.emoji_code
    const existing = groups.get(key)
    if (existing) {
      existing.count++
      existing.user_ids.push(r.user_id)
    } else {
      groups.set(key, { emoji_name: r.emoji_name, emoji_code: r.emoji_code, count: 1, user_ids: [r.user_id] })
    }
  }
  return Array.from(groups.values())
}
