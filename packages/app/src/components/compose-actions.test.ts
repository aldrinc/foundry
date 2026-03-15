import { describe, expect, test } from "bun:test"

import {
  CALL_PROVIDER,
  buildBlockInsert,
  buildCallMessage,
  buildGlobalTimeMessage,
  buildInlineInsert,
  buildPollMessage,
  buildTodoMessage,
  chooseGifProvider,
  createCurrentHourDate,
  formatDateTimeLocalValue,
  getGifDisabledReason,
  getGifRating,
  getSavedSnippetDisabledReason,
  getVideoCallDisabledReason,
  getVoiceCallDisabledReason,
} from "./compose-actions"

describe("compose action helpers", () => {
  test("frames poll content with non-empty options", () => {
    expect(buildPollMessage(" Standup? ", ["Yes", "", " No "])).toBe("/poll Standup?\nYes\nNo")
  })

  test("frames todo content with descriptions", () => {
    expect(
      buildTodoMessage(" Sprint ", [
        { name: "Ship desktop", description: "" },
        { name: "Review plan", description: "with design" },
        { name: "   ", description: "ignored" },
      ]),
    ).toBe("/todo Sprint\nShip desktop\nReview plan: with design")
  })

  test("builds inline and block insertions without losing cursor placement", () => {
    expect(buildInlineInsert("hello world", 5, 5, ",")).toEqual({
      value: "hello, world",
      selectionStart: 6,
      selectionEnd: 6,
    })

    expect(buildBlockInsert("hello", 5, 5, "/poll Ready?\nYes")).toEqual({
      value: "hello\n/poll Ready?\nYes",
      selectionStart: 22,
      selectionEnd: 22,
    })
  })

  test("builds markdown snippets for time and calls", () => {
    expect(buildGlobalTimeMessage("2026-03-15T20:00:00Z")).toBe("<time:2026-03-15T20:00:00Z> ")
    expect(buildCallMessage("https://call.example.com", false)).toBe("[Join video call.](https://call.example.com)")
    expect(buildCallMessage("https://call.example.com", true)).toBe("[Join voice call.](https://call.example.com)")
  })

  test("maps call-provider availability correctly", () => {
    expect(getVideoCallDisabledReason(CALL_PROVIDER.DISABLED, null)).toBe(
      "This organization has not configured a call provider.",
    )
    expect(getVideoCallDisabledReason(CALL_PROVIDER.JITSI, "")).toBe(
      "This organization's Jitsi configuration is incomplete.",
    )
    expect(getVoiceCallDisabledReason(CALL_PROVIDER.NEXTCLOUD_TALK, "https://meet.example.com")).toBe(
      "Voice calls are not available for Nextcloud Talk.",
    )
    expect(getVoiceCallDisabledReason(CALL_PROVIDER.JITSI, "https://meet.example.com")).toBeNull()
  })

  test("maps saved-snippet and gif availability correctly", () => {
    expect(getSavedSnippetDisabledReason(296)).toBe("Saved snippets require a newer Foundry server.")
    expect(getSavedSnippetDisabledReason(297)).toBeNull()

    const enabledConfig = {
      giphyApiKey: "",
      tenorApiKey: "tenor-key",
      gifRatingPolicy: 2,
    }
    expect(chooseGifProvider(enabledConfig)).toBe("tenor")
    expect(getGifDisabledReason(enabledConfig)).toBeNull()
    expect(getGifRating(2)).toBe("pg")
    expect(getGifDisabledReason({ ...enabledConfig, tenorApiKey: "", gifRatingPolicy: 0 })).toBe(
      "GIFs are disabled by this organization.",
    )
  })

  test("formats datetime-local values at minute precision", () => {
    const date = new Date("2026-03-15T20:42:19.999Z")
    expect(formatDateTimeLocalValue(date)).toMatch(/2026-03-15T\d{2}:\d{2}/)

    const rounded = createCurrentHourDate()
    expect(rounded.getMinutes()).toBe(0)
    expect(rounded.getSeconds()).toBe(0)
    expect(rounded.getMilliseconds()).toBe(0)
  })
})
