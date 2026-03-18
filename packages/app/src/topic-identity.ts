export function normalizeTopicName(topicName: string): string {
  return topicName.trim().replace(/\s+/g, " ").toLowerCase()
}

export function sameTopicName(left: string, right: string): boolean {
  return normalizeTopicName(left) === normalizeTopicName(right)
}
