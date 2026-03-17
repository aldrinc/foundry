import { createEffect, createSignal, on } from "solid-js"
import { ComposeBox } from "./compose-box"
import { MessageList } from "./message-list"
import type { ReplyTarget } from "./message-reply"

export function ConversationView(props: { narrow: string; onToggleUserPanel?: () => void }) {
  const [replyTarget, setReplyTarget] = createSignal<ReplyTarget | null>(null)

  createEffect(on(
    () => props.narrow,
    () => setReplyTarget(null),
  ))

  return (
    <>
      <MessageList
        narrow={props.narrow}
        onReply={setReplyTarget}
        onToggleUserPanel={props.onToggleUserPanel}
      />
      <ComposeBox
        narrow={props.narrow}
        onClearReply={() => setReplyTarget(null)}
        replyTarget={replyTarget()}
      />
    </>
  )
}
