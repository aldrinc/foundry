import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { parseHTML } from "linkedom"
import {
  findImageCarouselRanges,
  getUserUploadDownloadUrl,
  hydrateMessageImageCarousels,
  isMessageImageLink,
  normalizeGalleryIndex,
  openMessageImageViewerFromLink,
  resolveAuthenticatedMediaUrl,
  resolveMessageUrl,
  shouldFetchAuthenticatedMedia,
} from "./message-html"

let restoreDom: (() => void) | null = null

function installDom() {
  const { window } = parseHTML("<!doctype html><html><body></body></html>")
  const target = globalThis as Record<string, unknown>
  const previous = new Map<string, unknown>()

  const bindings: Record<string, unknown> = {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLImageElement: window.HTMLImageElement,
    SVGElement: window.SVGElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
  }

  for (const [key, value] of Object.entries(bindings)) {
    previous.set(key, target[key])
    target[key] = value
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (typeof value === "undefined") {
        delete target[key]
        continue
      }
      target[key] = value
    }
  }
}

function click(element: Element) {
  element.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }))
}

function pressKey(element: Element, key: string) {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as Event & { key: string }
  Object.defineProperty(event, "key", { value: key })
  element.dispatchEvent(event)
}

beforeEach(() => {
  restoreDom = installDom()
})

afterEach(() => {
  restoreDom?.()
  restoreDom = null
})

describe("resolveMessageUrl", () => {
  test("preserves absolute urls", () => {
    expect(resolveMessageUrl("https://example.com/path")).toBe("https://example.com/path")
    expect(resolveMessageUrl("mailto:test@example.com")).toBe("mailto:test@example.com")
  })

  test("resolves relative upload urls against the current realm", () => {
    expect(resolveMessageUrl("/user_uploads/1/file.png", "https://chat.example.com")).toBe(
      "https://chat.example.com/user_uploads/1/file.png",
    )
  })

  test("leaves relative urls alone when the realm url is unavailable", () => {
    expect(resolveMessageUrl("/user_uploads/1/file.png")).toBe("/user_uploads/1/file.png")
  })
})

describe("getUserUploadDownloadUrl", () => {
  test("rewrites same-origin upload links to the download endpoint", () => {
    expect(
      getUserUploadDownloadUrl("/user_uploads/1/path/stage-3-agent-architecture-spec.md", "https://chat.example.com"),
    ).toBe("https://chat.example.com/user_uploads/download/1/path/stage-3-agent-architecture-spec.md")
  })

  test("preserves upload links that already target the download endpoint", () => {
    expect(
      getUserUploadDownloadUrl("https://chat.example.com/user_uploads/download/1/path/file.md", "https://chat.example.com"),
    ).toBe("https://chat.example.com/user_uploads/download/1/path/file.md")
  })

  test("ignores upload links on a different origin", () => {
    expect(
      getUserUploadDownloadUrl("https://files.example.com/user_uploads/1/path/file.md", "https://chat.example.com"),
    ).toBeUndefined()
  })

  test("ignores non-upload links", () => {
    expect(getUserUploadDownloadUrl("/help", "https://chat.example.com")).toBeUndefined()
  })
})

describe("shouldFetchAuthenticatedMedia", () => {
  test("requires same-origin realm-hosted uploads", () => {
    expect(
      shouldFetchAuthenticatedMedia(
        "https://chat.example.invalid/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        "https://chat.example.invalid",
      ),
    ).toBe(true)
  })

  test("ignores public same-origin static assets", () => {
    expect(
      shouldFetchAuthenticatedMedia(
        "https://chat.example.invalid/static/images/story-tutorial/zulip-compose.png",
        "https://chat.example.invalid",
      ),
    ).toBe(false)
  })

  test("ignores foreign origins", () => {
    expect(
      shouldFetchAuthenticatedMedia(
        "https://example.com/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        "https://chat.example.invalid",
      ),
    ).toBe(false)
  })
})

describe("resolveAuthenticatedMediaUrl", () => {
  test("prefers a protected thumbnail src when one is present", () => {
    expect(
      resolveAuthenticatedMediaUrl(
        "https://chat.example.invalid/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        null,
        "https://chat.example.invalid/user_uploads/3/5b/file.png",
        "https://chat.example.invalid",
      ),
    ).toBe("https://chat.example.invalid/user_uploads/thumbnail/3/5b/file.png/840x560.webp")
  })

  test("falls back to the protected upload link when the image src is a loader placeholder", () => {
    expect(
      resolveAuthenticatedMediaUrl(
        "https://chat.example.invalid/static/images/loading/loader-black.svg",
        null,
        "/user_uploads/3/5b/file.png",
        "https://chat.example.invalid",
      ),
    ).toBe("https://chat.example.invalid/user_uploads/3/5b/file.png")
  })

  test("uses data-original-src for markdown image placeholders", () => {
    expect(
      resolveAuthenticatedMediaUrl(
        "/static/images/loading/loader-black.svg",
        "/user_uploads/3/5b/file.png",
        null,
        "https://chat.example.invalid",
      ),
    ).toBe("https://chat.example.invalid/user_uploads/3/5b/file.png")
  })
})

