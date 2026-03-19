import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { parseHTML } from "linkedom"

import { detectReplyPatterns, hydrateReplyQuotes } from "./reply-quote-card"

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
    SVGElement: window.SVGElement,
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

beforeEach(() => {
  restoreDom = installDom()
})

afterEach(() => {
  restoreDom?.()
  restoreDom = null
})

function createContainer(html: string): HTMLElement {
  const container = document.createElement("div")
  container.innerHTML = html
  return container
}

/** Builds server-rendered reply HTML matching actual Zulip output */
function replyHtml(opts: { href: string; sender: string; userId: string; quote: string; reply: string }): string {
  return [
    `<p>Original: <a href="${opts.href}" target="_blank" rel="noopener noreferrer">Direct message @ 💬</a><br>`,
    `<span class="user-mention silent" data-user-id="${opts.userId}">${opts.sender}</span> said:</p>`,
    `<blockquote><p>${opts.quote}</p></blockquote>`,
    `<p>${opts.reply}</p>`,
  ].join("\n")
}

describe("detectReplyPatterns", () => {
  test("detects a DM reply pattern (actual server HTML)", () => {
    const container = createContainer(replyHtml({
      href: "#narrow/dm/10,11,12/near/2668",
      sender: "Aldrin Clement",
      userId: "10",
      quote: "@Paul Clement no ATC here for internal funnel flow- you ok with that?",
      reply: "No we need to track page click from presales",
    }))

    const replies = detectReplyPatterns(container)
    expect(replies).toHaveLength(1)
    expect(replies[0].senderName).toBe("Aldrin Clement")
    expect(replies[0].quoteText).toBe("@Paul Clement no ATC here for internal funnel flow- you ok with that?")
    expect(replies[0].href).toBe("#narrow/dm/10,11,12/near/2668")
  })

  test("detects a stream message reply pattern", () => {
    const container = createContainer([
      '<p>Original: <a href="#narrow/channel/9-engineering/topic/roadmap/near/214">#engineering &gt; roadmap</a><br>',
      '<span class="user-mention silent" data-user-id="123">Alice Example</span> said:</p>',
      "<blockquote><p>Hello world</p></blockquote>",
      "<p>On it</p>",
    ].join("\n"))

    const replies = detectReplyPatterns(container)
    expect(replies).toHaveLength(1)
    expect(replies[0].senderName).toBe("Alice Example")
    expect(replies[0].quoteText).toBe("Hello world")
    expect(replies[0].href).toBe("#narrow/channel/9-engineering/topic/roadmap/near/214")
  })

  test("does not match non-reply blockquotes", () => {
    const container = createContainer([
      "<p>Here's what someone once said:</p>",
      "<blockquote><p>Wisdom is bliss</p></blockquote>",
      "<p>I agree.</p>",
    ].join(""))

    const replies = detectReplyPatterns(container)
    expect(replies).toHaveLength(0)
  })

  test("does not match when the paragraph lacks Original: prefix", () => {
    const container = createContainer([
      '<p>Not original: <a href="#narrow/dm/1/near/10">link</a><br>',
      '<span class="user-mention silent" data-user-id="7">Alice</span> said:</p>',
      "<blockquote><p>Quoted</p></blockquote>",
    ].join(""))
    expect(detectReplyPatterns(container)).toHaveLength(0)
  })

  test("does not match when blockquote is missing", () => {
    const container = createContainer([
      '<p>Original: <a href="#narrow/dm/1/near/10">DM</a><br>',
      '<span class="user-mention silent" data-user-id="7">Alice</span> said:</p>',
      "<p>This is not a blockquote</p>",
    ].join(""))
    expect(detectReplyPatterns(container)).toHaveLength(0)
  })

  test("does not match when user-mention span is missing", () => {
    const container = createContainer([
      '<p>Original: <a href="#narrow/dm/1/near/10">DM</a><br>',
      "someone said:</p>",
      "<blockquote><p>Quoted</p></blockquote>",
    ].join(""))
    expect(detectReplyPatterns(container)).toHaveLength(0)
  })

  test("detects multiple reply patterns in one message", () => {
    const html = replyHtml({
      href: "#narrow/dm/1/near/10",
      sender: "Alice",
      userId: "1",
      quote: "First quote",
      reply: "reply to first",
    }) + replyHtml({
      href: "#narrow/dm/2/near/20",
      sender: "Bob",
      userId: "2",
      quote: "Second quote",
      reply: "reply to second",
    })

    const container = createContainer(html)
    const replies = detectReplyPatterns(container)
    expect(replies).toHaveLength(2)
    expect(replies[0].senderName).toBe("Alice")
    expect(replies[1].senderName).toBe("Bob")
  })
})

describe("hydrateReplyQuotes", () => {
  test("replaces the reply pattern with a Slack-style block card", () => {
    const container = createContainer(replyHtml({
      href: "#narrow/dm/10,11,12/near/2668",
      sender: "Aldrin Clement",
      userId: "10",
      quote: "no ATC here for internal funnel flow",
      reply: "No we need to track page click",
    }))

    const cleanup = hydrateReplyQuotes(container)

    // The original elements should be gone
    expect(container.querySelector("blockquote")).toBeNull()
    expect(container.textContent).not.toContain("Original:")
    expect(container.textContent).not.toContain("said:")

    // A reply card should be present
    const card = container.querySelector(".foundry-reply-card")
    expect(card).not.toBeNull()

    // Card has a content column with sender, text, and meta
    const content = card!.querySelector(".foundry-reply-content")
    expect(content).not.toBeNull()

    const sender = card!.querySelector(".foundry-reply-sender")
    expect(sender?.textContent).toBe("Aldrin Clement")

    const preview = card!.querySelector(".foundry-reply-text")
    expect(preview?.textContent).toBe("no ATC here for internal funnel flow")

    // "View conversation" meta link with original href
    const meta = card!.querySelector<HTMLAnchorElement>(".foundry-reply-meta")
    expect(meta?.textContent).toBe("View conversation")
    expect(meta?.getAttribute("href")).toBe("#narrow/dm/10,11,12/near/2668")

    // Reply text after the card should still be present
    expect(container.textContent).toContain("No we need to track page click")

    // Person avatar icon should be present
    const icon = card!.querySelector("svg.foundry-reply-icon")
    expect(icon).not.toBeNull()

    cleanup()
  })

  test("leaves non-reply blockquotes untouched", () => {
    const container = createContainer([
      "<blockquote><p>Just a regular quote</p></blockquote>",
      "<p>Some text</p>",
    ].join(""))

    hydrateReplyQuotes(container)

    expect(container.querySelector("blockquote")).not.toBeNull()
    expect(container.querySelector(".foundry-reply-card")).toBeNull()
  })

  test("preserves full quote text for wrapping (CSS handles clamping)", () => {
    const longText = "A".repeat(200)
    const container = createContainer(replyHtml({
      href: "#narrow/dm/1/near/10",
      sender: "Alice",
      userId: "1",
      quote: longText,
      reply: "reply",
    }))

    hydrateReplyQuotes(container)

    const preview = container.querySelector(".foundry-reply-text")
    expect(preview?.textContent).toBe(longText)
  })
})
