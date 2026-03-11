import DOMPurify from "dompurify"
import { commands } from "@foundry/desktop/bindings"

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

export function getUserUploadDownloadUrl(url: string, serverUrl?: string): string | undefined {
  const resolved = resolveMessageUrl(url, serverUrl)
  if (!resolved) return undefined

  try {
    const parsed = new URL(resolved)

    if (serverUrl) {
      const realm = new URL(serverUrl)
      if (parsed.origin !== realm.origin) return undefined
    }

    if (!parsed.pathname.startsWith("/user_uploads/")) return undefined
    if (parsed.pathname.startsWith("/user_uploads/download/")) return parsed.toString()

    parsed.pathname = `/user_uploads/download/${parsed.pathname.slice("/user_uploads/".length)}`
    return parsed.toString()
  } catch {
    return undefined
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

  for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
    const preferOriginal = image.getAttribute("data-foundry-auth-prefer-original") === "true"
    const requestUrl = resolveAuthenticatedMediaUrl(
      preferOriginal ? image.getAttribute("data-original-src") : image.getAttribute("src"),
      preferOriginal ? image.getAttribute("src") : image.getAttribute("data-original-src"),
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
      image.removeAttribute("data-foundry-auth-prefer-original")
      image.setAttribute("src", dataUrl)
    })
  }

  return () => {
    disposed = true
  }
}

function isImageOnlyNode(node: ChildNode): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return !(node.textContent || "").trim()
  }
  if (!(node instanceof HTMLElement)) return false

  if (node.tagName === "IMG") return true

  if (node.tagName === "A" || node.tagName === "P" || node.tagName === "DIV" || node.tagName === "SPAN") {
    return Array.from(node.childNodes).every(isImageOnlyNode)
  }

  return false
}

function isImageOnlyBlock(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  if (element.dataset.foundryImageCarousel === "true") return false
  if (!element.querySelector("img")) return false
  if (element.querySelector("video, audio, iframe")) return false
  return Array.from(element.childNodes).every(isImageOnlyNode)
}

export function findImageCarouselRanges(imageOnlyBlocks: readonly boolean[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = -1

  for (let index = 0; index < imageOnlyBlocks.length; index += 1) {
    if (imageOnlyBlocks[index]) {
      if (start < 0) start = index
      continue
    }

    if (start >= 0 && index - start > 1) {
      ranges.push({ start, end: index })
    }
    start = -1
  }

  if (start >= 0 && imageOnlyBlocks.length - start > 1) {
    ranges.push({ start, end: imageOnlyBlocks.length })
  }

  return ranges
}

const SVG_NS = "http://www.w3.org/2000/svg"
const CHEVRON_LEFT_PATH = "M15.75 19.5 8.25 12l7.5-7.5"
const CHEVRON_RIGHT_PATH = "M8.25 4.5 15.75 12l-7.5 7.5"
const EXTERNAL_LINK_PATH = "M13.5 4.5H19.5V10.5 M10.5 13.5L19.5 4.5 M16.5 13.5V18C16.5 18.8284 15.8284 19.5 15 19.5H6C5.17157 19.5 4.5 18.8284 4.5 18V9C4.5 8.17157 5.17157 7.5 6 7.5H10.5"
const CLOSE_ICON_PATH = "M6 6L18 18 M18 6L6 18"

type MessageImageCarouselOptions = {
  onViewerImageChange?: () => void
  serverUrl?: string
}

type GalleryImageSource = {
  alt: string
  externalHref: string
  thumbSrc: string
  title: string
  viewerSrc: string
}

type GalleryImageItem = GalleryImageSource & {
  thumbnailButton: HTMLButtonElement
  thumbnailImage: HTMLImageElement
}

export function normalizeGalleryIndex(nextIndex: number, itemCount: number): number {
  if (itemCount <= 0) return 0
  return ((nextIndex % itemCount) + itemCount) % itemCount
}

function createIcon(pathDefinition: string): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("fill", "none")
  icon.setAttribute("stroke", "currentColor")
  icon.setAttribute("stroke-width", "1.75")
  icon.setAttribute("stroke-linecap", "round")
  icon.setAttribute("stroke-linejoin", "round")
  icon.setAttribute("aria-hidden", "true")

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", pathDefinition)
  icon.appendChild(path)

  return icon
}

function extractGalleryImageSource(block: HTMLElement, index: number): GalleryImageSource | null {
  const sourceImage = block.querySelector("img")
  if (!sourceImage) return null

  const sourceLink = sourceImage.closest("a[href]") || block.querySelector<HTMLAnchorElement>("a[href]")
  const thumbSrc = sourceImage.getAttribute("src")?.trim() || ""
  const originalSrc = sourceImage.getAttribute("data-original-src")?.trim() || ""
  const externalHref = sourceLink?.getAttribute("href")?.trim() || originalSrc || thumbSrc
  const viewerSrc = originalSrc || externalHref || thumbSrc

  if (!thumbSrc || !viewerSrc) return null

  return {
    alt: sourceImage.getAttribute("alt") || sourceLink?.getAttribute("aria-label") || `Image ${index + 1}`,
    externalHref,
    thumbSrc,
    title: sourceImage.getAttribute("title") || sourceLink?.getAttribute("title") || "",
    viewerSrc,
  }
}

