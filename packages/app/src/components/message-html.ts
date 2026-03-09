import DOMPurify from "dompurify"
import { commands } from "@zulip/desktop/bindings"

const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z\d+\-.]*:|\/\/|#)/i
const AUTHENTICATED_MEDIA_PATHS = [
  "/user_uploads/",
  "/external_content/",
]

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "code", "pre", "a", "img", "ul", "ol", "li",
  "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead",
  "tbody", "tr", "th", "td", "span", "div", "del", "sup", "sub", "hr",
]

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "target", "rel",
  "data-user-id", "data-stream-id",
]

export function resolveMessageUrl(url: string, serverUrl?: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  if (ABSOLUTE_URL_PATTERN.test(trimmed)) return trimmed
  if (!serverUrl) return trimmed

  try {
    const base = serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`
    return new URL(trimmed, base).toString()
  } catch {
    return trimmed
  }
}

export function sanitizeMessageHtml(html: string, serverUrl?: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })

  if (typeof document === "undefined") {
    return sanitized
  }

  const template = document.createElement("template")
  template.innerHTML = sanitized

  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href")
    if (!href) continue

    anchor.setAttribute("href", resolveMessageUrl(href, serverUrl))
    anchor.setAttribute("target", "_blank")
    anchor.setAttribute("rel", "noopener noreferrer")
  }

  for (const image of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = image.getAttribute("src")
    if (!src) continue

    image.setAttribute("src", resolveMessageUrl(src, serverUrl))
    image.setAttribute("loading", "lazy")
  }

  return template.innerHTML
}

export function shouldFetchAuthenticatedMedia(url: string, serverUrl?: string): boolean {
  if (!serverUrl) return false

  try {
    const resolved = new URL(resolveMessageUrl(url, serverUrl))
    const realm = new URL(serverUrl)
    return resolved.origin === realm.origin
      && AUTHENTICATED_MEDIA_PATHS.some((pathPrefix) => resolved.pathname.startsWith(pathPrefix))
  } catch {
    return false
  }
}

export function resolveAuthenticatedMediaUrl(
  imageSrc: string | null | undefined,
  originalSrc: string | null | undefined,
  linkHref: string | null | undefined,
  serverUrl?: string,
): string | null {
  for (const candidate of [imageSrc, originalSrc, linkHref]) {
    if (!candidate) continue

    const resolved = resolveMessageUrl(candidate, serverUrl)
    if (shouldFetchAuthenticatedMedia(resolved, serverUrl)) {
      return resolved
    }
  }

  return null
}

async function fetchAuthenticatedMediaDataUrl(orgId: string, url: string): Promise<string | null> {
  const cacheKey = `${orgId}:${url}`
  const existing = authenticatedMediaDataUrlCache.get(cacheKey)
  if (existing) return existing

  const request = (async () => {
    try {
      const result = await commands.fetchAuthenticatedMediaDataUrl(orgId, url)
      return result.status === "ok" ? result.data : null
    } catch {
      return null
    }
  })()

  authenticatedMediaDataUrlCache.set(cacheKey, request)
  return request
}

export function hydrateAuthenticatedMessageImages(
  container: HTMLElement,
  orgId: string,
  serverUrl?: string,
): () => void {
  let disposed = false

  for (const image of container.querySelectorAll<HTMLImageElement>("img[src]")) {
    const requestUrl = resolveAuthenticatedMediaUrl(
      image.getAttribute("src"),
      image.getAttribute("data-original-src"),
      image.closest("a[href]")?.getAttribute("href"),
      serverUrl,
    )
    if (!requestUrl) continue

    image.setAttribute("data-foundry-auth-media-url", requestUrl)
    void fetchAuthenticatedMediaDataUrl(orgId, requestUrl).then((dataUrl) => {
      if (disposed || !dataUrl || !image.isConnected) return
      if (image.getAttribute("data-foundry-auth-media-url") !== requestUrl) return

      image.classList.remove("image-loading-placeholder")
      image.removeAttribute("data-foundry-auth-media-url")
      image.setAttribute("src", dataUrl)
    })
  }

  return () => {
    disposed = true
  }
}

type SavedServerStatusLike = {
  connected?: boolean
  org_id?: string | null
  realm_name?: string
  url?: string
}

let savedServerStatusesPromise: Promise<SavedServerStatusLike[]> | null = null
const authenticatedMediaDataUrlCache = new Map<string, Promise<string | null>>()

async function getSavedServerStatuses(): Promise<SavedServerStatusLike[]> {
  if (savedServerStatusesPromise) {
    return savedServerStatusesPromise
  }

  savedServerStatusesPromise = (async () => {
    const invoke = (window as any).__TAURI_INTERNALS__?.invoke
    if (typeof invoke !== "function") return []

    try {
      const result = await invoke("get_saved_server_statuses")
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  })()

  return savedServerStatusesPromise
}

export async function resolveRealmUrlFromSavedServers(orgId: string, realmName: string): Promise<string | null> {
  const statuses = await getSavedServerStatuses()
  const current = statuses.find((server) => server.org_id === orgId)
    || statuses.find((server) => server.connected && server.realm_name === realmName)

  return current?.url || null
}
