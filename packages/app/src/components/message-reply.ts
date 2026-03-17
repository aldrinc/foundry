import type { Message, Subscription } from "../context/zulip-sync"
import { buildDirectMessageLinkMarkdown, buildMessageLinkMarkdown } from "./zulip-link-utils"

const ATTACHMENT_FALLBACK_TEXT = "(attached file)"
const REPLY_PREVIEW_LIMIT = 200

type ReplyableMessage = Pick<
  Message,
  "content" | "display_recipient" | "id" | "sender_full_name" | "stream_id" | "subject"
>

export interface ReplyTarget {
  messageId: number
  previewText: string
  prefixMarkdown: string
  senderFullName: string
  topicName?: string
}

export function buildReplyTarget(
  message: ReplyableMessage,
  subscriptions: Pick<Subscription, "name" | "stream_id">[],
): ReplyTarget {
  const quoteText = extractReplyQuoteText(message.content)
  const previewText = truncateReplyPreview(normalizeWhitespace(quoteText))
  const originalLink = buildOriginalMessageLinkMarkdown(message, subscriptions)

  return {
    messageId: message.id,
    previewText,
    prefixMarkdown: `Original: ${originalLink}\n@_**${message.sender_full_name}** said:\n${buildQuoteBlock(quoteText)}\n\n`,
    senderFullName: message.sender_full_name,
    topicName: typeof message.stream_id === "number" ? message.subject : undefined,
  }
}

export function buildReplyMessage(target: ReplyTarget, messageText: string): string {
  return `${target.prefixMarkdown}${messageText.trim()}`
}

function buildOriginalMessageLinkMarkdown(
  message: ReplyableMessage,
  subscriptions: Pick<Subscription, "name" | "stream_id">[],
): string {
  if (typeof message.stream_id === "number") {
    const streamName = subscriptions.find((subscription) => subscription.stream_id === message.stream_id)?.name
      || `stream-${message.stream_id}`
    return buildMessageLinkMarkdown(message.stream_id, streamName, message.subject, message.id)
  }

  if (Array.isArray(message.display_recipient)) {
    const userIds = message.display_recipient
      .map((recipient) => recipient.id)
      .filter((userId) => Number.isFinite(userId))

    if (userIds.length > 0) {
      return buildDirectMessageLinkMarkdown(userIds, message.id)
    }
  }

  return `message ${message.id}`
}

function extractReplyQuoteText(html: string): string {
  const directText = normalizeReplyText(htmlToText(html))
  if (directText) {
    return directText
  }

  if (/<(?:img|video|audio)\b/i.test(html) || /href="[^"]*\/user_uploads\//i.test(html)) {
    return ATTACHMENT_FALLBACK_TEXT
  }

  return ATTACHMENT_FALLBACK_TEXT
}

function htmlToText(html: string): string {
  if (typeof document !== "undefined") {
    const node = document.createElement("div")
    node.innerHTML = html
    return node.innerText || node.textContent || ""
  }

  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
}

function normalizeReplyText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateReplyPreview(value: string): string {
  if (value.length <= REPLY_PREVIEW_LIMIT) {
    return value
  }

  return `${value.slice(0, REPLY_PREVIEW_LIMIT - 1).trimEnd()}…`
}

function buildQuoteBlock(text: string): string {
  const longestBacktickRun = (text.match(/`+/g) || [""])
    .reduce((longest, segment) => Math.max(longest, segment.length), 0)
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1))

  return `${fence}quote\n${text}\n${fence}`
}
