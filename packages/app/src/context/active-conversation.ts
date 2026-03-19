import { primaryNarrowForMessage } from "./message-cache"
import { parseNarrow } from "./navigation-utils"
import { sameTopicName } from "../topic-identity"
import type { Message } from "./zulip-sync"

function sameUserIds(left: number[] = [], right: number[] = []): boolean {
  return left.length === right.length && left.every((userId, index) => userId === right[index])
}

export function isMessageInActiveConversation(activeNarrow: string | null, message: Message): boolean {
  const activeParsed = activeNarrow ? parseNarrow(activeNarrow) : null
  const messageNarrow = primaryNarrowForMessage(message)
  const messageParsed = messageNarrow ? parseNarrow(messageNarrow) : null

  if (!activeParsed || !messageParsed) {
    return false
  }

  if (activeParsed.type === "topic" && messageParsed.type === "topic") {
    return (
      activeParsed.streamId === messageParsed.streamId
      && sameTopicName(activeParsed.topic || "", messageParsed.topic || "")
    )
  }

  if (activeParsed.type === "dm" && messageParsed.type === "dm") {
    return sameUserIds(activeParsed.userIds, messageParsed.userIds)
  }

  return false
}
