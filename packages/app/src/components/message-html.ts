import DOMPurify from "dompurify"
import { commands } from "@foundry/desktop/bindings"

const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z\d+\-.]*:|\/\/|#)/i
const AUTHENTICATED_MEDIA_PATHS = [
  "/user_uploads/",
  "/external_content/",
]
const IMAGE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i

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
const DOWNLOAD_ICON_PATH = "M12 3.75V14.25 M8.25 10.5 12 14.25 15.75 10.5 M5.25 18.75H18.75"
const EXTERNAL_LINK_PATH = "M13.5 4.5H19.5V10.5 M10.5 13.5L19.5 4.5 M16.5 13.5V18C16.5 18.8284 15.8284 19.5 15 19.5H6C5.17157 19.5 4.5 18.8284 4.5 18V9C4.5 8.17157 5.17157 7.5 6 7.5H10.5"
const CLOSE_ICON_PATH = "M6 6L18 18 M18 6L6 18"

function extractFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    // Remove /user_uploads/download/ or /user_uploads/ prefix path segments
    const segments = pathname.split("/").filter(Boolean)
    const lastSegment = segments[segments.length - 1] || ""
    return decodeURIComponent(lastSegment)
  } catch {
    const lastSlash = url.lastIndexOf("/")
    if (lastSlash >= 0) return decodeURIComponent(url.slice(lastSlash + 1))
    return url
  }
}

function getImageFilename(source: GalleryImageSource): string {
  // Try title first, then extract from download/external URL
  if (source.title) return source.title
  const url = source.downloadHref || source.externalHref || source.viewerSrc
  if (!url) return ""
  return extractFilenameFromUrl(url)
}

type MessageImageCarouselOptions = {
  openLink?: (url: string) => void
  onViewerImageChange?: () => void
  serverUrl?: string
}

type GalleryImageSource = {
  alt: string
  downloadHref: string
  externalHref: string
  thumbSrc: string
  thumbnailImage?: HTMLImageElement
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

function resolveGalleryDownloadHref(url: string, serverUrl?: string): string {
  return getUserUploadDownloadUrl(url, serverUrl) || resolveMessageUrl(url, serverUrl)
}

function extractGalleryImageSource(
  block: HTMLElement,
  index: number,
  serverUrl?: string,
): GalleryImageSource | null {
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
    downloadHref: resolveGalleryDownloadHref(externalHref || viewerSrc || thumbSrc, serverUrl),
    externalHref: resolveMessageUrl(externalHref, serverUrl),
    thumbSrc: resolveMessageUrl(thumbSrc, serverUrl),
    title: sourceImage.getAttribute("title") || sourceLink?.getAttribute("title") || "",
    viewerSrc: resolveMessageUrl(viewerSrc, serverUrl),
  }
}

function isImageUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed.startsWith("data:image/")) return true

  try {
    const resolved = new URL(trimmed, "https://foundry.invalid")
    return IMAGE_EXTENSION_PATTERN.test(resolved.pathname)
  } catch {
    return IMAGE_EXTENSION_PATTERN.test(trimmed)
  }
}

function extractLinkedImageSource(
  link: HTMLAnchorElement,
  serverUrl?: string,
): GalleryImageSource | null {
  const href = link.getAttribute("href")?.trim() || ""
  const sourceImage = link.querySelector("img")
  const thumbSrc = sourceImage?.getAttribute("src")?.trim() || resolveMessageUrl(href, serverUrl)
  const originalSrc = sourceImage?.getAttribute("data-original-src")?.trim() || href || thumbSrc
  const externalHref = href || originalSrc || thumbSrc
  const viewerSrc = originalSrc || externalHref || thumbSrc

  if (!viewerSrc || !thumbSrc) return null

  return {
    alt: sourceImage?.getAttribute("alt") || link.getAttribute("aria-label") || "Image",
    downloadHref: resolveGalleryDownloadHref(externalHref || viewerSrc || thumbSrc, serverUrl),
    externalHref: resolveMessageUrl(externalHref, serverUrl),
    thumbSrc: resolveMessageUrl(thumbSrc, serverUrl),
    thumbnailImage: sourceImage || undefined,
    title: sourceImage?.getAttribute("title") || link.getAttribute("title") || "",
    viewerSrc: resolveMessageUrl(viewerSrc, serverUrl),
  }
}

