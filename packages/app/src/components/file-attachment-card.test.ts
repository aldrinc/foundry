import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { parseHTML } from "linkedom"
import { hydrateFileAttachmentCards } from "./file-attachment-card"

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
    HTMLBRElement: window.HTMLBRElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Event: window.Event,
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

beforeEach(() => {
  restoreDom = installDom()
})

afterEach(() => {
  restoreDom?.()
  restoreDom = null
})

describe("hydrateFileAttachmentCards", () => {
  test("turns upload links into buttons that invoke a single download callback", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <p><a href="/user_uploads/1/files/spec.pdf">spec.pdf</a></p>
    `

    const downloads: string[] = []
    const cleanup = hydrateFileAttachmentCards(container, undefined, {
      downloadFile: (url) => {
        downloads.push(url)
      },
    })

    const card = container.querySelector<HTMLElement>(".file-attachment-card")
    const downloadButton = container.querySelector<HTMLButtonElement>(".file-attachment-download")

    expect(card).toBeTruthy()
    expect(downloadButton).toBeTruthy()

    click(downloadButton!)
    expect(downloads).toEqual(["/user_uploads/1/files/spec.pdf"])

    cleanup()
  })
})
