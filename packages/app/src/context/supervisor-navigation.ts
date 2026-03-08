import type { Narrow } from "./navigation"
import { parseNarrow } from "./navigation-utils"

export function shouldKeepSupervisorOpenForNarrow(
  narrow: Narrow,
  streamId: number | null,
  topicName: string,
): boolean {
  if (!narrow) return false

  const parsed = parseNarrow(narrow)
  return parsed?.type === "topic" && parsed.streamId === streamId && parsed.topic === topicName
}
