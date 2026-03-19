/**
 * File attachment card enhancer — transforms plain file upload links into
 * rich attachment cards with file type icons, names, and download buttons.
 *
 * Follows Mattermost FileAttachment pattern:
 * - Detect links to /user_uploads/ that aren't wrapping images
 * - Replace with a structured card: icon + filename + extension + download
 *
 * This works as a DOM hydration function like hydrateCodeBlocks.
 */

const SVG_NS = "http://www.w3.org/2000/svg"

/** File type categories and their associated icons (SVG paths) */
const FILE_TYPE_ICONS: Record<string, { path: string; color: string }> = {
  pdf: {
    path: "M7 2h7l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1zm6 1v5h5M9 13h2v4M9 13a2 2 0 114 0M15 13l-2 4m2-4l-2 2",
    color: "#ef4444",
  },
  image: {
    path: "M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 16l5-5 3 3 4-4 4 4M14.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
    color: "#8b5cf6",
  },
  video: {
    path: "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm6 5l5 3-5 3V9z",
    color: "#f59e0b",
  },
  audio: {
    path: "M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z",
    color: "#22c55e",
  },
  archive: {
    path: "M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zm5 2v2m0 2v2m0 2v2m-1 0h2v2H9v-2z",
    color: "#f59e0b",
  },
  code: {
    path: "M7 2h7l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1zm6 1v5h5M10 12l-3 3 3 3M14 12l3 3-3 3",
    color: "#0d9488",
  },
  document: {
    path: "M7 2h7l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1zm6 1v5h5M9 13h6M9 17h4",
    color: "#6b7280",
  },
}

const EXTENSION_TYPES: Record<string, keyof typeof FILE_TYPE_ICONS> = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  webp: "image", bmp: "image", ico: "image", avif: "image",
  mp4: "video", webm: "video", avi: "video", mov: "video", mkv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", aac: "audio", m4a: "audio",
  zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive",
  js: "code", ts: "code", py: "code", rb: "code", rs: "code", go: "code",
  java: "code", c: "code", cpp: "code", h: "code", css: "code", html: "code",
  json: "code", yaml: "code", yml: "code", xml: "code", sh: "code",
}

function getFileType(filename: string): keyof typeof FILE_TYPE_ICONS {
  const ext = filename.split(".").pop()?.toLowerCase() || ""
  return EXTENSION_TYPES[ext] || "document"
}

function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase() || ""
  return ext
}

function createFileIcon(fileType: keyof typeof FILE_TYPE_ICONS): SVGSVGElement {
  const config = FILE_TYPE_ICONS[fileType]
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", config.color)
  svg.setAttribute("stroke-width", "1.5")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("width", "24")
  svg.setAttribute("height", "24")
  svg.setAttribute("aria-hidden", "true")
  svg.style.flexShrink = "0"

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", config.path)
  svg.appendChild(path)

  return svg
}

function createDownloadIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("width", "14")
  svg.setAttribute("height", "14")
  svg.setAttribute("aria-hidden", "true")

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3")
  svg.appendChild(path)

  return svg
}

/**
 * Detect plain file-upload links (not image wrappers) and replace them
 * with rich attachment card HTML.
 *
 * Returns a cleanup function.
 */
function normalizeUploadPath(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname.replace("/user_uploads/download/", "/user_uploads/")
  } catch {
    return url.replace("/user_uploads/download/", "/user_uploads/")
  }
}

