import { describe, expect, test } from "bun:test"
import {
  resolveAuthenticatedMediaUrl,
  resolveMessageUrl,
  shouldFetchAuthenticatedMedia,
} from "./message-html"

describe("resolveMessageUrl", () => {
  test("preserves absolute urls", () => {
    expect(resolveMessageUrl("https://example.com/path")).toBe("https://example.com/path")
    expect(resolveMessageUrl("mailto:test@example.com")).toBe("mailto:test@example.com")
  })

  test("resolves relative upload urls against the current realm", () => {
    expect(resolveMessageUrl("/user_uploads/1/file.png", "https://chat.example.com")).toBe(
      "https://chat.example.com/user_uploads/1/file.png",
    )
  })

  test("leaves relative urls alone when the realm url is unavailable", () => {
    expect(resolveMessageUrl("/user_uploads/1/file.png")).toBe("/user_uploads/1/file.png")
  })
})

describe("shouldFetchAuthenticatedMedia", () => {
  test("requires same-origin realm-hosted uploads", () => {
    expect(
      shouldFetchAuthenticatedMedia(
        "https://zulip.meridian.cv/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        "https://zulip.meridian.cv",
      ),
    ).toBe(true)
  })

  test("ignores public same-origin static assets", () => {
    expect(
      shouldFetchAuthenticatedMedia(
        "https://zulip.meridian.cv/static/images/story-tutorial/zulip-compose.png",
        "https://zulip.meridian.cv",
      ),
    ).toBe(false)
  })

  test("ignores foreign origins", () => {
    expect(
      shouldFetchAuthenticatedMedia(
        "https://example.com/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        "https://zulip.meridian.cv",
      ),
    ).toBe(false)
  })
})

describe("resolveAuthenticatedMediaUrl", () => {
  test("prefers a protected thumbnail src when one is present", () => {
    expect(
      resolveAuthenticatedMediaUrl(
        "https://zulip.meridian.cv/user_uploads/thumbnail/3/5b/file.png/840x560.webp",
        null,
        "https://zulip.meridian.cv/user_uploads/3/5b/file.png",
        "https://zulip.meridian.cv",
      ),
    ).toBe("https://zulip.meridian.cv/user_uploads/thumbnail/3/5b/file.png/840x560.webp")
  })

  test("falls back to the protected upload link when the image src is a loader placeholder", () => {
    expect(
      resolveAuthenticatedMediaUrl(
        "https://zulip.meridian.cv/static/images/loading/loader-black.svg",
        null,
        "/user_uploads/3/5b/file.png",
        "https://zulip.meridian.cv",
      ),
    ).toBe("https://zulip.meridian.cv/user_uploads/3/5b/file.png")
  })

  test("uses data-original-src for markdown image placeholders", () => {
    expect(
      resolveAuthenticatedMediaUrl(
        "/static/images/loading/loader-black.svg",
        "/user_uploads/3/5b/file.png",
        null,
        "https://zulip.meridian.cv",
      ),
    ).toBe("https://zulip.meridian.cv/user_uploads/3/5b/file.png")
  })
})