function setViewerImageSource(
  viewerImage: HTMLImageElement,
  item: GalleryImageItem,
  serverUrl?: string,
) {
  const requiresAuthenticatedFetch = shouldFetchAuthenticatedMedia(item.viewerSrc, serverUrl)
  const thumbnailSrc = item.thumbnailImage.getAttribute("src") || item.thumbSrc

  viewerImage.alt = item.alt
  if (item.title) {
    viewerImage.setAttribute("title", item.title)
  } else {
    viewerImage.removeAttribute("title")
  }

  viewerImage.setAttribute("data-original-src", item.viewerSrc)
  viewerImage.classList.toggle("image-loading-placeholder", requiresAuthenticatedFetch)

  if (requiresAuthenticatedFetch) {
    viewerImage.setAttribute("data-foundry-auth-prefer-original", "true")
    viewerImage.setAttribute("src", thumbnailSrc)
    return
  }

  viewerImage.removeAttribute("data-foundry-auth-prefer-original")
  viewerImage.setAttribute("src", item.viewerSrc)
}

function renderActiveGalleryImage(
  items: GalleryImageItem[],
  viewerImage: HTMLImageElement,
  counter: HTMLElement,
  externalLink: HTMLAnchorElement,
  nextIndex: number,
  options?: MessageImageCarouselOptions,
): number {
  const activeIndex = normalizeGalleryIndex(nextIndex, items.length)
  const activeItem = items[activeIndex]

  items.forEach((item, index) => {
    const active = index === activeIndex
    item.thumbnailButton.dataset.active = active ? "true" : "false"
    item.thumbnailButton.setAttribute("aria-current", active ? "true" : "false")
  })

  setViewerImageSource(viewerImage, activeItem, options?.serverUrl)
  counter.textContent = `${activeIndex + 1} / ${items.length}`
  externalLink.hidden = !activeItem.externalHref
  externalLink.setAttribute("href", activeItem.externalHref || "#")
  externalLink.setAttribute("aria-label", `Open image ${activeIndex + 1} in browser`)
  options?.onViewerImageChange?.()

  return activeIndex
}

