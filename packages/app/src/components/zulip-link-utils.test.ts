import { describe, expect, test } from "bun:test"
import {
  buildDirectMessageLinkMarkdown,
  buildMessageLinkMarkdown,
  buildStreamLinkMarkdown,
  buildTopicLinkMarkdown,
  parseZulipConversationLink,
  parseSameOriginHashRoute,
  transformZulipConversationLinkToMarkdown,
} from "./zulip-link-utils"

describe("buildStreamLinkMarkdown", () => {
  test("uses Zulip shorthand syntax for standard stream names", () => {
    expect(buildStreamLinkMarkdown(9, "announce")).toBe("#**announce**")
  })

  test("falls back to markdown links when the stream name breaks Zulip shorthand syntax", () => {
    expect(buildStreamLinkMarkdown(9, "Sw*den")).toBe(
      "[#Sw&#42;den](#narrow/channel/9-Sw*den)",
    )
  })
})

describe("buildTopicLinkMarkdown", () => {
  test("uses Zulip shorthand syntax for standard topic links", () => {
    expect(buildTopicLinkMarkdown(9, "announce", "roadmap")).toBe("#**announce>roadmap**")
  })

  test("falls back to markdown links for empty topics with special-character stream names", () => {
    expect(buildTopicLinkMarkdown(9, "Sw*den", "")).toBe(
      "[#Sw&#42;den > general chat](#narrow/channel/9-Sw*den/topic/)",
    )
  })
})

describe("buildMessageLinkMarkdown", () => {
  test("uses Zulip message-link shorthand syntax", () => {
    expect(buildMessageLinkMarkdown(9, "announce", "roadmap", 214)).toBe("#**announce>roadmap@214**")
  })
})

describe("buildDirectMessageLinkMarkdown", () => {
  test("creates a stable markdown link for direct messages", () => {
    expect(buildDirectMessageLinkMarkdown([12, 5], 90)).toBe(
      "[Direct message @ 💬](#narrow/dm/5,12/near/90)",
    )
  })
})

describe("parseZulipConversationLink", () => {
  test("parses current copied topic hashes that use the stream operator", () => {
    expect(parseZulipConversationLink(
      "#narrow/stream/9-mos-general/topic/Swipe-image%20style%20testimonials",
      {
        subscriptions: [{ stream_id: 9, name: "mos-general" }],
      },
    )).toEqual({
      kind: "topic",
      narrow: "stream:9/topic:Swipe-image style testimonials",
      streamId: 9,
      streamName: "mos-general",
      topicName: "Swipe-image style testimonials",
    })
  })

  test("parses rendered same-realm message links that use the channel operator", () => {
    expect(parseZulipConversationLink(
      "https://zulip.meridian.cv/#narrow/channel/9-announce/topic/roadmap/near/214",
      {
        realmUrl: "https://zulip.meridian.cv",
        subscriptions: [{ stream_id: 9, name: "announce" }],
      },
    )).toEqual({
      kind: "message",
      narrow: "stream:9/topic:roadmap",
      messageId: 214,
      streamId: 9,
      streamName: "announce",
      topicName: "roadmap",
    })
  })

  test("parses rendered same-realm topic links that use Zulip dot-escaped hash encoding", () => {
    expect(parseZulipConversationLink(
      "https://zulip.meridian.cv/#narrow/channel/9-mos-general/topic/Swipe-image.20style.20testimonials/with/2188",
      {
        realmUrl: "https://zulip.meridian.cv",
        subscriptions: [{ stream_id: 9, name: "mos-general" }],
      },
    )).toEqual({
      kind: "topic",
      narrow: "stream:9/topic:Swipe-image style testimonials",
      streamId: 9,
      streamName: "mos-general",
      topicName: "Swipe-image style testimonials",
    })
  })

  test("ignores foreign-realm absolute urls", () => {
    expect(parseZulipConversationLink(
      "https://other.example/#narrow/channel/9-announce/topic/roadmap",
      {
        realmUrl: "https://zulip.meridian.cv",
        subscriptions: [{ stream_id: 9, name: "announce" }],
      },
    )).toBeNull()
  })
})