export function isMessageImageLink(link: HTMLAnchorElement, serverUrl?: string): boolean {
  if (link.classList.contains("foundry-image-gallery-open")) return false
  if (link.classList.contains("foundry-image-gallery-download")) return false
  if (link.classList.contains("foundry-image-lightbox-link")) return false
  if (link.classList.contains("foundry-image-lightbox-download")) return false
  if (link.querySelector("img, picture")) return true

  const href = link.getAttribute("href")
  if (!href) return false

  const resolvedHref = resolveMessageUrl(href, serverUrl)
  return isImageUrl(resolvedHref)
}

export function openMessageImageViewerFromLink(
  container: HTMLElement,
  link: HTMLAnchorElement,
  options?: MessageImageCarouselOptions,
): boolean {
  const source = extractLinkedImageSource(link, options?.serverUrl)
  if (!source) return false

  container
    .querySelector<HTMLElement>('.foundry-image-lightbox[data-foundry-standalone-viewer="true"]')
    ?.remove()

  const lightbox = document.createElement("div")
  lightbox.className = "foundry-image-lightbox"
  lightbox.dataset.foundryStandaloneViewer = "true"

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
  counter.textContent = "1 / 1"

  const actions = document.createElement("div")
  actions.className = "foundry-image-lightbox-actions"

  const downloadLink = document.createElement("a")
  downloadLink.className = "foundry-image-lightbox-download"
  downloadLink.setAttribute("target", "_blank")
  downloadLink.setAttribute("rel", "noopener noreferrer")
  downloadLink.append(createIcon(DOWNLOAD_ICON_PATH), document.createTextNode("Download"))

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

  const filenameEl = document.createElement("span")
  filenameEl.className = "foundry-image-lightbox-filename"
  filenameEl.textContent = getImageFilename(source)

  actions.append(downloadLink, externalLink, closeButton)
  toolbar.append(counter, filenameEl, actions)

  const stage = document.createElement("div")
  stage.className = "foundry-image-lightbox-stage"

  const prevButton = document.createElement("button")
  prevButton.type = "button"
  prevButton.className = "foundry-image-lightbox-nav is-prev"
  prevButton.hidden = true
  prevButton.setAttribute("aria-hidden", "true")

  const nextButton = document.createElement("button")
  nextButton.type = "button"
  nextButton.className = "foundry-image-lightbox-nav is-next"
  nextButton.hidden = true
  nextButton.setAttribute("aria-hidden", "true")

  const viewerFrame = document.createElement("div")
  viewerFrame.className = "foundry-image-lightbox-frame"

  const viewerImage = document.createElement("img")
  viewerImage.className = "foundry-image-lightbox-image"
  viewerImage.setAttribute("loading", "eager")
  viewerFrame.appendChild(viewerImage)

  stage.append(prevButton, viewerFrame, nextButton)
  dialog.append(toolbar, stage)
  lightbox.append(lightboxBackdrop, dialog)
  container.appendChild(lightbox)

  const setActiveSource = () => {
    setViewerImageSource(viewerImage, source, options?.serverUrl)
    downloadLink.hidden = !source.downloadHref
    downloadLink.setAttribute("href", source.downloadHref || "#")
    downloadLink.setAttribute("aria-label", "Download image")
    externalLink.hidden = !source.externalHref
    externalLink.setAttribute("href", source.externalHref || "#")
    externalLink.setAttribute("aria-label", "Open image in browser")
    options?.onViewerImageChange?.()
  }

  const cleanup = () => {
    lightboxBackdrop.removeEventListener("click", handleClose)
    closeButton.removeEventListener("click", handleClose)
    dialog.removeEventListener("keydown", handleKeyDown)
  }

  const restoreFocus = link.querySelector<HTMLElement>("img") || link
  const handleClose = () => {
    cleanup()
    viewerImage.removeAttribute("data-foundry-auth-prefer-original")
    lightbox.remove()
    restoreFocus.focus?.()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    handleClose()
  }

  lightboxBackdrop.addEventListener("click", handleClose)
  closeButton.addEventListener("click", handleClose)
  dialog.addEventListener("keydown", handleKeyDown)

  setActiveSource()
  queueMicrotask(() => dialog.focus())
  return true
}

