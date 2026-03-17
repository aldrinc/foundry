import { describe, expect, test } from "bun:test"

import { buildReplyMessage, buildReplyTarget } from "./message-reply"

describe("message reply helpers", () => {
  test("builds a quoted reply target for stream messages", () => {
    const target = buildReplyTarget(
      {
        content: "<p>Hello <strong>world</strong></p>",
        display_recipient: "engineering",
        id: 214,
        sender_full_name: "Alice Example",
        stream_id: 9,
        subject: "roadmap",
      },
      [{ name: "engineering", stream_id: 9 }],
    )

    expect(target).toEqual({
      messageId: 214,
      previewText: "Hello world",
      prefixMarkdown: "Original: #**engineering>roadmap@214**\n@_**Alice Example** said:\n```quote\nHello world\n```\n\n",
      senderFullName: "Alice Example",
      topicName: "roadmap",
    })

    expect(buildReplyMessage(target, "On it")).toBe(
      "Original: #**engineering>roadmap@214**\n@_**Alice Example** said:\n```quote\nHello world\n```\n\nOn it",
    )
  })

  test("builds a direct-message reply target with a stable original-message link", () => {
    const target = buildReplyTarget(
      {
        content: "<p>Can you take this?</p>",
        display_recipient: [
          { email: "alice@example.com", full_name: "Alice Example", id: 7 },
          { email: "bob@example.com", full_name: "Bob Example", id: 3 },
        ],
        id: 88,
        sender_full_name: "Alice Example",
        stream_id: null,
        subject: "",
      },
      [],
    )

    expect(target.prefixMarkdown).toBe(
      "Original: [Direct message @ 💬](#narrow/dm/3,7/near/88)\n@_**Alice Example** said:\n```quote\nCan you take this?\n```\n\n",
    )
    expect(target.topicName).toBeUndefined()
  })

  test("falls back to attachment text and extends quote fences when the message contains backticks", () => {
    const attachmentTarget = buildReplyTarget(
      {
        content: '<p><img src="/user_uploads/1/file.png"></p>',
        display_recipient: "engineering",
        id: 1,
        sender_full_name: "Alice Example",
        stream_id: 9,
        subject: "attachments",
      },
      [{ name: "engineering", stream_id: 9 }],
    )

    expect(attachmentTarget.previewText).toBe("(attached file)")

    const fencedTarget = buildReplyTarget(
      {
        content: "Use ```ts fences",
        display_recipient: "engineering",
        id: 2,
        sender_full_name: "Alice Example",
        stream_id: 9,
        subject: "code",
      },
      [{ name: "engineering", stream_id: 9 }],
    )

    expect(fencedTarget.prefixMarkdown).toContain("````quote\nUse ```ts fences\n````")
  })
})