describe("parseSameOriginHashRoute", () => {
  const realm = "https://zulip.meridian.cv"

  test("maps #recent to recent-topics", () => {
    expect(parseSameOriginHashRoute(`${realm}/#recent`, realm))
      .toEqual({ narrow: "recent-topics" })
  })

  test("maps #all to all-messages", () => {
    expect(parseSameOriginHashRoute(`${realm}/#all`, realm))
      .toEqual({ narrow: "all-messages" })
  })

  test("maps #starred to starred", () => {
    expect(parseSameOriginHashRoute(`${realm}/#starred`, realm))
      .toEqual({ narrow: "starred" })
  })

  test("maps #inbox to null (inbox view)", () => {
    expect(parseSameOriginHashRoute(`${realm}/#inbox`, realm))
      .toEqual({ narrow: null })
  })

  test("maps same-origin link with no hash to inbox", () => {
    expect(parseSameOriginHashRoute(realm, realm))
      .toEqual({ narrow: null })
  })

  test("maps same-origin link with empty hash to inbox", () => {
    expect(parseSameOriginHashRoute(`${realm}/#`, realm))
      .toEqual({ narrow: null })
  })

  test("returns null for same-origin non-root paths without a handled hash", () => {
    expect(parseSameOriginHashRoute(`${realm}/user_uploads/1/file.txt`, realm))
      .toBeNull()
    expect(parseSameOriginHashRoute(`${realm}/settings`, realm))
      .toBeNull()
  })

  test("returns null for handled hashes on a different same-origin path", () => {
    expect(parseSameOriginHashRoute(`${realm}/help#recent`, realm))
      .toBeNull()
  })

  test("matches a realm served from a subpath", () => {
    const subpathRealm = "https://zulip.meridian.cv/tenant"

    expect(parseSameOriginHashRoute(`${subpathRealm}/#recent`, subpathRealm))
      .toEqual({ narrow: "recent-topics" })
    expect(parseSameOriginHashRoute("https://zulip.meridian.cv/#recent", subpathRealm))
      .toBeNull()
  })

  test("returns null for foreign-origin links", () => {
    expect(parseSameOriginHashRoute("https://other.example/#recent", realm))
      .toBeNull()
  })

  test("returns null for unrecognized hashes", () => {
    expect(parseSameOriginHashRoute(`${realm}/#settings`, realm))
      .toBeNull()
  })

  test("returns null when realmUrl is undefined", () => {
    expect(parseSameOriginHashRoute(`${realm}/#recent`, undefined))
      .toBeNull()
  })
})

describe("transformZulipConversationLinkToMarkdown", () => {
  test("converts copied topic hashes into Zulip-renderable shorthand", () => {
    expect(transformZulipConversationLinkToMarkdown(
      "#narrow/stream/9-mos-general/topic/Swipe-image%20style%20testimonials",
      {
        subscriptions: [{ stream_id: 9, name: "mos-general" }],
      },
    )).toBe("#**mos-general>Swipe-image style testimonials**")
  })

  test("drops the with anchor when converting topic links", () => {
    expect(transformZulipConversationLinkToMarkdown(
      "https://zulip.meridian.cv/#narrow/channel/9-announce/topic/roadmap/with/214",
      {
        realmUrl: "https://zulip.meridian.cv",
        subscriptions: [{ stream_id: 9, name: "announce" }],
      },
    )).toBe("#**announce>roadmap**")
  })

  test("converts Zulip dot-escaped topic links back into shorthand", () => {
    expect(transformZulipConversationLinkToMarkdown(
      "https://zulip.meridian.cv/#narrow/channel/9-mos-general/topic/Swipe-image.20style.20testimonials/with/2188",
      {
        realmUrl: "https://zulip.meridian.cv",
        subscriptions: [{ stream_id: 9, name: "mos-general" }],
      },
    )).toBe("#**mos-general>Swipe-image style testimonials**")
  })
})
