import type { Subscription } from "../context/zulip-sync"

const INVALID_STREAM_TOPIC_REGEX = /[`>*&[\]]|(\$\$)/g
const EXPLICIT_URL_SCHEME_REGEX = /^[a-z][a-z\d+\-.]*:/i

export interface ParsedZulipConversationLink {
  kind: "stream" | "topic" | "message" | "dm"
  narrow: string
  messageId?: number
  streamId?: number
  streamName?: string
  topicName?: string
  userIds?: number[]
}

interface ParseLinkOptions {
  realmUrl?: string
  subscriptions?: Pick<Subscription, "stream_id" | "name">[]
}

function escapeInvalidStreamTopicCharacters(text: string): string {
  return text.replace(INVALID_STREAM_TOPIC_REGEX, (match) => {
    switch (match) {
      case "`":
        return "&#96;"
      case ">":
        return "&gt;"
      case "*":
        return "&#42;"
      case "&":
        return "&amp;"
      case "$$":
        return "&#36;&#36;"
      case "[":
        return "&#91;"
      case "]":
        return "&#93;"
      default:
        return match
    }
  })
}

function willProduceBrokenStreamTopicLink(text: string): boolean {
  return INVALID_STREAM_TOPIC_REGEX.test(text)
}

function buildChannelUrl(streamId: number, streamName: string): string {
  return `#narrow/channel/${streamId}-${encodeURIComponent(streamName)}`
}

function buildTopicUrl(streamId: number, streamName: string, topicName: string): string {
  return `${buildChannelUrl(streamId, streamName)}/topic/${encodeURIComponent(topicName)}`
}

function buildMessageUrl(streamId: number, streamName: string, topicName: string, messageId: number): string {
  return `${buildTopicUrl(streamId, streamName, topicName)}/near/${messageId}`
}

function buildMarkdownLink(label: string, url: string): string {
  return `[${label}](${url})`
}

function getTopicDisplayName(topicName: string): string {
  return topicName || "general chat"
}

export function buildStreamLinkMarkdown(streamId: number, streamName: string): string {
  if (willProduceBrokenStreamTopicLink(streamName)) {
    return buildMarkdownLink(
      `#${escapeInvalidStreamTopicCharacters(streamName)}`,
      buildChannelUrl(streamId, streamName),
    )
  }

  return `#**${streamName}**`
}

export function buildTopicLinkMarkdown(streamId: number, streamName: string, topicName: string): string {
  if (
    willProduceBrokenStreamTopicLink(streamName)
    || willProduceBrokenStreamTopicLink(topicName)
  ) {
    return buildMarkdownLink(
      `#${escapeInvalidStreamTopicCharacters(streamName)} > ${escapeInvalidStreamTopicCharacters(getTopicDisplayName(topicName))}`,
      buildTopicUrl(streamId, streamName, topicName),
    )
  }

  return `#**${streamName}>${topicName}**`
}

export function buildMessageLinkMarkdown(
  streamId: number,
  streamName: string,
  topicName: string,
  messageId: number,
): string {
  if (
    willProduceBrokenStreamTopicLink(streamName)
    || willProduceBrokenStreamTopicLink(topicName)
  ) {
    return buildMarkdownLink(
      `#${escapeInvalidStreamTopicCharacters(streamName)} > ${escapeInvalidStreamTopicCharacters(getTopicDisplayName(topicName))} @ 💬`,
      buildMessageUrl(streamId, streamName, topicName, messageId),
    )
  }

  return `#**${streamName}>${topicName}@${messageId}**`
}

export function buildDirectMessageLinkMarkdown(userIds: readonly number[], messageId?: number): string {
  const sortedIds = [...userIds].sort((left, right) => left - right)
  const url = messageId
    ? `#narrow/dm/${sortedIds.join(",")}/near/${messageId}`
    : `#narrow/dm/${sortedIds.join(",")}`

  return buildMarkdownLink(
    messageId ? "Direct message @ 💬" : "Direct message",
    url,
  )
}

function safeDecodeURIComponent(text: string): string {
  const normalized = text.replace(/\.(?=[\da-fA-F]{2})/g, "%")
  try {
    return decodeURIComponent(normalized)
  } catch {
    return text
  }
}

function resolveStreamName(
  streamId: number,
  segment: string,
  subscriptions?: Pick<Subscription, "stream_id" | "name">[],
): string | undefined {
  const subscriptionName = subscriptions?.find((subscription) => subscription.stream_id === streamId)?.name
  if (subscriptionName) return subscriptionName

  const decodedSegment = safeDecodeURIComponent(segment)
  const separatorIndex = decodedSegment.indexOf("-")
  if (separatorIndex < 0 || separatorIndex >= decodedSegment.length - 1) {
    return undefined
  }

  return decodedSegment.slice(separatorIndex + 1)
}

function parseStreamId(segment: string): number | null {
  const decodedSegment = safeDecodeURIComponent(segment)
  const idPart = decodedSegment.split("-", 1)[0]
  const streamId = Number.parseInt(idPart, 10)

  return Number.isFinite(streamId) ? streamId : null
}

function parseMessageId(segment: string | undefined): number | undefined {
  if (!segment) return undefined
  const messageId = Number.parseInt(segment, 10)
  return Number.isFinite(messageId) ? messageId : undefined
}

function parseDirectMessageUserIds(segment: string): number[] | null {
  const decodedSegment = safeDecodeURIComponent(segment)
  const match = decodedSegment.match(/^(\d+(?:,\d+)*)/)
  if (!match) return null

  const userIds = match[1].split(",")
    .map((part) => Number.parseInt(part, 10))
    .filter((userId) => Number.isFinite(userId))

  return userIds.length > 0 ? userIds : null
}

