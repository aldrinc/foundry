import { normalizeServerUrl } from "./zulip-auth"

const SUPPORTED_MESSAGE_DEEP_LINK_PROTOCOLS = new Set(["foundry:", "zulip:"])

export type MessageDeepLinkPayload = {
  orgId: string
  narrow: string
  messageId: number
  realm?: string
}

export function buildMessageDeepLinkUrl(props: {
  orgId: string
  narrow: string
  messageId: number
  realmUrl?: string | null
}): string {
  const url = new URL("foundry://message")
  url.searchParams.set("org_id", props.orgId)
  url.searchParams.set("narrow", props.narrow)
  url.searchParams.set("message_id", String(props.messageId))

  const realm = props.realmUrl?.trim()
  if (realm) {
    url.searchParams.set("realm", normalizeServerUrl(realm))
  }

  return url.toString()
}

export function parseMessageDeepLinkUrl(rawUrl: string): MessageDeepLinkPayload | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  if (!SUPPORTED_MESSAGE_DEEP_LINK_PROTOCOLS.has(parsed.protocol)) {
    return null
  }

  if (parsed.hostname !== "message" && parsed.pathname !== "/message") {
    return null
  }

  const orgId = parsed.searchParams.get("org_id")?.trim()
  const narrow = parsed.searchParams.get("narrow")?.trim()
  const messageId = Number.parseInt(parsed.searchParams.get("message_id") ?? "", 10)

  if (!orgId || !narrow || !Number.isFinite(messageId)) {
    return null
  }

  const realm = parsed.searchParams.get("realm")?.trim()

  return {
    orgId,
    narrow,
    messageId,
    ...(realm ? { realm: normalizeServerUrl(realm) } : {}),
  }
}

export function messageDeepLinkMatchesTarget(
  payload: MessageDeepLinkPayload,
  target: {
    orgId?: string | null
    realmUrl?: string | null
  },
): boolean {
  if (target.orgId && target.orgId === payload.orgId) {
    return true
  }

  if (payload.realm && target.realmUrl) {
    return normalizeServerUrl(target.realmUrl) === payload.realm
  }

  return false
}

export function sameMessageDeepLink(
  left: MessageDeepLinkPayload | null | undefined,
  right: MessageDeepLinkPayload | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right
  }

  return left.orgId === right.orgId
    && left.narrow === right.narrow
    && left.messageId === right.messageId
    && left.realm === right.realm
}
