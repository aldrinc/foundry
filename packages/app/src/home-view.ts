export function homeViewToNarrow(homeView: string): string | null | undefined {
  const homeMap: Record<string, string | null> = {
    inbox: null,
    recent: "recent-topics",
    all: "all-messages",
  }
  return homeMap[homeView]
}