function setViewerImageSource(
  viewerImage: HTMLImageElement,
  item: GalleryImageSource,
  serverUrl?: string,
) {
  const requiresAuthenticatedFetch = shouldFetchAuthenticatedMedia(item.viewerSrc, serverUrl)
  const thumbnailSrc = item.thumbnailImage?.getAttribute("src") || item.thumbSrc

  // Reset loaded state so the image fades in when ready
  viewerImage.classList.remove("is-loaded")

  // Use a one-shot listener; safe to call repeatedly since prior one-shot
  // listeners either already fired or are superseded by the new src change.
  viewerImage.addEventListener("load", () => viewerImage.classList.add("is-loaded"), { once: true })

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
  filenameEl: HTMLElement,
  downloadLink: HTMLAnchorElement,
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
  filenameEl.textContent = getImageFilename(activeItem)
  filenameEl.title = getImageFilename(activeItem)
  downloadLink.hidden = !activeItem.downloadHref
  downloadLink.setAttribute("href", activeItem.downloadHref || "#")
  downloadLink.setAttribute("aria-label", `Download image ${activeIndex + 1}`)
  externalLink.hidden = !activeItem.externalHref
  externalLink.setAttribute("href", activeItem.externalHref || "#")
  externalLink.setAttribute("aria-label", `Open image ${activeIndex + 1} in browser`)
  options?.onViewerImageChange?.()

  return activeIndex
}

function extractStandaloneImageUploadLinks(
  block: Element,
  serverUrl?: string,
) : HTMLAnchorElement[] {
  if (!(block instanceof HTMLElement)) return []
  if (block.querySelector("img, picture, video, audio, iframe")) return []

  const links = Array.from(block.querySelectorAll<HTMLAnchorElement>("a[href]"))
  if (links.length === 0) return []
  if (!links.every((link) => isMessageImageLink(link, serverUrl))) return []

  for (const child of Array.from(block.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && !(child.textContent || "").trim()) continue
    if (child instanceof HTMLElement && child.tagName === "BR") continue
    if (child instanceof HTMLAnchorElement && links.includes(child)) continue
    return []
  }

  return links
}

function collectRedundantGalleryUploadBlocks(
  children: HTMLElement[],
  rangeStart: number,
  sources: GalleryImageSource[],
  serverUrl?: string,
): HTMLElement[] {
  const hrefCounts = new Map<string, number>()
  for (const source of sources) {
    hrefCounts.set(source.externalHref, (hrefCounts.get(source.externalHref) || 0) + 1)
  }

  const matches: HTMLElement[] = []
  for (let index = rangeStart - 1; index >= 0; index -= 1) {
    const candidate = children[index]
    const links = extractStandaloneImageUploadLinks(candidate, serverUrl)
    if (links.length === 0) break

    const resolvedHrefs = links.map((link) => resolveMessageUrl(link.getAttribute("href") || "", serverUrl))
    if (resolvedHrefs.some((href) => !hrefCounts.get(href))) break

    matches.push(candidate)
    for (const resolvedHref of resolvedHrefs) {
      const remainingCount = hrefCounts.get(resolvedHref)
      if (!remainingCount) continue

      if (remainingCount === 1) {
        hrefCounts.delete(resolvedHref)
      } else {
        hrefCounts.set(resolvedHref, remainingCount - 1)
      }
    }

    if (hrefCounts.size === 0) break
  }

  return matches
}

