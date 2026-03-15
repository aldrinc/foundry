export type TodoTaskDraft = {
  name: string
  description: string
}

export type GifProvider = "tenor" | "giphy"

export type GifSearchConfig = {
  giphyApiKey: string
  tenorApiKey: string
  gifRatingPolicy: number | null
  locale?: string
}

export type GifSearchResult = {
  previewUrl: string
  insertUrl: string
}

export const CALL_PROVIDER = {
  DISABLED: 0,
  JITSI: 1,
  ZOOM: 3,
  BIG_BLUE_BUTTON: 4,
  ZOOM_SERVER_TO_SERVER: 5,
  CONSTRUCTOR_GROUPS: 6,
  NEXTCLOUD_TALK: 7,
} as const

export function buildPollMessage(question: string, options: string[]): string {
  const normalizedQuestion = question.trim()
  const normalizedOptions = options
    .map((option) => option.trim())
    .filter(Boolean)
  return `/poll ${normalizedQuestion}\n${normalizedOptions.join("\n")}`
}

export function buildTodoMessage(title: string, tasks: TodoTaskDraft[]): string {
  const normalizedTitle = title.trim() || "Task list"
  const normalizedTasks = tasks
    .map(({ name, description }) => {
      const trimmedName = name.trim()
      const trimmedDescription = description.trim()
      if (!trimmedName) {
        return ""
      }
      if (!trimmedDescription) {
        return trimmedName
      }
      return `${trimmedName}: ${trimmedDescription}`
    })
    .filter(Boolean)

  return `/todo ${normalizedTitle}\n${normalizedTasks.join("\n")}`
}

export function buildGlobalTimeMessage(isoString: string): string {
  return `<time:${isoString}> `
}

export function buildCallMessage(url: string, isAudioCall: boolean): string {
  const label = isAudioCall ? "Join voice call." : "Join video call."
  return `[${label}](${url})`
}

export function buildInlineInsert(
  currentValue: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
) {
  const before = currentValue.slice(0, selectionStart)
  const after = currentValue.slice(selectionEnd)
  const value = `${before}${insertion}${after}`
  const cursor = before.length + insertion.length
  return { value, selectionStart: cursor, selectionEnd: cursor }
}

export function buildBlockInsert(
  currentValue: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
) {
  const before = currentValue.slice(0, selectionStart)
  const after = currentValue.slice(selectionEnd)
  const needsLeadingBreak = before.length > 0 && !before.endsWith("\n")
  const needsTrailingBreak = after.length > 0 && !after.startsWith("\n")
  const prefix = needsLeadingBreak ? "\n" : ""
  const suffix = needsTrailingBreak ? "\n" : ""
  const value = `${before}${prefix}${insertion}${suffix}${after}`
  const cursor = before.length + prefix.length + insertion.length
  return { value, selectionStart: cursor, selectionEnd: cursor }
}

