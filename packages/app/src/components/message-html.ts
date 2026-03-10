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

function setActiveCarouselSlide(
  slides: HTMLElement[],
  dots: HTMLButtonElement[],
  counter: HTMLElement,
  nextIndex: number,
) {
  slides.forEach((slide, index) => {
    const active = index === nextIndex
    slide.hidden = !active
    slide.setAttribute("data-active", active ? "true" : "false")
  })

  dots.forEach((dot, index) => {
    const active = index === nextIndex
    dot.setAttribute("aria-current", active ? "true" : "false")
    dot.dataset.active = active ? "true" : "false"
  })

  counter.textContent = `${nextIndex + 1} / ${slides.length}`
}

export function hydrateMessageImageCarousels(container: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  const children = Array.from(container.children)
  const ranges = findImageCarouselRanges(children.map((child) => isImageOnlyBlock(child)))

  for (const range of ranges) {
    const group = children.slice(range.start, range.end) as HTMLElement[]
    if (group.length > 1) {
      const wrapper = document.createElement("div")
      wrapper.className = "foundry-image-carousel"
      wrapper.dataset.foundryImageCarousel = "true"
      group[0].before(wrapper)

      const viewport = document.createElement("div")
      viewport.className = "foundry-image-carousel-viewport"

      const controls = document.createElement("div")
      controls.className = "foundry-image-carousel-controls"

      const prevButton = document.createElement("button")
      prevButton.type = "button"
      prevButton.className = "foundry-image-carousel-button"
      prevButton.textContent = "Previous"
      prevButton.setAttribute("aria-label", "Show previous image")

      const counter = document.createElement("span")
      counter.className = "foundry-image-carousel-counter"
      counter.setAttribute("aria-live", "polite")

      const nextButton = document.createElement("button")
      nextButton.type = "button"
      nextButton.className = "foundry-image-carousel-button"
      nextButton.textContent = "Next"
      nextButton.setAttribute("aria-label", "Show next image")

      controls.append(prevButton, counter, nextButton)

      const dots = document.createElement("div")
      dots.className = "foundry-image-carousel-dots"

      const slides = group.map((block, slideIndex) => {
        const slide = document.createElement("div")
        slide.className = "foundry-image-carousel-slide"
        slide.hidden = slideIndex !== 0
        slide.setAttribute("data-active", slideIndex === 0 ? "true" : "false")
        slide.appendChild(block)
        viewport.appendChild(slide)

        const dot = document.createElement("button")
        dot.type = "button"
        dot.className = "foundry-image-carousel-dot"
        dot.setAttribute("aria-label", `Show image ${slideIndex + 1}`)
        dots.appendChild(dot)

        return slide
      })

      wrapper.append(viewport, controls, dots)

      let activeIndex = 0
      const dotButtons = Array.from(dots.querySelectorAll<HTMLButtonElement>("button"))
      const render = (nextIndex: number) => {
        activeIndex = (nextIndex + slides.length) % slides.length
        setActiveCarouselSlide(slides, dotButtons, counter, activeIndex)
      }

      const handlePrev = () => render(activeIndex - 1)
      const handleNext = () => render(activeIndex + 1)

      prevButton.addEventListener("click", handlePrev)
      nextButton.addEventListener("click", handleNext)

      dotButtons.forEach((dot, dotIndex) => {
        const handleClick = () => render(dotIndex)
        dot.addEventListener("click", handleClick)
        cleanups.push(() => dot.removeEventListener("click", handleClick))
      })

      render(0)

      cleanups.push(() => {
        prevButton.removeEventListener("click", handlePrev)
        nextButton.removeEventListener("click", handleNext)
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
