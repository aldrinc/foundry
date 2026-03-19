type MessageWithId = { id: number }

export function countNewlyAppendedMessages(
  previousMessages: readonly MessageWithId[] | undefined,
  nextMessages: readonly MessageWithId[],
): number {
  const previousNewestId = previousMessages?.[previousMessages.length - 1]?.id
  if (previousNewestId === undefined) return 0

  let appendedCount = 0
  for (const message of nextMessages) {
    if (message.id > previousNewestId) appendedCount += 1
  }

  return appendedCount
}