function triggerFileDownload(
  url: string,
  options?: { downloadFile?: (url: string) => void | Promise<void> },
) {
  if (!url) return
  if (options?.downloadFile) {
    void options.downloadFile(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

export function hydrateFileAttachmentCards(
  container: HTMLElement,
  serverUrl?: string,
  options?: { downloadFile?: (url: string) => void | Promise<void> },
): () => void {
  const cleanups: Array<() => void> = []

  // Collect upload paths already displayed in image galleries or as inline
  // image previews — suppress duplicate file cards for these images
  const galleryUploadPaths = new Set<string>()
  for (const gallery of container.querySelectorAll<HTMLElement>(".foundry-image-gallery")) {
    for (const link of gallery.querySelectorAll<HTMLAnchorElement>(".foundry-image-gallery-open, .foundry-image-gallery-download")) {
      const href = link.getAttribute("href")
      if (href) galleryUploadPaths.add(normalizeUploadPath(href))
    }
  }
  // Also collect from single inline image previews (.message_inline_image)
  for (const inlineImage of container.querySelectorAll<HTMLElement>(".message_inline_image")) {
    const link = inlineImage.querySelector<HTMLAnchorElement>("a[href], a[data-original-href]")
    const href = link?.getAttribute("href") || link?.dataset.originalHref
    if (href) galleryUploadPaths.add(normalizeUploadPath(href))
  }

  for (const anchor of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href") || ""

    // Only process user uploads
    if (!href.includes("/user_uploads/")) continue

    // Skip if the link wraps an image (these are image attachments handled elsewhere)
    if (anchor.querySelector("img")) continue

    // Skip if already enhanced
    if (anchor.dataset.fileCardEnhanced === "true") continue

    // Skip links inside image galleries
    if (anchor.closest(".foundry-image-gallery")) continue

    // Hide links whose upload is already shown in a gallery,
    // plus adjacent <br> and whitespace nodes that would leave a gap
    if (galleryUploadPaths.has(normalizeUploadPath(href))) {
      anchor.style.display = "none"
      anchor.dataset.fileCardEnhanced = "true"
      // Remove surrounding <br> and whitespace-only text nodes
      for (const sibling of [anchor.previousSibling, anchor.nextSibling]) {
        if (!sibling) continue
        if (sibling instanceof HTMLBRElement) {
          sibling.remove()
        } else if (sibling.nodeType === Node.TEXT_NODE && !(sibling.textContent || "").trim()) {
          sibling.remove()
        }
      }
      continue
    }

    // Get the filename from link text or URL
    const linkText = anchor.textContent?.trim() || ""
    const filename = linkText || href.split("/").pop() || "file"
    const fileType = getFileType(filename)
    const ext = getFileExtension(filename)

    // Don't enhance image links that are displayed inline
    if (fileType === "image" && anchor.closest("p")?.querySelector("img")) continue

    // Mark as enhanced
    anchor.dataset.fileCardEnhanced = "true"

    // Create the card
    const card = document.createElement("div")
    card.className = "file-attachment-card"
    card.setAttribute("role", "group")
    card.setAttribute("aria-label", `File attachment: ${filename}`)

    const iconSection = document.createElement("div")
    iconSection.className = "file-attachment-icon"
    iconSection.appendChild(createFileIcon(fileType))

    const infoSection = document.createElement("div")
    infoSection.className = "file-attachment-info"

    const nameEl = document.createElement("span")
    nameEl.className = "file-attachment-name"
    nameEl.textContent = filename
    nameEl.title = filename

    const metaEl = document.createElement("span")
    metaEl.className = "file-attachment-meta"
    metaEl.textContent = ext ? ext : "File"

    infoSection.append(nameEl, metaEl)

    const downloadBtn = document.createElement("button")
    downloadBtn.type = "button"
    downloadBtn.className = "file-attachment-download"
    downloadBtn.setAttribute("aria-label", `Download ${filename}`)
    downloadBtn.setAttribute("title", "Download")
    downloadBtn.appendChild(createDownloadIcon())

    const handleDownload = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      triggerFileDownload(href, options)
    }
    downloadBtn.addEventListener("click", handleDownload)
    cleanups.push(() => downloadBtn.removeEventListener("click", handleDownload))

    card.append(iconSection, infoSection, downloadBtn)

    // Replace the anchor's parent paragraph or the anchor itself
    const parentP = anchor.closest("p")
    if (parentP && parentP.childNodes.length === 1) {
      // The paragraph only contains this link — replace the whole paragraph
      parentP.replaceWith(card)
    } else if (parentP && parentP.textContent?.trim() === linkText) {
      // Paragraph text is just the filename link
      parentP.replaceWith(card)
    } else {
      // Link is inline with other text — insert card after and hide original link
      anchor.style.display = "none"
      anchor.after(card)
    }
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}