export function formatDateTimeLocalValue(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hours = `${date.getHours()}`.padStart(2, "0")
  const minutes = `${date.getMinutes()}`.padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function createCurrentHourDate() {
  const value = new Date()
  value.setMinutes(0, 0, 0)
  return value
}

export function getVideoCallProviderName(providerId: number | null | undefined): string {
  switch (providerId) {
    case CALL_PROVIDER.JITSI:
      return "Jitsi Meet"
    case CALL_PROVIDER.ZOOM:
    case CALL_PROVIDER.ZOOM_SERVER_TO_SERVER:
      return "Zoom"
    case CALL_PROVIDER.BIG_BLUE_BUTTON:
      return "BigBlueButton"
    case CALL_PROVIDER.CONSTRUCTOR_GROUPS:
      return "Constructor Groups"
    case CALL_PROVIDER.NEXTCLOUD_TALK:
      return "Nextcloud Talk"
    default:
      return "call provider"
  }
}

export function getVideoCallDisabledReason(
  providerId: number | null | undefined,
  jitsiUrl?: string | null,
): string | null {
  if (providerId == null || providerId === CALL_PROVIDER.DISABLED) {
    return "This organization has not configured a call provider."
  }

  if (providerId === CALL_PROVIDER.JITSI && !jitsiUrl?.trim()) {
    return "This organization's Jitsi configuration is incomplete."
  }

  return null
}

export function getVoiceCallDisabledReason(
  providerId: number | null | undefined,
  jitsiUrl?: string | null,
): string | null {
  const genericReason = getVideoCallDisabledReason(providerId, jitsiUrl)
  if (genericReason) {
    return genericReason
  }

  if (
    providerId === CALL_PROVIDER.CONSTRUCTOR_GROUPS
    || providerId === CALL_PROVIDER.NEXTCLOUD_TALK
  ) {
    return `Voice calls are not available for ${getVideoCallProviderName(providerId)}.`
  }

  return null
}

export function getSavedSnippetDisabledReason(featureLevel: number | null | undefined): string | null {
  if (featureLevel != null && featureLevel < 297) {
    return "Saved snippets require a newer Foundry server."
  }

  return null
}

export function chooseGifProvider(config: GifSearchConfig): GifProvider | null {
  if (config.gifRatingPolicy === 0) {
    return null
  }

  if (config.tenorApiKey.trim()) {
    return "tenor"
  }

  if (config.giphyApiKey.trim()) {
    return "giphy"
  }

  return null
}

export function getGifDisabledReason(config: GifSearchConfig): string | null {
  if (config.gifRatingPolicy === 0) {
    return "GIFs are disabled by this organization."
  }

  if (chooseGifProvider(config) === null) {
    return "No GIF provider is configured for this organization."
  }

  return null
}

export function getGifRating(policy: number | null | undefined): "g" | "pg" | "pg-13" | "r" {
  switch (policy) {
    case 2:
      return "pg"
    case 3:
      return "pg-13"
    case 4:
      return "r"
    default:
      return "g"
  }
}

type TenorResult = {
  media_formats?: {
    mediumgif?: { url?: string }
    tinygif?: { url?: string }
  }
}

type GiphyResult = {
  images?: {
    downsized_medium?: { url?: string }
    fixed_height?: { url?: string }
  }
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

async function searchTenorGifs(config: GifSearchConfig, query: string): Promise<GifSearchResult[]> {
  const url = new URL(query.trim() ? "https://tenor.googleapis.com/v2/search" : "https://tenor.googleapis.com/v2/featured")
  url.searchParams.set("key", config.tenorApiKey)
  url.searchParams.set("client_key", "FoundryDesktop")
  url.searchParams.set("limit", "18")
  url.searchParams.set("media_filter", "tinygif,mediumgif")
  url.searchParams.set("locale", config.locale || "en")
  url.searchParams.set("contentfilter", tenorContentFilter(getGifRating(config.gifRatingPolicy)))
  if (query.trim()) {
    url.searchParams.set("q", query.trim())
  }

  const payload = await fetchJson<{ results?: TenorResult[] }>(url)
  return (payload.results || [])
    .map((result) => {
      const previewUrl = result.media_formats?.tinygif?.url
      const insertUrl = result.media_formats?.mediumgif?.url
      if (!previewUrl || !insertUrl) {
        return null
      }
      return { previewUrl, insertUrl }
    })
    .filter((result): result is GifSearchResult => result !== null)
}

async function searchGiphyGifs(config: GifSearchConfig, query: string): Promise<GifSearchResult[]> {
  const endpoint = query.trim()
    ? "https://api.giphy.com/v1/gifs/search"
    : "https://api.giphy.com/v1/gifs/trending"
  const url = new URL(endpoint)
  url.searchParams.set("api_key", config.giphyApiKey)
  url.searchParams.set("limit", "18")
  url.searchParams.set("offset", "0")
  url.searchParams.set("rating", getGifRating(config.gifRatingPolicy))
  url.searchParams.set("fields", "images.downsized_medium,images.fixed_height")
  if (query.trim()) {
    url.searchParams.set("q", query.trim())
    url.searchParams.set("lang", config.locale || "en")
  }

  const payload = await fetchJson<{ data?: GiphyResult[] }>(url)
  return (payload.data || [])
    .map((result) => {
      const previewUrl = result.images?.fixed_height?.url
      const insertUrl = result.images?.downsized_medium?.url
      if (!previewUrl || !insertUrl) {
        return null
      }
      return { previewUrl, insertUrl }
    })
    .filter((result): result is GifSearchResult => result !== null)
}

function tenorContentFilter(rating: "g" | "pg" | "pg-13" | "r") {
  switch (rating) {
    case "pg":
      return "medium"
    case "pg-13":
      return "low"
    case "r":
      return "off"
    default:
      return "high"
  }
}

export async function searchGifs(config: GifSearchConfig, query: string): Promise<GifSearchResult[]> {
  const provider = chooseGifProvider(config)
  if (provider === "tenor") {
    return searchTenorGifs(config, query)
  }
  if (provider === "giphy") {
    return searchGiphyGifs(config, query)
  }
  return []
}