describe("findImageCarouselRanges", () => {
  test("returns only consecutive runs with at least two image-only blocks", () => {
    expect(
      findImageCarouselRanges([true, true, false, true, false, true, true, true]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ])
  })

  test("ignores isolated image blocks", () => {
    expect(findImageCarouselRanges([false, true, false, true, false])).toEqual([])
  })
})

describe("normalizeGalleryIndex", () => {
  test("wraps backward and forward movement across the gallery bounds", () => {
    expect(normalizeGalleryIndex(-1, 4)).toBe(3)
    expect(normalizeGalleryIndex(4, 4)).toBe(0)
    expect(normalizeGalleryIndex(7, 4)).toBe(3)
  })
})

describe("isMessageImageLink", () => {
  test("detects inline image links", () => {
    const link = document.createElement("a")
    link.setAttribute("href", "/user_uploads/1/files/report.png")
    link.innerHTML = `<img src="/user_uploads/thumbnail/1/files/report.png/200x200.webp" alt="Report">`

    expect(isMessageImageLink(link, "https://chat.example.invalid")).toBe(true)
  })

  test("detects image-file links without an inline thumbnail", () => {
    const link = document.createElement("a")
    link.setAttribute("href", "https://example.com/report.webp")

    expect(isMessageImageLink(link, "https://chat.example.invalid")).toBe(true)
  })

  test("ignores normal document links", () => {
    const link = document.createElement("a")
    link.setAttribute("href", "/user_uploads/1/files/spec.pdf")

    expect(isMessageImageLink(link, "https://chat.example.invalid")).toBe(false)
  })
})

