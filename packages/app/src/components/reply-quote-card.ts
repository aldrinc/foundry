/**
 * Reply quote card hydrator — transforms the reply pattern into a
 * Slack-style reply card with avatar, sender, wrapped quote text,
 * and a "View conversation" link.
 *
 * The Zulip server renders reply quotes as a single <p> containing the
 * "Original:" link, a <br>, and the "@sender said:" mention, followed by
 * a <blockquote>. This hydrator detects that two-element pattern and
 * replaces it with a structured card.
 *
 * Works as a DOM hydration function like hydrateCodeBlocks and
 * hydrateFileAttachmentCards.
 */

const SVG_NS = "http://www.w3.org/2000/svg"

// Person silhouette icon (matches Slack's quoted-message avatar)
const PERSON_ICON_PATH = "M12 4a4 4 0 110 8 4 4 0 010-8zm0 10c-4.42 0-8 1.79-8 4v1h16v-1c0-2.21-3.58-4-8-4z"

/**
 * Detect the two-element reply pattern in a container. The actual server
 * HTML structure is:
 *
 * ```html
 * <p>Original: <a href="...">...</a><br>
 * <span class="user-mention silent" data-user-id="...">Sender</span> said:</p>
 * <blockquote><p>quoted text</p></blockquote>
 * ```
 *
 * Both "Original:" and "said:" live in the same <p>, separated by <br>.
 */
export interface DetectedReply {
  /** The two DOM elements that form the reply pattern */
  elements: [HTMLElement, HTMLElement]
  /** href from the original message link */
  href: string
  /** The quoted text from the blockquote */
  quoteText: string
  /** The sender name from the mention span */
  senderName: string
}

export function detectReplyPatterns(container: HTMLElement): DetectedReply[] {
  const results: DetectedReply[] = []
  const children = Array.from(container.children) as HTMLElement[]

  for (let i = 0; i < children.length - 1; i++) {
    const first = children[i]
    const second = children[i + 1]

    // Step 1: First element must be a <p> whose text starts with "Original:"
    // and ends with "said:", containing both an <a> link and a .user-mention span
    if (first.tagName !== "P") continue
    const firstText = (first.textContent || "").trim()
    if (!firstText.startsWith("Original:")) continue
    if (!firstText.endsWith("said:")) continue

    const link = first.querySelector("a[href]") as HTMLAnchorElement | null
    if (!link) continue
    const href = link.getAttribute("href") || ""

    const mentionSpan = first.querySelector(".user-mention") as HTMLElement | null
    if (!mentionSpan) continue
    const senderName = (mentionSpan.textContent || "").trim()

    // Step 2: Next sibling must be a <blockquote>
    if (second.tagName !== "BLOCKQUOTE") continue
    const quoteText = (second.textContent || "").trim()

    results.push({
      elements: [first, second],
      href,
      quoteText,
      senderName,
    })

    // Skip past the blockquote
    i += 1
  }

  return results
}

function createPersonIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "currentColor")
  svg.setAttribute("width", "20")
  svg.setAttribute("height", "20")
  svg.setAttribute("aria-hidden", "true")
  svg.classList.add("foundry-reply-icon")

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", PERSON_ICON_PATH)
  svg.appendChild(path)

  return svg
}

function buildReplyCard(reply: DetectedReply): HTMLElement {
  const card = document.createElement("div")
  card.className = "foundry-reply-card"
  card.dataset.foundryReply = "true"

  // Icon column — person avatar, top-aligned
  card.appendChild(createPersonIcon())

  // Content column — sender, quote text, metadata
  const content = document.createElement("div")
  content.className = "foundry-reply-content"

  const sender = document.createElement("span")
  sender.className = "foundry-reply-sender"
  sender.textContent = reply.senderName

  const preview = document.createElement("div")
  preview.className = "foundry-reply-text"
  preview.textContent = reply.quoteText

  const meta = document.createElement("a")
  meta.className = "foundry-reply-meta"
  meta.setAttribute("href", reply.href)
  meta.textContent = "View conversation"

  content.append(sender, preview, meta)
  card.appendChild(content)

  return card
}

/**
 * Detect reply quote patterns in the container and replace them with
 * Slack-style reply cards.
 *
 * Returns a cleanup function.
 */
export function hydrateReplyQuotes(container: HTMLElement): () => void {
  const replies = detectReplyPatterns(container)

  for (const reply of replies) {
    const card = buildReplyCard(reply)
    const [headerP, blockquote] = reply.elements

    // Insert the card before the header paragraph, then remove both
    headerP.before(card)
    headerP.remove()
    blockquote.remove()
  }

  // No event listeners to clean up — the card link navigation is handled
  // by the existing handleContentClick in message-item.tsx
  return () => {}
}
