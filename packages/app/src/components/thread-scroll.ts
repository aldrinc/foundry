export const THREAD_SCROLL_TO_BOTTOM_EVENT = "foundry:thread-scroll-to-bottom"

export type ThreadScrollReason = "typing" | "send"

export type ThreadScrollDetail = {
  narrow: string
  reason: ThreadScrollReason
}

export function requestThreadScrollToBottom(
  narrow: string,
  reason: ThreadScrollReason,
): void {
  window.dispatchEvent(new CustomEvent<ThreadScrollDetail>(
    THREAD_SCROLL_TO_BOTTOM_EVENT,
    {
      detail: { narrow, reason },
    },
  ))
}