export function hydrateMessageImageCarousels(
  container: HTMLElement,
  options?: MessageImageCarouselOptions,
): () => void {
  const cleanups: Array<() => void> = []
  const children = Array.from(container.children) as HTMLElement[]
  const ranges = findImageCarouselRanges(children.map((child) => isImageOnlyBlock(child)))

  for (const range of ranges) {
    const group = children.slice(range.start, range.end) as HTMLElement[]
    if (group.length > 1) {
      const sources = group
        .map((block, index) => extractGalleryImageSource(block, index, options?.serverUrl))
        .filter((source): source is GalleryImageSource => Boolean(source))
      if (sources.length < 2) continue

      const wrapper = document.createElement("div")
      wrapper.className = "foundry-image-gallery"
      wrapper.dataset.foundryImageCarousel = "true"
      group[0].before(wrapper)

      const header = document.createElement("div")
      header.className = "foundry-image-gallery-header"

      const title = document.createElement("span")
      title.className = "foundry-image-gallery-title"
      title.textContent = `${sources.length} images`

      const headerActions = document.createElement("div")
      headerActions.className = "foundry-image-gallery-actions"

      const downloadAllButton = document.createElement("button")
      downloadAllButton.type = "button"
      downloadAllButton.className = "foundry-image-gallery-download-all"
      downloadAllButton.setAttribute("aria-label", `Download all ${sources.length} images`)
      downloadAllButton.append(createIcon(DOWNLOAD_ICON_PATH), document.createTextNode("Download all"))

      headerActions.appendChild(downloadAllButton)
      header.append(title, headerActions)

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

      const downloadLink = document.createElement("a")
      downloadLink.className = "foundry-image-lightbox-download"
      downloadLink.setAttribute("target", "_blank")
      downloadLink.setAttribute("rel", "noopener noreferrer")
      downloadLink.append(createIcon(DOWNLOAD_ICON_PATH), document.createTextNode("Download"))

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

      const filenameEl = document.createElement("span")
      filenameEl.className = "foundry-image-lightbox-filename"

      actions.append(downloadLink, externalLink, closeButton)
      toolbar.append(counter, filenameEl, actions)

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

        const tileDownloadLink = document.createElement("a")
        tileDownloadLink.className = "foundry-image-gallery-download"
        tileDownloadLink.setAttribute("href", source.downloadHref)
        tileDownloadLink.setAttribute("target", "_blank")
        tileDownloadLink.setAttribute("rel", "noopener noreferrer")
        tileDownloadLink.setAttribute("aria-label", `Download image ${index + 1}`)
        tileDownloadLink.appendChild(createIcon(DOWNLOAD_ICON_PATH))

        const tileExternalLink = document.createElement("a")
        tileExternalLink.className = "foundry-image-gallery-open"
        tileExternalLink.setAttribute("href", source.externalHref)
        tileExternalLink.setAttribute("target", "_blank")
        tileExternalLink.setAttribute("rel", "noopener noreferrer")
        tileExternalLink.setAttribute("aria-label", `Open image ${index + 1} in browser`)
        tileExternalLink.appendChild(createIcon(EXTERNAL_LINK_PATH))

        tileActions.append(tileDownloadLink, tileExternalLink)
        tile.append(thumbnailButton, tileActions)
        grid.appendChild(tile)

        return {
          ...source,
          thumbnailButton,
          thumbnailImage,
        }
      })

      const redundantBlocks = collectRedundantGalleryUploadBlocks(children, range.start, sources, options?.serverUrl)
      group.forEach((block) => block.remove())
      redundantBlocks.forEach((block) => block.remove())
      wrapper.append(header, grid, lightbox)

      let activeIndex = 0
      let lastTrigger: HTMLButtonElement | null = null

      const render = (nextIndex: number) => {
        activeIndex = renderActiveGalleryImage(
          items,
          viewerImage,
          counter,
          filenameEl,
          downloadLink,
          externalLink,
          nextIndex,
          options,
        )
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
        // Reset all thumbnail active states so none stays highlighted
        for (const item of items) {
          item.thumbnailButton.dataset.active = "false"
          item.thumbnailButton.setAttribute("aria-current", "false")
        }
        lastTrigger?.focus()
      }

      const handlePrev = () => render(activeIndex - 1)
      const handleNext = () => render(activeIndex + 1)
      const handleDownloadAll = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()

        for (const item of items) {
          if (!item.downloadHref) continue
          if (options?.openLink) {
            options.openLink(item.downloadHref)
            continue
          }
          window.open(item.downloadHref, "_blank", "noopener,noreferrer")
        }
      }
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
      downloadAllButton.addEventListener("click", handleDownloadAll)
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
        downloadAllButton.removeEventListener("click", handleDownloadAll)
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
