export function scrollToMessageWhenReady(
  messageId: number,
  options: {
    delayMs?: number
    maxAttempts?: number
  } = {},
): Promise<boolean> {
  const delayMs = options.delayMs ?? 150
  const maxAttempts = options.maxAttempts ?? 20

  return new Promise((resolve) => {
    let attempts = 0

    const tryScroll = () => {
      const messageElement = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
      if (messageElement) {
        messageElement.scrollIntoView({ block: "center" })
        resolve(true)
        return
      }

      attempts += 1
      if (attempts >= maxAttempts) {
        resolve(false)
        return
      }

      window.setTimeout(tryScroll, delayMs)
    }

    window.setTimeout(tryScroll, 0)
  })
}
