export type TextSelectionSnapshot = {
  end: number
  scrollTop: number
  start: number
}

export function appendUploadMarkdown(draft: string, markdown: string): string {
  if (!draft) return markdown
  return draft.endsWith("\n") ? `${draft}${markdown}` : `${draft}\n${markdown}`
}

export function bytesFromMebibytes(value: number | null | undefined): number | null {
  if (!value || value <= 0) return null
  return value * 1024 * 1024
}

export function buildUploadTooLargeMessage(limitBytes: number | null): string {
  if (!limitBytes) {
    return "This file is larger than the current upload limit."
  }

  return `This file is larger than the current upload limit of ${formatFileSize(limitBytes)}.`
}

export function captureTextareaSelection(
  textarea: HTMLTextAreaElement | null | undefined,
): TextSelectionSnapshot | null {
  if (!textarea || document.activeElement !== textarea) return null

  return {
    end: textarea.selectionEnd,
    scrollTop: textarea.scrollTop,
    start: textarea.selectionStart,
  }
}

export function restoreTextareaSelection(
  textarea: HTMLTextAreaElement | null | undefined,
  selection: TextSelectionSnapshot | null,
) {
  if (!textarea || !selection) return

  textarea.focus()
  textarea.setSelectionRange(selection.start, selection.end)
  textarea.scrollTop = selection.scrollTop
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = -1

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex <= 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[Math.max(unitIndex, 0)]}`
}