export function hydrateMessageImageCarousels(
  container: HTMLElement,
  options?: MessageImageCarouselOptions,
): () => void {
  const cleanups: Array<() => void> = []
  const children = Array.from(container.children)
  const ranges = findImageCarouselRanges(children.map((child) => isImageOnlyBlock(child)))

  for (const range of ranges) {
    const group = children.slice(range.start, range.end) as HTMLElement[]
    if (group.length > 1) {
      const sources = group
        .map((block, index) => extractGalleryImageSource(block, index))
        .filter((source): source is GalleryImageSource => Boolean(source))
      if (sources.length < 2) continue

      const wrapper = document.createElement("div")
      wrapper.className = "foundry-image-gallery"
      wrapper.dataset.foundryImageCarousel = "true"
      group[0].before(wrapper)

      const grid = document.createElement("div")
      grid.className = "foundry-image-gallery-grid"

      const lightbox = document.createElement("div")
      lightbox.className = "foundry-image-lightbox"
      lightbox.hidden = true

      const lightboxBackdrop = document.createElement("button")
      lightboxBackdrop.type = "button"
      lightboxBackdrop.className = "foundry-image-lightbox-backdrop"
      lightboxBackdrop.setAttribute("aria-label", "Close image viewer")

      const dialog = document.createElement("div")
      dialog.className = "foundry-image-lightbox-dialog"
      dialog.setAttribute("role", "dialog")
      dialog.setAttribute("aria-modal", "true")
      dialog.setAttribute("aria-label", "Image viewer")
      dialog.tabIndex = -1

      const toolbar = document.createElement("div")
      toolbar.className = "foundry-image-lightbox-toolbar"

      const counter = document.createElement("span")
      counter.className = "foundry-image-lightbox-counter"
      counter.setAttribute("aria-live", "polite")

      const actions = document.createElement("div")
      actions.className = "foundry-image-lightbox-actions"

      const externalLink = document.createElement("a")
      externalLink.className = "foundry-image-lightbox-link"
      externalLink.setAttribute("target", "_blank")
      externalLink.setAttribute("rel", "noopener noreferrer")
      externalLink.append(createIcon(EXTERNAL_LINK_PATH), document.createTextNode("Open in browser"))

      const closeButton = document.createElement("button")
      closeButton.type = "button"
      closeButton.className = "foundry-image-lightbox-close"
      closeButton.setAttribute("aria-label", "Close image viewer")
      closeButton.appendChild(createIcon(CLOSE_ICON_PATH))

      actions.append(externalLink, closeButton)
      toolbar.append(counter, actions)

      const stage = document.createElement("div")
      stage.className = "foundry-image-lightbox-stage"

      const prevButton = document.createElement("button")
      prevButton.type = "button"
      prevButton.className = "foundry-image-lightbox-nav"
      prevButton.classList.add("is-prev")
      prevButton.setAttribute("aria-label", "Show previous image")
      prevButton.appendChild(createIcon(CHEVRON_LEFT_PATH))

      const nextButton = document.createElement("button")
      nextButton.type = "button"
      nextButton.className = "foundry-image-lightbox-nav"
      nextButton.classList.add("is-next")
      nextButton.setAttribute("aria-label", "Show next image")
      nextButton.appendChild(createIcon(CHEVRON_RIGHT_PATH))

      const viewerFrame = document.createElement("div")
      viewerFrame.className = "foundry-image-lightbox-frame"

      const viewerImage = document.createElement("img")
      viewerImage.className = "foundry-image-lightbox-image"
      viewerImage.setAttribute("loading", "eager")
      viewerFrame.appendChild(viewerImage)

      stage.append(prevButton, viewerFrame, nextButton)
      dialog.append(toolbar, stage)
      lightbox.append(lightboxBackdrop, dialog)

      const items = sources.map((source, index) => {
        const tile = document.createElement("div")
        tile.className = "foundry-image-gallery-item"

        const thumbnailButton = document.createElement("button")
        thumbnailButton.type = "button"
        thumbnailButton.className = "foundry-image-gallery-thumb"
        thumbnailButton.setAttribute("aria-label", `Open image ${index + 1} of ${sources.length}`)

        const thumbnailImage = document.createElement("img")
        thumbnailImage.setAttribute("src", source.thumbSrc)
        thumbnailImage.setAttribute("alt", source.alt)
        if (source.title) {
          thumbnailImage.setAttribute("title", source.title)
        }
        thumbnailImage.setAttribute("loading", "lazy")
        thumbnailButton.appendChild(thumbnailImage)

        const tileActions = document.createElement("div")
        tileActions.className = "foundry-image-gallery-item-actions"

        const tileExternalLink = document.createElement("a")
        tileExternalLink.className = "foundry-image-gallery-open"
        tileExternalLink.setAttribute("href", source.externalHref)
        tileExternalLink.setAttribute("target", "_blank")
        tileExternalLink.setAttribute("rel", "noopener noreferrer")
        tileExternalLink.setAttribute("aria-label", `Open image ${index + 1} in browser`)
        tileExternalLink.appendChild(createIcon(EXTERNAL_LINK_PATH))

        tileActions.appendChild(tileExternalLink)
        tile.append(thumbnailButton, tileActions)
        grid.appendChild(tile)

        return {
          ...source,
          thumbnailButton,
          thumbnailImage,
        }
      })

      group.forEach((block) => block.remove())
      wrapper.append(grid, lightbox)

      let activeIndex = 0
      let lastTrigger: HTMLButtonElement | null = null

      const render = (nextIndex: number) => {
        activeIndex = renderActiveGalleryImage(items, viewerImage, counter, externalLink, nextIndex, options)
      }

      const openViewer = (nextIndex: number, trigger?: HTMLButtonElement) => {
        lastTrigger = trigger || items[nextIndex]?.thumbnailButton || null
        lightbox.hidden = false
        wrapper.dataset.viewerOpen = "true"
        render(nextIndex)
        queueMicrotask(() => dialog.focus())
      }

      const closeViewer = () => {
        lightbox.hidden = true
        wrapper.dataset.viewerOpen = "false"
        viewerImage.removeAttribute("data-foundry-auth-prefer-original")
        lastTrigger?.focus()
      }

      const handlePrev = () => render(activeIndex - 1)
      const handleNext = () => render(activeIndex + 1)
      const handleBackdropClick = () => closeViewer()
      const handleClose = () => closeViewer()
      const handleDialogKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault()
          closeViewer()
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          handlePrev()
        }
        if (event.key === "ArrowRight") {
          event.preventDefault()
          handleNext()
        }
      }

      prevButton.addEventListener("click", handlePrev)
      nextButton.addEventListener("click", handleNext)
      lightboxBackdrop.addEventListener("click", handleBackdropClick)
      closeButton.addEventListener("click", handleClose)
      dialog.addEventListener("keydown", handleDialogKeyDown)

      items.forEach((item, itemIndex) => {
        const handleClick = () => openViewer(itemIndex, item.thumbnailButton)
        item.thumbnailButton.addEventListener("click", handleClick)
        cleanups.push(() => item.thumbnailButton.removeEventListener("click", handleClick))
      })

      cleanups.push(() => {
        prevButton.removeEventListener("click", handlePrev)
        nextButton.removeEventListener("click", handleNext)
        lightboxBackdrop.removeEventListener("click", handleBackdropClick)
        closeButton.removeEventListener("click", handleClose)
        dialog.removeEventListener("keydown", handleDialogKeyDown)
      })
    }
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
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