export function parseZulipConversationLink(
  rawLink: string,
  options: ParseLinkOptions = {},
): ParsedZulipConversationLink | null {
  const trimmed = rawLink.trim()
  if (!trimmed) return null

  const baseUrl = options.realmUrl || "https://foundry.invalid"

  let url: URL
  try {
    url = new URL(trimmed, baseUrl)
  } catch {
    return null
  }

  if (options.realmUrl && EXPLICIT_URL_SCHEME_REGEX.test(trimmed)) {
    try {
      if (url.origin !== new URL(options.realmUrl).origin) {
        return null
      }
    } catch {
      return null
    }
  }

  if (!url.hash.startsWith("#narrow")) {
    return null
  }

  const segments = url.hash.slice(1).split("/")
  if (segments[0] !== "narrow") return null

  const scope = segments[1]
  if (scope === "channel" || scope === "stream") {
    const streamSegment = segments[2]
    if (!streamSegment) return null

    const streamId = parseStreamId(streamSegment)
    if (streamId === null) return null

    const streamName = resolveStreamName(streamId, streamSegment, options.subscriptions)

    if (!segments[3]) {
      return {
        kind: "stream",
        narrow: `stream:${streamId}`,
        streamId,
        streamName,
      }
    }

    if (segments[3] === "near") {
      const messageId = parseMessageId(segments[4])
      return {
        kind: messageId === undefined ? "stream" : "message",
        narrow: `stream:${streamId}`,
        streamId,
        streamName,
        messageId,
      }
    }

    if (segments[3] !== "topic") return null

    const topicName = safeDecodeURIComponent(segments[4] ?? "")
    const narrow = `stream:${streamId}/topic:${topicName}`
    if (!segments[5]) {
      return {
        kind: "topic",
        narrow,
        streamId,
        streamName,
        topicName,
      }
    }

    if (segments[5] === "with") {
      return {
        kind: "topic",
        narrow,
        streamId,
        streamName,
        topicName,
      }
    }

    if (segments[5] !== "near") return null
    const messageId = parseMessageId(segments[6])

    return {
      kind: messageId === undefined ? "topic" : "message",
      narrow,
      streamId,
      streamName,
      topicName,
      messageId,
    }
  }

  if (scope === "dm") {
    const directMessageSegment = segments[2]
    if (!directMessageSegment) return null

    const userIds = parseDirectMessageUserIds(directMessageSegment)
    if (!userIds) return null

    const narrow = `dm:${userIds.join(",")}`
    let messageId: number | undefined
    if (segments[3] === "near") {
      messageId = parseMessageId(segments[4])
    }

    return {
      kind: messageId === undefined ? "dm" : "message",
      narrow,
      userIds,
      messageId,
    }
  }

  return null
}

export interface ParsedSameOriginRoute {
  narrow: string | null
}

const SAME_ORIGIN_HASH_ROUTES: Record<string, string | null> = {
  "#recent": "recent-topics",
  "#all": "all-messages",
  "#starred": "starred",
  "#inbox": null,
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname
  return pathname.replace(/\/+$/, "")
}

/**
 * Catch same-origin links that point back to the realm but weren't matched by
 * `parseZulipConversationLink` (which only handles `#narrow/…` hashes).
 *
 * Returns a route when the link is a same-origin URL we can handle in-app,
 * or `null` when the link should fall through to the browser.
 */
export function parseSameOriginHashRoute(
  rawLink: string,
  realmUrl: string | undefined,
): ParsedSameOriginRoute | null {
  if (!realmUrl) return null

  const trimmed = rawLink.trim()
  if (!trimmed) return null

  let url: URL
  let realm: URL
  try {
    url = new URL(trimmed, realmUrl)
    realm = new URL(realmUrl)
  } catch {
    return null
  }

  if (url.origin !== realm.origin) return null

  const samePath = normalizePathname(url.pathname) === normalizePathname(realm.pathname)
  const sameSearch = url.search === realm.search
  if (!samePath || !sameSearch) return null

  // Known hash routes
  const hash = url.hash
  if (hash in SAME_ORIGIN_HASH_ROUTES) {
    return { narrow: SAME_ORIGIN_HASH_ROUTES[hash] }
  }

  // Same-origin link with no hash or empty hash → inbox
  if (!hash || hash === "#") {
    return { narrow: null }
  }

  return null
}

export function transformZulipConversationLinkToMarkdown(
  rawLink: string,
  options: ParseLinkOptions = {},
): string | null {
  const parsedLink = parseZulipConversationLink(rawLink, options)
  if (!parsedLink) return null

  if (parsedLink.kind === "stream" && parsedLink.streamId !== undefined && parsedLink.streamName) {
    return buildStreamLinkMarkdown(parsedLink.streamId, parsedLink.streamName)
  }

  if (
    parsedLink.kind === "topic"
    && parsedLink.streamId !== undefined
    && parsedLink.streamName !== undefined
    && parsedLink.topicName !== undefined
  ) {
    return buildTopicLinkMarkdown(parsedLink.streamId, parsedLink.streamName, parsedLink.topicName)
  }

  if (
    parsedLink.kind === "message"
    && parsedLink.streamId !== undefined
    && parsedLink.streamName !== undefined
    && parsedLink.topicName !== undefined
    && parsedLink.messageId !== undefined
  ) {
    return buildMessageLinkMarkdown(
      parsedLink.streamId,
      parsedLink.streamName,
      parsedLink.topicName,
      parsedLink.messageId,
    )
  }

  if ((parsedLink.kind === "dm" || parsedLink.kind === "message") && parsedLink.userIds) {
    return buildDirectMessageLinkMarkdown(parsedLink.userIds, parsedLink.messageId)
  }

  return null
}
