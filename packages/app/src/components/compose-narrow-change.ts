/**
 * Handles narrow (conversation) change in the compose box:
 * loads the draft, clears transient state, and schedules focus on the
 * compose textarea so the user can start typing immediately after
 * clicking a DM or channel.
 *
 * Uses setTimeout(0) to defer focus until after the click event that
 * triggered the narrow change finishes, preventing the browser from
 * overriding programmatic focus with its native focus-to-clicked-button
 * behavior.
 */
export function handleNarrowChange(
  narrow: string,
  drafts: Record<string, string>,
  setContent: (s: string) => void,
  setError: (s: string) => void,
  setUploadError: (s: string) => void,
  setUploadedImages: (imgs: { name: string; markdown: string; previewUrl: string | null }[]) => void,
  focusCompose: () => void,
) {
  const draft = drafts[narrow]
  setContent(draft || "")
  setError("")
  setUploadError("")
  setUploadedImages([])
  focusCompose()
}
