import { Show, For, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { Message, Reaction } from "../context/zulip-sync"
import { useZulipSync } from "../context/zulip-sync"
import { useOrg } from "../context/org"
import { usePlatform } from "../context/platform"
import { commands } from "@foundry/desktop/bindings"
import { MessageActions } from "./message-actions"
import {
  hydrateMessageImageCarousels,
  hydrateAuthenticatedMessageImages,
  resolveMessageUrl,
  resolveRealmUrlFromSavedServers,
  sanitizeMessageHtml,
} from "./message-html"

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
  onQuote?: (text: string) => void
}) {
  const org = useOrg()
  const sync = useZulipSync()
  const platform = usePlatform()
  const [editing, setEditing] = createSignal(false)
  const [editContent, setEditContent] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [resolvedServerUrl, setResolvedServerUrl] = createSignal(props.serverUrl || org.realmUrl || (window as any).__FOUNDRY_REALM_URL || "")
  let contentEl!: HTMLDivElement

  const currentUserId = () => sync.store.currentUserId

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

  const handleContentClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const link = target.closest("a[href]") as HTMLAnchorElement | null
    if (!link) return

    const href = link.getAttribute("href")
    if (!href) return

    event.preventDefault()
    event.stopPropagation()
    platform.openLink(resolveMessageUrl(href, serverUrl()))
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
    const cleanupCarousel = hydrateMessageImageCarousels(contentEl, {
      onViewerImageChange: rehydrateImages,
      serverUrl: serverUrl(),
    })
    rehydrateImages()
    onCleanup(() => {
      cleanupImages()
      cleanupCarousel()
    })
  })

  return (
    <div
      class="group relative flex gap-3 px-4 py-1 hover:bg-[var(--background-surface)]/50"
      classList={{ "pt-4": props.showSender, "pt-0.5": !props.showSender }}
      data-component="message-item"
      data-message-id={props.message.id}
    >
      {/* Avatar column */}
      <div class="w-8 shrink-0">
        <Show
          when={props.showSender}
          fallback={
            <span class="block w-8 text-center text-[10px] leading-[1.25rem] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity select-none whitespace-nowrap overflow-hidden">
              {new Date(props.message.timestamp * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: false })}
            </span>
          }
        >
          <Show
            when={avatarUrl()}
            fallback={
              <div class="w-8 h-8 rounded-full bg-[var(--background-surface)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
                {props.message.sender_full_name.charAt(0).toUpperCase()}
              </div>
            }
          >
            {(url) => (
              <img
                src={url()}
                alt=""
                class="w-8 h-8 rounded-full object-cover"
                loading="lazy"
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
            <span class="text-[11px] text-[var(--text-tertiary)] ml-0.5">
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
            class="text-sm text-[var(--text-primary)] message-content select-text"
            data-component="message-content"
            onClick={handleContentClick}
          />
        </Show>

        {/* Reactions */}
        <Show when={props.message.reactions && props.message.reactions.length > 0}>
          <div class="flex flex-wrap gap-1 mt-1">
            <For each={groupReactions(props.message.reactions || [])}>
              {(reaction) => {
                const isOwn = () => {
                  const uid = currentUserId()
                  return uid ? reaction.user_ids.includes(uid) : false
                }

                return (
                  <button
                    class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                      isOwn()
                        ? "bg-[var(--interactive-primary)]/10 border-[var(--interactive-primary)]/30 text-[var(--interactive-primary)]"
                        : "bg-[var(--background-surface)] border-[var(--border-default)] text-[var(--text-primary)]"
                    } hover:border-[var(--interactive-primary)]`}
                    title={`:${reaction.emoji_name}: (${reaction.count})`}
                    onClick={() => handleToggleReaction(reaction.emoji_name, reaction.emoji_code)}
                  >
                    <span>{emojiCodeToChar(reaction.emoji_code)}</span>
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
        onQuote={props.onQuote}
      />
    </div>
  )
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