describe("openMessageImageViewerFromLink", () => {
  test("opens a standalone viewer for a single clicked image link", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <p>
        <a href="https://example.com/image-full.png">
          <img src="https://example.com/image-thumb.png" alt="Screenshot">
        </a>
      </p>
    `

    const link = container.querySelector<HTMLAnchorElement>("a")!
    const opened = openMessageImageViewerFromLink(container, link, {
      serverUrl: "https://example.com",
    })

    expect(opened).toBe(true)

    const lightbox = container.querySelector<HTMLDivElement>(".foundry-image-lightbox")
    const viewerImage = container.querySelector<HTMLImageElement>(".foundry-image-lightbox-image")
    const downloadLink = container.querySelector<HTMLAnchorElement>(".foundry-image-lightbox-download")
    const externalLink = container.querySelector<HTMLAnchorElement>(".foundry-image-lightbox-link")
    const closeButton = container.querySelector<HTMLButtonElement>(".foundry-image-lightbox-close")

    expect(lightbox).toBeTruthy()
    expect(viewerImage?.getAttribute("src")).toBe("https://example.com/image-full.png")
    expect(downloadLink?.getAttribute("href")).toBe("https://example.com/image-full.png")
    expect(externalLink?.getAttribute("href")).toBe("https://example.com/image-full.png")

    click(closeButton!)
    expect(container.querySelector(".foundry-image-lightbox")).toBeNull()
  })
})

describe("hydrateMessageImageCarousels", () => {
  test("replaces consecutive image-only blocks with a thumbnail gallery and in-app viewer", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <p><a href="https://example.com/image-1-full.png"><img src="https://example.com/image-1-thumb.png" alt="Image 1"></a></p>
      <p><a href="https://example.com/image-2-full.png"><img src="https://example.com/image-2-thumb.png" alt="Image 2"></a></p>
      <p><a href="https://example.com/image-3-full.png"><img src="https://example.com/image-3-thumb.png" alt="Image 3"></a></p>
    `

    const notifications: string[] = []
    const cleanup = hydrateMessageImageCarousels(container, {
      onViewerImageChange: () => notifications.push("changed"),
      serverUrl: "https://example.com",
    })

    expect(container.children).toHaveLength(1)
    expect(container.querySelectorAll(".foundry-image-gallery-thumb")).toHaveLength(3)
    expect(container.querySelectorAll(".foundry-image-gallery-download")).toHaveLength(3)
    expect(container.querySelector(".foundry-image-gallery-download-all")).toBeTruthy()
    expect(container.querySelector(".foundry-image-lightbox")).toBeTruthy()

    const thumbButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".foundry-image-gallery-thumb"),
    )
    click(thumbButtons[1])

    const lightbox = container.querySelector<HTMLDivElement>(".foundry-image-lightbox")
    const viewerImage = container.querySelector<HTMLImageElement>(".foundry-image-lightbox-image")
    const counter = container.querySelector<HTMLSpanElement>(".foundry-image-lightbox-counter")
    const downloadLink = container.querySelector<HTMLAnchorElement>(".foundry-image-lightbox-download")
    const externalLink = container.querySelector<HTMLAnchorElement>(".foundry-image-lightbox-link")
    const dialog = container.querySelector<HTMLDivElement>(".foundry-image-lightbox-dialog")

    expect(lightbox?.hidden).toBe(false)
    expect(counter?.textContent).toBe("2 / 3")
    expect(viewerImage?.getAttribute("src")).toBe("https://example.com/image-2-full.png")
    expect(downloadLink?.getAttribute("href")).toBe("https://example.com/image-2-full.png")
    expect(externalLink?.getAttribute("href")).toBe("https://example.com/image-2-full.png")
    expect(notifications).toHaveLength(1)

    pressKey(dialog!, "ArrowRight")
    expect(counter?.textContent).toBe("3 / 3")
    expect(viewerImage?.getAttribute("src")).toBe("https://example.com/image-3-full.png")
    expect(notifications).toHaveLength(2)

    pressKey(dialog!, "Escape")
    expect(lightbox?.hidden).toBe(true)

    cleanup()
  })

  test("removes duplicate image upload links and downloads the full set from the gallery", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <p>
        <a href="/user_uploads/1/files/image-1.png">image-1.png</a><br>
        <a href="/user_uploads/1/files/image-2.png">image-2.png</a><br>
        <a href="/user_uploads/1/files/image-3.png">image-3.png</a>
      </p>
      <p><a href="/user_uploads/1/files/image-1.png"><img src="/user_uploads/thumbnail/1/files/image-1.png/200x200.webp" alt="Image 1"></a></p>
      <p><a href="/user_uploads/1/files/image-2.png"><img src="/user_uploads/thumbnail/1/files/image-2.png/200x200.webp" alt="Image 2"></a></p>
      <p><a href="/user_uploads/1/files/image-3.png"><img src="/user_uploads/thumbnail/1/files/image-3.png/200x200.webp" alt="Image 3"></a></p>
    `

    const downloads: string[] = []
    const cleanup = hydrateMessageImageCarousels(container, {
      openLink: (url) => downloads.push(url),
      serverUrl: "https://chat.example.invalid",
    })

    expect(container.children).toHaveLength(1)
    expect(container.textContent || "").not.toContain("image-1.png")

    const downloadAllButton = container.querySelector<HTMLButtonElement>(".foundry-image-gallery-download-all")
    click(downloadAllButton!)

    expect(downloads).toEqual([
      "https://chat.example.invalid/user_uploads/download/1/files/image-1.png",
      "https://chat.example.invalid/user_uploads/download/1/files/image-2.png",
      "https://chat.example.invalid/user_uploads/download/1/files/image-3.png",
    ])

    cleanup()
  })

  test("prefers the hydrated thumbnail as a viewer preview before fetching authenticated originals", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <p>
        <a href="https://chat.example.invalid/user_uploads/3/5b/file-1.png">
          <img
            src="https://chat.example.invalid/user_uploads/thumbnail/3/5b/file-1.png/300x200.webp"
            data-original-src="https://chat.example.invalid/user_uploads/3/5b/file-1.png"
            alt="Image 1"
          >
        </a>
      </p>
      <p>
        <a href="https://chat.example.invalid/user_uploads/3/5b/file-2.png">
          <img
            src="https://chat.example.invalid/user_uploads/thumbnail/3/5b/file-2.png/300x200.webp"
            data-original-src="https://chat.example.invalid/user_uploads/3/5b/file-2.png"
            alt="Image 2"
          >
        </a>
      </p>
    `

    const cleanup = hydrateMessageImageCarousels(container, {
      serverUrl: "https://chat.example.invalid",
    })

    const firstThumb = container.querySelector<HTMLButtonElement>(".foundry-image-gallery-thumb")
    click(firstThumb!)

    const viewerImage = container.querySelector<HTMLImageElement>(".foundry-image-lightbox-image")
    expect(viewerImage?.getAttribute("src")).toBe(
      "https://chat.example.invalid/user_uploads/thumbnail/3/5b/file-1.png/300x200.webp",
    )
    expect(viewerImage?.getAttribute("data-original-src")).toBe(
      "https://chat.example.invalid/user_uploads/3/5b/file-1.png",
    )
    expect(viewerImage?.getAttribute("data-foundry-auth-prefer-original")).toBe("true")

    cleanup()
  })
})
