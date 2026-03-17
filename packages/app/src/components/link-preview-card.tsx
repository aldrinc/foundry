/**
 * LinkPreviewCard — renders an OpenGraph link preview card below messages.
 *
 * Design uses a compact card layout:
 * - Banner image (full-width, max 160px height)
 * - Site name, title (2-line clamp), description (2-line clamp)
 *
 * The component fetches preview data via the `fetch_link_preview` Tauri command
 * when available. Falls back to displaying basic URL domain info.
 */

import { createSignal, createEffect, Show, onCleanup } from "solid-js"
import { usePlatform } from "../context/platform"
import { commands } from "@foundry/desktop/bindings"

export interface LinkPreviewData {
  url: string
  title?: string
  description?: string
  image_url?: string
  site_name?: string
}

/** Extract the first external URL from message HTML content */
export function extractFirstUrl(htmlContent: string): string | null {
  if (typeof document === "undefined") return null

  const template = document.createElement("template")
  template.innerHTML = htmlContent

  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href")
    if (!href) continue

    // Skip internal links, mailto, tel, anchors
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue

    // Skip user uploads (these are file attachments, not link previews)
    if (href.includes("/user_uploads/")) continue

    // Only match http(s) URLs
    try {
      const parsed = new URL(href)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return href
      }
    } catch {
      continue
    }
  }

  return null
}

/** Extract domain from a URL for display */
function getDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Global in-memory cache for link previews to avoid refetching */
const previewCache = new Map<string, LinkPreviewData | null>()

export function LinkPreviewCard(props: {
  url: string
  collapsed?: boolean
  onCollapse?: () => void
}) {
  const platform = usePlatform()
  const [preview, setPreview] = createSignal<LinkPreviewData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [collapsed, setCollapsed] = createSignal(props.collapsed ?? false)

  createEffect(() => {
    const url = props.url
    if (!url) {
      setLoading(false)
      return
    }

    // Check cache first
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        // Fetch OpenGraph metadata via Tauri command
        const result = await commands.fetchLinkPreview(url)
        if (cancelled) return

        if (result.status === "ok") {
          const raw = result.data
          const data: LinkPreviewData = {
            url: raw.url,
            title: raw.title ?? undefined,
            description: raw.description ?? undefined,
            image_url: raw.image_url ?? undefined,
            site_name: raw.site_name ?? undefined,
          }
          previewCache.set(url, data)
          setPreview(data)
        } else {
          // Error — store null so we don't refetch
          previewCache.set(url, null)
          setPreview(null)
        }
      } catch {
        // Fetch failed — show minimal preview with domain info
        const fallback: LinkPreviewData = {
          url,
          site_name: getDomain(url),
        }
        previewCache.set(url, fallback)
        setPreview(fallback)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    onCleanup(() => {
      cancelled = true
    })
  })

  const handleClick = () => {
    platform.openLink(props.url)
  }

  const handleCollapse = (e: MouseEvent) => {
    e.stopPropagation()
    setCollapsed(!collapsed())
    props.onCollapse?.()
  }

  return (
    <>
    <Show when={loading()}>
      <div
        class="mt-1.5 max-w-[400px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)] overflow-hidden"
        style={{ "min-height": "68px" }}
      >
        <div class="px-3 py-2 flex flex-col gap-1">
          <div class="w-16 h-2.5 rounded bg-[var(--background-elevated)] animate-pulse" />
          <div class="w-48 h-3.5 rounded bg-[var(--background-elevated)] animate-pulse" />
          <div class="w-32 h-3 rounded bg-[var(--background-elevated)] animate-pulse" />
        </div>
      </div>
    </Show>
    <Show when={!loading() && preview()}>
      {(data) => (
        <Show when={!collapsed()}>
          <div
            class="mt-1.5 relative max-w-[400px] cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--background-surface)] overflow-hidden transition-colors hover:border-[var(--border-strong)] link-preview-enter"
            onClick={handleClick}
            role="link"
            aria-label={`Link preview: ${data().title || data().url}`}
          >
            {/* Collapse button */}
            <button
              class="absolute top-1 right-1 z-10 p-1 rounded-full bg-[var(--background-surface)]/80 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
              onClick={handleCollapse}
              title="Dismiss preview"
              aria-label="Dismiss link preview"
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>

            {/* Banner image */}
            <Show when={data().image_url}>
              {(imgUrl) => (
                <div class="w-full overflow-hidden bg-[var(--background-elevated)]" style={{ height: "160px" }}>
                  <img
                    src={imgUrl()}
                    alt=""
                    class="w-full h-full object-cover"
                    style={{ border: "none", "border-radius": "0", margin: "0" }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).parentElement!.style.display = "none"
                    }}
                  />
                </div>
              )}
            </Show>

            {/* Text content */}
            <div class="px-3 py-2 flex flex-col gap-0.5">
              <Show when={data().site_name}>
                <span class="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] truncate">
                  {data().site_name}
                </span>
              </Show>
              <Show when={data().title}>
                <span class="text-[13px] font-medium text-[var(--text-primary)] line-clamp-2 leading-snug">
                  {data().title}
                </span>
              </Show>
              <Show when={data().description}>
                <span class="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                  {data().description}
                </span>
              </Show>
              <Show when={!data().title && !data().description}>
                <span class="text-xs text-[var(--interactive-primary)] truncate">
                  {getDomain(data().url)}
                </span>
              </Show>
            </div>
          </div>
        </Show>
      )}
    </Show>
    </>
  )
}
